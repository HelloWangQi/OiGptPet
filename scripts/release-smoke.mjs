import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertAppDistribution } from './distribution.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const releaseRoot = path.resolve(root, 'release');
const latest = JSON.parse(await readFile(path.join(releaseRoot, 'latest.json'), 'utf8'));
if (typeof latest.directory !== 'string') throw new Error('Invalid release manifest');
const release = path.resolve(releaseRoot, latest.directory);
if (!release.startsWith(`${releaseRoot}${path.sep}`)) throw new Error('Release path escapes output directory');
const output = path.resolve(root, 'artifacts/release-smoke');
const userData = path.resolve(root, `.cache/release-smoke-profile-${Date.now()}`);
await mkdir(output, { recursive: true });
const files = await assertAppDistribution(path.join(release, 'resources/app'));
const env = { ...process.env, OIGPTPET_TEST: '1', OIGPTPET_TEST_USER_DATA: userData };
for (const name of ['ELECTRON_RUN_AS_NODE', 'OIGPTPET_DEV_URL', 'OIGPTPET_SMOKE_DEMO']) delete env[name];
let desktop;
let page;
const nativeLog = [];
const errors = [];
async function launch() {
  desktop = await electron.launch({ executablePath: path.join(release, 'OiGptPet.exe'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: root, env, timeout: 60000 });
  desktop.process().stderr.on('data', (chunk) => nativeLog.push(chunk.toString()));
  const page = await desktop.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#import-button').waitFor();
  return page;
}
try {
  page = await launch();
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('导入本机'));
  assert.equal(await page.locator('#load-demo').isHidden(), true);
  assert.equal(await page.locator('#export-button').isDisabled(), true);
  const packaged = await desktop.evaluate(({ app }) => app.isPackaged);
  assert.equal(packaged, true);
  await page.screenshot({ path: path.join(output, 'empty-state.png') });
  await page.locator('#model-file').setInputFiles(path.join(root, 'public/models/demo.vrm'));
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('角色已就绪'), undefined, { timeout: 60000 });
  assert.equal(await page.locator('#export-button').isEnabled(), true);
  await page.screenshot({ path: path.join(output, 'imported-model.png') });
  await desktop.close(); desktop = undefined;
  page = await launch();
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('角色已就绪'), undefined, { timeout: 60000 });
  assert.match(await page.locator('#character-name').innerText(), /VRM1/);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, version: latest.version, directory: latest.directory, packaged, files, emptyFirstStart: true, localImport: true, persistedAfterRestart: true, rendererErrors: errors }, null, 2));
  console.log('Release smoke passed: no bundled model, empty first launch, local import and restart persistence.');
} catch (error) {
  await writeFile(path.join(output, 'native-failure.log'), nativeLog.join(''));
  if (page) {
    console.error(await page.locator('#status').innerText().catch(() => 'Page unavailable'));
    console.error(errors);
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally { if (desktop) await desktop.close(); }
