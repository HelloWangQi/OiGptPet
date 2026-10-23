import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, totalmem, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = resolve(root, 'artifacts/renderer-sprite/run-01');
await mkdir(outputDirectory, { recursive: true });

const inputExpectations = {
  v1: {
    path: 'artifacts/animation-fixes/run-04/atlas-v1.png',
    bytes: 293190,
    sha256: '05ac930c71c9a8f5308c2fc4c5aedcffaec99b865cbdc5a36b1c4ade1156e8f6',
  },
  v2: {
    path: 'artifacts/animation-fixes/run-04/atlas-v2.png',
    bytes: 370954,
    sha256: '84604125009381796d748388ab5b934dd9faac581b8cd8a00fd4417b4b3acada',
  },
};

function pngDimensions(bytes) {
  assert.ok(bytes.byteLength >= 24, 'PNG is too short.');
  assert.equal(bytes.readUInt32BE(0), 0x89504e47, 'PNG signature (1/2)');
  assert.equal(bytes.readUInt32BE(4), 0x0d0a1a0a, 'PNG signature (2/2)');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function removeOwnTempDirectory(directory) {
  const resolved = resolve(directory);
  const relativePath = relative(resolve(tmpdir()), resolved);
  assert.ok(
    relativePath.startsWith('oigptpet-renderer-sprite-')
      && !relativePath.startsWith('..')
      && !relativePath.includes(':'),
    `refusing to remove unexpected temp path: ${resolved}`,
  );
  await rm(resolved, { recursive: true, force: true });
}

function assertRgba(actual, expected, label, tolerance = 3) {
  assert.equal(actual.length, 4, `${label}: expected RGBA`);
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(
      Math.abs(actual[channel] - expected[channel]) <= tolerance,
      `${label}: channel ${channel} expected ${expected[channel]}, got ${actual[channel]}`,
    );
  }
  assert.equal(actual[3], expected[3], `${label}: alpha expected ${expected[3]}, got ${actual[3]}`);
}

const inputs = {};
for (const [profile, expectation] of Object.entries(inputExpectations)) {
  const path = resolve(root, expectation.path);
  const bytes = await readFile(path);
  assert.equal(bytes.byteLength, expectation.bytes, `${profile}: input byte size drifted`);
  assert.equal(hash(bytes), expectation.sha256, `${profile}: input hash drifted`);
  inputs[profile] = {
    ...expectation,
    path,
    base64: bytes.toString('base64'),
  };
}

const temp = await mkdtemp(join(tmpdir(), 'oigptpet-renderer-sprite-'));
const appDirectory = join(temp, 'app');
const userData = join(temp, 'user-data');
const cacheDirectory = join(temp, 'vite-cache');
await mkdir(appDirectory, { recursive: true });
await mkdir(userData, { recursive: true });
await writeFile(
  join(appDirectory, 'package.json'),
  JSON.stringify({ name: 'renderer-sprite-smoke-app', version: '0.0.0', main: 'main.cjs' }),
);
await writeFile(
  join(appDirectory, 'main.cjs'),
  `const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.SPRITE_SMOKE_USER_DATA);
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1100,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { backgroundThrottling: false },
  });
  window.loadURL(process.env.SPRITE_SMOKE_URL);
});
app.on('window-all-closed', () => app.quit());
`,
);

let desktop = null;
let server = null;
let page = null;
const pageErrors = [];
const consoleErrors = [];
const screenshots = [];

async function installProbe() {
  await page.evaluate(() => {
    const originalSetTimeout = window.setTimeout.bind(window);
    const probe = {
      openBitmaps: 0,
      closedBitmaps: 0,
      activeDecodes: 0,
      intervals: new Set(),
      rafCalls: 0,
      timeoutCalls: 0,
      webglContexts: 0,
      canvas2dContexts: 0,
      objectUrls: 0,
      decodeDurations: [],
      decodeDelays: [],
      originalSetTimeout,
    };

    const originalCreateImageBitmap = window.createImageBitmap.bind(window);
    window.createImageBitmap = async (...args) => {
      const delay = probe.decodeDelays.length > 0 ? probe.decodeDelays.shift() : 0;
      probe.activeDecodes += 1;
      try {
        if (delay > 0) {
          await new Promise((resolveDelay) => originalSetTimeout(resolveDelay, delay));
        }
        const started = performance.now();
        const bitmap = await originalCreateImageBitmap(...args);
        probe.decodeDurations.push(performance.now() - started);
        probe.openBitmaps += 1;
        return bitmap;
      } finally {
        probe.activeDecodes -= 1;
      }
    };

    const closed = new WeakSet();
    const originalClose = ImageBitmap.prototype.close;
    ImageBitmap.prototype.close = function close() {
      if (!closed.has(this)) {
        closed.add(this);
        probe.closedBitmaps += 1;
      }
      return originalClose.call(this);
    };

    const originalSetInterval = window.setInterval.bind(window);
    const originalClearInterval = window.clearInterval.bind(window);
    window.setInterval = (...args) => {
      const id = originalSetInterval(...args);
      probe.intervals.add(id);
      return id;
    };
    window.clearInterval = (id) => {
      probe.intervals.delete(id);
      return originalClearInterval(id);
    };
    window.setTimeout = (...args) => {
      probe.timeoutCalls += 1;
      return originalSetTimeout(...args);
    };

    const originalRaf = window.requestAnimationFrame?.bind(window);
    if (originalRaf) {
      window.requestAnimationFrame = (...args) => {
        probe.rafCalls += 1;
        return originalRaf(...args);
      };
    }

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
      if (typeof type === 'string') {
        const normalized = type.toLowerCase();
        if (normalized === '2d') {
          probe.canvas2dContexts += 1;
        } else if (normalized.includes('webgl')) {
          probe.webglContexts += 1;
        }
      }
      return originalGetContext.call(this, type, ...rest);
    };

    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (...args) => {
      probe.objectUrls += 1;
      return originalCreateObjectUrl(...args);
    };

    window.__spriteProbe = probe;
  });
}

async function probeState() {
  return page.evaluate(() => {
    const probe = window.__spriteProbe;
    return {
      openBitmaps: probe.openBitmaps,
      closedBitmaps: probe.closedBitmaps,
      outstandingBitmaps: probe.openBitmaps - probe.closedBitmaps,
      activeDecodes: probe.activeDecodes,
      activeIntervals: probe.intervals.size,
      rafCalls: probe.rafCalls,
      timeoutCalls: probe.timeoutCalls,
      webglContexts: probe.webglContexts,
      canvas2dContexts: probe.canvas2dContexts,
      objectUrls: probe.objectUrls,
      decodeDurations: [...probe.decodeDurations],
    };
  });
}

async function canvasAlpha(x = 0, y = 0) {
  return page.evaluate(
    ({ x, y }) => window.__spriteFixture.canvasPixel(x, y)[3],
    { x, y },
  );
}

async function loadOutcome(key, profile) {
  return page.evaluate(async ({ key, profile }) => {
    try {
      const result = await window.__spriteFixture.loadKey(key, profile);
      return { ok: true, sha256: result.sha256, profile: result.profile };
    } catch (error) {
      return {
        ok: false,
        name: error.name,
        message: error.message,
        code: error.code ?? null,
        inspection: error.inspection
          ? {
            valid: error.inspection.valid,
            codes: error.inspection.errors.map((issue) => issue.code),
            rows: error.inspection.errors.map((issue) => issue.row).filter((row) => row !== undefined),
            frames: error.inspection.errors.map((issue) => issue.frame).filter((frame) => frame !== undefined),
          }
          : null,
      };
    }
  }, { key, profile });
}

async function saveCanvas(name) {
  const dataUrl = await page.evaluate(() => window.__spriteFixture.canvasDataUrl());
  assert.match(dataUrl, /^data:image\/png;base64,/, `${name}: canvas must encode as PNG`);
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const dimensions = pngDimensions(bytes);
  await writeFile(join(outputDirectory, name), bytes);
  screenshots.push({ name, bytes: bytes.byteLength, ...dimensions });
  return dimensions;
}

async function verifyRealCell(key, row, frame, render, label) {
  const analysis = await page.evaluate(
    ({ key, row, frame }) => window.__spriteFixture.analyzeKey(key, row, frame),
    { key, row, frame },
  );
  assert.ok(
    analysis.opaque.length >= 8,
    `${label}: expected at least 8 stable opaque points, found ${analysis.opaque.length}`,
  );
  assert.ok(
    analysis.transparent.length >= 8,
    `${label}: expected at least 8 stable transparent points, found ${analysis.transparent.length}`,
  );

  const checks = await page.evaluate(({ analysis, render }) => {
    const fixture = window.__spriteFixture;
    fixture.render(render.state, render.time, render.look);
    const snapshot = fixture.canvasSnapshot();
    const sample = (point) => ({
      pixel: fixture.canvasPixel(point.x, point.y),
      hit: fixture.hitTest(
        snapshot.rect.left + point.x + 0.5,
        snapshot.rect.top + point.y + 0.5,
      ),
    });
    return {
      opaque: analysis.opaque.slice(0, 12).map(sample),
      transparent: analysis.transparent.slice(0, 12).map(sample),
    };
  }, { analysis, render });

  for (const [index, check] of checks.opaque.entries()) {
    const point = analysis.opaque[index];
    assertRgba(check.pixel, point.rgba, `${label}: opaque point ${index}`, 2);
    assert.equal(check.hit, true, `${label}: opaque point ${index} must hit`);
  }
  for (const [index, check] of checks.transparent.entries()) {
    assert.equal(check.pixel[3], 0, `${label}: transparent point ${index} must stay transparent`);
    assert.equal(check.hit, false, `${label}: transparent point ${index} must not hit`);
  }
  return { analysisCounts: { opaque: analysis.opaque.length, transparent: analysis.transparent.length } };
}

try {
  server = await createServer({
    configFile: false,
    root,
    logLevel: 'error',
    appType: 'mpa',
    cacheDir: cacheDirectory,
    server: { host: '127.0.0.1', port: 0, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls?.local?.[0];
  assert.ok(baseUrl, 'Vite dev server did not expose a local URL');
  const url = new URL('tests/fixtures/renderer-sprite/index.html', baseUrl).href;

  const env = {
    ...process.env,
    SPRITE_SMOKE_URL: url,
    SPRITE_SMOKE_USER_DATA: userData,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await electron.launch({
    args: [appDirectory],
    cwd: root,
    env,
    timeout: 60000,
  });
  const environment = await desktop.evaluate(() => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }));

  page = await desktop.firstWindow({ timeout: 60000 });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  await page.waitForFunction(() => Boolean(window.__spriteFixture), undefined, { timeout: 60000 });
  await installProbe();

  await page.evaluate(({ v1, v2 }) => {
    window.__spriteFixture.putBlob('real-v1', v1, 'image/png');
    window.__spriteFixture.putBlob('real-v2', v2, 'image/png');
  }, { v1: inputs.v1.base64, v2: inputs.v2.base64 });

  await page.evaluate(() => window.__spriteFixture.mount({ width: 192, height: 208, pixelRatio: 1 }));
  let stageInfo = await page.evaluate(() => window.__spriteFixture.stageInfo());
  assert.equal(stageInfo.loaded, false, 'a fresh stage has no image');
  assert.deepEqual(stageInfo.canvas, {
    width: 192,
    height: 208,
    cssWidth: 192,
    cssHeight: 208,
    rect: stageInfo.canvas.rect,
  });
  assert.ok(Math.abs(stageInfo.canvas.rect.width - 192) < 0.01);
  assert.ok(Math.abs(stageInfo.canvas.rect.height - 208) < 0.01);

  // Real v2 PNG: hash, structure, full-cell drawing and alpha hit mapping.
  const realV2 = await page.evaluate(() =>
    window.__spriteFixture.loadKeyTimed('real-v2', 'v2'));
  assert.equal(realV2.summary.sha256, inputs.v2.sha256, 'v2 hash comes from the actual file');
  assert.equal(realV2.summary.encodedBytes, inputs.v2.bytes);
  assert.equal(realV2.summary.sameBlob, true, 'load returns the same Blob object');
  assert.equal(realV2.summary.profile, 'v2');
  assert.equal(realV2.summary.inspection.valid, true);
  assert.equal(realV2.summary.inspection.requiredFrames, 73);
  assert.ok(realV2.summary.inspection.warnings.join(' ').includes('不能替代'));
  stageInfo = await page.evaluate(() => window.__spriteFixture.stageInfo());
  assert.equal(stageInfo.loaded, true);
  let probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 1, 'one retained bitmap while loaded');
  assert.equal(probe.activeIntervals, 0, 'no internal playback interval');
  assert.equal(probe.webglContexts, 0, 'no WebGL context is created');

  const realV2Idle = await verifyRealCell('real-v2', 0, 0, { state: 'idle', time: 0 }, 'real v2 idle frame 0');
  await saveCanvas('real-v2-idle-192x208.png');
  const realV2Gaze = await verifyRealCell(
    'real-v2',
    9,
    4,
    { state: 'idle', time: 0, look: 90 },
    'real v2 gaze 90',
  );
  await saveCanvas('real-v2-gaze-90-192x208.png');
  const realV2Jump = await verifyRealCell(
    'real-v2',
    4,
    0,
    { state: 'jumping', time: 0 },
    'real v2 jumping frame 0',
  );

  // Real v1 PNG: 57 frames, and a look angle must be ignored.
  const realV1 = await page.evaluate(() =>
    window.__spriteFixture.loadKeyTimed('real-v1', 'v1'));
  assert.equal(realV1.summary.sha256, inputs.v1.sha256, 'v1 hash comes from the actual file');
  assert.equal(realV1.summary.encodedBytes, inputs.v1.bytes);
  assert.equal(realV1.summary.sameBlob, true);
  assert.equal(realV1.summary.inspection.valid, true);
  assert.equal(realV1.summary.inspection.requiredFrames, 57);
  probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 1, 'replacing real v2 releases its bitmap');
  const realV1Idle = await verifyRealCell('real-v1', 0, 0, { state: 'idle', time: 0 }, 'real v1 idle frame 0');
  const realV1LookIgnored = await verifyRealCell(
    'real-v1',
    0,
    0,
    { state: 'idle', time: 0, look: 90 },
    'real v1 ignores look',
  );
  await saveCanvas('real-v1-idle-192x208.png');

  // Marker atlas: exact frame, row, gaze quantization and edge-to-edge full-cell draw.
  const markerV2Result = await page.evaluate(() => window.__spriteFixture.makeMarker('v2'));
  assert.equal(markerV2Result.type, 'image/png');
  await page.evaluate((key) => window.__spriteFixture.loadKey(key, 'v2'), markerV2Result.key);
  await page.evaluate(() => window.__spriteFixture.resize(192, 208, 1));
  const markerCases = [
    { label: 'idle 0', state: 'idle', time: 0, row: 0, frame: 0 },
    { label: 'idle 0.125', state: 'idle', time: 0.125, row: 0, frame: 1 },
    { label: 'running-right 0', state: 'running-right', time: 0, row: 1, frame: 0 },
    { label: 'running-left 0.25', state: 'running-left', time: 0.25, row: 2, frame: 2 },
    { label: 'waving 0.25', state: 'waving', time: 0.25, row: 3, frame: 2 },
    { label: 'jumping 0', state: 'jumping', time: 0, row: 4, frame: 0 },
    { label: 'failed 0', state: 'failed', time: 0, row: 5, frame: 0 },
    { label: 'waiting 0.25', state: 'waiting', time: 0.25, row: 6, frame: 2 },
    { label: 'running 0', state: 'running', time: 0, row: 7, frame: 0 },
    { label: 'review 0.125', state: 'review', time: 0.125, row: 8, frame: 1 },
    { label: 'gaze 90', state: 'idle', time: 0, look: 90, row: 9, frame: 4 },
    { label: 'gaze -90', state: 'idle', time: 0, look: -90, row: 10, frame: 4 },
    { label: 'gaze 337.5', state: 'idle', time: 0, look: 337.5, row: 10, frame: 7 },
    { label: 'gaze 11.25', state: 'idle', time: 0, look: 11.25, row: 9, frame: 1 },
    { label: 'gaze Infinity', state: 'idle', time: 0, look: Number.POSITIVE_INFINITY, row: 9, frame: 0 },
  ];
  const markerDraws = await page.evaluate((cases) => {
    const fixture = window.__spriteFixture;
    return cases.map((entry) => {
      fixture.render(entry.state, entry.time, entry.look);
      const info = fixture.markerInfo(entry.row, entry.frame);
      return {
        label: entry.label,
        pixel: fixture.canvasPixel(info.local.x, info.local.y),
        color: info.color,
        top: fixture.canvasPixel(info.localTop.x, info.localTop.y),
        bottom: fixture.canvasPixel(info.localBottom.x, info.localBottom.y),
      };
    });
  }, markerCases);
  for (const entry of markerDraws) {
    assertRgba(entry.pixel, [...entry.color, 255], `marker ${entry.label}`, 2);
    assertRgba(entry.top, [255, 0, 0, 255], `marker ${entry.label} top edge`, 2);
    assertRgba(entry.bottom, [0, 0, 255, 255], `marker ${entry.label} bottom edge`, 2);
  }

  const markerAlphaSamples = await page.evaluate((key) => {
    const fixture = window.__spriteFixture;
    return fixture.sampleKey(key, 0, 0, [
      { x: 60, y: 30 },
      { x: 61, y: 30 },
      { x: 30, y: 120 },
      { x: 31, y: 120 },
    ]);
  }, markerV2Result.key);
  assert.deepEqual(markerAlphaSamples.map((rgba) => rgba[3]), [7, 200, 7, 8], 'fixture alpha boundary values');

  const markerHits = await page.evaluate(() => {
    const fixture = window.__spriteFixture;
    const snapshot = fixture.canvasSnapshot();
    const at = (x, y) => fixture.hitTest(snapshot.rect.left + x + 0.5, snapshot.rect.top + y + 0.5);
    fixture.render('idle', 0);
    const idle = {
      block: at(40, 40),
      empty: at(100, 40),
      alpha7: at(60, 30),
      alpha200: at(61, 30),
      threshold7: at(30, 120),
      threshold8: at(31, 120),
      corner: at(191, 207),
    };
    fixture.render('jumping', 0);
    const jumping = { bottom: at(20, 190), top: at(20, 20) };
    fixture.render('idle', 0, 90);
    const gaze = { block: at(160, 180), idle: at(40, 40) };
    return { idle, jumping, gaze };
  });
  assert.deepEqual(markerHits.idle, {
    block: true,
    empty: false,
    alpha7: false,
    alpha200: true,
    threshold7: false,
    threshold8: true,
    corner: false,
  });
  assert.deepEqual(markerHits.jumping, { bottom: true, top: false });
  assert.deepEqual(markerHits.gaze, { block: true, idle: false });

  // Contain + DPR + CSS scaling.
  await page.evaluate(() => window.__spriteFixture.resize(400, 300, 2));
  const containDpr = await page.evaluate(() => {
    const fixture = window.__spriteFixture;
    fixture.render('idle', 0);
    const snapshot = fixture.canvasSnapshot();
    const canvasWidth = snapshot.width;
    const canvasHeight = snapshot.height;
    const scale = Math.min(canvasWidth / 192, canvasHeight / 208);
    const destination = {
      x: (canvasWidth - 192 * scale) / 2,
      y: (canvasHeight - 208 * scale) / 2,
      width: 192 * scale,
      height: 208 * scale,
    };
    const info = fixture.markerInfo(0, 0);
    const toClient = (x, y) => ({
      clientX: snapshot.rect.left + (
        (destination.x + ((x + 0.5) / 192) * destination.width) / canvasWidth
      ) * snapshot.rect.width,
      clientY: snapshot.rect.top + (
        (destination.y + ((y + 0.5) / 208) * destination.height) / canvasHeight
      ) * snapshot.rect.height,
    });
    const point = toClient(info.local.x, info.local.y);
    const edgeTop = toClient(info.localTop.x, info.localTop.y);
    const edgeBottom = toClient(info.localBottom.x, info.localBottom.y);
    const pixelAt = (client) => {
      const x = Math.floor(
        ((client.clientX - snapshot.rect.left) / snapshot.rect.width) * canvasWidth,
      );
      const y = Math.floor(
        ((client.clientY - snapshot.rect.top) / snapshot.rect.height) * canvasHeight,
      );
      return fixture.canvasPixel(x, y);
    };
    return {
      snapshot,
      destination,
      markerPixel: pixelAt(point),
      markerHit: fixture.hitTest(point.clientX, point.clientY),
      topPixel: pixelAt(edgeTop),
      topHit: fixture.hitTest(edgeTop.clientX, edgeTop.clientY),
      bottomPixel: pixelAt(edgeBottom),
      bottomHit: fixture.hitTest(edgeBottom.clientX, edgeBottom.clientY),
      letterbox: fixture.canvasPixel(10, 10),
      rightLetterbox: fixture.canvasPixel(canvasWidth - 10, 10),
      letterboxHit: fixture.hitTest(snapshot.rect.left + 10, snapshot.rect.top + 10),
      farHit: fixture.hitTest(
        snapshot.rect.left + snapshot.rect.width - 1,
        snapshot.rect.top + snapshot.rect.height - 1,
      ),
    };
  });
  assert.equal(containDpr.snapshot.width, 800);
  assert.equal(containDpr.snapshot.height, 600);
  assert.equal(containDpr.snapshot.cssWidth, 400);
  assert.equal(containDpr.snapshot.cssHeight, 300);
  assert.equal(containDpr.letterbox[3], 0, 'left letterbox stays transparent');
  assert.equal(containDpr.rightLetterbox[3], 0, 'right letterbox stays transparent');
  assertRgba(containDpr.markerPixel, [...(await page.evaluate(() => window.__spriteFixture.markerInfo(0, 0).color)), 255], 'contain dpr marker', 4);
  assertRgba(containDpr.topPixel, [255, 0, 0, 255], 'contain dpr top edge', 4);
  assertRgba(containDpr.bottomPixel, [0, 0, 255, 255], 'contain dpr bottom edge', 4);
  assert.equal(containDpr.markerHit, true);
  assert.equal(containDpr.topHit, true);
  assert.equal(containDpr.bottomHit, true);
  assert.equal(containDpr.letterboxHit, false);
  assert.equal(containDpr.farHit, false);
  await saveCanvas('marker-v2-contain-400x300-dpr2.png');

  // CSS stretching outside the API's control still maps through the actual rect.
  const stretched = await page.evaluate(() => {
    const fixture = window.__spriteFixture;
    const canvas = document.querySelector('[data-sprite-canvas]');
    canvas.style.width = '300px';
    canvas.style.height = '300px';
    const snapshot = fixture.canvasSnapshot();
    const scale = Math.min(snapshot.width / 192, snapshot.height / 208);
    const destination = {
      x: (snapshot.width - 192 * scale) / 2,
      y: (snapshot.height - 208 * scale) / 2,
      width: 192 * scale,
      height: 208 * scale,
    };
    const info = fixture.markerInfo(0, 0);
    const clientX = snapshot.rect.left + (
      (destination.x + ((info.local.x + 0.5) / 192) * destination.width) / snapshot.width
    ) * snapshot.rect.width;
    const clientY = snapshot.rect.top + (
      (destination.y + ((info.local.y + 0.5) / 208) * destination.height) / snapshot.height
    ) * snapshot.rect.height;
    return {
      rect: snapshot.rect,
      hit: fixture.hitTest(clientX, clientY),
      letterbox: fixture.hitTest(snapshot.rect.left + 5, snapshot.rect.top + 5),
    };
  });
  assert.ok(Math.abs(stretched.rect.width - 300) < 0.01);
  assert.ok(Math.abs(stretched.rect.height - 300) < 0.01);
  assert.equal(stretched.hit, true, 'CSS-stretched canvas still maps hits through the actual rect');
  assert.equal(stretched.letterbox, false);

  await page.evaluate(() => window.__spriteFixture.resize(300, 400, 1));
  const tall = await page.evaluate(() => {
    const fixture = window.__spriteFixture;
    fixture.render('idle', 0);
    const snapshot = fixture.canvasSnapshot();
    const info = fixture.markerInfo(0, 0);
    const scale = Math.min(snapshot.width / 192, snapshot.height / 208);
    const destination = {
      x: (snapshot.width - 192 * scale) / 2,
      y: (snapshot.height - 208 * scale) / 2,
      width: 192 * scale,
      height: 208 * scale,
    };
    const clientX = snapshot.rect.left + destination.x + ((info.local.x + 0.5) / 192) * destination.width;
    const clientY = snapshot.rect.top + destination.y + ((info.local.y + 0.5) / 208) * destination.height;
    const pixelX = Math.floor(destination.x + ((info.local.x + 0.5) / 192) * destination.width);
    const pixelY = Math.floor(destination.y + ((info.local.y + 0.5) / 208) * destination.height);
    return {
      pixel: fixture.canvasPixel(pixelX, pixelY),
      hit: fixture.hitTest(clientX, clientY),
      topLetterbox: fixture.canvasPixel(10, 10),
      topHit: fixture.hitTest(
        snapshot.rect.left + 10,
        snapshot.rect.top + 10,
      ),
    };
  });
  assertRgba(tall.pixel, [20, 20, 200, 255], 'tall contain marker');
  assert.equal(tall.hit, true);
  assert.equal(tall.topLetterbox[3], 0, 'top letterbox stays transparent');
  assert.equal(tall.topHit, false);

  const resizeErrors = await page.evaluate(() => {
    const fixture = window.__spriteFixture;
    fixture.resize(320, 240, 1);
    const before = fixture.canvasSnapshot();
    const attempts = [
      [Number.NaN, 100],
      [100, Number.NaN],
      [Number.POSITIVE_INFINITY, 100],
      [0, 100],
      [100, -1],
      [5000, 100, 1],
      [3000, 100, 2],
    ];
    const errors = attempts.map((args) => {
      try {
        fixture.resize(...args);
        return null;
      } catch (error) {
        return { name: error.name, message: error.message };
      }
    });
    return { before, after: fixture.canvasSnapshot(), errors };
  });
  for (const error of resizeErrors.errors) {
    assert.ok(error, 'invalid resize must throw');
    assert.equal(error.name, 'RangeError');
    assert.ok(error.message.length > 0);
  }
  assert.deepEqual(resizeErrors.after, resizeErrors.before, 'rejected resize must not change the canvas');

  // WebP through the same final-Blob path.
  const markerWebpV2 = await page.evaluate(() => window.__spriteFixture.makeMarker('v2', { format: 'webp' }));
  assert.equal(markerWebpV2.type, 'image/webp');
  const webpV2Load = await page.evaluate((key) => window.__spriteFixture.loadKey(key, 'v2'), markerWebpV2.key);
  assert.equal(webpV2Load.inspection.valid, true);
  await page.evaluate(() => window.__spriteFixture.resize(192, 208, 1));
  const webpGaze = await page.evaluate((key) => {
    const fixture = window.__spriteFixture;
    fixture.render('idle', 0, 90);
    const info = fixture.markerInfo(9, 4);
    return { pixel: fixture.canvasPixel(info.local.x, info.local.y), color: info.color };
  }, markerWebpV2.key);
  assertRgba(webpGaze.pixel, [...webpGaze.color, 255], 'webp gaze marker', 12);

  const markerWebpV1 = await page.evaluate(() => window.__spriteFixture.makeMarker('v1', { format: 'webp' }));
  assert.equal(markerWebpV1.type, 'image/webp');
  const webpV1Load = await page.evaluate((key) => window.__spriteFixture.loadKey(key, 'v1'), markerWebpV1.key);
  assert.equal(webpV1Load.inspection.valid, true);
  assert.equal(webpV1Load.inspection.requiredFrames, 57);

  // Structural and input failures clear the display and never leak bitmaps.
  const invalidScenarios = {};
  const emptyKey = await page.evaluate(() => window.__spriteFixture.makeMarker('v2', {
    empty: { row: 4, frame: 2 },
  }));
  invalidScenarios.emptyFrame = await loadOutcome(emptyKey.key, 'v2');
  assert.equal(invalidScenarios.emptyFrame.ok, false);
  assert.equal(invalidScenarios.emptyFrame.name, 'SpriteStageError');
  assert.equal(invalidScenarios.emptyFrame.code, 'inspection');
  assert.ok(invalidScenarios.emptyFrame.inspection.codes.includes('empty-frame'));
  assert.ok(invalidScenarios.emptyFrame.inspection.rows.includes(4));
  assert.ok(invalidScenarios.emptyFrame.inspection.frames.includes(2));
  await page.evaluate((key) => window.__spriteFixture.removeKey(key), emptyKey.key);

  const pollutedKey = await page.evaluate(() => window.__spriteFixture.makeMarker('v2', {
    pollute: { row: 0, frame: 6 },
  }));
  invalidScenarios.pollutedCell = await loadOutcome(pollutedKey.key, 'v2');
  assert.equal(invalidScenarios.pollutedCell.code, 'inspection');
  assert.ok(invalidScenarios.pollutedCell.inspection.codes.includes('unused-cell'));
  await page.evaluate((key) => window.__spriteFixture.removeKey(key), pollutedKey.key);

  invalidScenarios.corruptPng = await loadOutcome(
    await page.evaluate(() => window.__spriteFixture.makeCorruptPng('v2')),
    'v2',
  );
  assert.equal(invalidScenarios.corruptPng.code, 'decode');
  assert.match(invalidScenarios.corruptPng.message, /无法解码/);

  invalidScenarios.fakeImage = await loadOutcome(
    await page.evaluate(() => window.__spriteFixture.makeFakeImage()),
    'v2',
  );
  assert.equal(invalidScenarios.fakeImage.code, 'format');

  invalidScenarios.wrongDimensions = await loadOutcome(
    await page.evaluate(() => window.__spriteFixture.makeMarker('v1').then((entry) => entry.key)),
    'v2',
  );
  assert.equal(invalidScenarios.wrongDimensions.code, 'dimensions');

  const gifKey = await page.evaluate((key) =>
    window.__spriteFixture.rewrapKey(key, 'image/gif'), markerV2Result.key);
  invalidScenarios.wrongMime = await loadOutcome(gifKey, 'v2');
  assert.equal(invalidScenarios.wrongMime.code, 'mime');

  const missingMimeKey = await page.evaluate((key) =>
    window.__spriteFixture.rewrapKey(key, ''), markerV2Result.key);
  invalidScenarios.missingMime = await loadOutcome(missingMimeKey, 'v2');
  assert.equal(invalidScenarios.missingMime.code, 'mime');

  const mismatchKey = await page.evaluate((key) =>
    window.__spriteFixture.rewrapKey(key, 'image/png'), markerWebpV2.key);
  invalidScenarios.formatMismatch = await loadOutcome(mismatchKey, 'v2');
  assert.equal(invalidScenarios.formatMismatch.code, 'format');
  assert.match(invalidScenarios.formatMismatch.message, /不一致/);

  const oversizedKey = await page.evaluate(() => window.__spriteFixture.makeOversized());
  invalidScenarios.oversized = await loadOutcome(oversizedKey, 'v2');
  assert.equal(invalidScenarios.oversized.code, 'file-size');
  await page.evaluate((key) => window.__spriteFixture.removeKey(key), oversizedKey);

  invalidScenarios.wrongProfile = await loadOutcome('real-v2', 'v3');
  assert.equal(invalidScenarios.wrongProfile.code, 'profile');

  for (const [name, scenario] of Object.entries(invalidScenarios)) {
    assert.equal(scenario.ok, false, `${name}: must reject`);
    assert.equal(await page.evaluate(() => window.__spriteFixture.stageInfo().loaded), false, `${name}: stage must not stay loaded`);
    assert.equal(await canvasAlpha(0, 0), 0, `${name}: canvas must be cleared`);
  }
  probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 0, 'all rejected inputs release their bitmaps');
  assert.equal(probe.activeIntervals, 0);
  assert.equal(probe.webglContexts, 0);

  // Repeated load and synchronous clearing at the start of a new load.
  await page.evaluate((key) => window.__spriteFixture.loadKey(key, 'v2'), markerV2Result.key);
  const repeat = await page.evaluate(async (key) => {
    const fixture = window.__spriteFixture;
    const first = await fixture.loadKey(key, 'v2');
    const second = await fixture.loadKey(key, 'v2');
    return { first: first.sha256, second: second.sha256 };
  }, markerV2Result.key);
  assert.equal(repeat.first, repeat.second, 'the same bytes produce the same digest on repeated loads');
  probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 1, 'repeated load keeps exactly one bitmap');

  const clearing = await page.evaluate(async (key) => {
    const fixture = window.__spriteFixture;
    window.__spriteProbe.decodeDelays = [300];
    const pending = fixture.loadKey(key, 'v2').then(
      (result) => ({ ok: true, sha256: result.sha256 }),
      (error) => ({ ok: false, name: error.name }),
    );
    const immediate = {
      loaded: fixture.isLoaded(),
      alpha: fixture.canvasPixel(0, 0)[3],
    };
    return { immediate, outcome: await pending };
  }, markerV2Result.key);
  assert.deepEqual(clearing.immediate, { loaded: false, alpha: 0 }, 'a new load clears the old image synchronously');
  assert.equal(clearing.outcome.ok, true);

  // Latest load wins; the superseded decode is released when it finally arrives.
  probe = await probeState();
  const closedBeforeRace = probe.closedBitmaps;
  await page.evaluate(() => {
    window.__spriteProbe.decodeDelays = [400, 0];
  });
  const race = await page.evaluate(async () => {
    const fixture = window.__spriteFixture;
    const first = fixture.loadKey('real-v1', 'v1').then(
      (result) => ({ ok: true, sha256: result.sha256 }),
      (error) => ({ ok: false, name: error.name }),
    );
    while (window.__spriteProbe.activeDecodes !== 1) {
      await new Promise((resolveDelay) => window.__spriteProbe.originalSetTimeout(resolveDelay, 5));
    }
    const second = fixture.loadKey('real-v2', 'v2').then(
      (result) => ({ ok: true, sha256: result.sha256, profile: result.profile }),
      (error) => ({ ok: false, name: error.name }),
    );
    return { first: await first, second: await second };
  });
  assert.equal(race.first.ok, false);
  assert.equal(race.first.name, 'AbortError');
  assert.equal(race.second.ok, true);
  assert.equal(race.second.profile, 'v2');
  assert.equal(race.second.sha256, inputs.v2.sha256);
  assert.equal(await page.evaluate(() => window.__spriteFixture.isLoaded()), true);
  await page.waitForFunction(
    (target) => window.__spriteProbe.closedBitmaps >= target,
    closedBeforeRace + 1,
    { timeout: 5000 },
  );
  probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 1, 'superseded decode is closed after it resolves');

  // Cancellation: prompt AbortError, then the late bitmap is closed.
  const closedBeforeCancel = probe.closedBitmaps;
  await page.evaluate(() => {
    window.__spriteProbe.decodeDelays = [400];
  });
  const cancelled = await page.evaluate(async () => {
    const fixture = window.__spriteFixture;
    const controller = new AbortController();
    const started = performance.now();
    const pending = fixture.loadKey('real-v2', 'v2', controller.signal).then(
      (result) => ({ ok: true, sha256: result.sha256 }),
      (error) => ({ ok: false, name: error.name, message: error.message }),
    );
    while (window.__spriteProbe.activeDecodes !== 1) {
      await new Promise((resolveDelay) => window.__spriteProbe.originalSetTimeout(resolveDelay, 5));
    }
    controller.abort();
    const outcome = await pending;
    return { ...outcome, elapsedMs: performance.now() - started };
  });
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.name, 'AbortError');
  assert.ok(cancelled.elapsedMs < 300, `cancellation must not wait for decode (${cancelled.elapsedMs}ms)`);
  assert.equal(await page.evaluate(() => window.__spriteFixture.isLoaded()), false);
  await page.waitForFunction(
    (target) => window.__spriteProbe.closedBitmaps >= target,
    closedBeforeCancel + 1,
    { timeout: 5000 },
  );
  probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 0, 'cancelled decode releases its late bitmap');

  // Dispose during a load and dispose idempotence.
  await page.evaluate(() => {
    window.__spriteProbe.decodeDelays = [400];
  });
  const disposedPending = await page.evaluate(async () => {
    const fixture = window.__spriteFixture;
    const pending = fixture.loadKey('real-v2', 'v2').then(
      (result) => ({ ok: true, sha256: result.sha256 }),
      (error) => ({ ok: false, name: error.name }),
    );
    while (window.__spriteProbe.activeDecodes !== 1) {
      await new Promise((resolveDelay) => window.__spriteProbe.originalSetTimeout(resolveDelay, 5));
    }
    fixture.dispose();
    fixture.dispose();
    const outcome = await pending;
    return {
      outcome,
      loaded: fixture.isLoaded(),
      afterLoad: await fixture.loadKey('real-v2', 'v2').then(
        () => ({ ok: true }),
        (error) => ({ ok: false, name: error.name }),
      ),
      canvas: fixture.canvasPixel(0, 0),
      resized: (() => {
        const before = fixture.canvasSnapshot();
        fixture.resize(100, 100, 1);
        return { before, after: fixture.canvasSnapshot() };
      })(),
    };
  });
  assert.equal(disposedPending.outcome.ok, false);
  assert.equal(disposedPending.outcome.name, 'AbortError');
  assert.equal(disposedPending.loaded, false);
  assert.equal(disposedPending.afterLoad.ok, false);
  assert.equal(disposedPending.afterLoad.name, 'AbortError');
  assert.equal(disposedPending.canvas[3], 0, 'dispose clears the canvas');
  assert.deepEqual(disposedPending.resized.after, disposedPending.resized.before, 'resize after dispose is a no-op');
  await page.waitForFunction(
    (target) => window.__spriteProbe.closedBitmaps >= target,
    probe.closedBitmaps + 1,
    { timeout: 5000 },
  );
  probe = await probeState();
  assert.equal(probe.outstandingBitmaps, 0, 'dispose during load releases the late bitmap');
  assert.equal(probe.activeIntervals, 0);
  assert.equal(probe.rafCalls, 0, 'the renderer never schedules requestAnimationFrame');
  assert.equal(probe.timeoutCalls, 0, 'the renderer never schedules setTimeout');
  assert.equal(probe.webglContexts, 0, 'the renderer never creates a WebGL context');
  assert.equal(probe.objectUrls, 0, 'the renderer never creates object URLs');

  const finalCanvasCounts = probe.canvas2dContexts;
  assert.ok(finalCanvasCounts > 0, 'the fixture used Canvas 2D contexts');
  await page.evaluate(() => {
    window.__spriteFixture.mount({ width: 192, height: 208, pixelRatio: 1 });
  });
  const remounted = await page.evaluate((key) => window.__spriteFixture.loadKey(key, 'v2'), markerV2Result.key);
  assert.equal(remounted.inspection.valid, true, 'a fresh stage can be mounted after dispose');
  await page.evaluate(() => window.__spriteFixture.dispose());

  assert.deepEqual(pageErrors, [], 'no renderer page errors');
  assert.deepEqual(consoleErrors, [], 'no renderer console errors');

  const finalProbe = await probeState();
  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    fixtureUrl: url,
    environment: {
      ...environment,
      os: `${process.platform} ${process.arch}`,
      cpus: cpus().length,
      totalMemoryBytes: totalmem(),
      devicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
    },
    inputs: {
      v1: {
        path: relative(root, inputs.v1.path),
        bytes: inputs.v1.bytes,
        sha256: inputs.v1.sha256,
        loadMs: realV1.elapsedMs,
      },
      v2: {
        path: relative(root, inputs.v2.path),
        bytes: inputs.v2.bytes,
        sha256: inputs.v2.sha256,
        loadMs: realV2.elapsedMs,
      },
    },
    realAtlas: {
      v1: {
        requiredFrames: realV1.summary.inspection.requiredFrames,
        idle: realV1Idle.analysisCounts,
        lookIgnored: realV1LookIgnored.analysisCounts,
      },
      v2: {
        requiredFrames: realV2.summary.inspection.requiredFrames,
        idle: realV2Idle.analysisCounts,
        gaze: realV2Gaze.analysisCounts,
        jumping: realV2Jump.analysisCounts,
      },
    },
    marker: {
      frames: markerDraws.map((entry) => ({
        label: entry.label,
        pixel: entry.pixel,
        expected: [...entry.color, 255],
      })),
      alphaSamples: markerAlphaSamples.map((rgba) => rgba[3]),
      hits: markerHits,
    },
    containDpr: {
      width: containDpr.snapshot.width,
      height: containDpr.snapshot.height,
      cssWidth: containDpr.snapshot.cssWidth,
      cssHeight: containDpr.snapshot.cssHeight,
      letterboxAlpha: containDpr.letterbox[3],
      rightLetterboxAlpha: containDpr.rightLetterbox[3],
      markerHit: containDpr.markerHit,
      topHit: containDpr.topHit,
      bottomHit: containDpr.bottomHit,
      letterboxHit: containDpr.letterboxHit,
      farHit: containDpr.farHit,
    },
    webp: {
      v1: { bytes: markerWebpV1.size, requiredFrames: webpV1Load.inspection.requiredFrames },
      v2: { bytes: markerWebpV2.size, gazePixel: webpGaze.pixel },
    },
    invalidScenarios,
    race: { superseded: race.first.name, latest: race.second.profile },
    cancelled: { name: cancelled.name, elapsedMs: cancelled.elapsedMs },
    disposedPending: { name: disposedPending.outcome.name, afterLoad: disposedPending.afterLoad.name },
    screenshots,
    resources: finalProbe,
    timing: {
      conditions: 'Windows 10, hidden Electron window, single process, software Canvas 2D; wall-clock values include Blob read, SHA-256, decode, pixel read and structural inspection. Not a cross-hardware guarantee.',
      realV1LoadMs: realV1.elapsedMs,
      realV2LoadMs: realV2.elapsedMs,
      decodeDurationsMs: finalProbe.decodeDurations,
    },
    pageErrors,
    consoleErrors,
  };
  await writeFile(join(outputDirectory, 'result.json'), JSON.stringify(result, null, 2));
  console.log('Renderer sprite smoke passed: real v1/v2, marker frames/gaze, contain/DPR, alpha hit tests, invalid inputs, races, cancellation and disposal.');
} finally {
  if (desktop) {
    await desktop.close().catch(() => {});
  }
  if (server) {
    await server.close();
  }
  await removeOwnTempDirectory(temp);
}
