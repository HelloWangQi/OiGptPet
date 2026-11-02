import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = resolve(root, 'artifacts/character-package/run-01');
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const inputs = {
  vrm: {
    path: 'artifacts/model-library/2026-10-22/AvatarSample_B.vrm',
    bytes: 21047556,
    sha256: 'ffbd8c92a9e67c0a948f69c7a2eec91e5c282c9ae70e9184309fc164d74cbc27',
    expectedName: 'AvatarSample_B',
  },
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

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

for (const [label, input] of Object.entries(inputs)) {
  const bytes = await readFile(resolve(root, input.path));
  assert.equal(bytes.byteLength, input.bytes, `${label}: input byte size drifted`);
  assert.equal(hash(bytes), input.sha256, `${label}: input hash drifted`);
}

function ok(outcome, label) {
  assert.equal(
    outcome?.ok,
    true,
    `${label}: expected success, received ${JSON.stringify(outcome)}`,
  );
  return outcome.value;
}

function err(outcome, expectedCode, label) {
  assert.equal(
    outcome?.ok,
    false,
    `${label}: expected failure, received ${JSON.stringify(outcome)}`,
  );
  assert.equal(
    outcome.error.code,
    expectedCode,
    `${label}: expected code ${expectedCode}, received ${outcome.error.code} (${outcome.error.message})`,
  );
  return outcome.error;
}

function findSummary(list, id, label) {
  const summary = list.find((entry) => entry.id === id);
  assert.ok(summary, `${label}: expected ${id} in list`);
  return summary;
}

function assertPackage(pkg, expected, label) {
  assert.equal(pkg.magic, 'OIPET001', `${label}: magic`);
  assert.equal(pkg.type, 'application/octet-stream', `${label}: package MIME`);
  assert.equal(pkg.manifestLength > 0, true, `${label}: manifest length`);
  assert.equal(pkg.totalSize, pkg.size, `${label}: total size`);
  assert.equal(pkg.encodedBytes, pkg.size, `${label}: encodedBytes must be the container size`);
  assert.deepEqual(pkg.fieldOrder, expected.fieldOrder, `${label}: manifest field order`);
  assert.equal(pkg.manifest.format, 'oigptpet-character', `${label}: format`);
  assert.equal(pkg.manifest.schemaVersion, 1, `${label}: schema version`);
  assert.equal(pkg.manifest.name, expected.name, `${label}: name`);
  assert.equal(pkg.manifest.kind, expected.kind, `${label}: kind`);
  assert.equal(pkg.manifest.mime, expected.mime, `${label}: mime`);
  assert.equal(pkg.manifest.encodedBytes, expected.payloadBytes, `${label}: payload size`);
  assert.equal(pkg.manifest.sha256, expected.payloadSha256, `${label}: payload sha256`);
  if (expected.kind === 'sprite') {
    assert.equal(pkg.manifest.profile, expected.profile, `${label}: profile`);
  } else {
    assert.equal('profile' in pkg.manifest, false, `${label}: VRM must not carry a profile`);
  }
}

async function removeOwnTempDirectory(directory) {
  const resolved = resolve(directory);
  const relativePath = relative(resolve(tmpdir()), resolved);
  assert.ok(
    relativePath.startsWith('oigptpet-character-package-')
      && !relativePath.startsWith('..')
      && !relativePath.includes(':'),
    `refusing to remove unexpected temp path: ${resolved}`,
  );
  await rm(resolved, { recursive: true, force: true });
}

const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const databaseNames = {
  source: `oigptpet-package-smoke-${runId}-source`,
  target: `oigptpet-package-smoke-${runId}-target`,
};

const temp = await mkdtemp(join(tmpdir(), 'oigptpet-character-package-'));
const appDirectory = join(temp, 'app');
const userData = join(temp, 'user-data');
const cacheDirectory = join(temp, 'vite-cache');
await mkdir(appDirectory, { recursive: true });
await mkdir(userData, { recursive: true });
await writeFile(
  join(appDirectory, 'package.json'),
  JSON.stringify({ name: 'character-package-smoke-app', version: '0.0.0', main: 'main.cjs' }),
);
await writeFile(
  join(appDirectory, 'main.cjs'),
  `const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.PACKAGE_SMOKE_USER_DATA);
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { backgroundThrottling: false },
  });
  window.loadURL(process.env.PACKAGE_SMOKE_URL);
});
app.on('window-all-closed', () => app.quit());
`,
);

let desktop = null;
let page = null;
let server = null;
let environment = null;
const pageErrors = [];
const consoleErrors = [];
const screenshots = [];
const timings = {};

async function call(method, ...args) {
  return page.evaluate(({ method: name, args: callArgs }) => {
    const fixture = window.__packageFixture;
    const fn = fixture[name];
    if (typeof fn !== 'function') {
      throw new Error(`Unknown fixture method: ${name}`);
    }
    return fn.apply(fixture, callArgs);
  }, { method, args });
}

async function screenshot(name) {
  const path = join(outputDirectory, name);
  await page.screenshot({ path, fullPage: true });
  const bytes = (await readFile(path)).byteLength;
  assert.ok(bytes > 0, `${name}: screenshot must not be empty`);
  screenshots.push({ name, bytes });
}

let launchEnvironment = null;
try {
  const serverStartedAt = performance.now();
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
  const fixtureUrl = new URL('tests/fixtures/character-package/index.html', baseUrl).href;
  timings.viteStartMs = performance.now() - serverStartedAt;

  const artifactUrl = (path) => new URL(path, baseUrl).href;
  const urls = {
    vrm: artifactUrl(inputs.vrm.path),
    v1: artifactUrl(inputs.v1.path),
    v2: artifactUrl(inputs.v2.path),
  };

  launchEnvironment = {
    ...process.env,
    PACKAGE_SMOKE_URL: fixtureUrl,
    PACKAGE_SMOKE_USER_DATA: userData,
  };
  delete launchEnvironment.ELECTRON_RUN_AS_NODE;

  timings.launchMs = performance.now();
  desktop = await electron.launch({
    args: [appDirectory],
    cwd: root,
    env: launchEnvironment,
    timeout: 60000,
  });
  environment = await desktop.evaluate(() => ({
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
  await page.waitForFunction(() => Boolean(window.__packageFixture), undefined, { timeout: 60000 });
  timings.launchMs = performance.now() - timings.launchMs;

  const constants = await call('constants');
  assert.deepEqual(constants, {
    magic: 'OIPET001',
    headerBytes: 12,
    format: 'oigptpet-character',
    schemaVersion: 1,
    maxNameLength: 80,
    maxManifestBytes: 65536,
    maxVrmBytes: 64 * 1024 * 1024,
    maxSpriteBytes: 20 * 1024 * 1024,
    maxBytes: 12 + 65536 + 64 * 1024 * 1024,
    vrmMime: 'model/gltf-binary',
    spriteMimes: ['image/png', 'image/webp'],
    vrmFields: [
      'format',
      'schemaVersion',
      'name',
      'kind',
      'mime',
      'encodedBytes',
      'sha256',
    ],
    spriteFields: [
      'format',
      'schemaVersion',
      'name',
      'kind',
      'mime',
      'encodedBytes',
      'sha256',
      'profile',
    ],
    defaultDatabase: 'oigptpet-library',
  });

  // Transport check: the renderer receives the exact source bytes.
  const inputKeys = {};
  for (const [label, input] of Object.entries(inputs)) {
    const info = ok(await call('fetchUrl', urls[label]), `${label} transport`);
    assert.equal(info.size, input.bytes, `${label}: transport size`);
    assert.equal(info.sha256, input.sha256, `${label}: transport hash`);
    inputKeys[label] = info;
  }

  ok(await call('create', 'source', databaseNames.source), 'create source library');
  ok(await call('create', 'target', databaseNames.target), 'create target library');
  assert.deepEqual(ok(await call('list', 'source'), 'source initial list'), []);
  assert.deepEqual(ok(await call('list', 'target'), 'target initial list'), []);

  // Import the real assets into the source library first, as the app does.
  let startedAt = performance.now();
  const vrmSummary = ok(
    await call('add', 'source', 'vrm', inputKeys.vrm.key, null, null),
    'source add real VRM',
  );
  timings.addVrmMs = performance.now() - startedAt;
  assert.equal(vrmSummary.id, `vrm:${inputs.vrm.sha256}`);
  assert.equal(vrmSummary.name, inputs.vrm.expectedName);
  assert.equal(vrmSummary.sha256, inputs.vrm.sha256);
  assert.equal(vrmSummary.encodedBytes, inputs.vrm.bytes);
  assert.equal('profile' in vrmSummary, false, 'VRM summary must not carry a profile');

  startedAt = performance.now();
  const v1Summary = ok(
    await call('add', 'source', 'sprite', inputKeys.v1.key, 'v1', '  图集 V1  '),
    'source add v1 PNG',
  );
  timings.addV1Ms = performance.now() - startedAt;
  assert.equal(v1Summary.id, `sprite:v1:${inputs.v1.sha256}`);
  assert.equal(v1Summary.profile, 'v1');
  assert.equal(v1Summary.name, '图集 V1', 'library trims the stored name');

  startedAt = performance.now();
  const v2Summary = ok(
    await call('add', 'source', 'sprite', inputKeys.v2.key, 'v2', '图集 V2'),
    'source add v2 PNG',
  );
  timings.addV2Ms = performance.now() - startedAt;
  assert.equal(v2Summary.id, `sprite:v2:${inputs.v2.sha256}`);
  assert.equal(v2Summary.profile, 'v2');

  // Real VRM: encode, inspect, decode, restore into a clean library.
  startedAt = performance.now();
  const vrmPackage = ok(await call('encode', 'source', vrmSummary.id), 'encode VRM');
  timings.encodeVrmMs = performance.now() - startedAt;
  assertPackage(vrmPackage, {
    fieldOrder: constants.vrmFields,
    name: vrmSummary.name,
    kind: 'vrm',
    mime: constants.vrmMime,
    payloadBytes: inputs.vrm.bytes,
    payloadSha256: inputs.vrm.sha256,
  }, 'VRM package');

  startedAt = performance.now();
  const vrmDecoded = ok(await call('decode', vrmPackage.key), 'decode VRM');
  timings.decodeVrmMs = performance.now() - startedAt;
  assert.equal(vrmDecoded.kind, 'vrm');
  assert.equal(vrmDecoded.name, vrmSummary.name);
  assert.equal('profile' in vrmDecoded, false, 'decoded VRM must not carry a profile');
  assert.equal(vrmDecoded.type, constants.vrmMime);
  assert.equal(vrmDecoded.size, inputs.vrm.bytes);
  assert.equal(vrmDecoded.sha256, inputs.vrm.sha256, 'decoded bytes must be preserved');
  assert.equal(vrmDecoded.assetSha256, inputs.vrm.sha256);
  assert.equal(vrmDecoded.packageSha256, vrmPackage.sha256);
  assert.equal(vrmDecoded.encodedBytes, vrmPackage.size);
  assert.deepEqual(ok(await call('list', 'target'), 'decode must not import'), []);

  const restoredVrm = ok(
    await call('addDecoded', 'target', vrmDecoded.key),
    'restore VRM into clean library',
  );
  assert.equal(restoredVrm.id, vrmSummary.id);
  assert.equal(restoredVrm.name, vrmSummary.name);
  assert.equal(restoredVrm.sha256, inputs.vrm.sha256);
  assert.equal(restoredVrm.encodedBytes, inputs.vrm.bytes);
  assert.equal('profile' in restoredVrm, false);

  const duplicateVrm = ok(
    await call('addDecoded', 'target', vrmDecoded.key, '不应覆盖已有名称'),
    'duplicate restore',
  );
  assert.equal(duplicateVrm.id, restoredVrm.id);
  assert.equal(duplicateVrm.name, restoredVrm.name, 'duplicate restore must keep the alias');
  assert.equal(duplicateVrm.createdAt, restoredVrm.createdAt);
  let targetList = ok(await call('list', 'target'), 'target list after duplicate');
  assert.equal(targetList.length, 1);

  let storedVrm = ok(await call('stored', 'target', restoredVrm.id), 'stored restored VRM');
  assert.equal(storedVrm.sha256, inputs.vrm.sha256);
  assert.equal(storedVrm.size, inputs.vrm.bytes);
  assert.equal(storedVrm.summary.name, vrmSummary.name);

  // Real v1 and v2 PNGs.
  const spriteCases = [
    { label: 'v1', summary: v1Summary, input: inputs.v1, profile: 'v1', name: '图集 V1' },
    { label: 'v2', summary: v2Summary, input: inputs.v2, profile: 'v2', name: '图集 V2' },
  ];
  const spritePackages = {};
  for (const spriteCase of spriteCases) {
    startedAt = performance.now();
    const pkg = ok(
      await call('encode', 'source', spriteCase.summary.id),
      `${spriteCase.label} package`,
    );
    spritePackages[spriteCase.label] = pkg;
    timings[`encode${spriteCase.label.toUpperCase()}Ms`] = performance.now() - startedAt;
    assertPackage(pkg, {
      fieldOrder: constants.spriteFields,
      name: spriteCase.name,
      kind: 'sprite',
      mime: 'image/png',
      payloadBytes: spriteCase.input.bytes,
      payloadSha256: spriteCase.input.sha256,
      profile: spriteCase.profile,
    }, `${spriteCase.label} package`);

    startedAt = performance.now();
    const decoded = ok(await call('decode', pkg.key), `${spriteCase.label} decode`);
    timings[`decode${spriteCase.label.toUpperCase()}Ms`] = performance.now() - startedAt;
    assert.equal(decoded.kind, 'sprite');
    assert.equal(decoded.profile, spriteCase.profile);
    assert.equal(decoded.name, spriteCase.name);
    assert.equal(decoded.type, 'image/png');
    assert.equal(decoded.size, spriteCase.input.bytes);
    assert.equal(decoded.sha256, spriteCase.input.sha256);
    assert.equal(decoded.assetSha256, spriteCase.input.sha256);
    assert.equal(decoded.packageSha256, pkg.sha256);

    const restored = ok(
      await call('addDecoded', 'target', decoded.key),
      `${spriteCase.label} restore`,
    );
    assert.equal(restored.id, spriteCase.summary.id);
    assert.equal(restored.profile, spriteCase.profile);
    assert.equal(restored.name, spriteCase.name);

    const stored = ok(await call('stored', 'target', restored.id), `${spriteCase.label} stored`);
    assert.equal(stored.sha256, spriteCase.input.sha256);
    assert.equal(stored.size, spriteCase.input.bytes);
    assert.equal(stored.type, 'image/png');
  }

  // Generated WebP uses the real v2 atlas pixels but a different encoding.
  startedAt = performance.now();
  const webp = ok(await call('makeWebp', inputKeys.v2.key, 1), 'generate WebP');
  timings.generateWebpMs = performance.now() - startedAt;
  assert.equal(webp.type, 'image/webp');
  const webpBytes = Buffer.from(webp.base64, 'base64');
  assert.equal(webpBytes.byteLength, webp.size);
  assert.equal(hash(webpBytes), webp.sha256);
  assert.equal(webpBytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(webpBytes.subarray(8, 12).toString('ascii'), 'WEBP');
  await writeFile(join(outputDirectory, 'generated-atlas.webp'), webpBytes);

  startedAt = performance.now();
  const webpSummary = ok(
    await call('add', 'source', 'sprite', webp.key, 'v2', '图集 V2 WebP'),
    'add generated WebP',
  );
  timings.addWebpMs = performance.now() - startedAt;
  assert.equal(webpSummary.id, `sprite:v2:${webp.sha256}`);
  assert.equal(webpSummary.profile, 'v2');

  startedAt = performance.now();
  const webpPackage = ok(await call('encode', 'source', webpSummary.id), 'encode WebP');
  timings.encodeWebpMs = performance.now() - startedAt;
  assertPackage(webpPackage, {
    fieldOrder: constants.spriteFields,
    name: '图集 V2 WebP',
    kind: 'sprite',
    mime: 'image/webp',
    payloadBytes: webp.size,
    payloadSha256: webp.sha256,
    profile: 'v2',
  }, 'WebP package');

  startedAt = performance.now();
  const webpDecoded = ok(await call('decode', webpPackage.key), 'decode WebP');
  timings.decodeWebpMs = performance.now() - startedAt;
  assert.equal(webpDecoded.kind, 'sprite');
  assert.equal(webpDecoded.profile, 'v2');
  assert.equal(webpDecoded.type, 'image/webp');
  assert.equal(webpDecoded.size, webp.size);
  assert.equal(webpDecoded.sha256, webp.sha256);
  assert.equal(webpDecoded.assetSha256, webp.sha256);
  assert.equal(webpDecoded.packageSha256, webpPackage.sha256);

  const restoredWebp = ok(
    await call('addDecoded', 'target', webpDecoded.key),
    'restore WebP into clean library',
  );
  assert.equal(restoredWebp.id, webpSummary.id);
  assert.equal(restoredWebp.profile, 'v2');
  assert.equal(restoredWebp.name, '图集 V2 WebP');
  const storedWebp = ok(await call('stored', 'target', restoredWebp.id), 'stored restored WebP');
  assert.equal(storedWebp.sha256, webp.sha256);
  assert.equal(storedWebp.size, webp.size);
  assert.equal(storedWebp.type, 'image/webp');

  targetList = ok(await call('list', 'target'), 'target final list');
  assert.equal(targetList.length, 4);
  assert.deepEqual(
    targetList.map((entry) => entry.id).sort(),
    [vrmSummary.id, v1Summary.id, v2Summary.id, webpSummary.id].sort(),
  );

  // A valid container is not proof that the payload is a usable source.
  const invalidVrmContainer = ok(
    await call('makeInvalidContainer', 'vrm', '无效模型', null, 'this is not a VRM model'),
    'invalid VRM container',
  );
  const invalidVrmDecoded = ok(
    await call('decode', invalidVrmContainer.key),
    'invalid VRM container must decode',
  );
  assert.equal(invalidVrmDecoded.kind, 'vrm');
  assert.equal(invalidVrmDecoded.name, '无效模型');
  const invalidVrmError = err(
    await call('addDecoded', 'target', invalidVrmDecoded.key),
    'invalid-input',
    'library must still validate VRM sources',
  );
  assert.ok(invalidVrmError.message.length > 0);

  const invalidSpriteContainer = ok(
    await call('makeInvalidContainer', 'sprite', '无效图集', 'v1', 'this is not a PNG'),
    'invalid sprite container',
  );
  const invalidSpriteDecoded = ok(
    await call('decode', invalidSpriteContainer.key),
    'invalid sprite container must decode',
  );
  assert.equal(invalidSpriteDecoded.kind, 'sprite');
  assert.equal(invalidSpriteDecoded.profile, 'v1');
  err(
    await call('addDecoded', 'target', invalidSpriteDecoded.key),
    'invalid-input',
    'library must still validate sprite sources',
  );
  targetList = ok(await call('list', 'target'), 'target list after invalid sources');
  assert.equal(targetList.length, 4, 'rejected restores must not add entries');

  // Structural damage must be rejected before any import.
  const v1Package = spritePackages.v1;
  const truncated = ok(await call('tamper', v1Package.key, 'truncate'), 'truncate package');
  err(await call('decode', truncated.key), 'invalid-container', 'truncated package');
  const trailing = ok(await call('tamper', v1Package.key, 'trailing'), 'append trailing byte');
  err(await call('decode', trailing.key), 'invalid-container', 'trailing package');
  const flippedPayload = ok(
    await call('tamper', v1Package.key, 'payload-flip'),
    'flip payload byte',
  );
  err(await call('decode', flippedPayload.key), 'hash-mismatch', 'payload tamper');
  const flippedManifest = ok(
    await call('tamper', v1Package.key, 'manifest-flip'),
    'flip manifest byte',
  );
  const manifestError = await call('decode', flippedManifest.key);
  assert.equal(manifestError.ok, false, 'manifest tamper must fail');
  assert.ok(
    manifestError.error.code === 'invalid-manifest' || manifestError.error.code === 'invalid-container',
    `manifest tamper code: ${manifestError.error.code}`,
  );

  // Cancellation must reject with AbortError and leave the libraries untouched.
  const cancellations = [
    ['encode immediate', await call('encodeCancelled', 'source', vrmSummary.id, 'immediate')],
    ['encode timer', await call('encodeCancelled', 'source', vrmSummary.id, 'timer')],
    ['decode immediate', await call('decodeCancelled', vrmPackage.key, 'immediate')],
    ['decode timer', await call('decodeCancelled', vrmPackage.key, 'timer')],
  ];
  for (const [label, result] of cancellations) {
    assert.equal(result.ok, false, `${label}: must not succeed`);
    assert.equal(result.error.name, 'AbortError', `${label}: name`);
    assert.equal(result.elapsedMs < 10000, true, `${label}: elapsed ${result.elapsedMs}ms`);
  }
  assert.equal(ok(await call('list', 'source'), 'source after cancellation').length, 4);
  assert.equal(ok(await call('list', 'target'), 'target after cancellation').length, 4);

  await call(
    'setStatus',
    `package smoke: VRM + v1/v2 PNG + WebP restored, ${targetList.length} target entries`,
  );
  await screenshot('character-package.png');

  assert.deepEqual(pageErrors, [], 'page errors');
  assert.deepEqual(consoleErrors, [], 'console errors');

  const result = {
    generatedAt: new Date().toISOString(),
    environment,
    constants,
    inputs: Object.fromEntries(
      Object.entries(inputs).map(([label, input]) => [label, {
        path: input.path,
        bytes: input.bytes,
        sha256: input.sha256,
        url: urls[label],
      }]),
    ),
    summaries: {
      vrm: vrmSummary,
      v1: v1Summary,
      v2: v2Summary,
      webp: webpSummary,
    },
    packages: {
      vrm: {
        sha256: vrmPackage.sha256,
        size: vrmPackage.size,
        manifestLength: vrmPackage.manifestLength,
      },
      v1: {
        sha256: v1Package.sha256,
        size: v1Package.size,
        manifestLength: v1Package.manifestLength,
      },
      v2: {
        sha256: spritePackages.v2.sha256,
        size: spritePackages.v2.size,
        manifestLength: spritePackages.v2.manifestLength,
      },
      webp: {
        sha256: webpPackage.sha256,
        size: webpPackage.size,
        manifestLength: webpPackage.manifestLength,
        generatedBytes: webp.size,
        generatedSha256: webp.sha256,
      },
    },
    restored: {
      vrm: { id: restoredVrm.id, name: restoredVrm.name, sha256: inputs.vrm.sha256 },
      v1: { id: v1Summary.id, name: v1Summary.name, sha256: inputs.v1.sha256 },
      v2: { id: v2Summary.id, name: v2Summary.name, sha256: inputs.v2.sha256 },
      webp: { id: restoredWebp.id, name: restoredWebp.name, sha256: webp.sha256 },
    },
    targetList,
    timings,
    screenshots,
    errors: { page: pageErrors, console: consoleErrors },
  };
  await writeFile(
    join(outputDirectory, 'result.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );

  console.log(JSON.stringify({
    outputDirectory,
    targetEntries: targetList.length,
    packages: result.packages,
    timings,
    environment,
  }, null, 2));
} finally {
  if (desktop) {
    await desktop.close();
  }
  if (server) {
    await server.close();
  }
  await removeOwnTempDirectory(temp);
}
