import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const runId = Date.now();
const output = path.join(root, 'artifacts/phase-03', `run-${runId}`);
const profile = path.join(root, '.cache', `phase-three-profile-${runId}`);
await mkdir(output, { recursive: true }); await mkdir(profile, { recursive: true });
const legacy = await readFile(path.join(root, 'public/models/demo.vrm'));
await writeFile(path.join(profile, 'current.vrm'), legacy);
const legacyHash = createHash('sha256').update(legacy).digest('hex');
const env = { ...process.env, OIGPTPET_TEST: '1', OIGPTPET_SMOKE_DEMO: '1', OIGPTPET_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.OIGPTPET_DEV_URL;
const launchOptions = { args: ['.', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: root, env, timeout: 60000 };
const atlas = (version) => path.join(root, `artifacts/animation-fixes/run-04/atlas-${version}.png`);
const errors = []; const nativeLog = [];
let desktop; let page; let pet;

async function launch() {
  desktop = await electron.launch(launchOptions);
  desktop.process().stderr.on('data', (chunk) => nativeLog.push(chunk.toString()));
  page = await desktop.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('角色已就绪'), undefined, { timeout: 60000 });
  await page.locator('#import-button:not([disabled])').waitFor();
}
async function settled() {
  await page.locator('#cancel-load').waitFor({ state: 'hidden', timeout: 60000 });
  await page.locator('#import-button:not([disabled])').waitFor();
}
async function importFile(file) {
  await page.locator('#model-file').setInputFiles(file);
  await page.waitForFunction(() => !document.querySelector('#import-button').disabled, undefined, { timeout: 60000 });
  await settled();
}
async function kind(target, value) {
  await target.waitForFunction((kind) => document.body.dataset.characterKind === kind, value, { timeout: 60000 });
}
async function currentId(target = page) { return target.locator('body').getAttribute('data-character-id'); }
async function select(id) {
  await page.locator(`[data-select-character="${id}"]`).click();
  await page.waitForFunction((id) => document.body.dataset.characterId === id, id, { timeout: 60000 });
  await settled();
  await pet.waitForFunction((id) => document.body.dataset.characterId === id, id, { timeout: 60000 });
}
async function drawSummary(target) {
  return target.evaluate(() => {
    const canvas = document.querySelector('#character-canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let occupied = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] >= 8) occupied++;
    return { width: canvas.width, height: canvas.height, occupied };
  });
}

try {
  await launch();
  assert.equal(await page.locator('[data-character-id].library-row').count(), 1, 'legacy migrated once');
  const vrmId = await currentId(); assert.match(vrmId, new RegExp(legacyHash));
  await page.locator('#character-alias').fill('我的搭档');
  await page.locator('#rename-character').click();
  await page.waitForFunction(() => document.querySelector('#character-name').textContent === '我的搭档');
  const petReady = desktop.waitForEvent('window');
  await page.locator('#open-pet').click(); pet = await petReady;
  pet.on('pageerror', (error) => errors.push(error.message));
  await kind(pet, 'vrm');
  // Keep deterministic draw checks running while the test application is backgrounded.
  await desktop.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.setBackgroundThrottling(false);
  });
  assert.equal(await pet.locator('body').getAttribute('data-character-id'), vrmId);

  await importFile(atlas('v2')); await kind(page, 'sprite'); await kind(pet, 'sprite');
  const spriteV2 = await currentId(); assert.equal(await currentId(pet), spriteV2);
  assert.equal(await page.locator('#export-button').isDisabled(), true);
  assert.equal(await page.locator('#character-list .library-row').count(), 2);
  await pet.waitForFunction(() => {
    const canvas = document.querySelector('#character-canvas');
    const c = canvas.getContext('2d');
    return c && c.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v >= 8);
  });
  const spriteDrawing = await drawSummary(pet); assert.ok(spriteDrawing.occupied > 100);
  await pet.screenshot({ path: path.join(output, 'sprite-pet.png') });
  await page.screenshot({ path: path.join(output, 'sprite-workshop.png') });

  // Correct file but wrong explicitly selected profile must keep the active sprite.
  await page.locator('#sprite-profile').selectOption('v1');
  await importFile(atlas('v2'));
  assert.equal(await currentId(), spriteV2);
  assert.match(await page.locator('#status').innerText(), /保留原角色/);

  // A storage failure after candidate loading must preserve both active pointer and visible canvas.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'meta' && args[1] === 'active') {
        IDBObjectStore.prototype.put = original;
        this.transaction.abort();
        throw new DOMException('Injected active write failure', 'AbortError');
      }
      return original.apply(this, args);
    };
  });
  await page.locator(`[data-select-character="${vrmId}"]`).click();
  await settled();
  assert.equal(await currentId(), spriteV2);
  assert.equal(await currentId(pet), spriteV2);
  assert.match(await page.locator('#status').innerText(), /保留原角色/);
  assert.equal(await page.locator('#character-list .library-row').count(), 2);

  // Static VRM metadata passes, but its absent humanoid/scene fails actual rendering.
  const doc = { asset: { version: '2.0' }, extensions: { VRMC_vrm: { specVersion: '1.0', meta: { name: 'Broken renderer candidate' } } } };
  let json = JSON.stringify(doc); while (Buffer.byteLength(json) % 4) json += ' ';
  const broken = Buffer.alloc(20 + Buffer.byteLength(json));
  broken.writeUInt32LE(0x46546c67, 0); broken.writeUInt32LE(2, 4); broken.writeUInt32LE(broken.length, 8);
  broken.writeUInt32LE(Buffer.byteLength(json), 12); broken.writeUInt32LE(0x4e4f534a, 16); broken.write(json, 20);
  await importFile({ name: 'broken.vrm', mimeType: 'model/gltf-binary', buffer: broken });
  assert.equal(await currentId(), spriteV2);
  assert.equal(await page.locator('#character-list .library-row').count(), 2);
  assert.match(await page.locator('#status').innerText(), /保留原角色/);

  // Cancel during real image decoding. Late completion must not replace the sprite.
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    window.createImageBitmap = async (...args) => {
      const bitmap = await original(...args);
      await new Promise((resolve) => setTimeout(resolve, 350));
      return bitmap;
    };
  });
  await page.locator('#model-file').setInputFiles(atlas('v1'));
  await page.locator('#cancel-load:not([disabled])').click();
  await settled();
  assert.equal(await currentId(), spriteV2);
  assert.match(await page.locator('#status').innerText(), /取消/);
  await importFile(atlas('v1')); await kind(page, 'sprite');
  const spriteV1 = await currentId(); assert.notEqual(spriteV1, spriteV2);
  await pet.waitForFunction((id) => document.body.dataset.characterId === id, spriteV1);
  await select(vrmId); await kind(page, 'vrm');
  assert.equal(await page.locator('#export-button').isEnabled(), true);
  assert.equal(await page.locator('#character-name').innerText(), '我的搭档');
  // Exercise both context types repeatedly; every switch must replace its canvas.
  for (let i = 0; i < 3; i++) { await select(spriteV2); await select(vrmId); }
  await select(spriteV1);
  await page.locator(`[data-remove-character="${spriteV2}"]`).click();
  await page.locator(`[data-select-character="${spriteV2}"]`).waitFor({ state: 'detached' });
  assert.equal(await page.locator(`[data-remove-character="${spriteV1}"]`).isDisabled(), true);
  assert.equal(await page.locator('#character-list .library-row').count(), 2);
  // Save settings, then verify the chosen sprite survives a complete app restart.
  await page.locator('#performance-mode').selectOption('battery');
  await page.locator('#performance-mode:not([disabled])').waitFor();
  await desktop.close(); desktop = undefined;
  await launch(); await kind(page, 'sprite');
  assert.equal(await currentId(), spriteV1);
  assert.equal(await page.locator('#character-list .library-row').count(), 2);
  assert.equal(await page.locator('#performance-mode').inputValue(), 'battery');
  assert.ok((await page.locator(`[data-select-character="${vrmId}"]`).innerText()).includes('我的搭档'));
  assert.equal(createHash('sha256').update(await readFile(path.join(profile, 'current.vrm'))).digest('hex'), legacyHash, 'old file is unchanged');
  await page.screenshot({ path: path.join(output, 'restored-library.png') });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, legacyHash, vrmId, spriteV1, spriteV2, spriteDrawing, migrationIdempotent: true, failureRollback: true, storageFailureRollback: true, cancellation: true, repeatedSwitchPairs: 3, renameDelete: true, petSync: true, restartPersistence: true, rendererErrors: errors, officialValidation: 'not-run' }, null, 2));
  await writeFile(path.join(root, 'artifacts/phase-03/latest.json'), JSON.stringify({ directory: `run-${runId}` }, null, 2));
  console.log(`Phase three smoke passed: migration, VRM/sprite switch, rollback, cancellation, pet sync and restart. ${output}`);
} catch (error) {
  await writeFile(path.join(output, 'native-failure.log'), nativeLog.join(''));
  if (page) {
    console.error(await page.locator('#status').innerText().catch(() => 'Page unavailable'));
    console.error(errors);
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally { if (desktop) await desktop.close(); }
