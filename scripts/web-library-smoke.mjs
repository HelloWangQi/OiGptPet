import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, totalmem, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const startedAt = performance.now();
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const outputDirectory = resolve(root, `artifacts/web-library/run-${runId}`);
await mkdir(outputDirectory, { recursive: true });

const inputs = {
  vrm: {
    path: 'public/models/demo.vrm',
    bytes: 10_776_032,
    sha256: '12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2',
    name: 'VRM1_Constraint_Twist_Sample',
  },
  v1: {
    path: 'artifacts/animation-fixes/run-04/atlas-v1.png',
    bytes: 293_190,
    sha256: '05ac930c71c9a8f5308c2fc4c5aedcffaec99b865cbdc5a36b1c4ade1156e8f6',
    width: 1536,
    height: 1872,
  },
  v2: {
    path: 'artifacts/animation-fixes/run-04/atlas-v2.png',
    bytes: 370_954,
    sha256: '84604125009381796d748388ab5b934dd9faac581b8cd8a00fd4417b4b3acada',
    width: 1536,
    height: 2288,
  },
};

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

for (const input of Object.values(inputs)) {
  const bytes = await readFile(resolve(root, input.path));
  assert.equal(bytes.byteLength, input.bytes, `${input.path}: input byte size drifted`);
  assert.equal(hash(bytes), input.sha256, `${input.path}: input hash drifted`);
}

function removeOwnTempDirectory(directory) {
  const resolved = resolve(directory);
  const relativePath = relative(resolve(tmpdir()), resolved);
  assert.ok(
    relativePath.startsWith('oigptpet-web-library-')
      && !relativePath.startsWith('..')
      && !relativePath.includes(':'),
    `refusing to remove unexpected temp path: ${resolved}`,
  );
  return rm(resolved, { recursive: true, force: true });
}

const temp = await mkdtemp(join(tmpdir(), 'oigptpet-web-library-'));
const appDirectory = join(temp, 'app');
const userData = join(temp, 'user-data');
const cacheDirectory = join(temp, 'vite-cache');
const webpDirectory = join(temp, 'webp-inputs');
await Promise.all([
  mkdir(appDirectory, { recursive: true }),
  mkdir(userData, { recursive: true }),
  mkdir(cacheDirectory, { recursive: true }),
  mkdir(webpDirectory, { recursive: true }),
]);
await writeFile(
  join(appDirectory, 'package.json'),
  JSON.stringify({ name: 'web-library-smoke-app', version: '0.0.0', main: 'main.cjs' }),
);
await writeFile(
  join(appDirectory, 'main.cjs'),
  `const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.WEB_LIBRARY_SMOKE_USER_DATA);
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { backgroundThrottling: false },
  });
  window.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
`,
);

let desktop = null;
let page = null;
let server = null;
let mainUrl = null;
const pageErrors = [];
const consoleErrors = [];
const screenshots = [];
const timings = {};
const webp = {};
let legacySeed = null;
let layoutAudit = null;

async function screenshot(name) {
  const path = join(outputDirectory, name);
  await page.screenshot({ path });
  const bytes = (await readFile(path)).byteLength;
  assert.ok(bytes > 0, `${name}: screenshot must not be empty`);
  screenshots.push({ name, bytes });
}

async function waitForReady(timeout = 180_000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await page.waitForFunction(() => {
        const status = document.querySelector('#status');
        const importButton = document.querySelector('#import-button');
        return Boolean(status && importButton && !(importButton).disabled
          && !status.textContent.includes('正在准备角色工坊'));
      }, undefined, { timeout: Math.min(30_000, Math.max(1_000, deadline - Date.now())) });
      break;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(500);
    }
  }
  if (lastError) throw lastError;
  const status = page.locator('#status');
  assert.equal(await status.evaluate((node) => node.classList.contains('error')), false,
    `main page reported an error: ${await status.innerText()}`);
  assert.equal(await page.locator('#import-button').isDisabled(), false);
}

async function waitForCharacter(id, kind, timeout = 120_000) {
  await page.waitForFunction(({ expectedId, expectedKind }) => (
    document.body.dataset.characterId === expectedId
      && document.body.dataset.characterKind === expectedKind
  ), { expectedId: id, expectedKind: kind }, { timeout });
}

async function waitForOpaqueSprite(timeout = 90_000) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#character-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] >= 8 && ++opaque > 64) return true;
    }
    return false;
  }, undefined, { timeout });
}

async function readLibrary() {
  return page.evaluate(async () => {
    const request = (idbRequest) => new Promise((resolveResult, reject) => {
      idbRequest.onsuccess = () => resolveResult(idbRequest.result);
      idbRequest.onerror = () => reject(idbRequest.error);
    });
    const open = () => new Promise((resolveDb, reject) => {
      const idbRequest = indexedDB.open('oigptpet-library');
      idbRequest.onsuccess = () => resolveDb(idbRequest.result);
      idbRequest.onerror = () => reject(idbRequest.error);
    });
    const digest = async (buffer) => {
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
      return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    };
    const db = await open();
    try {
      const tx = db.transaction(['characters', 'assets', 'meta'], 'readonly');
      const [summaries, rawAssets, pointer] = await Promise.all([
        request(tx.objectStore('characters').getAll()),
        request(tx.objectStore('assets').getAll()),
        request(tx.objectStore('meta').get('active')),
      ]);
      const assets = [];
      for (const asset of rawAssets) {
        const buffer = asset.blob instanceof Blob ? await asset.blob.arrayBuffer() : null;
        assets.push({
          id: asset.id,
          size: asset.blob?.size ?? null,
          sha256: buffer ? await digest(buffer) : null,
        });
      }
      return {
        version: db.version,
        stores: Array.from(db.objectStoreNames),
        summaries,
        assets,
        activeId: pointer?.id ?? null,
      };
    } finally {
      db.close();
    }
  });
}

async function readLegacy() {
  return page.evaluate(async () => {
    const request = (idbRequest) => new Promise((resolveResult, reject) => {
      idbRequest.onsuccess = () => resolveResult(idbRequest.result);
      idbRequest.onerror = () => reject(idbRequest.error);
    });
    const open = () => new Promise((resolveDb, reject) => {
      const idbRequest = indexedDB.open('oigptpet');
      idbRequest.onsuccess = () => resolveDb(idbRequest.result);
      idbRequest.onerror = () => reject(idbRequest.error);
    });
    const digest = async (buffer) => {
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
      return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    };
    const db = await open();
    try {
      const value = await request(db.transaction('models', 'readonly').objectStore('models').get('current'));
      const buffer = value instanceof ArrayBuffer ? value : null;
      return {
        version: db.version,
        stores: Array.from(db.objectStoreNames),
        bytes: buffer?.byteLength ?? null,
        sha256: buffer ? await digest(buffer) : null,
      };
    } finally {
      db.close();
    }
  });
}

async function readDatabases() {
  return page.evaluate(async () => (await indexedDB.databases()).map(({ name, version }) => ({ name, version })));
}

function summaryOf(library, id) {
  const summary = library.summaries.find((entry) => entry.id === id);
  assert.ok(summary, `expected summary ${id}`);
  return summary;
}

function assetOf(library, id) {
  const asset = library.assets.find((entry) => entry.id === id);
  assert.ok(asset, `expected stored asset ${id}`);
  return asset;
}

function assertStoredBytes(library, id, expectedHash, expectedBytes) {
  const summary = summaryOf(library, id);
  assert.equal(summary.sha256, expectedHash);
  assert.equal(summary.encodedBytes, expectedBytes);
  const asset = assetOf(library, id);
  assert.equal(asset.sha256, expectedHash);
  assert.equal(asset.size, expectedBytes);
}

async function importWebp(profile, encoded, expectedId) {
  await page.locator('#sprite-profile').selectOption(profile);
  await page.locator('#model-file').setInputFiles({
    name: `atlas-${profile}.webp`,
    mimeType: 'image/webp',
    buffer: encoded.buffer,
  });
  await waitForCharacter(expectedId, 'sprite');
  await page.locator('#import-button:not([disabled])').waitFor({ timeout: 120_000 });
  await page.waitForFunction((expected) => document.querySelector('#format-badge')?.textContent === expected,
    `SPRITE ${profile}`, { timeout: 30_000 });
}

async function importInvalid(encoded, profile, expectedMessage) {
  await page.locator('#sprite-profile').selectOption(profile);
  await page.locator('#model-file').setInputFiles({
    name: `invalid-${profile}.webp`,
    mimeType: 'image/webp',
    buffer: encoded,
  });
  await page.waitForFunction(() => {
    const status = document.querySelector('#status');
    return status && status.textContent.includes('保留原角色')
      && !document.querySelector('#import-button').disabled;
  }, undefined, { timeout: 120_000 });
  const statusText = await page.locator('#status').innerText();
  assert.match(statusText, expectedMessage);
  return statusText;
}

try {
  const serverStartedAt = performance.now();
  server = await createServer({
    configFile: false,
    root,
    logLevel: 'error',
    appType: 'spa',
    cacheDir: cacheDirectory,
    define: { __WITH_DEMO__: 'false' },
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls?.local?.[0];
  assert.ok(baseUrl, 'Vite dev server did not expose a local URL');
  mainUrl = new URL('index.html', baseUrl).href;
  const demoUrl = new URL(inputs.vrm.path, baseUrl).href;
  const atlasUrl = (profile) => new URL(inputs[profile].path, baseUrl).href;
  timings.serverStartMs = performance.now() - serverStartedAt;

  if (typeof server.warmupRequest === 'function') {
    await server.warmupRequest('/src/main.ts').catch(() => {});
  }

  const launchEnvironment = { ...process.env, WEB_LIBRARY_SMOKE_USER_DATA: userData };
  delete launchEnvironment.ELECTRON_RUN_AS_NODE;
  const launchStartedAt = performance.now();
  desktop = await electron.launch({
    args: [appDirectory, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    cwd: root,
    env: launchEnvironment,
    timeout: 60_000,
  });
  timings.launchMs = performance.now() - launchStartedAt;
  const environment = await desktop.evaluate(() => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }));
  page = await desktop.firstWindow({ timeout: 60_000 });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await desktop.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false);
      window.show();
      window.focus();
    }
  });
  await page.bringToFront();

  const seedStartedAt = performance.now();
  const routePattern = '**/src/main.ts*';
  await page.route(routePattern, (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: '/* seed-only page; application module intentionally not loaded */',
  }));
  await page.goto(mainUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('#app').waitFor({ state: 'attached', timeout: 60_000 });
  const initialDatabases = await readDatabases();
  assert.deepEqual(initialDatabases, [], 'isolated profile should start without databases');
  legacySeed = await page.evaluate(async ({ url }) => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`demo VRM fetch failed: HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const digest = async (value) => {
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', value));
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    };
    await new Promise((resolveSeed, reject) => {
      const idbRequest = indexedDB.open('oigptpet', 1);
      idbRequest.onupgradeneeded = () => idbRequest.result.createObjectStore('models');
      idbRequest.onerror = () => reject(idbRequest.error);
      idbRequest.onsuccess = () => {
        const db = idbRequest.result;
        const tx = db.transaction('models', 'readwrite');
        tx.objectStore('models').put(buffer, 'current');
        tx.oncomplete = () => { db.close(); resolveSeed(); };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('legacy seed transaction aborted'));
      };
    });
    return { bytes: buffer.byteLength, sha256: await digest(buffer) };
  }, { url: demoUrl });
  assert.equal(legacySeed.bytes, inputs.vrm.bytes);
  assert.equal(legacySeed.sha256, inputs.vrm.sha256);
  timings.seedMs = performance.now() - seedStartedAt;

  await page.unroute(routePattern);
  const migrationStartedAt = performance.now();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.bringToFront();
  await waitForReady();
  const vrmId = `vrm:${inputs.vrm.sha256}`;
  await waitForCharacter(vrmId, 'vrm');
  timings.migrationMs = performance.now() - migrationStartedAt;

  const browserState = await page.evaluate(() => ({
    petDesktop: typeof window.petDesktop,
    openPetDisabled: document.querySelector('#open-pet')?.disabled ?? null,
    openPetText: document.querySelector('#open-pet')?.textContent?.trim() ?? null,
    petScaleDisabled: document.querySelector('#pet-scale')?.disabled ?? null,
    performanceDisabled: document.querySelector('#performance-mode')?.disabled ?? null,
    demoHidden: document.querySelector('#load-demo')?.hidden ?? null,
    formatBadge: document.querySelector('#format-badge')?.textContent ?? null,
    characterName: document.querySelector('#character-name')?.textContent ?? null,
    canvas: (() => {
      const canvas = document.querySelector('#character-canvas');
      return canvas ? { width: canvas.width, height: canvas.height, cssWidth: canvas.getBoundingClientRect().width } : null;
    })(),
    visibility: document.visibilityState,
  }));
  assert.equal(browserState.petDesktop, 'undefined');
  assert.equal(browserState.openPetDisabled, true);
  assert.equal(browserState.openPetText, '桌面版功能');
  assert.equal(browserState.petScaleDisabled, true);
  assert.equal(browserState.performanceDisabled, false);
  assert.equal(browserState.demoHidden, true);
  assert.equal(browserState.formatBadge, 'VRM 1.0');
  assert.equal(browserState.characterName, inputs.vrm.name);
  assert.ok(browserState.canvas && browserState.canvas.width > 0 && browserState.canvas.height > 0);
  assert.equal(await page.locator('#character-list .library-row').count(), 1);
  assert.equal(await page.locator('#export-button').isDisabled(), false);

  let library = await readLibrary();
  assert.equal(library.version, 1);
  assert.deepEqual(library.stores.sort(), ['assets', 'characters', 'meta']);
  assert.equal(library.summaries.length, 1);
  assert.equal(library.activeId, vrmId);
  assertStoredBytes(library, vrmId, inputs.vrm.sha256, inputs.vrm.bytes);
  assert.equal(summaryOf(library, vrmId).name, inputs.vrm.name);
  assert.equal(summaryOf(library, vrmId).kind, 'vrm');
  let legacy = await readLegacy();
  assert.equal(legacy.version, 1);
  assert.ok(legacy.stores.includes('models'));
  assert.equal(legacy.bytes, inputs.vrm.bytes);
  assert.equal(legacy.sha256, inputs.vrm.sha256);
  await screenshot('migrated-vrm.png');

  const renamed = '浏览器搭档';
  await page.locator('#character-alias').fill(renamed);
  await page.locator('#rename-character').click();
  await page.waitForFunction((value) => document.querySelector('#character-name')?.textContent === value,
    renamed, { timeout: 60_000 });
  await page.waitForFunction((value) => (
    document.querySelector('[data-select-character]')?.textContent?.includes(value)
  ), renamed, { timeout: 60_000 });
  library = await readLibrary();
  assert.equal(summaryOf(library, vrmId).name, renamed);
  assert.equal(library.activeId, vrmId);

  const refreshStartedAt = performance.now();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.bringToFront();
  await waitForReady();
  await waitForCharacter(vrmId, 'vrm');
  assert.equal(await page.locator('#character-name').innerText(), renamed);
  assert.equal(await page.locator('#character-alias').inputValue(), renamed);
  assert.equal(await page.locator('#character-list .library-row').count(), 1);
  library = await readLibrary();
  assert.equal(library.summaries.length, 1);
  assert.equal(library.activeId, vrmId);
  assert.equal(summaryOf(library, vrmId).name, renamed);
  legacy = await readLegacy();
  assert.equal(legacy.sha256, inputs.vrm.sha256);
  timings.renameRefreshMs = performance.now() - refreshStartedAt;

  const encodeStartedAt = performance.now();
  for (const profile of ['v2', 'v1']) {
    const encoded = await page.evaluate(async ({ url }) => {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`atlas fetch failed: HTTP ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2D canvas unavailable for WebP test input');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await new Promise((resolveBlob, reject) => {
        canvas.toBlob((value) => value ? resolveBlob(value) : reject(new Error('WebP encoding failed')), 'image/webp', 1);
      });
      const base64 = await new Promise((resolveData, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolveData(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return { base64, type: blob.type, width: canvas.width, height: canvas.height };
    }, { url: atlasUrl(profile) });
    assert.equal(encoded.type, 'image/webp');
    assert.equal(encoded.width, inputs[profile].width);
    assert.equal(encoded.height, inputs[profile].height);
    const buffer = Buffer.from(encoded.base64, 'base64');
    assert.ok(buffer.length > 0);
    const sha256 = hash(buffer);
    assert.notEqual(sha256, inputs[profile].sha256, `${profile} WebP must be a distinct encoded file`);
    const path = join(webpDirectory, `atlas-${profile}.webp`);
    await writeFile(path, buffer);
    webp[profile] = {
      path,
      bytes: buffer.length,
      sha256,
      buffer,
      width: encoded.width,
      height: encoded.height,
      source: inputs[profile].path,
    };
  }
  timings.webpEncodeMs = performance.now() - encodeStartedAt;

  const importV2StartedAt = performance.now();
  const v2Id = `sprite:v2:${webp.v2.sha256}`;
  await importWebp('v2', webp.v2, v2Id);
  await waitForOpaqueSprite();
  assert.equal(await page.locator('#export-button').isDisabled(), true);
  const v2ExportTitle = await page.locator('#export-button').getAttribute('title');
  assert.match(v2ExportTitle ?? '', /精灵图.*VRM/);
  library = await readLibrary();
  assert.equal(library.summaries.length, 2);
  assert.equal(library.activeId, v2Id);
  assert.equal(summaryOf(library, v2Id).profile, 'v2');
  assert.equal(summaryOf(library, v2Id).kind, 'sprite');
  assertStoredBytes(library, v2Id, webp.v2.sha256, webp.v2.bytes);
  await screenshot('webp-v2.png');
  timings.importV2Ms = performance.now() - importV2StartedAt;

  const v2RefreshStartedAt = performance.now();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.bringToFront();
  await waitForReady();
  await waitForCharacter(v2Id, 'sprite');
  assert.equal(await page.locator('#format-badge').innerText(), 'SPRITE v2');
  assert.equal(await page.locator('#export-button').isDisabled(), true);
  assert.equal(await page.locator('#character-list .library-row').count(), 2);
  await waitForOpaqueSprite();
  library = await readLibrary();
  assert.equal(library.activeId, v2Id);
  assert.equal(library.summaries.length, 2);
  const v2RefreshState = {
    activeId: library.activeId,
    listCount: library.summaries.length,
    vrmName: summaryOf(library, vrmId).name,
  };
  timings.v2RefreshMs = performance.now() - v2RefreshStartedAt;

  const importV1StartedAt = performance.now();
  const v1Id = `sprite:v1:${webp.v1.sha256}`;
  await importWebp('v1', webp.v1, v1Id);
  await waitForOpaqueSprite();
  assert.equal(await page.locator('#export-button').isDisabled(), true);
  library = await readLibrary();
  assert.equal(library.summaries.length, 3);
  assert.equal(library.activeId, v1Id);
  assert.equal(summaryOf(library, v1Id).profile, 'v1');
  assertStoredBytes(library, v1Id, webp.v1.sha256, webp.v1.bytes);
  timings.importV1Ms = performance.now() - importV1StartedAt;

  const invalidStartedAt = performance.now();
  const beforeInvalid = await readLibrary();
  const wrongSpecStatus = await importInvalid(webp.v1.buffer, 'v2', /尺寸|1536|2288/);
  assert.equal(await page.evaluate(() => document.body.dataset.characterId), v1Id);
  let afterInvalid = await readLibrary();
  assert.equal(afterInvalid.summaries.length, 3);
  assert.equal(afterInvalid.activeId, v1Id);

  const corruptPath = join(webpDirectory, 'corrupt-atlas.webp');
  const corruptBytes = Buffer.from(webp.v2.buffer.subarray(0, 96));
  await writeFile(corruptPath, corruptBytes);
  const corruptStatus = await importInvalid(corruptBytes, 'v1', /截断|文件|WebP|格式|解码/);
  assert.equal(await page.evaluate(() => document.body.dataset.characterId), v1Id);
  afterInvalid = await readLibrary();
  assert.equal(afterInvalid.summaries.length, 3);
  assert.equal(afterInvalid.activeId, v1Id);
  assert.deepEqual(afterInvalid.summaries.map((entry) => entry.id).sort(), beforeInvalid.summaries.map((entry) => entry.id).sort());
  timings.invalidInputsMs = performance.now() - invalidStartedAt;

  const switchStartedAt = performance.now();
  await page.locator(`[data-select-character="${vrmId}"]`).click();
  await waitForCharacter(vrmId, 'vrm');
  await page.locator('#export-button:not([disabled])').waitFor({ timeout: 120_000 });
  assert.equal(await page.locator('#format-badge').innerText(), 'VRM 1.0');
  assert.equal(await page.locator('#character-name').innerText(), renamed);
  assert.equal(await page.locator('#character-alias').inputValue(), renamed);
  library = await readLibrary();
  assert.equal(library.activeId, vrmId);
  assert.equal(library.summaries.length, 3);
  assert.equal(summaryOf(library, vrmId).name, renamed);
  timings.switchVrmMs = performance.now() - switchStartedAt;

  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(980, 760);
  });
  await page.waitForTimeout(800);
  layoutAudit = await page.evaluate(() => {
    const canvas = document.querySelector('#character-canvas');
    const host = canvas?.parentElement;
    if (!(canvas instanceof HTMLCanvasElement) || !host) return null;
    const hostRect = host.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      hostWidth: hostRect.width,
      hostHeight: hostRect.height,
      hostContentWidth: host.clientWidth,
      hostContentHeight: host.clientHeight,
      canvasWidth: canvasRect.width,
      canvasHeight: canvasRect.height,
      inlineWidth: canvas.style.width,
      inlineHeight: canvas.style.height,
      computedWidth: getComputedStyle(canvas).width,
      computedHeight: getComputedStyle(canvas).height,
      // The stage has a 1px border; canvas 100% fills its inner content box.
      matchesHost: Math.abs(canvasRect.width - host.clientWidth) < 1
        && Math.abs(canvasRect.height - host.clientHeight) < 1,
    };
  });
  assert.ok(layoutAudit, 'canvas layout audit must resolve');
  assert.ok(layoutAudit.matchesHost, `VRM canvas must follow host content after sprite/resize: ${JSON.stringify(layoutAudit)}`);
  await screenshot('final-vrm.png');

  legacy = await readLegacy();
  assert.equal(legacy.version, 1);
  assert.equal(legacy.bytes, inputs.vrm.bytes);
  assert.equal(legacy.sha256, inputs.vrm.sha256);
  const databases = await readDatabases();
  assert.ok(databases.some(({ name }) => name === 'oigptpet'));
  assert.ok(databases.some(({ name }) => name === 'oigptpet-library'));
  assert.deepEqual(pageErrors, []);

  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    runId,
    fixtureUrl: mainUrl,
    browserPath: 'Temporary Electron Chromium window loading the real src/main.ts page without a preload or petDesktop bridge. This does not represent external Chrome/Edge or a real LAN/mobile browser.',
    migrations: {
      seed: legacySeed,
      libraryId: vrmId,
      libraryName: inputs.vrm.name,
      renamed,
      activeId: library.activeId,
      loadedByMainPage: browserState.characterName === inputs.vrm.name,
      listCountAfterRefresh: 1,
      legacyStillPresent: true,
      legacyBytesUnchanged: legacy.sha256 === inputs.vrm.sha256,
    },
    browserCapabilities: browserState,
    webpInputs: {
      v1: { bytes: webp.v1.bytes, sha256: webp.v1.sha256, width: webp.v1.width, height: webp.v1.height, source: webp.v1.source },
      v2: { bytes: webp.v2.bytes, sha256: webp.v2.sha256, width: webp.v2.width, height: webp.v2.height, source: webp.v2.source },
    },
    spriteImports: {
      v2: { id: v2Id, profile: 'v2', storedBytes: webp.v2.bytes, storedSha256: webp.v2.sha256, canvasOpaque: true, refreshRestored: true, exportButtonDisabled: true, exportTitle: v2ExportTitle },
      v1: { id: v1Id, profile: 'v1', storedBytes: webp.v1.bytes, storedSha256: webp.v1.sha256, canvasOpaque: true, exportButtonDisabled: true },
      finalCount: 3,
    },
    invalidInputs: {
      wrongSpec: { selectedProfile: 'v2', input: 'v1 WebP', status: wrongSpecStatus, activePreserved: v1Id },
      corrupt: { inputBytes: corruptBytes.length, status: corruptStatus, activePreserved: v1Id, entriesPreserved: 3 },
    },
    vrmRestore: {
      id: vrmId,
      name: renamed,
      formatBadge: 'VRM 1.0',
      exportButtonEnabled: true,
      activeId: library.activeId,
    },
    layoutAudit,
    persistence: {
      afterRefresh: v2RefreshState,
      finalActiveId: library.activeId,
      legacyBytesUnchanged: true,
      databases,
    },
    environment: {
      ...environment,
      cpus: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    resources: { pageErrors, consoleErrors },
    screenshots,
    timing: {
      conditions: 'Windows 10, visible Electron Chromium window, local Vite dev server, isolated temporary userData and Vite cache, single process. Wall-clock values include IPC and model loading; not a cross-hardware guarantee.',
      totalMs: performance.now() - startedAt,
      ...timings,
    },
  };
  await writeFile(join(outputDirectory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(
    `Web library smoke passed: real main page migrated the legacy IndexedDB VRM, renamed and refreshed it, imported real PNG-derived v1/v2 WebP through the file input, preserved state on invalid files, and restored VRM export. ${outputDirectory}`,
  );
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(outputDirectory, 'failure.png') }).catch(() => {});
    const status = await page.locator('#status').innerText().catch(() => 'Page unavailable');
    console.error(status);
  }
  await writeFile(
    join(outputDirectory, 'failure.json'),
    JSON.stringify({ message: error instanceof Error ? error.stack : String(error), pageErrors, consoleErrors }, null, 2),
  ).catch(() => {});
  throw error;
} finally {
  if (desktop) {
    await desktop.close().catch(() => {});
  }
  if (server) {
    await server.close();
  }
  await removeOwnTempDirectory(temp);
}
