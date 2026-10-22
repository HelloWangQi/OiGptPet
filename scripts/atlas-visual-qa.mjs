import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultArtifactDirectory = fileURLToPath(new URL('../artifacts/atlas-visual-qa/', import.meta.url));
const PROFILE_DIMENSIONS = {
  v1: { width: 1536, height: 1872 },
  v2: { width: 1536, height: 2288 },
};

function parseArguments(argv) {
  let file = null;
  let profile = 'v2';
  let outDir = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--file') {
      index += 1;
      file = argv[index] ?? null;
    } else if (argument === '--profile') {
      index += 1;
      profile = argv[index] ?? null;
    } else if (argument === '--out-dir') {
      index += 1;
      outDir = argv[index] ?? null;
    } else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/atlas-visual-qa.mjs --file <atlas.png> --profile <v1|v2> [--out-dir <directory>]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!file) {
    throw new Error('Missing --file. Usage: node scripts/atlas-visual-qa.mjs --file <atlas.png> --profile <v1|v2> [--out-dir <directory>]');
  }
  if (profile !== 'v1' && profile !== 'v2') {
    throw new Error(`Invalid --profile: ${String(profile)}. Expected v1 or v2.`);
  }
  if (outDir !== null && outDir.trim() === '') {
    throw new Error('--out-dir requires a non-empty directory.');
  }
  return {
    file: resolve(process.cwd(), file),
    profile,
    outDir: outDir === null ? null : resolve(process.cwd(), outDir),
  };
}

function readPngHeader(bytes, filePath) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < 33 || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error(`Not a PNG file: ${filePath}. This QA script currently accepts PNG atlases only.`);
  }
  const declaredChunkLength = bytes.readUInt32BE(8);
  const chunkType = bytes.subarray(12, 16).toString('ascii');
  if (declaredChunkLength !== 13 || chunkType !== 'IHDR') {
    throw new Error('PNG IHDR chunk is missing or malformed.');
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

function findTempPrefix() {
  return 'oigptpet-atlas-visual-qa-';
}

async function removeOwnTempDirectory(directory) {
  const resolved = resolve(directory);
  const relativePath = relative(resolve(tmpdir()), resolved);
  assert.ok(
    relativePath.startsWith(findTempPrefix())
      && !relativePath.startsWith('..')
      && !relativePath.includes(':'),
    `refusing to remove unexpected temp path: ${resolved}`,
  );
  await rm(resolved, { recursive: true, force: true });
}

function formatRelativePath(filePath) {
  const relativePath = relative(root, filePath);
  return relativePath.startsWith('..') ? filePath : relativePath;
}

const options = parseArguments(process.argv.slice(2));
const artifactDirectory = options.outDir ?? defaultArtifactDirectory;
const bytes = await readFile(options.file);
if (bytes.byteLength === 0) {
  throw new Error(`Empty atlas file: ${options.file}`);
}
if (bytes.byteLength > 20 * 1024 * 1024) {
  throw new Error(`Atlas exceeds the 20 MiB contract limit: ${bytes.byteLength} bytes.`);
}
const header = readPngHeader(bytes, options.file);
const expected = PROFILE_DIMENSIONS[options.profile];
if (header.width !== expected.width || header.height !== expected.height) {
  throw new Error(
    `Atlas dimensions ${header.width}×${header.height} do not match ${options.profile} (${expected.width}×${expected.height}).`,
  );
}
const sha256 = createHash('sha256').update(bytes).digest('hex');
const base64 = bytes.toString('base64');

const temp = await mkdtemp(join(tmpdir(), findTempPrefix()));
const appDirectory = join(temp, 'app');
const userData = join(temp, 'user-data');
const cacheDirectory = join(temp, 'vite-cache');
await mkdir(appDirectory, { recursive: true });
await mkdir(userData, { recursive: true });
await mkdir(artifactDirectory, { recursive: true });
await writeFile(
  join(appDirectory, 'package.json'),
  JSON.stringify({ name: 'atlas-visual-qa-app', version: '0.0.0', main: 'main.cjs' }),
);
await writeFile(
  join(appDirectory, 'main.cjs'),
  `const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.ATLAS_QA_USER_DATA);
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1400,
    height: 1000,
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  window.loadURL(process.env.ATLAS_QA_URL);
});
app.on('window-all-closed', () => app.quit());
`,
);

let desktop = null;
let server = null;
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
  const url = new URL('tests/fixtures/atlas-preview/visual-qa.html', baseUrl).href;

  const env = {
    ...process.env,
    ATLAS_QA_URL: url,
    ATLAS_QA_USER_DATA: userData,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await electron.launch({
    args: [appDirectory, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    cwd: root,
    env,
    timeout: 60000,
  });
  const page = await desktop.firstWindow({ timeout: 60000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.waitForFunction(() => Boolean(window.__atlasVisualQa), undefined, { timeout: 60000 });

  const result = await page.evaluate(async (input) => (
    window.__atlasVisualQa.analyze(input)
  ), {
    base64,
    mime: 'image/png',
    profile: options.profile,
    encodedBytes: bytes.byteLength,
  });

  const outputs = [];
  for (const [name, dataUrl] of Object.entries(result.sheets)) {
    const prefix = 'data:image/png;base64,';
    if (!dataUrl.startsWith(prefix)) {
      throw new Error(`Unexpected data URL for ${name}.`);
    }
    const outputPath = join(artifactDirectory, `${name}.png`);
    await writeFile(outputPath, Buffer.from(dataUrl.slice(prefix.length), 'base64'));
    outputs.push(basename(outputPath));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    command: [
      'node scripts/atlas-visual-qa.mjs',
      `--file ${formatRelativePath(options.file)}`,
      `--profile ${options.profile}`,
      ...(options.outDir ? [`--out-dir ${formatRelativePath(options.outDir)}`] : []),
    ].join(' '),
    input: {
      path: formatRelativePath(options.file),
      bytes: bytes.byteLength,
      sha256,
      width: header.width,
      height: header.height,
      pngBitDepth: header.bitDepth,
      pngColorType: header.colorType,
      profile: options.profile,
    },
    inspection: result.inspection,
    states: result.states,
    frameBounds: result.frameBounds,
    stateComparisons: result.stateComparisons,
    jumpBottoms: result.jumpBottoms,
    gaze: result.gaze,
    outputs,
    limitations: [
      'This run is local structural and visual evidence only; official platform precheck/install was not executed.',
      'Contact sheets show existing pixels at integer scale without cropping, recentering or repainting.',
      'Visual verdicts must match this exact input SHA-256. See docs/ATLAS_VISUAL_QA_02.md for the old baseline and docs/ANIMATION_FIXES_02.md for later fixes; a report for another hash does not certify this input.',
    ],
    pageErrors,
  };
  await writeFile(
    join(artifactDirectory, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  assert.deepEqual(pageErrors, [], 'no renderer page errors');

  console.log(`Atlas visual QA: ${header.width}×${header.height}, ${result.inspection.requiredFrames} required frames, structure ${result.inspection.valid ? 'valid' : 'INVALID'}.`);
  console.log(`SHA-256: ${sha256}`);
  console.log(`Jump bottoms: ${result.jumpBottoms.join(', ')}`);
  for (const state of result.states) {
    console.log(`Frames ${state.state}: adjacent diff ${state.frameDiffAdjacent.join(', ')}; vs first ${state.frameDiffVsFirst.join(', ')}`);
  }
  const compare = (first, second) => result.stateComparisons.find((item) => (
    (item.first === first && item.second === second)
    || (item.first === second && item.second === first)
  ))?.diffPixels;
  console.log(`State diff (middle frame): failed/idle=${compare('failed', 'idle')}, failed/waiting=${compare('failed', 'waiting')}, waiting/review=${compare('waiting', 'review')}, running/review=${compare('running', 'review')}, idle/running=${compare('idle', 'running')}`);
  if (result.gaze) {
    console.log(`Gaze head diff vs up: ${result.gaze.headDiffVsUp.join(', ')}`);
    console.log(`Gaze eye diff vs up: ${result.gaze.eyeDiffVsUp.join(', ')}`);
    console.log(`Gaze eye diff adjacent: ${result.gaze.eyeDiffAdjacent.join(', ')}`);
    console.log(`Gaze lower-body diff vs up: ${result.gaze.lowerBodyDiffVsUp.join(', ')}`);
    console.log(`Gaze identical head frames to up: ${result.gaze.identicalHeadToUp.map((value, index) => value ? index : null).filter((value) => value !== null).join(', ') || 'none'}`);
  }
  console.log(`Wrote ${outputs.length} sheets to ${formatRelativePath(artifactDirectory)}/`);
} finally {
  if (desktop) {
    await desktop.close().catch(() => {});
  }
  if (server) {
    await server.close();
  }
  await removeOwnTempDirectory(temp);
}
