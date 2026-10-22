import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = new URL('../artifacts/atlas-preview-smoke/', import.meta.url);
await mkdir(artifacts, { recursive: true });

function findLanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if ((entry.family === 'IPv4' || entry.family === 4) && !entry.internal) {
        return entry.address;
      }
    }
  }
  return null;
}

async function removeOwnTempDirectory(directory) {
  const resolved = resolve(directory);
  const relativePath = relative(resolve(tmpdir()), resolved);
  assert.ok(
    relativePath.startsWith('oigptpet-atlas-preview-')
      && !relativePath.startsWith('..')
      && !relativePath.includes(':'),
    `refusing to remove unexpected temp path: ${resolved}`,
  );
  await rm(resolved, { recursive: true, force: true });
}

const temp = await mkdtemp(join(tmpdir(), 'oigptpet-atlas-preview-'));
const appDirectory = join(temp, 'app');
const userData = join(temp, 'user-data');
await mkdir(appDirectory, { recursive: true });
await writeFile(
  join(appDirectory, 'package.json'),
  JSON.stringify({ name: 'atlas-preview-smoke-app', version: '0.0.0', main: 'main.cjs' }),
);
await writeFile(
  join(appDirectory, 'main.cjs'),
  `const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.ATLAS_SMOKE_USER_DATA);
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1100,
    height: 900,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { backgroundThrottling: false },
  });
  window.loadURL(process.env.ATLAS_SMOKE_URL);
});
app.on('window-all-closed', () => app.quit());
`,
);

let desktop = null;
let server = null;
let page = null;
const pageErrors = [];
const consoleErrors = [];
let secureAtlas = null;
let largeFallback = null;
let insecureScenario = null;

function verifyGeneratedPayload(payload, label) {
  assert.equal(payload.result.encodedBytes, payload.size, `${label}: encodedBytes must match blob.size`);
  assert.equal(payload.result.sameBlob, true, `${label}: result must reference the same Blob`);
  const digest = createHash('sha256')
    .update(Buffer.from(payload.base64, 'base64'))
    .digest('hex');
  assert.equal(payload.result.sha256, digest, `${label}: SHA-256 must match the blob bytes`);
  assert.equal(payload.result.sha256, payload.result.sha256.toLowerCase(), `${label}: hash is lowercase`);
}

async function readUi() {
  return page.evaluate(() => {
    const root = document.querySelector('.atlas-preview-widget');
    if (!root) {
      return null;
    }
    const find = (selector) => root.querySelector(selector);
    const canvas = find('[data-atlas-canvas]');
    const meta = find('[data-atlas-meta]');
    const rect = canvas ? canvas.getBoundingClientRect() : null;
    return {
      valid: root.dataset.atlasValid,
      mode: root.dataset.atlasMode,
      playing: root.dataset.atlasPlaying,
      status: find('[data-atlas-status]')?.textContent ?? '',
      message: find('[data-atlas-message]')?.textContent ?? '',
      metaSha: meta?.dataset.sha256 ?? null,
      metaBytes: meta?.dataset.bytes ?? null,
      errors: Array.from(root.querySelectorAll('[data-atlas-errors] li')).map((item) => ({
        code: item.dataset.issueCode,
        row: item.dataset.row ?? null,
        frame: item.dataset.frame ?? null,
        text: item.textContent,
      })),
      actionValue: find('[data-atlas-action]')?.value ?? null,
      gazePresent: Boolean(find('[data-atlas-gaze]')),
      gazeValue: find('[data-atlas-gaze]')?.value ?? null,
      frameText: find('[data-atlas-frame]')?.textContent ?? '',
      playLabel: find('[data-atlas-play]')?.textContent ?? '',
      canvas: canvas
        ? {
          width: canvas.width,
          height: canvas.height,
          row: canvas.dataset.row ?? null,
          cell: canvas.dataset.cell ?? null,
          frameIndex: canvas.dataset.frameIndex ?? null,
          frameCount: canvas.dataset.frameCount ?? null,
          directionIndex: canvas.dataset.directionIndex ?? null,
          cssRatio: rect && rect.height > 0 ? rect.width / rect.height : 0,
        }
        : null,
      disabled: {
        action: find('[data-atlas-action]')?.disabled ?? null,
        play: find('[data-atlas-play]')?.disabled ?? null,
        previous: find('[data-atlas-prev]')?.disabled ?? null,
        next: find('[data-atlas-next]')?.disabled ?? null,
        gaze: find('[data-atlas-gaze]')?.disabled ?? null,
      },
      rootCount: document.querySelectorAll('.atlas-preview-widget').length,
    };
  });
}

async function probeState() {
  return page.evaluate(() => ({
    openBitmaps: window.__atlasProbe.openBitmaps,
    closedBitmaps: window.__atlasProbe.closedBitmaps,
    outstandingBitmaps: window.__atlasProbe.openBitmaps - window.__atlasProbe.closedBitmaps,
    activeIntervals: window.__atlasProbe.activeIntervals.size,
    objectUrls: window.__atlasProbe.objectUrls,
  }));
}

async function installProbe() {
  await page.evaluate(() => {
    const probe = {
      openBitmaps: 0,
      closedBitmaps: 0,
      activeIntervals: new Set(),
      objectUrls: 0,
      decodeDelayMs: 0,
    };
    const originalCreateImageBitmap = window.createImageBitmap.bind(window);
    window.createImageBitmap = async (...args) => {
      if (probe.decodeDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, probe.decodeDelayMs));
      }
      const bitmap = await originalCreateImageBitmap(...args);
      probe.openBitmaps += 1;
      return bitmap;
    };
    const originalClose = ImageBitmap.prototype.close;
    ImageBitmap.prototype.close = function close() {
      probe.closedBitmaps += 1;
      return originalClose.call(this);
    };
    const originalSetInterval = window.setInterval.bind(window);
    const originalClearInterval = window.clearInterval.bind(window);
    window.setInterval = (handler, delay, ...args) => {
      const id = originalSetInterval(handler, delay, ...args);
      if (delay === 125) {
        probe.activeIntervals.add(id);
      }
      return id;
    };
    window.clearInterval = (id) => {
      probe.activeIntervals.delete(id);
      return originalClearInterval(id);
    };
    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (...args) => {
      probe.objectUrls += 1;
      return originalCreateObjectUrl(...args);
    };
    window.__atlasProbe = probe;
  });
}

async function loadGenerated(profile, options = {}) {
  const payload = await page.evaluate(async ({ profile, options }) => {
    const fixture = window.__atlasFixture;
    const blob = await fixture.makeAtlas(profile, options);
    const result = await fixture.load(blob, profile);
    return {
      result,
      base64: await fixture.blobToBase64(blob),
      size: blob.size,
      type: blob.type,
    };
  }, { profile, options });
  verifyGeneratedPayload(payload, `${profile} ${options.format ?? 'png'}`);
  return payload;
}

async function pixel(x, y) {
  return page.evaluate(
    ({ x, y }) => window.__atlasFixture.canvasPixel(x, y),
    { x, y },
  );
}

function assertNear(actual, expected, label, tolerance = 3) {
  assert.equal(actual.length, 4, `${label}: expected RGBA`);
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(
      Math.abs(actual[channel] - expected[channel]) <= tolerance,
      `${label}: channel ${channel} expected ${expected[channel]}, got ${actual[channel]}`,
    );
  }
  assert.equal(actual[3], expected[3], `${label}: alpha expected ${expected[3]}, got ${actual[3]}`);
}

try {
  server = await createServer({
    configFile: false,
    root,
    logLevel: 'error',
    appType: 'mpa',
    cacheDir: join(temp, 'vite-cache'),
    server: {
      host: '0.0.0.0',
      port: 0,
      allowedHosts: true,
      hmr: false,
    },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls?.local?.[0];
  assert.ok(baseUrl, 'Vite dev server did not expose a local URL');
  const url = new URL('tests/fixtures/atlas-preview/index.html?auto=0', baseUrl).href;
  const port = new URL(baseUrl).port;
  const lanAddress = findLanAddress();
  const lanUrl = lanAddress
    ? `http://${lanAddress}:${port}/tests/fixtures/atlas-preview/index.html?auto=0`
    : null;
  const hostAliasUrl = `http://atlas.test:${port}/tests/fixtures/atlas-preview/index.html?auto=0`;

  const env = { ...process.env, ATLAS_SMOKE_URL: url, ATLAS_SMOKE_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await electron.launch({
    args: [
      appDirectory,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--host-resolver-rules=MAP atlas.test 127.0.0.1',
    ],
    cwd: root,
    env,
    timeout: 60000,
  });

  page = await desktop.firstWindow({ timeout: 60000 });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  await page.waitForFunction(() => Boolean(window.__atlasFixture), undefined, { timeout: 60000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await installProbe();

  await page.evaluate(() => window.__atlasFixture.mount());
  await page.locator('.atlas-preview-widget').waitFor();
  assert.equal((await readUi()).rootCount, 1, 'mount creates exactly one widget');

  // Valid v2: decoding, inspection, SHA, layout, no autoplay under reduced motion.
  const v2 = await loadGenerated('v2');
  assert.equal(v2.result.profile, 'v2');
  assert.equal(v2.result.inspection.valid, true);
  assert.equal(v2.result.inspection.requiredFrames, 73);
  assert.equal(v2.type, 'image/png');

  let ui = await readUi();
  assert.equal(ui.valid, 'true');
  assert.equal(ui.mode, 'animation');
  assert.equal(ui.playing, 'false');
  assert.match(ui.status, /通过/);
  assert.match(ui.status, /本地结构检查/);
  assert.doesNotMatch(ui.status, /官方预检通过|已安装/);
  assert.equal(ui.metaSha, v2.result.sha256);
  assert.equal(ui.metaBytes, String(v2.size));
  assert.equal(ui.canvas.width, 192);
  assert.equal(ui.canvas.height, 208);
  assert.ok(Math.abs(ui.canvas.cssRatio - 192 / 208) < 0.01, 'preview preserves the 192x208 aspect ratio');
  assert.equal(ui.canvas.row, '0');
  assert.equal(ui.canvas.cell, '0');
  assert.equal(ui.canvas.frameIndex, '0');
  assert.equal(ui.canvas.frameCount, '6');
  assert.equal(ui.frameText, '动作帧 1 / 6');
  assert.equal(ui.gazePresent, true);
  assert.equal(await page.locator('[data-atlas-gaze] option').count(), 16);
  assert.equal(ui.disabled.action, false);
  assert.equal(ui.disabled.play, false);
  assert.equal(ui.disabled.previous, false);
  assert.equal(ui.disabled.next, false);

  let probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 1, 'one live bitmap while previewing');
  assert.equal(probe.activeIntervals, 0, 'no autoplay timer after load');
  assert.equal(probe.objectUrls, 0, 'component does not create object URLs');

  // Full-cell 1:1 drawing preserves jump pixel positions; no crop, center or scale.
  await page.locator('[data-atlas-action]').selectOption('jumping');
  ui = await readUi();
  assert.equal(ui.canvas.row, '4');
  assert.equal(ui.canvas.cell, '0');
  assert.equal(ui.canvas.frameCount, '5');
  assert.equal(ui.frameText, '动作帧 1 / 5');
  assertNear(await pixel(20, 20), [255, 255, 255, 255], 'top marker');
  assertNear(await pixel(20, 206), [0, 0, 0, 255], 'bottom marker');
  assert.equal((await pixel(20, 0))[3], 0, 'top margin stays transparent (cell is not recentered)');
  assert.equal((await pixel(20, 207))[3], 255, 'last row of the cell is preserved');
  await page.screenshot({ path: fileURLToPath(new URL('v2-valid.png', artifacts)) });

  // Gaze boundaries on v2.
  await page.locator('[data-atlas-gaze]').selectOption('0');
  ui = await readUi();
  assert.equal(ui.mode, 'look');
  assert.equal(ui.canvas.row, '9');
  assert.equal(ui.canvas.cell, '0');
  assert.equal(ui.canvas.directionIndex, '0');
  assert.match(ui.frameText, /视线帧 1 \/ 16/);
  await page.locator('[data-atlas-gaze]').selectOption('15');
  ui = await readUi();
  assert.equal(ui.canvas.row, '10');
  assert.equal(ui.canvas.cell, '7');
  assert.equal(ui.canvas.directionIndex, '15');
  assert.match(ui.frameText, /337\.5°/);
  await page.locator('[data-atlas-next]').click();
  ui = await readUi();
  assert.equal(ui.canvas.directionIndex, '0', 'next from the last gaze wraps to the first');
  assert.equal(ui.canvas.row, '9');
  await page.locator('[data-atlas-prev]').click();
  ui = await readUi();
  assert.equal(ui.canvas.directionIndex, '15', 'previous from the first gaze wraps to the last');
  assert.equal(ui.canvas.row, '10');

  // Action switching resets frame index; stepping wraps within real frames only.
  await page.locator('[data-atlas-action]').selectOption('waving');
  ui = await readUi();
  assert.equal(ui.mode, 'animation');
  assert.equal(ui.canvas.frameIndex, '0');
  assert.equal(ui.canvas.frameCount, '4');
  assert.equal(ui.frameText, '动作帧 1 / 4');
  for (let step = 0; step < 4; step += 1) {
    await page.locator('[data-atlas-next]').click();
  }
  ui = await readUi();
  assert.equal(ui.canvas.frameIndex, '0', 'next past the last frame wraps to frame zero');
  assert.equal(ui.canvas.cell, '0', 'playback never enters the trailing transparent cells');
  await page.locator('[data-atlas-prev]').click();
  ui = await readUi();
  assert.equal(ui.canvas.frameIndex, '3');
  assert.equal(ui.canvas.cell, '3');
  assert.equal(ui.frameText, '动作帧 4 / 4');
  await page.locator('[data-atlas-next]').click();
  assert.equal((await readUi()).canvas.frameIndex, '0');

  await page.locator('[data-atlas-action]').selectOption('idle');
  ui = await readUi();
  assert.equal(ui.canvas.frameCount, '6');
  assert.equal(ui.canvas.frameIndex, '0');

  // Manual playback, pause and timer cleanup.
  await page.locator('[data-atlas-play]').click();
  await page.waitForFunction(() => window.__atlasProbe.activeIntervals.size === 1);
  assert.equal((await readUi()).playing, 'true');
  await page.waitForFunction(
    () => document.querySelector('[data-atlas-canvas]')?.dataset.frameIndex !== '0',
    undefined,
    { timeout: 3000 },
  );
  await page.locator('[data-atlas-play]').click();
  await page.waitForFunction(() => window.__atlasProbe.activeIntervals.size === 0);
  ui = await readUi();
  assert.equal(ui.playing, 'false');
  assert.equal(ui.playLabel, '播放');
  probe = await probeState();
  assert.equal(probe.activeIntervals, 0);

  // Hiding the page stops scheduling without auto-resuming.
  await page.locator('[data-atlas-play]').click();
  await page.waitForFunction(() => window.__atlasProbe.activeIntervals.size === 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => window.__atlasProbe.activeIntervals.size === 0);
  assert.equal((await readUi()).playing, 'false');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal((await readUi()).playing, 'false', 'becoming visible does not auto-resume');

  // Valid WebP is decoded through the same final-Blob path.
  const webp = await loadGenerated('v2', { format: 'webp' });
  assert.equal(webp.type, 'image/webp');
  assert.equal(webp.result.inspection.valid, true);
  ui = await readUi();
  assert.equal(ui.valid, 'true');
  assert.equal(ui.metaSha, webp.result.sha256);
  probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 1);

  // Structural failure resolves with inspection but clears playback and prior pass state.
  const empty = await loadGenerated('v2', { empty: { row: 4, frame: 2 } });
  assert.equal(empty.result.inspection.valid, false);
  assert.ok(
    empty.result.inspection.errors.some(
      (issue) => issue.code === 'empty-frame' && issue.row === 4 && issue.frame === 2,
    ),
    'empty frame is reported with row/frame',
  );
  ui = await readUi();
  assert.equal(ui.valid, 'false');
  assert.match(ui.status, /未通过/);
  assert.equal(ui.metaSha, empty.result.sha256);
  assert.equal(ui.gazePresent, false);
  assert.deepEqual(
    ui.errors.map((issue) => issue.code),
    ['empty-frame'],
  );
  assert.equal(ui.errors[0].row, '4');
  assert.equal(ui.errors[0].frame, '2');
  assert.equal(ui.disabled.play, true);
  assert.equal((await pixel(20, 20))[3], 0, 'invalid atlas is not rendered');
  probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 0, 'invalid atlas releases its bitmap');
  assert.equal(probe.activeIntervals, 0);

  const polluted = await loadGenerated('v2', { pollute: { row: 0, frame: 6 } });
  assert.equal(polluted.result.inspection.valid, false);
  ui = await readUi();
  assert.equal(ui.valid, 'false');
  assert.deepEqual(ui.errors.map((issue) => issue.code), ['unused-cell']);
  assert.equal(ui.errors[0].row, '0');
  assert.equal(ui.errors[0].frame, '6');
  assert.equal(ui.metaSha, polluted.result.sha256);
  probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 0);

  // Corrupt PNG with valid header but undecodable body.
  const corrupt = await page.evaluate(async () => {
    const fixture = window.__atlasFixture;
    const blob = fixture.makeCorruptPng();
    try {
      await fixture.load(blob, 'v2');
      return { ok: true };
    } catch (error) {
      return { ok: false, name: error.name, message: error.message, size: blob.size, type: blob.type };
    }
  });
  assert.equal(corrupt.ok, false);
  assert.notEqual(corrupt.name, 'AbortError');
  assert.match(corrupt.message, /无法解码/);
  ui = await readUi();
  assert.equal(ui.valid, 'error');
  assert.match(ui.message, /无法解码/);
  assert.equal(ui.metaSha, null);
  assert.equal(ui.disabled.play, true);
  assert.equal((await pixel(20, 20))[3], 0);
  probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 0);

  // MIME and format mismatch boundaries reject before decoding.
  const wrongMime = await page.evaluate(async () => {
    const fixture = window.__atlasFixture;
    const png = await fixture.makeAtlas('v1');
    const disguised = await fixture.withType(png, 'image/jpeg');
    try {
      await fixture.load(disguised, 'v1');
      return { ok: true };
    } catch (error) {
      return { ok: false, name: error.name, message: error.message };
    }
  });
  assert.equal(wrongMime.ok, false);
  assert.match(wrongMime.message, /MIME/);
  assert.equal((await readUi()).valid, 'error');

  const missingMime = await page.evaluate(async () => {
    const fixture = window.__atlasFixture;
    const png = await fixture.makeAtlas('v1');
    const anonymous = await fixture.withType(png, '');
    try {
      await fixture.load(anonymous, 'v1');
      return { ok: true };
    } catch (error) {
      return { ok: false, name: error.name, message: error.message };
    }
  });
  assert.equal(missingMime.ok, false);
  assert.match(missingMime.message, /缺少 MIME/);
  assert.equal((await readUi()).valid, 'error');

  const formatMismatch = await page.evaluate(async () => {
    const fixture = window.__atlasFixture;
    const webp = await fixture.makeAtlas('v2', { format: 'webp' });
    const disguised = await fixture.withType(webp, 'image/png');
    try {
      await fixture.load(disguised, 'v2');
      return { ok: true };
    } catch (error) {
      return { ok: false, name: error.name, message: error.message };
    }
  });
  assert.equal(formatMismatch.ok, false);
  assert.match(formatMismatch.message, /不一致/);
  assert.equal((await readUi()).valid, 'error');

  const oversized = await page.evaluate(async () => {
    const fixture = window.__atlasFixture;
    const blob = fixture.makeOversized();
    try {
      await fixture.load(blob, 'v2');
      return { ok: true };
    } catch (error) {
      return { ok: false, name: error.name, message: error.message, size: blob.size };
    }
  });
  assert.equal(oversized.ok, false);
  assert.match(oversized.message, /20 MiB/);
  assert.equal(oversized.size, 20 * 1024 * 1024 + 1);
  assert.equal((await readUi()).valid, 'error');

  const wrongDimensions = await page.evaluate(async () => {
    const fixture = window.__atlasFixture;
    const v1Atlas = await fixture.makeAtlas('v1');
    try {
      await fixture.load(v1Atlas, 'v2');
      return { ok: true };
    } catch (error) {
      return { ok: false, name: error.name, message: error.message };
    }
  });
  assert.equal(wrongDimensions.ok, false);
  assert.match(wrongDimensions.message, /尺寸/);
  assert.equal((await readUi()).valid, 'error');

  const wrongProfile = await page.evaluate(async () => {
    const fixture = window.__atlasFixture;
    const atlas = await fixture.makeAtlas('v1');
    try {
      await fixture.load(atlas, 'v3');
      return { ok: true };
    } catch (error) {
      return { ok: false, name: error.name, message: error.message };
    }
  });
  assert.equal(wrongProfile.ok, false);
  assert.match(wrongProfile.message, /v1 或 v2/);
  assert.equal((await readUi()).valid, 'error');

  probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 0, 'rejected inputs leave no bitmap behind');
  assert.equal(probe.activeIntervals, 0);
  assert.equal(probe.objectUrls, 0);

  // Valid v1: no gaze control, 57 required frames.
  const v1 = await loadGenerated('v1');
  assert.equal(v1.result.inspection.valid, true);
  assert.equal(v1.result.inspection.requiredFrames, 57);
  assert.equal(await page.locator('[data-atlas-action] option').count(), 9);
  ui = await readUi();
  assert.equal(ui.valid, 'true');
  assert.equal(ui.gazePresent, false, 'v1 does not render the gaze control');
  assert.equal(ui.canvas.width, 192);
  assert.equal(ui.canvas.height, 208);
  assert.equal(ui.canvas.frameCount, '6');
  assert.equal(ui.metaSha, v1.result.sha256);
  assert.equal(ui.disabled.action, false);
  await page.screenshot({ path: fileURLToPath(new URL('v1-valid.png', artifacts)) });

  // D5: native Web Crypto and the pure JS fallback agree on identical atlas bytes.
  secureAtlas = await page.evaluate(async () => {
    const fixture = window.__atlasFixture;
    const blob = await fixture.makeAtlas('v2');
    const base64 = await fixture.blobToBase64(blob);
    const comparison = await fixture.hashBoth(await blob.arrayBuffer());
    return { base64, size: blob.size, comparison };
  });
  const secureExpected = createHash('sha256')
    .update(Buffer.from(secureAtlas.base64, 'base64'))
    .digest('hex');
  assert.equal(secureAtlas.comparison.isSecureContext, true, 'localhost fixture is a secure context');
  assert.equal(secureAtlas.comparison.nativeAvailable, true, 'localhost fixture exposes crypto.subtle');
  assert.equal(secureAtlas.comparison.native.hash, secureExpected);
  assert.equal(secureAtlas.comparison.fallback.hash, secureExpected);
  assert.equal(
    secureAtlas.comparison.native.hash,
    secureAtlas.comparison.fallback.hash,
    'native and fallback digests match byte for byte',
  );

  // D5: the 20 MiB fallback digest yields to the event loop instead of blocking it.
  largeFallback = await page.evaluate(async () => {
    const fixture = window.__atlasFixture;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 0);
    try {
      const metrics = await fixture.hashFallbackWithMetrics(
        fixture.makeZeroBuffer(20 * 1024 * 1024),
      );
      return { ...metrics, ticks };
    } finally {
      clearInterval(timer);
    }
  });
  const expectedLargeHash = createHash('sha256')
    .update(Buffer.alloc(20 * 1024 * 1024))
    .digest('hex');
  assert.equal(largeFallback.hash, expectedLargeHash);
  assert.ok(largeFallback.yields >= 39, '20 MiB fallback hash yields between chunks');
  assert.ok(largeFallback.ticks > 0, 'event loop timers run while hashing 20 MiB');
  assert.ok(largeFallback.elapsedMs < 5000, '20 MiB fallback hash finishes in a bounded time');

  // Concurrent loads: the latest wins; the superseded call rejects with AbortError.
  await page.evaluate(() => {
    window.__atlasProbe.decodeDelayMs = 120;
  });
  const concurrent = await page.evaluate(async () => {
    const fixture = window.__atlasFixture;
    const firstBlob = await fixture.makeAtlas('v1');
    const secondBlob = await fixture.makeAtlas('v2');
    const first = fixture.load(firstBlob, 'v1').then(
      (result) => ({ ok: true, sha256: result.sha256 }),
      (error) => ({ ok: false, name: error.name, message: error.message }),
    );
    const second = fixture.load(secondBlob, 'v2').then(
      (result) => ({ ok: true, sha256: result.sha256, valid: result.inspection.valid }),
      (error) => ({ ok: false, name: error.name, message: error.message }),
    );
    const [firstResult, secondResult] = await Promise.all([first, second]);
    return { first: firstResult, second: secondResult };
  });
  assert.equal(concurrent.first.ok, false);
  assert.equal(concurrent.first.name, 'AbortError');
  assert.equal(concurrent.second.ok, true);
  assert.equal(concurrent.second.valid, true);
  ui = await readUi();
  assert.equal(ui.valid, 'true');
  assert.equal(ui.metaSha, concurrent.second.sha256, 'stale load did not overwrite the newer preview');
  probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 1, 'superseded decode did not leak a bitmap');
  assert.equal(probe.activeIntervals, 0);

  // Cancellation rejects with AbortError and releases partial work.
  const cancelled = await page.evaluate(async () => {
    const fixture = window.__atlasFixture;
    const blob = await fixture.makeAtlas('v2');
    const abortController = new AbortController();
    const pending = fixture.load(blob, 'v2', abortController.signal).then(
      (result) => ({ ok: true, sha256: result.sha256 }),
      (error) => ({ ok: false, name: error.name, message: error.message }),
    );
    setTimeout(() => abortController.abort(), 20);
    return pending;
  });
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.name, 'AbortError');
  ui = await readUi();
  assert.equal(ui.valid, 'cancelled');
  assert.match(ui.status, /已取消/);
  assert.equal(ui.metaSha, null);
  assert.equal(ui.disabled.play, true);
  probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 0, 'cancelled load releases its bitmap');
  assert.equal(probe.activeIntervals, 0);
  await page.evaluate(() => {
    window.__atlasProbe.decodeDelayMs = 0;
  });

  // Close and reopen: dispose is idempotent and cleans playback/bitmaps.
  await page.evaluate(() => window.__atlasFixture.dispose());
  assert.equal((await readUi()), null, 'dispose removes the widget root');
  await page.evaluate(() => window.__atlasFixture.dispose());
  probe = await probeState();
  assert.equal(probe.activeIntervals, 0);
  assert.equal(probe.outstandingBitmaps, 0);

  await page.evaluate(() => window.__atlasFixture.mount());
  const reopened = await loadGenerated('v2');
  assert.equal(reopened.result.inspection.valid, true);
  assert.equal((await readUi()).rootCount, 1);
  await page.locator('[data-atlas-play]').click();
  await page.waitForFunction(() => window.__atlasProbe.activeIntervals.size === 1);
  await page.evaluate(() => window.__atlasFixture.dispose());
  probe = await probeState();
  assert.equal(probe.activeIntervals, 0, 'dispose clears the playback interval');
  assert.equal(probe.outstandingBitmaps, 0, 'dispose closes the preview bitmap');
  assert.equal(await readUi(), null);

  // Disposing while a load is pending rejects it without restoring UI.
  await page.evaluate(() => window.__atlasFixture.mount());
  await page.evaluate(() => {
    window.__atlasProbe.decodeDelayMs = 120;
  });
  const disposedPending = await page.evaluate(async () => {
    const fixture = window.__atlasFixture;
    const blob = await fixture.makeAtlas('v2');
    const pending = fixture.load(blob, 'v2').then(
      (result) => ({ ok: true, sha256: result.sha256 }),
      (error) => ({ ok: false, name: error.name, message: error.message }),
    );
    fixture.dispose();
    return pending;
  });
  assert.equal(disposedPending.ok, false);
  assert.equal(disposedPending.name, 'AbortError');
  assert.equal(await readUi(), null);
  probe = await probeState();
  assert.equal(probe.activeIntervals, 0);
  assert.equal(probe.outstandingBitmaps, 0);
  assert.equal(probe.objectUrls, 0);

  // D5: a real non-localhost HTTP origin is not a secure context and must use
  // the pure JavaScript digest. If the LAN address is unreachable, record that
  // and fall back to a loopback host alias instead of treating it as LAN proof.
  let navigation;
  if (lanUrl) {
    try {
      await page.goto(lanUrl, { waitUntil: 'load', timeout: 20000 });
      navigation = { actualKind: 'lan', actualUrl: lanUrl, lanError: null };
    } catch (error) {
      navigation = {
        actualKind: 'lan',
        actualUrl: lanUrl,
        lanError: error instanceof Error ? error.message : String(error),
      };
    }
  } else {
    navigation = {
      actualKind: 'lan',
      actualUrl: null,
      lanError: 'no non-internal IPv4 address',
    };
  }
  if (navigation.lanError) {
    await page.goto(hostAliasUrl, { waitUntil: 'load', timeout: 30000 });
    navigation = {
      ...navigation,
      requestedLanUrl: navigation.actualUrl,
      actualKind: 'host-alias',
      actualUrl: hostAliasUrl,
    };
  } else {
    navigation = {
      ...navigation,
      requestedLanUrl: navigation.actualUrl,
    };
  }

  await page.waitForFunction(() => Boolean(window.__atlasFixture), undefined, { timeout: 60000 });
  const insecureEnvironment = await page.evaluate(() => ({
    isSecureContext: window.isSecureContext,
    subtleAvailable: Boolean(globalThis.crypto?.subtle),
    href: location.href,
  }));
  assert.equal(insecureEnvironment.isSecureContext, false, 'non-localhost HTTP is not a secure context');
  assert.equal(insecureEnvironment.subtleAvailable, false, 'crypto.subtle is absent on non-localhost HTTP');

  await installProbe();
  await page.evaluate(() => window.__atlasFixture.mount());
  const fallbackLoad = await page.evaluate(async (base64) => {
    const fixture = window.__atlasFixture;
    const blob = fixture.blobFromBase64(base64, 'image/png');
    const comparison = await fixture.hashBoth(await blob.arrayBuffer());
    const result = await fixture.load(blob, 'v2');
    return {
      sha256: result.sha256,
      valid: result.inspection.valid,
      comparison,
    };
  }, secureAtlas.base64);
  assert.equal(fallbackLoad.valid, true, 'fallback digest does not block atlas checks or preview');
  assert.equal(fallbackLoad.sha256, secureExpected, 'fallback digest matches the secure-context hash');
  assert.equal(fallbackLoad.comparison.nativeAvailable, false);
  assert.equal(fallbackLoad.comparison.native.hash, secureExpected);
  assert.equal(fallbackLoad.comparison.fallback.hash, secureExpected);

  let insecureUi = await readUi();
  assert.equal(insecureUi.valid, 'true');
  assert.equal(insecureUi.metaSha, secureExpected);
  assert.equal(insecureUi.gazePresent, true);
  assert.equal(insecureUi.canvas.width, 192);
  assert.equal(insecureUi.canvas.height, 208);
  let insecureProbe = await probeState();
  assert.equal(insecureProbe.outstandingBitmaps, 1);
  assert.equal(insecureProbe.activeIntervals, 0);
  assert.equal(insecureProbe.objectUrls, 0);

  await page.evaluate(() => {
    window.__atlasProbe.decodeDelayMs = 120;
  });
  const insecureConcurrent = await page.evaluate(async (base64) => {
    const fixture = window.__atlasFixture;
    const firstBlob = fixture.blobFromBase64(base64, 'image/png');
    const secondBlob = fixture.blobFromBase64(base64, 'image/png');
    const first = fixture.load(firstBlob, 'v2').then(
      (result) => ({ ok: true, sha256: result.sha256 }),
      (error) => ({ ok: false, name: error.name, message: error.message }),
    );
    const second = fixture.load(secondBlob, 'v2').then(
      (result) => ({ ok: true, sha256: result.sha256, valid: result.inspection.valid }),
      (error) => ({ ok: false, name: error.name, message: error.message }),
    );
    return Promise.all([first, second]);
  }, secureAtlas.base64);
  assert.equal(insecureConcurrent[0].ok, false);
  assert.equal(insecureConcurrent[0].name, 'AbortError');
  assert.equal(insecureConcurrent[1].ok, true);
  assert.equal(insecureConcurrent[1].valid, true);
  assert.equal(insecureConcurrent[1].sha256, secureExpected);
  insecureUi = await readUi();
  assert.equal(insecureUi.valid, 'true');
  assert.equal(insecureUi.metaSha, secureExpected, 'stale no-subtle load did not overwrite the newer preview');
  await page.evaluate(() => {
    window.__atlasProbe.decodeDelayMs = 0;
  });

  await page.evaluate(() => window.__atlasFixture.dispose());
  insecureProbe = await probeState();
  assert.equal(insecureProbe.activeIntervals, 0);
  assert.equal(insecureProbe.outstandingBitmaps, 0);
  assert.equal(insecureProbe.objectUrls, 0);
  assert.equal(await readUi(), null);

  insecureScenario = {
    requestedLanUrl: navigation.requestedLanUrl,
    actualUrl: insecureEnvironment.href,
    transport: navigation.actualKind,
    lanSucceeded: navigation.actualKind === 'lan' && !navigation.lanError,
    lanError: navigation.lanError,
    isSecureContext: insecureEnvironment.isSecureContext,
    subtleAvailable: insecureEnvironment.subtleAvailable,
    hash: fallbackLoad.sha256,
    hashMatchesSecureContext: fallbackLoad.sha256 === secureExpected,
    nativeAndFallbackMatch: fallbackLoad.comparison.native.hash === fallbackLoad.comparison.fallback.hash,
    concurrentSuperseded: insecureConcurrent[0].name,
    resourceProbe: insecureProbe,
  };

  assert.deepEqual(pageErrors, [], 'no renderer page errors');
  assert.deepEqual(consoleErrors, [], 'no renderer console errors');

  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    fixtureUrl: url,
    scenarios: {
      validV2: { sha256: v2.result.sha256, bytes: v2.size, requiredFrames: 73 },
      validWebpV2: { sha256: webp.result.sha256, bytes: webp.size },
      validV1: { sha256: v1.result.sha256, bytes: v1.size, requiredFrames: 57 },
      emptyFrame: { sha256: empty.result.sha256, code: 'empty-frame', row: 4, frame: 2 },
      pollutedCell: { sha256: polluted.result.sha256, code: 'unused-cell', row: 0, frame: 6 },
      corruptPng: { rejected: true, message: corrupt.message },
      wrongMime: { rejected: true, message: wrongMime.message },
      missingMime: { rejected: true, message: missingMime.message },
      formatMismatch: { rejected: true, message: formatMismatch.message },
      oversized: { rejected: true, bytes: oversized.size },
      wrongDimensions: { rejected: true, message: wrongDimensions.message },
      wrongProfile: { rejected: true, message: wrongProfile.message },
      concurrent: {
        superseded: concurrent.first.name,
        latestValid: concurrent.second.valid,
      },
      cancelled: cancelled.name,
      disposedPending: disposedPending.name,
      resourceProbe: probe,
      sha256: {
        secureContext: {
          url,
          isSecureContext: secureAtlas.comparison.isSecureContext,
          subtleAvailable: secureAtlas.comparison.nativeAvailable,
          bytes: secureAtlas.size,
          nativeHash: secureAtlas.comparison.native.hash,
          fallbackHash: secureAtlas.comparison.fallback.hash,
          nativeMs: secureAtlas.comparison.native.elapsedMs,
          fallbackMs: secureAtlas.comparison.fallback.elapsedMs,
        },
        largeFallback: {
          bytes: 20 * 1024 * 1024,
          hash: largeFallback.hash,
          yields: largeFallback.yields,
          ticks: largeFallback.ticks,
          elapsedMs: largeFallback.elapsedMs,
        },
        insecureHttp: insecureScenario,
      },
    },
    pageErrors,
    consoleErrors,
  };
  await writeFile(new URL('result.json', artifacts), JSON.stringify(result, null, 2));
  console.log('Atlas preview smoke passed: native/fallback SHA-256, v1/v2/WebP preview, errors, stepping, gaze, playback, concurrency, cancel and disposal.');
} finally {
  if (desktop) {
    await desktop.close().catch(() => {});
  }
  if (server) {
    await server.close();
  }
  await removeOwnTempDirectory(temp);
}
