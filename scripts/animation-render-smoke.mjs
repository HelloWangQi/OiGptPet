import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixesDirectory = resolve(root, 'artifacts/animation-fixes');

function parseArguments(argv) {
  let model = 'public/models/demo.vrm';
  let outDir = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--model') {
      index += 1;
      model = argv[index] ?? '';
    } else if (argument === '--out-dir') {
      index += 1;
      outDir = argv[index] ?? '';
    } else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/animation-render-smoke.mjs --model <model.vrm> --out-dir <artifacts/animation-fixes/run-XX>');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!model) {
    throw new Error('--model requires a path.');
  }
  if (!outDir) {
    throw new Error('Missing --out-dir. Output must be written to a new directory under artifacts/animation-fixes/.');
  }
  const modelPath = resolve(process.cwd(), model);
  const outputPath = resolve(process.cwd(), outDir);
  const relativeOutput = relative(fixesDirectory, outputPath);
  assert.ok(
    relativeOutput.length > 0
      && !relativeOutput.startsWith('..')
      && !isAbsolute(relativeOutput)
      && !relativeOutput.includes(':'),
    `--out-dir must be a child directory of ${fixesDirectory}, received ${outputPath}`,
  );
  return { modelPath, outputPath };
}

function formatRelativePath(filePath) {
  const relativePath = relative(root, filePath);
  return relativePath.startsWith('..') ? filePath : relativePath;
}

function pngDimensions(bytes) {
  assert.ok(bytes.byteLength >= 24, 'PNG header is too short.');
  assert.equal(bytes.readUInt32BE(0), 0x89504e47, 'PNG signature (1/2)');
  assert.equal(bytes.readUInt32BE(4), 0x0d0a1a0a, 'PNG signature (2/2)');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function percentile(values, fraction) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function summarizeTiming(timing) {
  const steady = timing.frameDurationsMs.slice(1);
  const perFrameDraws = new Set(timing.frameDrawCalls);
  return {
    exportMs: timing.exportMs,
    timeToFirstFrameMs: timing.timeToFirstFrameMs,
    medianFrameMs: percentile(steady, 0.5),
    p95FrameMs: percentile(steady, 0.95),
    maxFrameMs: steady.length > 0 ? Math.max(...steady) : 0,
    frameDurationsMs: timing.frameDurationsMs,
    frameDrawCalls: timing.frameDrawCalls,
    frameClearCalls: timing.frameClearCalls,
    drawsPerRender: perFrameDraws.size === 1 ? [...perFrameDraws][0] : null,
    drawCalls: timing.drawCalls,
    clearCalls: timing.clearCalls,
    glContextsCreated: timing.glContextsCreated,
  };
}

async function removeOwnTempDirectory(directory) {
  const resolved = resolve(directory);
  const relativePath = relative(resolve(tmpdir()), resolved);
  assert.ok(
    relativePath.startsWith('oigptpet-animation-render-')
      && !relativePath.startsWith('..')
      && !relativePath.includes(':'),
    `refusing to remove unexpected temp path: ${resolved}`,
  );
  await rm(resolved, { recursive: true, force: true });
}

const options = parseArguments(process.argv.slice(2));
await access(options.modelPath);
const modelBytes = await readFile(options.modelPath);
assert.ok(modelBytes.byteLength > 0, 'Model file is empty.');
const modelSha256 = createHash('sha256').update(modelBytes).digest('hex');
await mkdir(fixesDirectory, { recursive: true });
try {
  const existing = await readdir(options.outputPath);
  assert.equal(existing.length, 0, `--out-dir must be new or empty; ${options.outputPath} already contains files.`);
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}
await mkdir(options.outputPath, { recursive: true });

const temp = await mkdtemp(join(tmpdir(), 'oigptpet-animation-render-'));
const appDirectory = join(temp, 'app');
const userData = join(temp, 'user-data');
const cacheDirectory = join(temp, 'vite-cache');
await mkdir(appDirectory, { recursive: true });
await mkdir(userData, { recursive: true });
await writeFile(
  join(appDirectory, 'package.json'),
  JSON.stringify({ name: 'animation-render-smoke-app', version: '0.0.0', main: 'main.cjs' }),
);
await writeFile(
  join(appDirectory, 'main.cjs'),
  `const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.ANIMATION_RENDER_USER_DATA);
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 480,
    height: 360,
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  window.loadURL(process.env.ANIMATION_RENDER_URL);
});
app.on('window-all-closed', () => app.quit());
`,
);

let desktop = null;
let server = null;
const pageErrors = [];
const consoleErrors = [];

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
  const url = new URL('tests/fixtures/animation-render/index.html', baseUrl).href;
  const modelUrl = new URL(`/@fs/${options.modelPath.replaceAll('\\', '/')}`, baseUrl).href;

  const env = {
    ...process.env,
    ANIMATION_RENDER_URL: url,
    ANIMATION_RENDER_USER_DATA: userData,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await electron.launch({
    args: [appDirectory, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    cwd: root,
    env,
    timeout: 60000,
  });
  const page = await desktop.firstWindow({ timeout: 60000 });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  await page.waitForFunction(() => Boolean(window.__animationRender), undefined, { timeout: 60000 });

  const loaded = await page.evaluate((source) => window.__animationRender.loadModel(source), modelUrl);
  assert.equal(loaded.bytes, modelBytes.byteLength, 'Browser decoded the same model byte count as Node');
  const initialProbe = await page.evaluate(() => window.__animationRender.probe());
  assert.equal(initialProbe.live, 0, 'Model load alone does not create a WebGL context');

  const outputs = {};
  for (const [profile, expected] of Object.entries({
    v1: { width: 1536, height: 1872, frames: 57 },
    v2: { width: 1536, height: 2288, frames: 73 },
  })) {
    const result = await page.evaluate(
      (target) => window.__animationRender.render(target),
      profile,
    );
    assert.equal(result.ok, true);
    assert.equal(result.profile, profile);
    assert.equal(result.width, expected.width);
    assert.equal(result.height, expected.height);
    assert.equal(result.frames, expected.frames);
    assert.equal(result.inspection.valid, true, `${profile} structure inspection must pass`);
    assert.equal(result.inspection.requiredFrames, expected.frames);
    const png = Buffer.from(result.base64, 'base64');
    assert.equal(png.byteLength, result.bytes, `${profile} base64 length matches blob size`);
    const dimensions = pngDimensions(png);
    assert.equal(dimensions.width, expected.width);
    assert.equal(dimensions.height, expected.height);
    const sha256 = createHash('sha256').update(png).digest('hex');
    const outputPath = join(options.outputPath, `atlas-${profile}.png`);
    await writeFile(outputPath, png);
    assert.ok(
      result.timing.frameClearCalls.every((count) => count === 1),
      `${profile} must render exactly once per exported cell (clear calls: ${result.timing.frameClearCalls.join(',')})`,
    );
    assert.equal(result.timing.clearCalls, result.frames, `${profile} clear count matches frame count`);
    const perFrameDraws = new Set(result.timing.frameDrawCalls);
    assert.equal(perFrameDraws.size, 1, `${profile} draw calls are constant per cell`);
    const [drawsPerRender] = perFrameDraws;
    assert.ok(drawsPerRender > 0, `${profile} performs mesh draws`);
    assert.equal(
      result.timing.drawCalls,
      result.frames * drawsPerRender,
      `${profile} total draws are one render pass per frame`,
    );
    assert.equal(result.timing.glContextsCreated, 1, `${profile} creates one WebGL context`);
    outputs[profile] = {
      path: formatRelativePath(outputPath),
      bytes: png.byteLength,
      sha256,
      width: dimensions.width,
      height: dimensions.height,
      frames: result.frames,
      requiredFrames: result.inspection.requiredFrames,
      structureValid: result.inspection.valid,
      inspectionErrors: result.inspection.errors,
      inspectionWarnings: result.inspection.warnings,
      timing: summarizeTiming(result.timing),
    };
    console.log(
      `${profile}: ${dimensions.width}×${dimensions.height}, ${result.frames} frames, ${png.byteLength} bytes, ${sha256}`,
    );
    console.log(
      `${profile} timing: total ${Math.round(result.timing.exportMs)} ms, first cell ${Math.round(result.timing.timeToFirstFrameMs)} ms, median cell ${Math.round(outputs[profile].timing.medianFrameMs)} ms, ${result.timing.drawCalls} draws (${drawsPerRender} per render, ${result.timing.clearCalls} render passes)`,
    );
  }

  const cancellation = await page.evaluate(() => window.__animationRender.cancel('v2'));
  assert.equal(cancellation.ok, false);
  assert.equal(cancellation.name, 'AbortError');
  assert.equal(cancellation.framesCompleted, 3, 'Cancellation must occur after three completed cells');
  assert.ok(cancellation.glContextsCreated >= 1, 'Cancelled export created a WebGL context');
  assert.equal(cancellation.contextLossObserved, true, 'Cancelled export releases its WebGL context');
  assert.equal(cancellation.probe.live, 0, 'No WebGL context remains live after cancellation');
  console.log(
    `cancellation: ${cancellation.name} after ${cancellation.framesCompleted} frames in ${Math.round(cancellation.elapsedMs)} ms, context released=${cancellation.contextLossObserved}`,
  );

  const repeat = await page.evaluate(() => window.__animationRender.render('v2'));
  const repeatPng = Buffer.from(repeat.base64, 'base64');
  const repeatSha256 = createHash('sha256').update(repeatPng).digest('hex');
  assert.equal(
    repeatSha256,
    outputs.v2.sha256,
    'Repeated v2 export after a cancelled run must be byte-identical',
  );
  assert.equal(repeat.timing.clearCalls, repeat.frames);
  const repeatDrawsPerFrame = new Set(repeat.timing.frameDrawCalls);
  assert.equal(repeatDrawsPerFrame.size, 1);
  assert.equal(repeat.timing.drawCalls, repeat.frames * [...repeatDrawsPerFrame][0]);
  console.log(`repeat v2: deterministic ${repeatSha256}`);

  const finalProbe = await page.evaluate(() => window.__animationRender.probe());
  assert.equal(finalProbe.live, 0, 'All WebGL contexts are released after the run');
  assert.equal(finalProbe.contexts, finalProbe.lost, 'Every created WebGL context was released');
  assert.deepEqual(pageErrors, [], 'no renderer page errors');
  assert.deepEqual(consoleErrors, [], 'no renderer console errors');

  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    command: `node scripts/animation-render-smoke.mjs --model ${formatRelativePath(options.modelPath)} --out-dir ${formatRelativePath(options.outputPath)}`,
    model: {
      path: formatRelativePath(options.modelPath),
      bytes: modelBytes.byteLength,
      sha256: modelSha256,
    },
    outputs,
    repeat: {
      profile: 'v2',
      sha256: repeatSha256,
      identicalToFirstRun: repeatSha256 === outputs.v2.sha256,
    },
    cancellation,
    finalProbe,
    pageErrors,
    consoleErrors,
    limitations: [
      'Timing is measured on this machine and GPU/software rasterizer; it is not a hardware-independent guarantee.',
      'Structure inspection is local only; official platform precheck/install was not executed.',
      'Draw calls are counted through a WebGL context probe and cover the atlas sampling loop only.',
    ],
  };
  await writeFile(
    join(options.outputPath, 'manifest.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(`Wrote atlas-v1.png, atlas-v2.png and manifest.json to ${formatRelativePath(options.outputPath)}/`);
} finally {
  if (desktop) {
    await desktop.close().catch(() => {});
  }
  if (server) {
    await server.close();
  }
  await removeOwnTempDirectory(temp);
}
