import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, totalmem, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = resolve(root, 'artifacts/character-library/run-01');
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

function compareSummaries(left, right) {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

function assertOrder(list, label) {
  for (let index = 1; index < list.length; index += 1) {
    assert.ok(
      compareSummaries(list[index - 1], list[index]) <= 0,
      `${label}: list order must follow createdAt then id`,
    );
  }
  const ids = new Set(list.map((entry) => entry.id));
  assert.equal(ids.size, list.length, `${label}: ids must be unique`);
}

function ok(outcome, label) {
  assert.equal(
    outcome?.ok,
    true,
    `${label}: expected success, received ${JSON.stringify(outcome)}`,
  );
  return outcome.value;
}

function err(outcome, code, label) {
  assert.equal(
    outcome?.ok,
    false,
    `${label}: expected failure, received ${JSON.stringify(outcome)}`,
  );
  assert.equal(
    outcome.error.code,
    code,
    `${label}: expected code ${code}, received ${outcome.error.code} (${outcome.error.message})`,
  );
  return outcome.error;
}

function findSummary(list, id, label) {
  const summary = list.find((entry) => entry.id === id);
  assert.ok(summary, `${label}: expected ${id} in list`);
  return summary;
}

async function removeOwnTempDirectory(directory) {
  const resolved = resolve(directory);
  const relativePath = relative(resolve(tmpdir()), resolved);
  assert.ok(
    relativePath.startsWith('oigptpet-character-library-')
      && !relativePath.startsWith('..')
      && !relativePath.includes(':'),
    `refusing to remove unexpected temp path: ${resolved}`,
  );
  await rm(resolved, { recursive: true, force: true });
}

for (const input of Object.values(inputs)) {
  const bytes = await readFile(resolve(root, input.path));
  assert.equal(bytes.byteLength, input.bytes, `${input.path}: input byte size drifted`);
  assert.equal(hash(bytes), input.sha256, `${input.path}: input hash drifted`);
}

const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const db = {
  main: `oigptpet-library-smoke-${runId}-main`,
  migrateExisting: `oigptpet-library-smoke-${runId}-migrate-existing`,
  migrateEmpty: `oigptpet-library-smoke-${runId}-migrate-empty`,
  migrateBad: `oigptpet-library-smoke-${runId}-migrate-bad`,
  count: `oigptpet-library-smoke-${runId}-count`,
  bytes: `oigptpet-library-smoke-${runId}-bytes`,
  raceCount: `oigptpet-library-smoke-${runId}-race-count`,
  raceDup: `oigptpet-library-smoke-${runId}-race-dup`,
  raceRemove: `oigptpet-library-smoke-${runId}-race-remove`,
  corrupt: `oigptpet-library-smoke-${runId}-corrupt`,
  invalid: `oigptpet-library-smoke-${runId}-invalid`,
  versionchange: `oigptpet-library-smoke-${runId}-versionchange`,
};

const temp = await mkdtemp(join(tmpdir(), 'oigptpet-character-library-'));
const appDirectory = join(temp, 'app');
const userData = join(temp, 'user-data');
const cacheDirectory = join(temp, 'vite-cache');
await mkdir(appDirectory, { recursive: true });
await mkdir(userData, { recursive: true });
await writeFile(
  join(appDirectory, 'package.json'),
  JSON.stringify({ name: 'character-library-smoke-app', version: '0.0.0', main: 'main.cjs' }),
);
await writeFile(
  join(appDirectory, 'main.cjs'),
  `const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.LIBRARY_SMOKE_USER_DATA);
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1100,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { backgroundThrottling: false },
  });
  window.loadURL(process.env.LIBRARY_SMOKE_URL);
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
    const fixture = window.__libraryFixture;
    const fn = fixture[name];
    if (typeof fn !== 'function') {
      throw new Error(`Unknown fixture method: ${name}`);
    }
    return fn.apply(fixture, callArgs);
  }, { method, args });
}

async function launch() {
  desktop = await electron.launch({
    args: [appDirectory],
    cwd: root,
    env: launchEnvironment,
    timeout: 60000,
  });
  environment ??= await desktop.evaluate(() => ({
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
  await page.waitForFunction(() => Boolean(window.__libraryFixture), undefined, { timeout: 60000 });
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
  const fixtureUrl = new URL('tests/fixtures/character-library/index.html', baseUrl).href;
  timings.viteStartMs = performance.now() - serverStartedAt;

  const artifactUrl = (path) => new URL(path, baseUrl).href;
  const vrmUrl = artifactUrl(inputs.vrm.path);
  const v1Url = artifactUrl(inputs.v1.path);
  const v2Url = artifactUrl(inputs.v2.path);

  launchEnvironment = {
    ...process.env,
    LIBRARY_SMOKE_URL: fixtureUrl,
    LIBRARY_SMOKE_USER_DATA: userData,
  };
  delete launchEnvironment.ELECTRON_RUN_AS_NODE;

  timings.launchMs = performance.now();
  await launch();
  timings.launchMs = performance.now() - timings.launchMs;

  const constants = await call('constants');
  assert.deepEqual(constants, {
    defaultDatabase: 'oigptpet-library',
    databaseVersion: 1,
    maxEntries: 12,
    maxBytes: 256 * 1024 * 1024,
    maxNameLength: 80,
    maxModelBytes: 64 * 1024 * 1024,
    maxAtlasBytes: 20 * 1024 * 1024,
  });

  // Transport check: the browser receives the exact artifact bytes.
  for (const [label, url, expectation] of [
    ['vrm', vrmUrl, inputs.vrm],
    ['v1', v1Url, inputs.v1],
    ['v2', v2Url, inputs.v2],
  ]) {
    const transport = ok(await call('hashUrl', url), `${label} transport`);
    assert.equal(transport.size, expectation.bytes, `${label}: transport byte size`);
    assert.equal(transport.sha256, expectation.sha256, `${label}: transport hash`);
  }

  // Main library: raw storage, stable identity, duplicates, ordering and lifecycle.
  ok(await call('create', 'main', { databaseName: db.main }), 'create main');
  let mainList = ok(await call('list', 'main'), 'main initial list');
  assert.deepEqual(mainList, []);
  assert.equal(ok(await call('active', 'main'), 'main initial active'), null);

  let startedAt = performance.now();
  const vrmSummary = ok(await call('addUrl', 'main', 'vrm', vrmUrl, null, null), 'add real VRM');
  timings.addVrmMs = performance.now() - startedAt;
  assert.equal(vrmSummary.id, `vrm:${inputs.vrm.sha256}`);
  assert.equal(vrmSummary.kind, 'vrm');
  assert.equal(vrmSummary.sha256, inputs.vrm.sha256);
  assert.equal(vrmSummary.encodedBytes, inputs.vrm.bytes);
  assert.equal(vrmSummary.name, inputs.vrm.expectedName);
  assert.ok(!('profile' in vrmSummary), 'VRM summaries must not carry a profile');
  assert.ok(!Number.isNaN(Date.parse(vrmSummary.createdAt)));
  assert.equal(ok(await call('active', 'main'), 'VRM import must not auto-activate'), null);

  const storedVrm = ok(await call('stored', 'main', vrmSummary.id), 'stored VRM');
  assert.equal(storedVrm.sha256, inputs.vrm.sha256);
  assert.equal(storedVrm.size, inputs.vrm.bytes);

  startedAt = performance.now();
  const v1Summary = ok(
    await call('addUrl', 'main', 'sprite', v1Url, 'v1', '图集 V1'),
    'add v1 PNG',
  );
  timings.addV1Ms = performance.now() - startedAt;
  assert.equal(v1Summary.id, `sprite:v1:${inputs.v1.sha256}`);
  assert.equal(v1Summary.kind, 'sprite');
  assert.equal(v1Summary.profile, 'v1');
  assert.equal(v1Summary.sha256, inputs.v1.sha256);
  assert.equal(v1Summary.encodedBytes, inputs.v1.bytes);
  assert.equal(v1Summary.name, '图集 V1');

  startedAt = performance.now();
  const v2Key = ok(await call('fetchKey', v2Url), 'fetch v2 key');
  assert.equal(hash(Buffer.from(v2Key.base64, 'base64')), inputs.v2.sha256);
  const v2Summary = ok(
    await call('addKey', 'main', v2Key.key, 'sprite', 'v2', '图集 V2'),
    'add v2 PNG',
  );
  timings.addV2Ms = performance.now() - startedAt;
  assert.equal(v2Summary.id, `sprite:v2:${inputs.v2.sha256}`);
  assert.equal(v2Summary.sha256, inputs.v2.sha256);
  assert.equal(v2Summary.encodedBytes, inputs.v2.bytes);
  assert.equal(v2Summary.name, '图集 V2');

  startedAt = performance.now();
  const v2Webp = await call('makeWebp', v2Key.key, 1);
  assert.equal(v2Webp.type, 'image/webp');
  const v2WebpBytes = Buffer.from(v2Webp.base64, 'base64');
  assert.equal(v2WebpBytes.byteLength, v2Webp.size);
  const v2WebpSha = hash(v2WebpBytes);
  const v2WebpSummary = ok(
    await call('addKey', 'main', v2Webp.key, 'sprite', 'v2', '图集 V2 WebP'),
    'add v2 WebP',
  );
  timings.addV2WebpMs = performance.now() - startedAt;
  assert.equal(v2WebpSummary.sha256, v2WebpSha);
  assert.equal(v2WebpSummary.encodedBytes, v2Webp.size);
  assert.equal(v2WebpSummary.profile, 'v2');
  const storedV2Webp = ok(
    await call('stored', 'main', v2WebpSummary.id),
    'stored v2 WebP',
  );
  assert.equal(storedV2Webp.sha256, v2WebpSha);
  assert.equal(storedV2Webp.type, 'image/webp');

  const v1Key = ok(await call('fetchKey', v1Url), 'fetch v1 key');
  assert.equal(hash(Buffer.from(v1Key.base64, 'base64')), inputs.v1.sha256);
  const v1Webp = await call('makeWebp', v1Key.key, 1);
  assert.equal(v1Webp.type, 'image/webp');
  const v1WebpBytes = Buffer.from(v1Webp.base64, 'base64');
  const v1WebpSha = hash(v1WebpBytes);
  const v1WebpSummary = ok(
    await call('addKey', 'main', v1Webp.key, 'sprite', 'v1', '图集 V1 WebP'),
    'add v1 WebP',
  );
  assert.equal(v1WebpSummary.sha256, v1WebpSha);
  assert.equal(v1WebpSummary.encodedBytes, v1Webp.size);
  assert.equal(v1WebpSummary.profile, 'v1');

  mainList = ok(await call('list', 'main'), 'main list after five imports');
  assert.equal(mainList.length, 5);
  assertOrder(mainList, 'main after five imports');
  assert.equal(ok(await call('active', 'main'), 'no import auto-activates'), null);

  const activateStartedAt = performance.now();
  ok(await call('activate', 'main', vrmSummary.id), 'activate VRM');
  timings.activateVrmMs = performance.now() - activateStartedAt;
  let mainActive = ok(await call('active', 'main'), 'active after VRM activation');
  assert.equal(mainActive.summary.id, vrmSummary.id);
  assert.equal(mainActive.sha256, inputs.vrm.sha256);

  // Duplicate imports return the existing entry and do not touch name, time or active.
  const duplicateStartedAt = performance.now();
  const duplicate = ok(
    await call('addKey', 'main', v2Key.key, 'sprite', 'v2', '不应覆盖名称'),
    'duplicate v2 import',
  );
  timings.duplicateMs = performance.now() - duplicateStartedAt;
  assert.equal(duplicate.id, v2Summary.id);
  assert.equal(duplicate.name, v2Summary.name);
  assert.equal(duplicate.createdAt, v2Summary.createdAt);
  assert.equal(duplicate.sha256, v2Summary.sha256);
  mainList = ok(await call('list', 'main'), 'main list after duplicate');
  assert.equal(mainList.length, 5);
  mainActive = ok(await call('active', 'main'), 'active after duplicate');
  assert.equal(mainActive.summary.id, vrmSummary.id);

  // Close and reopen the same database in the same app.
  ok(await call('close', 'main'), 'close main');
  ok(await call('create', 'main2', { databaseName: db.main }), 'reopen main');
  const reopenedList = ok(await call('list', 'main2'), 'reopened list');
  assert.deepEqual(reopenedList, mainList);
  const reopenedActive = ok(await call('active', 'main2'), 'reopened active');
  assert.equal(reopenedActive.summary.id, vrmSummary.id);
  assert.equal(reopenedActive.sha256, inputs.vrm.sha256);
  assert.equal(
    ok(await call('stored', 'main2', v2Summary.id), 'reopened stored v2').sha256,
    inputs.v2.sha256,
  );

  // Names: trimmed on write, invalid names rejected without mutation.
  ok(await call('rename', 'main2', v2Summary.id, '  重命名图集  '), 'rename v2');
  mainList = ok(await call('list', 'main2'), 'list after rename');
  assert.equal(findSummary(mainList, v2Summary.id, 'renamed v2').name, '重命名图集');
  for (const [index, invalidName] of ['', '   ', 'x'.repeat(81), 123].entries()) {
    err(
      await call('rename', 'main2', v1Summary.id, invalidName),
      'invalid-name',
      `invalid name ${index}`,
    );
  }
  assert.equal(
    findSummary(ok(await call('list', 'main2'), 'list after invalid names'), v1Summary.id, 'v1').name,
    '图集 V1',
  );
  err(await call('rename', 'main2', 'missing-id', '新名字'), 'not-found', 'rename missing');

  // Removal constraints.
  ok(await call('remove', 'main2', v2WebpSummary.id), 'remove non-active WebP');
  ok(await call('remove', 'main2', v1WebpSummary.id), 'remove second non-active WebP');
  ok(await call('remove', 'main2', v2WebpSummary.id), 'remove missing is idempotent');
  err(await call('remove', 'main2', vrmSummary.id), 'active-character', 'remove active');
  assert.ok(findSummary(ok(await call('list', 'main2'), 'list after remove active'), vrmSummary.id, 'vrm'));
  err(await call('activate', 'main2', 'missing-id'), 'not-found', 'activate missing');
  mainActive = ok(await call('active', 'main2'), 'active after failures');
  assert.equal(mainActive.summary.id, vrmSummary.id);

  ok(await call('activate', 'main2', v1Summary.id), 'activate v1');
  ok(await call('remove', 'main2', vrmSummary.id), 'remove former active after switch');
  assert.equal(ok(await call('stored', 'main2', vrmSummary.id), 'removed get'), null);
  err(await call('remove', 'main2', v1Summary.id), 'active-character', 'remove new active');

  const mainFinalList = ok(await call('list', 'main2'), 'main final list');
  assert.equal(mainFinalList.length, 2);
  assertOrder(mainFinalList, 'main final list');
  assert.deepEqual(
    mainFinalList.map((entry) => entry.id).sort(),
    [v1Summary.id, v2Summary.id].sort(),
  );
  const mainFinalActive = ok(await call('active', 'main2'), 'main final active');
  assert.equal(mainFinalActive.summary.id, v1Summary.id);
  assert.equal(mainFinalActive.sha256, inputs.v1.sha256);

  const rawMain = ok(await call('inspectRaw', db.main), 'raw main database');
  assert.equal(rawMain.version, 1);
  assert.deepEqual([...rawMain.stores].sort(), ['assets', 'characters', 'meta']);
  assert.equal(rawMain.entries.length, 2);
  assert.equal(rawMain.activeId, v1Summary.id);
  assert.deepEqual(
    [...rawMain.assetIds].sort(),
    mainFinalList.map((entry) => entry.id).sort(),
  );

  const bitmapAfterMain = await call('bitmapStats');
  assert.equal(bitmapAfterMain.outstandingBitmaps, 0, 'main session must release decoded bitmaps');

  await call('setStatus', `main: ${mainFinalList.length} entries, active ${mainFinalActive.summary.name}`);
  await screenshot('main-session.png');
  ok(await call('close', 'main2'), 'close main before restart');

  // Migration: existing active is preserved, duplicates do not recreate or rename.
  ok(
    await call('create', 'migrateExisting', { databaseName: db.migrateExisting }),
    'create migrateExisting',
  );
  const migrateAtlas = await call('makeAtlas', 'v2', 'png', {});
  const migrateExistingEntry = ok(
    await call('addKey', 'migrateExisting', migrateAtlas.key, 'sprite', 'v2', null),
    'migration existing sprite',
  );
  assert.equal(migrateExistingEntry.name, '精灵图', 'sprite default name');
  ok(await call('activate', 'migrateExisting', migrateExistingEntry.id), 'activate existing sprite');

  startedAt = performance.now();
  const migrated = ok(
    await call('migrateUrl', 'migrateExisting', vrmUrl),
    'migrate real VRM with existing active',
  );
  timings.migrateRealVrmMs = performance.now() - startedAt;
  assert.equal(migrated.id, `vrm:${inputs.vrm.sha256}`);
  assert.equal(migrated.name, inputs.vrm.expectedName);
  let migrateExistingList = ok(await call('list', 'migrateExisting'), 'migrateExisting list');
  assert.equal(migrateExistingList.length, 2);
  assert.equal(
    ok(await call('active', 'migrateExisting'), 'migrateExisting active').summary.id,
    migrateExistingEntry.id,
    'migration must not overwrite an existing active entry',
  );
  ok(await call('rename', 'migrateExisting', migrated.id, '迁移角色'), 'rename migrated');
  const migratedAgain = ok(
    await call('migrateUrl', 'migrateExisting', vrmUrl),
    'repeat real VRM migration',
  );
  assert.equal(migratedAgain.id, migrated.id);
  assert.equal(migratedAgain.name, '迁移角色', 'repeated migration must preserve user name');
  migrateExistingList = ok(await call('list', 'migrateExisting'), 'migrateExisting list after repeat');
  assert.equal(migrateExistingList.length, 2);
  assert.equal(
    ok(await call('active', 'migrateExisting'), 'active after repeat').summary.id,
    migrateExistingEntry.id,
  );

  // Migration into an empty library sets the first active atomically.
  ok(await call('create', 'migrateEmpty', { databaseName: db.migrateEmpty }), 'create migrateEmpty');
  const syntheticMigrated = await call('makeVrm', { name: '迁移合成角色' });
  const firstMigration = ok(
    await call('migrateKey', 'migrateEmpty', syntheticMigrated.key),
    'first migration into empty library',
  );
  assert.equal(firstMigration.name, '迁移合成角色');
  assert.equal(firstMigration.id, `vrm:${hash(Buffer.from(syntheticMigrated.base64, 'base64'))}`);
  assert.equal(
    ok(await call('active', 'migrateEmpty'), 'first migration active').summary.id,
    firstMigration.id,
  );
  const repeatEmpty = ok(
    await call('migrateKey', 'migrateEmpty', syntheticMigrated.key),
    'repeat migration into empty library',
  );
  assert.equal(repeatEmpty.id, firstMigration.id);
  assert.equal(repeatEmpty.createdAt, firstMigration.createdAt);
  assert.equal(ok(await call('list', 'migrateEmpty'), 'empty migration list').length, 1);
  assert.equal(
    ok(await call('active', 'migrateEmpty'), 'active after empty repeat').summary.id,
    firstMigration.id,
  );

  // Failed migration leaves data and active untouched, then a retry succeeds.
  ok(await call('create', 'migrateBad', { databaseName: db.migrateBad }), 'create migrateBad');
  const keptEntry = ok(
    await call('addKey', 'migrateBad', migrateAtlas.key, 'sprite', 'v2', '保留条目'),
    'migration retry baseline',
  );
  ok(await call('activate', 'migrateBad', keptEntry.id), 'activate retry baseline');
  const garbageVrm = await call('makeGarbageVrm');
  err(
    await call('migrateBase64', 'migrateBad', garbageVrm.base64),
    'invalid-input',
    'garbage legacy VRM',
  );
  const truncatedVrm = await call('makeTruncatedVrm');
  err(
    await call('migrateBase64', 'migrateBad', truncatedVrm.base64),
    'invalid-input',
    'truncated legacy VRM',
  );
  assert.equal(ok(await call('list', 'migrateBad'), 'bad migration list').length, 1);
  assert.equal(
    ok(await call('active', 'migrateBad'), 'bad migration active').summary.id,
    keptEntry.id,
  );
  const retryMigration = ok(
    await call('migrateKey', 'migrateBad', syntheticMigrated.key),
    'migration retry',
  );
  assert.equal(ok(await call('list', 'migrateBad'), 'retry list').length, 2);
  assert.equal(
    ok(await call('active', 'migrateBad'), 'retry active').summary.id,
    keptEntry.id,
  );
  assert.equal(retryMigration.name, '迁移合成角色');

  // Count and byte limits, including the exact boundary and retry after abort.
  ok(
    await call('create', 'count', { databaseName: db.count, limits: { maxEntries: 2 } }),
    'create count limit library',
  );
  const countA = await call('makeVrm', { name: '计数 A' });
  const countB = await call('makeVrm', { name: '计数 B' });
  const countC = await call('makeVrm', { name: '计数 C' });
  const countEntryA = ok(await call('addKey', 'count', countA.key, 'vrm', null, null), 'count A');
  const countEntryB = ok(await call('addKey', 'count', countB.key, 'vrm', null, null), 'count B');
  err(
    await call('addKey', 'count', countC.key, 'vrm', null, null),
    'entry-limit',
    'count limit third entry',
  );
  assert.deepEqual(
    ok(await call('list', 'count'), 'count list after rejection').map((entry) => entry.id),
    [countEntryA.id, countEntryB.id],
  );
  ok(await call('remove', 'count', countEntryB.id), 'remove count B');
  const countEntryC = ok(
    await call('addKey', 'count', countC.key, 'vrm', null, null),
    'retry after entry-limit abort',
  );
  assert.deepEqual(
    ok(await call('list', 'count'), 'count list after retry').map((entry) => entry.id),
    [countEntryA.id, countEntryC.id],
  );

  const byteLimit = inputs.v1.bytes + inputs.v2.bytes;
  ok(
    await call('create', 'bytes', {
      databaseName: db.bytes,
      limits: { maxEntries: 12, maxBytes: byteLimit },
    }),
    'create byte limit library',
  );
  const byteV1 = ok(
    await call('addUrl', 'bytes', 'sprite', v1Url, 'v1', '字节 V1'),
    'byte limit v1',
  );
  const byteV2 = ok(
    await call('addKey', 'bytes', v2Key.key, 'sprite', 'v2', '字节 V2'),
    'byte limit v2 at exact boundary',
  );
  err(
    await call('addKey', 'bytes', v2Webp.key, 'sprite', 'v2', '字节 WebP'),
    'byte-limit',
    'byte limit WebP',
  );
  assert.equal(ok(await call('list', 'bytes'), 'byte list after rejection').length, 2);
  assert.equal(ok(await call('active', 'bytes'), 'byte active after rejection'), null);
  const removable = [byteV2, byteV1].find((entry) => v2Webp.size <= entry.encodedBytes);
  if (removable) {
    ok(await call('remove', 'bytes', removable.id), 'remove to make byte room');
  } else {
    ok(await call('remove', 'bytes', byteV1.id), 'remove v1 to make byte room');
    ok(await call('remove', 'bytes', byteV2.id), 'remove v2 to make byte room');
  }
  const byteWebp = ok(
    await call('addKey', 'bytes', v2Webp.key, 'sprite', 'v2', '字节 WebP 重试'),
    'retry after byte-limit abort',
  );
  const byteList = ok(await call('list', 'bytes'), 'byte list after retry');
  assert.ok(findSummary(byteList, byteWebp.id, 'byte retry entry'));
  assert.equal(byteList.length, removable ? 2 : 1);

  // Concurrent imports across two connections: dedupe and count boundary.
  ok(
    await call('create', 'dupA', { databaseName: db.raceDup }),
    'create dedupe instance A',
  );
  ok(
    await call('create', 'dupB', { databaseName: db.raceDup }),
    'create dedupe instance B',
  );
  const sharedVrm = await call('makeVrm', { name: '共享并发角色' });
  const sharedSha = hash(Buffer.from(sharedVrm.base64, 'base64'));
  const sharedOutcomes = await call('addConcurrent', [
    { handle: 'dupA', key: sharedVrm.key, kind: 'vrm', profile: null, name: null },
    { handle: 'dupB', key: sharedVrm.key, kind: 'vrm', profile: null, name: null },
  ]);
  const firstShared = ok(sharedOutcomes[0], 'concurrent duplicate A');
  const secondShared = ok(sharedOutcomes[1], 'concurrent duplicate B');
  assert.equal(firstShared.id, `vrm:${sharedSha}`);
  assert.equal(secondShared.id, firstShared.id);
  assert.equal(ok(await call('list', 'dupA'), 'dedupe list').length, 1);
  const rawDedupe = ok(await call('inspectRaw', db.raceDup), 'dedupe raw store');
  assert.equal(rawDedupe.entries.length, 1);
  assert.equal(rawDedupe.assetIds.length, 1);

  ok(
    await call('create', 'raceCountA', {
      databaseName: db.raceCount,
      limits: { maxEntries: 3 },
    }),
    'create count race A',
  );
  ok(
    await call('create', 'raceCountB', {
      databaseName: db.raceCount,
      limits: { maxEntries: 3 },
    }),
    'create count race B',
  );
  const raceVrms = [];
  for (const name of ['并发计数 1', '并发计数 2', '并发计数 3', '并发计数 4']) {
    raceVrms.push(await call('makeVrm', { name }));
  }
  const raceAdds = await call('addConcurrent', [
    { handle: 'raceCountA', key: raceVrms[0].key, kind: 'vrm', profile: null, name: null },
    { handle: 'raceCountA', key: raceVrms[1].key, kind: 'vrm', profile: null, name: null },
    { handle: 'raceCountB', key: raceVrms[2].key, kind: 'vrm', profile: null, name: null },
    { handle: 'raceCountB', key: raceVrms[3].key, kind: 'vrm', profile: null, name: null },
  ]);
  const raceSuccesses = raceAdds.filter((outcome) => outcome.ok);
  const raceFailures = raceAdds.filter((outcome) => !outcome.ok);
  assert.equal(raceSuccesses.length, 3, 'exactly three concurrent inserts fit the limit');
  assert.equal(raceFailures.length, 1, 'exactly one concurrent insert exceeds the limit');
  assert.equal(raceFailures[0].error.code, 'entry-limit');
  assert.equal(ok(await call('list', 'raceCountA'), 'race count list').length, 3);

  // Remove/activate race: outcomes must match the final state.
  ok(
    await call('create', 'raceSetup', { databaseName: db.raceRemove }),
    'create remove race setup',
  );
  const raceEntryA = ok(
    await call('addKey', 'raceSetup', countA.key, 'vrm', null, '移除竞争 A'),
    'remove race A',
  );
  const raceEntryB = ok(
    await call('addKey', 'raceSetup', countB.key, 'vrm', null, '移除竞争 B'),
    'remove race B',
  );
  ok(await call('activate', 'raceSetup', raceEntryB.id), 'activate race B');
  ok(await call('create', 'raceRemove', { databaseName: db.raceRemove }), 'create remover');
  ok(await call('create', 'raceActivate', { databaseName: db.raceRemove }), 'create activator');
  const race = await call('removeAndActivate', 'raceRemove', 'raceActivate', raceEntryA.id);
  const raceList = ok(await call('list', 'raceRemove'), 'remove race list');
  const raceActive = ok(await call('active', 'raceRemove'), 'remove race active');
  const removedEntryStillPresent = raceList.some((entry) => entry.id === raceEntryA.id);
  if (removedEntryStillPresent) {
    assert.equal(race.remove.ok, false, 'active entry cannot be removed');
    assert.equal(race.remove.error.code, 'active-character');
    assert.equal(race.activate.ok, true, 'activation wins the race');
    assert.equal(raceActive.summary.id, raceEntryA.id);
  } else {
    assert.equal(race.remove.ok, true, 'non-active removal wins the race');
    assert.equal(race.activate.ok, false);
    assert.equal(race.activate.error.code, 'not-found');
    assert.equal(raceActive.summary.id, raceEntryB.id);
  }

  // Corrupted bytes are detected by digest during activation; old active stays.
  ok(await call('create', 'corrupt', { databaseName: db.corrupt }), 'create corrupt library');
  const intactAtlas = await call('makeAtlas', 'v1', 'png', {});
  const damagedAtlas = await call('makeAtlas', 'v2', 'png', {});
  const intactEntry = ok(
    await call('addKey', 'corrupt', intactAtlas.key, 'sprite', 'v1', '完好条目'),
    'corrupt intact entry',
  );
  const damagedEntry = ok(
    await call('addKey', 'corrupt', damagedAtlas.key, 'sprite', 'v2', '待损坏条目'),
    'corrupt damaged entry',
  );
  ok(await call('activate', 'corrupt', intactEntry.id), 'activate intact entry');
  const corruption = ok(await call('corruptAsset', db.corrupt, damagedEntry.id), 'corrupt asset');
  assert.equal(corruption.size, damagedEntry.encodedBytes);
  const damagedStored = ok(await call('stored', 'corrupt', damagedEntry.id), 'stored damaged entry');
  assert.equal(damagedStored.size, damagedEntry.encodedBytes);
  assert.notEqual(damagedStored.sha256, damagedEntry.sha256, 'same-size corruption changes the digest');
  err(
    await call('activate', 'corrupt', damagedEntry.id),
    'incomplete-asset',
    'activate corrupted bytes',
  );
  assert.equal(
    ok(await call('active', 'corrupt'), 'active after corrupt activation').summary.id,
    intactEntry.id,
  );
  ok(await call('remove', 'corrupt', damagedEntry.id), 'remove corrupted non-active entry');
  assert.equal(ok(await call('list', 'corrupt'), 'corrupt final list').length, 1);

  // Invalid inputs, cancellation, close boundaries and resource cleanup.
  ok(await call('create', 'invalid', { databaseName: db.invalid }), 'create invalid library');
  const baselineAtlas = await call('makeAtlas', 'v1', 'png', {});
  const invalidBaseline = ok(
    await call('addKey', 'invalid', baselineAtlas.key, 'sprite', 'v1', '基准角色'),
    'invalid baseline entry',
  );
  ok(await call('activate', 'invalid', invalidBaseline.id), 'activate invalid baseline');

  async function assertInvalidBaseline(label) {
    const list = ok(await call('list', 'invalid'), `${label} list`);
    assert.equal(list.length, 1, `${label}: no partial entry`);
    assert.equal(list[0].id, invalidBaseline.id);
    const active = ok(await call('active', 'invalid'), `${label} active`);
    assert.equal(active.summary.id, invalidBaseline.id, `${label}: active unchanged`);
  }

  const garbage = await call('makeGarbageVrm');
  err(await call('addKey', 'invalid', garbage.key, 'vrm', null, '坏模型'), 'invalid-input', 'garbage VRM');
  await assertInvalidBaseline('garbage VRM');

  const externalVrm = await call('makeVrm', { external: true });
  err(
    await call('addKey', 'invalid', externalVrm.key, 'vrm', null, '外部引用'),
    'invalid-input',
    'external VRM',
  );
  await assertInvalidBaseline('external VRM');

  const truncated = await call('makeTruncatedVrm');
  err(
    await call('addKey', 'invalid', truncated.key, 'vrm', null, '截断模型'),
    'invalid-input',
    'truncated VRM',
  );
  await assertInvalidBaseline('truncated VRM');

  err(
    await call('addUrl', 'invalid', 'sprite', v1Url, 'v2', '尺寸错误'),
    'invalid-input',
    'v1 bytes as v2',
  );
  await assertInvalidBaseline('wrong dimensions');

  const fakePng = await call('makeTextBlob', 'not a real png', 'image/png');
  err(
    await call('addKey', 'invalid', fakePng.key, 'sprite', 'v1', '假图片'),
    'invalid-input',
    'fake PNG',
  );
  await assertInvalidBaseline('fake PNG');

  const gifV2 = ok(await call('rewrapKey', v2Key.key, 'image/gif'), 'rewrap v2 as gif');
  err(
    await call('addKey', 'invalid', gifV2.key, 'sprite', 'v2', '错误 MIME'),
    'invalid-input',
    'unsupported MIME',
  );
  await assertInvalidBaseline('unsupported MIME');

  const emptyAtlas = await call('makeAtlas', 'v2', 'png', { empty: { row: 4, frame: 2 } });
  const structureError = err(
    await call('addKey', 'invalid', emptyAtlas.key, 'sprite', 'v2', '空帧'),
    'invalid-input',
    'empty frame atlas',
  );
  assert.ok(structureError.inspection, 'structural failure must expose inspection');
  assert.ok(structureError.inspection.codes.includes('empty-frame'));
  assert.ok(structureError.inspection.rows.includes(4));
  assert.ok(structureError.inspection.frames.includes(2));
  await assertInvalidBaseline('empty frame');

  for (const badName of ['', '   ', 'x'.repeat(81), 123]) {
    err(
      await call('addKey', 'invalid', baselineAtlas.key, 'sprite', 'v1', badName),
      'invalid-name',
      'invalid add name',
    );
  }
  await assertInvalidBaseline('invalid add names');

  const immediate = await call('addKeyWithAbort', 'invalid', baselineAtlas.key, 'sprite', 'v1', '立即取消', 'immediate');
  assert.equal(immediate.outcome.ok, false);
  assert.equal(immediate.outcome.error.name, 'AbortError');
  await assertInvalidBaseline('pre-start cancellation');

  const bitmapsBeforeCancel = await call('bitmapStats');
  await call('setDecodeDelays', [500]);
  const cancelled = await call('addKeyWithAbort', 'invalid', v2Key.key, 'sprite', 'v2', '取消中', 'decode');
  await call('setDecodeDelays', []);
  assert.equal(cancelled.decodeStarted, true, 'cancellation must happen during decode');
  assert.equal(cancelled.outcome.ok, false);
  assert.equal(cancelled.outcome.error.name, 'AbortError');
  assert.ok(cancelled.elapsedMs < 400, `cancellation must be prompt (${cancelled.elapsedMs}ms)`);
  await page.waitForFunction(
    (target) => {
      const stats = window.__libraryFixture.bitmapStats();
      return stats.closedBitmaps >= target && stats.outstandingBitmaps === 0;
    },
    bitmapsBeforeCancel.closedBitmaps + 1,
    { timeout: 5000 },
  );
  await assertInvalidBaseline('decode cancellation');

  const bitmapsBeforeClose = await call('bitmapStats');
  await call('setDecodeDelays', [600]);
  const closedDuringAdd = await call('addKeyThenCloseAtDecode', 'invalid', baselineAtlas.key, 'sprite', 'v1', '关闭中');
  await call('setDecodeDelays', []);
  assert.equal(closedDuringAdd.decodeStarted, true);
  assert.equal(closedDuringAdd.outcome.ok, false);
  assert.equal(closedDuringAdd.outcome.error.code, 'closed');
  assert.ok(closedDuringAdd.elapsedMs >= 500, 'close waits for the in-flight prepare before reporting');
  err(await call('list', 'invalid'), 'closed', 'list after close');
  err(
    await call('addKey', 'invalid', baselineAtlas.key, 'sprite', 'v1', '关闭后导入'),
    'closed',
    'add after close',
  );
  ok(await call('close', 'invalid'), 'close is idempotent');
  await page.waitForFunction(
    (target) => {
      const stats = window.__libraryFixture.bitmapStats();
      return stats.closedBitmaps >= target && stats.outstandingBitmaps === 0;
    },
    bitmapsBeforeClose.closedBitmaps + 1,
    { timeout: 5000 },
  );
  ok(await call('create', 'invalidCheck', { databaseName: db.invalid }), 'reopen invalid DB');
  const invalidCheckList = ok(await call('list', 'invalidCheck'), 'invalid check list');
  assert.equal(invalidCheckList.length, 1);
  assert.equal(invalidCheckList[0].id, invalidBaseline.id);
  assert.equal(
    ok(await call('active', 'invalidCheck'), 'invalid check active').summary.id,
    invalidBaseline.id,
  );
  ok(await call('close', 'invalidCheck'), 'close invalid check');

  // Default database name and the legacy database guard.
  err(
    await call('create', 'legacyGuard', { databaseName: 'oigptpet' }),
    'invalid-input',
    'legacy database guard',
  );
  let databases = ok(await call('databases'), 'databases before default');
  assert.ok(
    !databases.some((entry) => entry.name === 'oigptpet'),
    'the legacy oigptpet database must never be opened',
  );
  ok(await call('create', 'defaultDb'), 'create default database library');
  const defaultAtlas = await call('makeAtlas', 'v1', 'png', {});
  const defaultEntry = ok(
    await call('addKey', 'defaultDb', defaultAtlas.key, 'sprite', 'v1', null),
    'default database import',
  );
  assert.equal(defaultEntry.name, '精灵图', 'sprite default name');
  databases = ok(await call('databases'), 'databases after default');
  const defaultDatabase = databases.find((entry) => entry.name === 'oigptpet-library');
  assert.ok(defaultDatabase, 'default database must be created under the documented name');
  assert.equal(defaultDatabase.version, 1);
  assert.ok(!databases.some((entry) => entry.name === 'oigptpet'));
  ok(await call('forget', 'defaultDb'), 'close default database library');

  // Versionchange closes the library; a later open with the wrong version fails cleanly.
  ok(
    await call('create', 'versionchange', { databaseName: db.versionchange }),
    'create versionchange library',
  );
  const versionchangeEntry = ok(
    await call('addKey', 'versionchange', defaultAtlas.key, 'sprite', 'v1', '版本变更'),
    'versionchange entry',
  );
  const upgraded = ok(await call('upgradeDatabase', db.versionchange, 2), 'raw upgrade');
  assert.equal(upgraded.version, 2);
  assert.deepEqual([...upgraded.stores].sort(), ['assets', 'characters', 'meta']);
  err(await call('list', 'versionchange'), 'closed', 'list after versionchange');
  err(
    await call('addKey', 'versionchange', defaultAtlas.key, 'sprite', 'v1', '版本变更后'),
    'closed',
    'add after versionchange',
  );
  ok(await call('close', 'versionchange'), 'close after versionchange');
  ok(
    await call('create', 'versionchangeNew', { databaseName: db.versionchange }),
    'create mismatched-version library',
  );
  err(
    await call('list', 'versionchangeNew'),
    'storage',
    'open database with newer version',
  );
  ok(await call('close', 'versionchangeNew'), 'close mismatched-version library');
  assert.ok(versionchangeEntry.id);

  const bitmapFinal = await call('bitmapStats');
  assert.equal(bitmapFinal.outstandingBitmaps, 0, 'all decoded bitmaps must be released');
  assert.ok(bitmapFinal.decodeCount > 0);

  const databasesBeforeRestart = ok(await call('databases'), 'databases before restart');
  assert.ok(!databasesBeforeRestart.some((entry) => entry.name === 'oigptpet'));

  // Restart Electron against the same user data and verify persistence.
  await call('setStatus', 'preparing restart persistence check');
  await desktop.close();
  desktop = null;
  await new Promise((resolveDelay) => {
    setTimeout(resolveDelay, 500);
  });
  const restartStartedAt = performance.now();
  await launch();
  timings.restartMs = performance.now() - restartStartedAt;

  ok(await call('create', 'restart', { databaseName: db.main }), 'create after restart');
  const restartList = ok(await call('list', 'restart'), 'list after restart');
  assert.deepEqual(restartList, mainFinalList, 'summaries must survive an app restart');
  const restartActive = ok(await call('active', 'restart'), 'active after restart');
  assert.equal(restartActive.summary.id, mainFinalActive.summary.id);
  assert.equal(restartActive.summary.name, mainFinalActive.summary.name);
  assert.equal(restartActive.sha256, mainFinalActive.sha256);
  const restartV1Stored = ok(await call('stored', 'restart', v1Summary.id), 'stored v1 after restart');
  assert.equal(restartV1Stored.sha256, inputs.v1.sha256);
  const restartV2Stored = ok(await call('stored', 'restart', v2Summary.id), 'stored v2 after restart');
  assert.equal(restartV2Stored.sha256, inputs.v2.sha256);
  const restartRaw = ok(await call('inspectRaw', db.main), 'raw after restart');
  assert.equal(restartRaw.activeId, v1Summary.id);
  assert.equal(restartRaw.entries.length, 2);

  ok(await call('create', 'restartDefault'), 'default database after restart');
  const restartDefaultList = ok(await call('list', 'restartDefault'), 'default list after restart');
  assert.equal(restartDefaultList.length, 1);
  assert.equal(restartDefaultList[0].name, '精灵图');
  ok(await call('forget', 'restartDefault'), 'close default after restart');

  const databasesAfterRestart = ok(await call('databases'), 'databases after restart');
  assert.ok(!databasesAfterRestart.some((entry) => entry.name === 'oigptpet'));
  await call('setStatus', `restart verified: ${restartList.length} entries, active ${restartActive.summary.name}`);
  await screenshot('after-restart.png');

  assert.deepEqual(pageErrors, [], 'no renderer page errors');
  assert.deepEqual(consoleErrors, [], 'no renderer console errors');

  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    fixtureUrl,
    runId,
    databases: {
      used: db,
      defaultDatabase: 'oigptpet-library',
      legacyDatabaseCreated: false,
    },
    environment: {
      ...environment,
      os: `${process.platform} ${process.arch}`,
      cpus: cpus().length,
      totalMemoryBytes: totalmem(),
      devicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
    },
    constants,
    inputs: {
      vrm: {
        path: inputs.vrm.path,
        bytes: inputs.vrm.bytes,
        sha256: inputs.vrm.sha256,
        defaultName: vrmSummary.name,
      },
      v1: {
        path: inputs.v1.path,
        bytes: inputs.v1.bytes,
        sha256: inputs.v1.sha256,
      },
      v2: {
        path: inputs.v2.path,
        bytes: inputs.v2.bytes,
        sha256: inputs.v2.sha256,
      },
      webp: {
        v1: { bytes: v1Webp.size, sha256: v1WebpSha, quality: 1 },
        v2: { bytes: v2Webp.size, sha256: v2WebpSha, quality: 1 },
      },
    },
    main: {
      finalList: mainFinalList,
      finalActiveId: mainFinalActive.summary.id,
      finalActiveName: mainFinalActive.summary.name,
      duplicate: {
        id: duplicate.id,
        name: duplicate.name,
        createdAtPreserved: duplicate.createdAt === v2Summary.createdAt,
      },
      renameTrimmed: findSummary(mainFinalList, v2Summary.id, 'v2 rename').name,
      order: mainFinalList.map((entry) => entry.id),
      raw: rawMain,
    },
    migration: {
      existingActivePreserved: true,
      repeatedName: migratedAgain.name,
      emptyFirstActive: firstMigration.id,
      failedThenRetried: retryMigration.id,
    },
    limits: {
      count: {
        maxEntries: 2,
        rejected: 'entry-limit',
        retried: countEntryC.id,
      },
      bytes: {
        maxBytes: byteLimit,
        webpBytes: v2Webp.size,
        rejected: 'byte-limit',
        retried: byteWebp.id,
      },
    },
    concurrency: {
      duplicateImport: { id: firstShared.id, entries: rawDedupe.entries.length },
      countRace: {
        successes: raceSuccesses.length,
        failures: raceFailures.length,
        errorCode: raceFailures[0].error.code,
      },
      removeActivate: {
        removeOk: race.remove.ok,
        removeCode: race.remove.ok ? null : race.remove.error.code,
        activateOk: race.activate.ok,
        activateCode: race.activate.ok ? null : race.activate.error.code,
        finalActiveId: raceActive.summary.id,
        entryPresent: removedEntryStillPresent,
      },
    },
    corrupt: {
      sizePreserved: corruption.size,
      digestChanged: damagedStored.sha256 !== damagedEntry.sha256,
      activationCode: 'incomplete-asset',
    },
    invalidScenarios: [
      'garbage-vrm',
      'external-reference-vrm',
      'truncated-vrm',
      'wrong-atlas-dimensions',
      'fake-png',
      'unsupported-mime',
      'empty-frame',
      'invalid-name',
      'pre-start-cancel',
      'mid-decode-cancel',
      'close-during-add',
      'post-close-call',
    ],
    cancellation: {
      immediateName: immediate.outcome.error.name,
      midDecodeName: cancelled.outcome.error.name,
      midDecodeElapsedMs: cancelled.elapsedMs,
      closeDuringAddCode: closedDuringAdd.outcome.error.code,
    },
    persistence: {
      restartListEqualsBefore: true,
      restartActiveId: restartActive.summary.id,
      restartV1Sha256: restartV1Stored.sha256,
      restartV2Sha256: restartV2Stored.sha256,
      defaultDatabasePersisted: restartDefaultList.length === 1,
    },
    versionchange: {
      upgradedVersion: upgraded.version,
      closedCode: 'closed',
      newerVersionOpenCode: 'storage',
    },
    resources: {
      finalBitmapStats: bitmapFinal,
      pageErrors,
      consoleErrors,
    },
    screenshots,
    timing: {
      conditions: 'Windows 10, hidden Electron window, local Vite server, isolated temporary userData, single process. Wall-clock values include IPC and full-blob reads; not a cross-hardware guarantee.',
      ...timings,
    },
  };
  await writeFile(
    join(outputDirectory, 'result.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(
    'Character library smoke passed: real VRM plus real v1/v2 PNG/WebP in Chromium IndexedDB, restart persistence, migration, limits, races, corruption, cancellation and close boundaries.',
  );
} finally {
  if (desktop) {
    await desktop.close().catch(() => {});
  }
  if (server) {
    await server.close();
  }
  await removeOwnTempDirectory(temp);
}
