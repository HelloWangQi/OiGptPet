import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAppDistribution } from './distribution.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = process.argv[2];
if (!['0.1.0', '0.2.0'].includes(version)) throw new Error('Expected 0.1.0 or 0.2.0');
const provenance = JSON.parse(await readFile(path.join(root, `artifacts/github-release/v${version}-build.json`), 'utf8'));
const releaseRoot = path.join(root, 'release');
const folder = path.resolve(releaseRoot, provenance.directory);
assert.ok(folder.startsWith(releaseRoot + path.sep));
const bundled = path.join(folder, 'resources/app');
const files = await assertAppDistribution(bundled);
assert.equal(JSON.parse(await readFile(path.join(bundled, 'package.json'), 'utf8')).version, version);
const testRoot = path.join(root, '.cache', `historical-smoke-${version}-${Date.now()}`);
const userData = path.join(testRoot, 'user-data');
await mkdir(userData, { recursive: true });
await writeFile(path.join(testRoot, 'package.json'), JSON.stringify({ name: 'historical-smoke', version: '0.0.0', main: 'main.cjs' }));
// 0.1 predates the test userData switch. Isolate its bundled code in a harness;
// no shipped file is patched and no real user profile is opened.
await writeFile(path.join(testRoot, 'main.cjs'), `const { app } = require('electron');
const setPath = app.setPath.bind(app);
app.setPath = (name, value) => setPath(name, name === 'userData' ? process.env.HISTORICAL_USER_DATA : value);
app.setPath('userData', process.env.HISTORICAL_USER_DATA);
require(${JSON.stringify(path.join(bundled, 'electron/main.cjs'))});
`);
const env = { ...process.env, HISTORICAL_USER_DATA: userData, OIGPTPET_TEST: '1', OIGPTPET_TEST_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE; delete env.OIGPTPET_DEV_URL; delete env.OIGPTPET_SMOKE_DEMO;
let app; let page; const errors = [];
const output = path.join(root, `artifacts/github-release/v${version}-smoke`);
await mkdir(output, { recursive: true });
async function launch() {
  app = await electron.launch({ args: [testRoot, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: root, env, timeout: 60000 });
  page = await app.firstWindow(); page.on('pageerror', (error) => errors.push(error.message));
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), userData);
}
try {
  await launch();
  await page.locator('#import-button').waitFor();
  await page.locator('#model-file').setInputFiles(path.join(root, 'public/models/demo.vrm'));
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('角色已就绪'), undefined, { timeout: 60000 });
  assert.equal(await page.locator('#export-button').isEnabled(), true);
  await page.screenshot({ path: path.join(output, 'imported-vrm.png') });
  await app.close(); app = undefined;
  await launch();
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('角色已就绪'), undefined, { timeout: 60000 });
  assert.match(await page.locator('#character-name').innerText(), /VRM1/);
  assert.equal(await page.locator('#export-button').isEnabled(), true);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, version, commit: provenance.commit, files, bundledApplicationHarness: true, nativePackagedExecutableLaunched: false, isolatedUserData: true, localImport: true, restartPersistence: true, rendererErrors: errors }, null, 2));
  console.log(`Historical ${version} bundled-code smoke passed: local import and restart in an isolated harness.`);
} catch (error) {
  if (page) { console.error(await page.locator('#status').innerText().catch(() => 'No page')); await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); }
  throw error;
} finally { if (app) await app.close(); }
