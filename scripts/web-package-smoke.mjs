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
const outputDirectory = resolve(root, `artifacts/web-package/run-${runId}`);
await mkdir(outputDirectory, { recursive: true });

const inputs = {
  vrm: {
    path: 'public/models/demo.vrm',
    bytes: 10_776_032,
    sha256: '12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2',
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

for (const [label, input] of Object.entries(inputs)) {
  const bytes = await readFile(resolve(root, input.path));
  assert.equal(bytes.byteLength, input.bytes, `${label}: input byte size drifted`);
  assert.equal(hash(bytes), input.sha256, `${label}: input hash drifted`);
}
const sourceBytes = {
  vrm: await readFile(resolve(root, inputs.vrm.path)),
  v1: await readFile(resolve(root, inputs.v1.path)),
  v2: await readFile(resolve(root, inputs.v2.path)),
};
const expectedIds = {
  vrm: `vrm:${inputs.vrm.sha256}`,
  v1: `sprite:v1:${inputs.v1.sha256}`,
  v2: `sprite:v2:${inputs.v2.sha256}`,
};

function removeOwnTempDirectory(directory) {
  const resolved = resolve(directory);
  const relativePath = relative(resolve(tmpdir()), resolved);
  assert.ok(
    relativePath.startsWith('oigptpet-web-package-')
      && !relativePath.startsWith('..')
      && !relativePath.includes(':'),
    `refusing to remove unexpected temp path: ${resolved}`,
  );
  return rm(resolved, { recursive: true, force: true });
}

function buildPackage({ name, kind, profile, payload }) {
  const mime = kind === 'vrm' ? 'model/gltf-binary' : 'image/png';
  const manifest = {
    format: 'oigptpet-character',
    schemaVersion: 1,
    name,
    kind,
    mime,
    encodedBytes: payload.length,
    sha256: hash(payload),
    ...(kind === 'sprite' ? { profile } : {}),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const header = Buffer.alloc(12);
  header.write('OIPET001', 0, 'ascii');
  header.writeUInt32LE(manifestBytes.length, 8);
  return Buffer.concat([header, manifestBytes, payload]);
}

function inspectPackage(bytes, expected, label) {
  assert.equal(bytes.subarray(0, 8).toString('ascii'), 'OIPET001', `${label}: magic`);
  const manifestLength = bytes.readUInt32LE(8);
  assert.equal(manifestLength > 0 && manifestLength <= 65_536, true, `${label}: manifest length`);
  const manifest = JSON.parse(bytes.subarray(12, 12 + manifestLength).toString('utf8'));
  const payload = bytes.subarray(12 + manifestLength);
  assert.equal(manifest.format, 'oigptpet-character', `${label}: format`);
  assert.equal(manifest.schemaVersion, 1, `${label}: schema`);
  assert.equal(manifest.name, expected.name, `${label}: name`);
  assert.equal(manifest.kind, expected.kind, `${label}: kind`);
  assert.equal(manifest.mime, expected.mime, `${label}: mime`);
  assert.equal(manifest.encodedBytes, payload.length, `${label}: encodedBytes`);
  assert.equal(manifest.sha256, hash(payload), `${label}: payload hash`);
  assert.equal(payload.length, expected.payload.length, `${label}: payload length`);
  assert.equal(payload.equals(expected.payload), true, `${label}: payload bytes`);
  if (expected.kind === 'vrm') {
    assert.equal('profile' in manifest, false, `${label}: VRM profile field`);
  } else {
    assert.equal(manifest.profile, expected.profile, `${label}: profile`);
  }
  return {
    bytes: bytes.length,
    sha256: hash(bytes),
    manifestLength,
    manifest,
    payloadBytes: payload.length,
    payloadSha256: hash(payload),
  };
}

const temp = await mkdtemp(join(tmpdir(), 'oigptpet-web-package-'));
const appDirectory = join(temp, 'app');
const userDataA = join(temp, 'profile-a');
const userDataB = join(temp, 'profile-b');
const cacheDirectory = join(temp, 'vite-cache');
await Promise.all([
  mkdir(appDirectory, { recursive: true }),
  mkdir(userDataA, { recursive: true }),
  mkdir(userDataB, { recursive: true }),
  mkdir(cacheDirectory, { recursive: true }),
]);
await writeFile(
  join(appDirectory, 'package.json'),
  JSON.stringify({ name: 'web-package-smoke-app', version: '0.0.0', main: 'main.cjs' }),
);
await writeFile(
  join(appDirectory, 'main.cjs'),
  `const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.WEB_PACKAGE_USER_DATA);
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
let environment = null;
const pageErrors = [];
const consoleErrors = [];
const screenshots = [];
const timings = {};
const backups = {};
const webp = {};

async function screenshot(profile, name) {  const path = join(outputDirectory, name);
  await page.screenshot({ path });
  const bytes = (await readFile(path)).byteLength;
  assert.ok(bytes > 0, `${name}: screenshot must not be empty`);
  screenshots.push({ profile, name, bytes });
}

async function waitForReady(timeout = 180_000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await page.waitForFunction(() => {
        const status = document.querySelector('#status');
        const importButton = document.querySelector('#import-button');
        return Boolean(status && importButton && !importButton.disabled
          && !status.textContent.includes('正在准备角色工坊'));
      }, undefined, { timeout: Math.min(30_000, Math.max(1_000, deadline - Date.now())) });
      break;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(500);
    }
  }
  if (lastError) throw lastError;
  const status = await page.locator('#status');
  assert.equal(await status.evaluate((node) => node.classList.contains('error')), false,
    `main page reported an error: ${await status.innerText()}`);
  assert.equal(await page.locator('#import-button').isDisabled(), false);
  await page.locator('#restore-character:not([disabled])').waitFor({ timeout: 60_000 });
}

async function waitForCharacter(id, kind, timeout = 180_000) {
  await page.waitForFunction(({ expectedId, expectedKind }) => (
    document.body.dataset.characterId === expectedId
      && document.body.dataset.characterKind === expectedKind
  ), { expectedId: id, expectedKind: kind }, { timeout });
}

async function waitForOpaqueSprite(timeout = 90_000) {
  const handle = await page.waitForFunction(() => {
    const canvas = document.querySelector('#character-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] >= 8 && ++opaque > 64) {
        return { width: canvas.width, height: canvas.height, opaque };
      }
    }
    return false;
  }, undefined, { timeout });
  try {
    return await handle.jsonValue();
  } finally {
    await handle.dispose();
  }
}

async function packageIdle() {
  await page.waitForFunction(() => document.body.dataset.packageBusy === '', undefined, { timeout: 120_000 });
  await page.locator('#restore-character:not([disabled])').waitFor({ timeout: 60_000 });
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
          type: asset.blob?.type ?? null,
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

function assertStored(library, id, expected) {
  const summary = summaryOf(library, id);
  assert.equal(summary.sha256, expected.sha256);
  assert.equal(summary.encodedBytes, expected.bytes);
  assert.equal(summary.name, expected.name);
  assert.equal(summary.kind, expected.kind);
  if (expected.kind === 'sprite') {
    assert.equal(summary.profile, expected.profile);
  } else {
    assert.equal('profile' in summary, false);
  }
  const asset = assetOf(library, id);
  assert.equal(asset.sha256, expected.sha256);
  assert.equal(asset.size, expected.bytes);
  if (expected.mime !== undefined) {
    assert.equal(asset.type, expected.mime);
  }
}

async function importPath(filePath, { profile, expectedId, kind, badge }) {
  if (profile) {
    await page.locator('#sprite-profile').selectOption(profile);
  }
  const importStartedAt = performance.now();
  await page.locator('#model-file').setInputFiles(filePath);
  await waitForCharacter(expectedId, kind);
  await page.waitForFunction(() => (
    !document.querySelector('#import-button').disabled
    && !document.querySelector('#backup-character').disabled
  ), undefined, { timeout: 120_000 });
  assert.equal(await page.locator('#format-badge').innerText(), badge);
  const render = kind === 'sprite' ? await waitForOpaqueSprite() : null;
  return { elapsedMs: performance.now() - importStartedAt, render };
}

async function importBuffer(buffer, { name, mime, profile, expectedId, kind, badge }) {
  if (profile) {
    await page.locator('#sprite-profile').selectOption(profile);
  }
  const importStartedAt = performance.now();
  await page.locator('#model-file').setInputFiles({ name, mimeType: mime, buffer });
  await waitForCharacter(expectedId, kind);
  await page.waitForFunction(() => (
    !document.querySelector('#import-button').disabled
    && !document.querySelector('#backup-character').disabled
  ), undefined, { timeout: 120_000 });
  assert.equal(await page.locator('#format-badge').innerText(), badge);
  const render = kind === 'sprite' ? await waitForOpaqueSprite() : null;
  return { elapsedMs: performance.now() - importStartedAt, render };
}

async function rename(value) {
  await page.locator('#character-alias').fill(value);
  await page.locator('#rename-character').click();
  await page.waitForFunction((expected) => (
    document.querySelector('#character-name')?.textContent === expected
  ), value, { timeout: 60_000 });
  await page.waitForFunction(() => (
    !document.querySelector('#rename-character').disabled
    && !document.querySelector('#backup-character').disabled
  ), undefined, { timeout: 60_000 });
  const library = await readLibrary();
  assert.ok(library.summaries.some((entry) => entry.name === value),
    `renamed library entry ${value}`);
}

async function backup(label) {
  await page.locator('#backup-character:not([disabled])').waitFor({ timeout: 60_000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
  const backupStartedAt = performance.now();
  await page.locator('#backup-character').click();
  const download = await downloadPromise;
  const filePath = join(outputDirectory, `${label}.oipet`);
  await download.saveAs(filePath);
  const failure = await download.failure();
  const elapsedMs = performance.now() - backupStartedAt;
  await packageIdle();
  const status = await page.locator('#package-status').innerText();
  assert.match(status, /已交给浏览器下载/, `${label}: browser download status`);
  assert.equal(
    await page.locator('#package-status').evaluate((node) => node.classList.contains('error')),
    false,
    `${label}: backup must not report an error`,
  );
  assert.equal(failure, null, `${label}: download must complete`);
  const bytes = await readFile(filePath);
  return {
    path: filePath,
    suggestedFilename: download.suggestedFilename(),
    bytes,
    elapsedMs,
    status,
    downloadFailure: failure,
  };
}

async function restoreFile(filePath) {
  const before = await readLibrary();
  await page.locator('#restore-character:not([disabled])').waitFor({ timeout: 60_000 });
  const previousStatus = await page.locator('#package-status').innerText();
  await page.locator('#package-file').setInputFiles(filePath);
  await page.waitForFunction((previous) => (
    document.body.dataset.packageBusy === 'restore'
    || (document.querySelector('#package-status')?.textContent ?? '') !== previous
  ), previousStatus, { timeout: 30_000 });
  await packageIdle();
  const text = await page.locator('#package-status').innerText();
  const error = await page.locator('#package-status').evaluate((node) => node.classList.contains('error'));
  const after = await readLibrary();
  return { text, error, before, after };
}

async function restoreAndWait(filePath, id, kind, badge) {
  const started = performance.now();
  const result = await restoreFile(filePath);
  assert.equal(result.error, false, `restore ${id}: ${result.text}`);
  await waitForCharacter(id, kind);
  await page.waitForFunction(() => (
    !document.querySelector('#backup-character').disabled
  ), undefined, { timeout: 120_000 });
  assert.equal(await page.locator('#format-badge').innerText(), badge);
  const render = kind === 'sprite' ? await waitForOpaqueSprite() : null;
  return { ...result, elapsedMs: performance.now() - started, render };
}

async function selectCharacter(id, kind, badge) {
  const started = performance.now();
  await page.locator(`[data-select-character="${id}"]`).click();
  await waitForCharacter(id, kind);
  await page.waitForFunction(() => (
    !document.querySelector('#backup-character').disabled
  ), undefined, { timeout: 120_000 });
  assert.equal(await page.locator('#format-badge').innerText(), badge);
  const render = kind === 'sprite' ? await waitForOpaqueSprite() : null;
  const exportDisabled = await page.locator('#export-button').isDisabled();
  assert.equal(exportDisabled, kind === 'sprite', `${id}: export gating`);
  if (kind === 'sprite') {
    assert.match(await page.locator('#export-button').getAttribute('title') ?? '', /精灵图.*VRM/);
  }
  return { elapsedMs: performance.now() - started, exportDisabled, render };
}

async function sampleResources(label) {
  const pageMetrics = await page.evaluate(() => ({
    heap: performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    } : null,
    canvases: Array.from(document.querySelectorAll('canvas'), (canvas) => ({
      id: canvas.id,
      width: canvas.width,
      height: canvas.height,
    })),
    libraryRows: document.querySelectorAll('#character-list .library-row').length,
  }));
  const processes = await desktop.evaluate(({ app }) => app.getAppMetrics());
  return { label, at: new Date().toISOString(), page: pageMetrics, processes };
}

let launchEnvironment = null;

async function launchProfile(profile, userData) {
  const env = {
    ...launchEnvironment,
    WEB_PACKAGE_USER_DATA: userData,
  };
  const launchStartedAt = performance.now();
  desktop = await electron.launch({
    args: [appDirectory, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    cwd: root,
    env,
    acceptDownloads: 'accept',
    timeout: 60_000,
  });
  environment ??= await desktop.evaluate(() => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }));
  page = await desktop.firstWindow({ timeout: 60_000 });
  page.on('pageerror', (error) => pageErrors.push({ profile, message: error.message }));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push({ profile, text: message.text() });
    }
  });
  await desktop.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false);
      window.show();
      window.focus();
    }
  });
  await page.bringToFront();
  await page.goto(mainUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForReady();
  timings[`launch${profile}Ms`] = performance.now() - launchStartedAt;
}

async function closeProfile() {
  if (desktop) {
    await desktop.close();
    desktop = null;
    page = null;
  }
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
  if (typeof server.warmupRequest === 'function') {
    await server.warmupRequest('/src/main.ts').catch(() => {});
  }
  timings.serverStartMs = performance.now() - serverStartedAt;

  launchEnvironment = { ...process.env };
  delete launchEnvironment.ELECTRON_RUN_AS_NODE;

  // Profile A: real imports, renames and backup downloads.
  await launchProfile('A', userDataA);
  const browserPath = await page.evaluate(() => ({
    petDesktop: typeof window.petDesktop,
    openPetDisabled: document.querySelector('#open-pet')?.disabled ?? null,
    formatBadge: document.querySelector('#format-badge')?.textContent ?? null,
  }));
  assert.equal(browserPath.petDesktop, 'undefined', 'browser path must not see petDesktop');
  assert.equal(browserPath.openPetDisabled, true);
  assert.equal(await page.locator('#character-list .library-row').count(), 0);
  assert.equal(await page.locator('#backup-character').isDisabled(), true);
  assert.match(await page.locator('#status').innerText(), /导入本机/);
  await screenshot('A', 'profile-a-empty.png');

  const imports = {};
  imports.vrm = await importPath(resolve(root, inputs.vrm.path), {
    expectedId: expectedIds.vrm,
    kind: 'vrm',
    badge: 'VRM 1.0',
  });
  await rename('备份原名');
  const vrmBackup = await backup('companion-vrm');
  const vrmRecord = inspectPackage(vrmBackup.bytes, {
    name: '备份原名',
    kind: 'vrm',
    mime: 'model/gltf-binary',
    payload: sourceBytes.vrm,
  }, 'VRM backup');
  backups.vrm = { ...vrmBackup, ...vrmRecord };

  await rename('A 本地别名');
  const duplicateA = await restoreFile(vrmBackup.path);
  assert.equal(duplicateA.error, false, duplicateA.text);
  await waitForCharacter(expectedIds.vrm, 'vrm');
  assert.equal(await page.locator('#character-name').innerText(), 'A 本地别名');
  assert.equal(duplicateA.after.summaries.length, 1, 'duplicate restore must not add an entry');
  assert.equal(summaryOf(duplicateA.after, expectedIds.vrm).name, 'A 本地别名');
  assert.equal(duplicateA.after.activeId, expectedIds.vrm);

  imports.v1 = await importPath(resolve(root, inputs.v1.path), {
    profile: 'v1',
    expectedId: expectedIds.v1,
    kind: 'sprite',
    badge: 'SPRITE v1',
  });
  assert.equal(await page.locator('#export-button').isDisabled(), true);
  await rename('浏览器图集 V1');
  const v1Backup = await backup('companion-v1');
  const v1Record = inspectPackage(v1Backup.bytes, {
    name: '浏览器图集 V1',
    kind: 'sprite',
    profile: 'v1',
    mime: 'image/png',
    payload: sourceBytes.v1,
  }, 'v1 backup');
  backups.v1 = { ...v1Backup, ...v1Record };

  imports.v2 = await importPath(resolve(root, inputs.v2.path), {
    profile: 'v2',
    expectedId: expectedIds.v2,
    kind: 'sprite',
    badge: 'SPRITE v2',
  });
  assert.equal(await page.locator('#export-button').isDisabled(), true);
  await rename('浏览器图集 V2');
  const v2Backup = await backup('companion-v2');
  const v2Record = inspectPackage(v2Backup.bytes, {
    name: '浏览器图集 V2',
    kind: 'sprite',
    profile: 'v2',
    mime: 'image/png',
    payload: sourceBytes.v2,
  }, 'v2 backup');
  backups.v2 = { ...v2Backup, ...v2Record };

  const webpStartedAt = performance.now();
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
  }, { url: new URL(inputs.v2.path, baseUrl).href });
  timings.generateWebpMs = performance.now() - webpStartedAt;
  assert.equal(encoded.type, 'image/webp');
  assert.equal(encoded.width, inputs.v2.width);
  assert.equal(encoded.height, inputs.v2.height);
  webp.base64 = encoded.base64;
  webp.bytes = Buffer.from(encoded.base64, 'base64');
  webp.size = webp.bytes.length;
  webp.sha256 = hash(webp.bytes);
  assert.notEqual(webp.sha256, inputs.v2.sha256);
  await writeFile(join(outputDirectory, 'atlas-v2.webp'), webp.bytes);
  const webpId = `sprite:v2:${webp.sha256}`;

  imports.webp = await importBuffer(webp.bytes, {
    name: 'browser-atlas-v2.webp',
    mime: 'image/webp',
    profile: 'v2',
    expectedId: webpId,
    kind: 'sprite',
    badge: 'SPRITE v2',
  });
  assert.equal(await page.locator('#export-button').isDisabled(), true);
  await rename('浏览器图集 WebP');
  const webpBackup = await backup('companion-webp');
  const webpRecord = inspectPackage(webpBackup.bytes, {
    name: '浏览器图集 WebP',
    kind: 'sprite',
    profile: 'v2',
    mime: 'image/webp',
    payload: webp.bytes,
  }, 'WebP backup');
  backups.webp = { ...webpBackup, ...webpRecord };

  // Export follows the source type: sprite disables it, VRM restores it.
  const vrmRestoreExport = await selectCharacter(expectedIds.vrm, 'vrm', 'VRM 1.0');
  assert.equal(vrmRestoreExport.exportDisabled, false);
  assert.equal(await page.locator('#export-button').getAttribute('title'), '');
  const spriteAgain = await selectCharacter(webpId, 'sprite', 'SPRITE v2');
  assert.equal(spriteAgain.exportDisabled, true);
  const webpExportTitle = await page.locator('#export-button').getAttribute('title');
  assert.match(webpExportTitle ?? '', /精灵图.*VRM/);
  timings.exportGateMs = vrmRestoreExport.elapsedMs + spriteAgain.elapsedMs;

  let libraryA = await readLibrary();
  assert.equal(libraryA.summaries.length, 4);
  assert.equal(libraryA.activeId, webpId);
  assert.deepEqual(
    libraryA.summaries.map((entry) => entry.id).sort(),
    [expectedIds.vrm, expectedIds.v1, expectedIds.v2, webpId].sort(),
  );
  assertStored(libraryA, expectedIds.vrm, {
    name: 'A 本地别名',
    kind: 'vrm',
    sha256: inputs.vrm.sha256,
    bytes: inputs.vrm.bytes,
  });
  assertStored(libraryA, expectedIds.v1, {
    name: '浏览器图集 V1',
    kind: 'sprite',
    profile: 'v1',
    sha256: inputs.v1.sha256,
    bytes: inputs.v1.bytes,
  });
  assertStored(libraryA, expectedIds.v2, {
    name: '浏览器图集 V2',
    kind: 'sprite',
    profile: 'v2',
    sha256: inputs.v2.sha256,
    bytes: inputs.v2.bytes,
  });
  assertStored(libraryA, webpId, {
    name: '浏览器图集 WebP',
    kind: 'sprite',
    profile: 'v2',
    sha256: webp.sha256,
    bytes: webp.size,
    mime: 'image/webp',
  });
  await screenshot('A', 'profile-a-imports.png');
  await closeProfile();

  // Profile B: a clean browser data directory restores each backup through the UI.
  await launchProfile('B', userDataB);
  assert.equal(await page.locator('#character-list .library-row').count(), 0);
  assert.equal(await page.locator('body').getAttribute('data-character-id'), null);
  assert.equal((await readLibrary()).summaries.length, 0);
  const emptyB = await readLibrary();
  assert.equal(emptyB.activeId, null);

  const restores = {};
  restores.vrm = await restoreAndWait(vrmBackup.path, expectedIds.vrm, 'vrm', 'VRM 1.0');
  let libraryB = await readLibrary();
  assert.equal(libraryB.summaries.length, 1);
  assert.equal(libraryB.activeId, expectedIds.vrm);
  assert.equal(await page.locator('#character-name').innerText(), '备份原名');
  assert.equal(await page.locator('#stage-empty').isHidden(), true);
  const canvasVrm = await page.locator('#character-canvas').evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    cssWidth: canvas.getBoundingClientRect().width,
  }));
  assert.ok(canvasVrm.width > 0 && canvasVrm.height > 0);
  assert.equal(await page.locator('#export-button').isDisabled(), false);
  assertStored(libraryB, expectedIds.vrm, {
    name: '备份原名',
    kind: 'vrm',
    sha256: inputs.vrm.sha256,
    bytes: inputs.vrm.bytes,
    mime: 'model/gltf-binary',
  });

  await rename('B 本地别名');
  const duplicateB = await restoreFile(vrmBackup.path);
  assert.equal(duplicateB.error, false, duplicateB.text);
  await waitForCharacter(expectedIds.vrm, 'vrm');
  assert.equal(await page.locator('#character-name').innerText(), 'B 本地别名');
  assert.equal(duplicateB.after.summaries.length, 1);
  assert.equal(summaryOf(duplicateB.after, expectedIds.vrm).name, 'B 本地别名');

  restores.v1 = await restoreAndWait(v1Backup.path, expectedIds.v1, 'sprite', 'SPRITE v1');
  libraryB = await readLibrary();
  assert.equal(libraryB.summaries.length, 2);
  assert.equal(libraryB.activeId, expectedIds.v1);
  assert.equal(await page.locator('#character-name').innerText(), '浏览器图集 V1');
  assertStored(libraryB, expectedIds.v1, {
    name: '浏览器图集 V1',
    kind: 'sprite',
    profile: 'v1',
    sha256: inputs.v1.sha256,
    bytes: inputs.v1.bytes,
    mime: 'image/png',
  });

  restores.v2 = await restoreAndWait(v2Backup.path, expectedIds.v2, 'sprite', 'SPRITE v2');
  libraryB = await readLibrary();
  assert.equal(libraryB.summaries.length, 3);
  assert.equal(libraryB.activeId, expectedIds.v2);
  assert.equal(await page.locator('#character-name').innerText(), '浏览器图集 V2');
  assertStored(libraryB, expectedIds.v2, {
    name: '浏览器图集 V2',
    kind: 'sprite',
    profile: 'v2',
    sha256: inputs.v2.sha256,
    bytes: inputs.v2.bytes,
    mime: 'image/png',
  });

  restores.webp = await restoreAndWait(webpBackup.path, webpId, 'sprite', 'SPRITE v2');
  libraryB = await readLibrary();
  assert.equal(libraryB.summaries.length, 4);
  assert.equal(libraryB.activeId, webpId);
  assert.equal(await page.locator('#character-name').innerText(), '浏览器图集 WebP');
  assertStored(libraryB, webpId, {
    name: '浏览器图集 WebP',
    kind: 'sprite',
    profile: 'v2',
    sha256: webp.sha256,
    bytes: webp.size,
    mime: 'image/webp',
  });
  assert.equal(await page.locator('#export-button').isDisabled(), true);
  await page.waitForFunction(() => (
    document.querySelectorAll('#character-list .library-row').length === 4
  ), undefined, { timeout: 60_000 });
  await screenshot('B', 'profile-b-restored.png');

  // Invalid files and wrong source types must leave the current character and library intact.
  const invalidRestores = [];
  const currentBeforeInvalid = await page.evaluate(() => document.body.dataset.characterId);
  const libraryBeforeInvalid = await readLibrary();
  const truncatedPath = join(outputDirectory, 'invalid-truncated.oipet');
  await writeFile(truncatedPath, v1Backup.bytes.subarray(0, v1Backup.bytes.length - 1));
  const truncated = await restoreFile(truncatedPath);
  assert.equal(truncated.error, true);
  assert.match(truncated.text, /原角色保持不变/);
  invalidRestores.push({ label: 'truncated', status: truncated.text, error: true });

  const wrongFile = Buffer.from('this is not a character backup', 'utf8');
  const wrongFilePath = join(outputDirectory, 'invalid-wrong-file.oipet');
  await writeFile(wrongFilePath, wrongFile);
  const wrongFileResult = await restoreFile(wrongFilePath);
  assert.equal(wrongFileResult.error, true);
  assert.match(wrongFileResult.text, /原角色保持不变/);
  invalidRestores.push({ label: 'wrong-file', status: wrongFileResult.text, error: true });

  const wrongSourceBytes = buildPackage({
    name: '错误来源类型',
    kind: 'vrm',
    payload: sourceBytes.v1,
  });
  const wrongSourcePath = join(outputDirectory, 'invalid-wrong-source.oipet');
  await writeFile(wrongSourcePath, wrongSourceBytes);
  const wrongSource = await restoreFile(wrongSourcePath);
  assert.equal(wrongSource.error, true, wrongSource.text);
  assert.match(wrongSource.text, /原角色保持不变/);
  invalidRestores.push({ label: 'wrong-source-type', status: wrongSource.text, error: true });

  assert.equal(await page.evaluate(() => document.body.dataset.characterId), currentBeforeInvalid);
  const libraryAfterInvalid = await readLibrary();
  assert.equal(libraryAfterInvalid.summaries.length, libraryBeforeInvalid.summaries.length);
  assert.equal(libraryAfterInvalid.activeId, libraryBeforeInvalid.activeId);
  assert.deepEqual(
    libraryAfterInvalid.summaries.map((entry) => entry.id).sort(),
    libraryBeforeInvalid.summaries.map((entry) => entry.id).sort(),
  );

  const switchTypes = {
    vrm: { id: expectedIds.vrm, kind: 'vrm', badge: 'VRM 1.0', type: 'vrm' },
    v1: { id: expectedIds.v1, kind: 'sprite', badge: 'SPRITE v1', type: 'sprite-v1-png' },
    v2: { id: expectedIds.v2, kind: 'sprite', badge: 'SPRITE v2', type: 'sprite-v2-png' },
    webp: { id: webpId, kind: 'sprite', badge: 'SPRITE v2', type: 'sprite-v2-webp' },
  };
  const sequence = ['v1', 'vrm', 'v2', 'webp'];
  const switches = [];
  const resourceSamples = [];
  resourceSamples.push(await sampleResources('before-switches'));
  let activeId = await page.evaluate(() => document.body.dataset.characterId);
  for (let index = 0; index < 20; index += 1) {
    const key = sequence[index % sequence.length];
    const target = switchTypes[key];
    assert.notEqual(target.id, activeId, `switch ${index + 1}: target must differ from active`);
    const result = await selectCharacter(target.id, target.kind, target.badge);
    const observedId = await page.evaluate(() => document.body.dataset.characterId);
    assert.equal(observedId, target.id);
    activeId = observedId;
    switches.push({
      index: index + 1,
      key,
      type: target.type,
      id: target.id,
      elapsedMs: result.elapsedMs,
      exportDisabled: result.exportDisabled,
      render: result.render,
      pageErrorCount: pageErrors.length,
    });
    if ((index + 1) % 5 === 0) {
      resourceSamples.push(await sampleResources(`after-switch-${index + 1}`));
    }
  }
  await screenshot('B', 'profile-b-after-switches.png');

  const switchStats = {};
  for (const entry of switches) {
    const current = switchStats[entry.type] ?? { count: 0, totalMs: 0, maxMs: 0 };
    current.count += 1;
    current.totalMs += entry.elapsedMs;
    current.maxMs = Math.max(current.maxMs, entry.elapsedMs);
    switchStats[entry.type] = current;
  }
  for (const stats of Object.values(switchStats)) {
    stats.averageMs = stats.totalMs / stats.count;
  }

  // The last switch is WebP; refresh must restore it, its alias, spec and bytes.
  const beforeRefreshId = activeId;
  const refreshStartedAt = performance.now();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.bringToFront();
  await waitForReady();
  await waitForCharacter(beforeRefreshId, 'sprite');
  await waitForOpaqueSprite();
  await page.waitForFunction(() => (
    document.querySelectorAll('#character-list .library-row').length === 4
  ), undefined, { timeout: 60_000 });
  assert.equal(await page.locator('#character-name').innerText(), '浏览器图集 WebP');
  assert.equal(await page.locator('#format-badge').innerText(), 'SPRITE v2');
  assert.equal(await page.locator('#export-button').isDisabled(), true);
  assert.equal(await page.locator('#character-list .library-row').count(), 4);
  const refreshedLibrary = await readLibrary();
  assert.equal(refreshedLibrary.activeId, beforeRefreshId);
  assert.equal(refreshedLibrary.summaries.length, 4);
  assertStored(refreshedLibrary, webpId, {
    name: '浏览器图集 WebP',
    kind: 'sprite',
    profile: 'v2',
    sha256: webp.sha256,
    bytes: webp.size,
    mime: 'image/webp',
  });
  await screenshot('B', 'profile-b-after-refresh.png');
  timings.refreshMs = performance.now() - refreshStartedAt;

  assert.deepEqual(pageErrors, []);
  assert.equal(switches.filter((entry) => entry.pageErrorCount !== 0).length, 0);

  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    runId,
    fixtureUrl: mainUrl,
    browserPath: 'Temporary Electron Chromium window loading the real src/main.ts page without a preload or petDesktop bridge. Downloads use the app browser blob download path captured by Playwright acceptDownloads, which replaces the Electron save dialog. This does not represent external Chrome/Edge or a real LAN/mobile browser.',
    browserCapabilities: browserPath,
    inputs: Object.fromEntries(
      Object.entries(inputs).map(([label, input]) => [label, {
        path: input.path,
        bytes: input.bytes,
        sha256: input.sha256,
      }]),
    ),
    webp: {
      bytes: webp.size,
      sha256: webp.sha256,
      width: inputs.v2.width,
      height: inputs.v2.height,
      source: inputs.v2.path,
    },
    imports,
    backups: Object.fromEntries(
      Object.entries(backups).map(([label, backup]) => [label, {
        file: relative(root, backup.path).replaceAll('\\', '/'),
        suggestedFilename: backup.suggestedFilename,
        downloadFailure: backup.downloadFailure,
        bytes: backup.bytes.length,
        sha256: backup.sha256,
        manifest: backup.manifest,
        manifestLength: backup.manifestLength,
        payloadBytes: backup.payloadBytes,
        payloadSha256: backup.payloadSha256,
        elapsedMs: backup.elapsedMs,
      }]),
    ),
    restores: {
      vrm: { status: restores.vrm.text, elapsedMs: restores.vrm.elapsedMs, render: restores.vrm.render },
      v1: { status: restores.v1.text, elapsedMs: restores.v1.elapsedMs, render: restores.v1.render },
      v2: { status: restores.v2.text, elapsedMs: restores.v2.elapsedMs, render: restores.v2.render },
      webp: { status: restores.webp.text, elapsedMs: restores.webp.elapsedMs, render: restores.webp.render },
    },
    duplicateAlias: {
      profileA: {
        backupName: '备份原名',
        localAlias: 'A 本地别名',
        entriesAfterDuplicate: duplicateA.after.summaries.length,
        activeId: duplicateA.after.activeId,
      },
      profileB: {
        restoredName: '备份原名',
        localAlias: 'B 本地别名',
        entriesAfterDuplicate: duplicateB.after.summaries.length,
        activeId: duplicateB.after.activeId,
      },
    },
    exportGate: {
      vrm: { disabled: vrmRestoreExport.exportDisabled, title: '' },
      webp: { disabled: spriteAgain.exportDisabled, title: webpExportTitle },
    },
    invalidRestores,
    currentAfterInvalid: currentBeforeInvalid,
    switches: {
      count: switches.length,
      sequence,
      records: switches,
      stats: switchStats,
      note: '20 real UI selections in a visible Electron Chromium window. Elapsed values include model loading and IPC; they are not a cross-hardware guarantee.',
    },
    resources: {
      samples: resourceSamples,
      pageErrors,
      consoleErrors,
      note: 'Raw Electron getAppMetrics and performance.memory samples across 20 selections only. This is not a long-term leak, energy or soak test.',
    },
    persistence: {
      activeBeforeRefresh: beforeRefreshId,
      activeAfterRefresh: refreshedLibrary.activeId,
      entriesAfterRefresh: refreshedLibrary.summaries.length,
      listRows: 4,
      formatBadge: 'SPRITE v2',
      exportButtonDisabled: true,
    },
    environment: {
      ...environment,
      cpus: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    screenshots,
    timing: {
      totalMs: performance.now() - startedAt,
      ...timings,
    },
  };
  await writeFile(join(outputDirectory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    outputDirectory,
    backups: Object.keys(backups),
    restoredEntries: refreshedLibrary.summaries.length,
    switches: switches.length,
    switchStats,
    pageErrors: pageErrors.length,
    environment,
  }, null, 2));
} catch (error) {
  let failureContext = null;
  if (page) {
    await page.screenshot({ path: join(outputDirectory, 'failure.png') }).catch(() => {});
    const status = await page.locator('#status').innerText().catch(() => 'Page unavailable');
    const packageStatus = await page.locator('#package-status').innerText().catch(() => '');
    console.error(status);
    console.error(packageStatus);
    failureContext = {
      status,
      packageStatus,
      characterId: await page.evaluate(() => document.body.dataset.characterId ?? null).catch(() => null),
      packageBusy: await page.evaluate(() => document.body.dataset.packageBusy ?? null).catch(() => null),
    };
  }
  await writeFile(
    join(outputDirectory, 'failure.json'),
    JSON.stringify({
      message: error instanceof Error ? error.stack : String(error),
      context: failureContext,
      pageErrors,
      consoleErrors,
      timings,
    }, null, 2),
  ).catch(() => {});
  throw error;
} finally {
  await closeProfile();
  if (server) {
    await server.close();
  }
  await removeOwnTempDirectory(temp);
}
