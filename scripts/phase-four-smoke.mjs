import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = Date.now();
const output = path.join(root, `artifacts/phase-04/run-${run}`);
const packagedRun = process.argv.includes('--release');
let release;
if (packagedRun) {
  const latest = JSON.parse(await readFile(path.join(root, 'release/latest.json'), 'utf8'));
  const folder = path.resolve(root, 'release', latest.directory);
  if (!folder.startsWith(path.join(root, 'release') + path.sep)) throw new Error('Invalid release path');
  release = { version: latest.version, executablePath: path.join(folder, 'OiGptPet.exe') };
}
await mkdir(output, { recursive: true });
const errors = []; const switches = []; const snapshots = []; const nativeLog = [];
const hash = (data) => createHash('sha256').update(data).digest('hex');
let desktop; let page; let pet;
async function launch(profile) {
  const env = { ...process.env, OIGPTPET_TEST: '1', OIGPTPET_TEST_USER_DATA: path.join(root, `.cache/phase-four-${run}-${profile}`) };
  if (!packagedRun) env.OIGPTPET_SMOKE_DEMO = '1'; else delete env.OIGPTPET_SMOKE_DEMO;
  delete env.ELECTRON_RUN_AS_NODE; delete env.OIGPTPET_DEV_URL;
  desktop = await electron.launch({ ...(release ? { executablePath: release.executablePath } : {}), args: [...(release ? [] : ['.']), '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: root, env, timeout: 60000 });
  desktop.process().stderr.on('data', (chunk) => nativeLog.push(chunk.toString()));
  assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), packagedRun);
  page = await desktop.firstWindow(); attachErrors(page);
  await desktop.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.webContents.setBackgroundThrottling(false); });
  await ready();
  await page.addInitScript(() => {
    const probe = { contexts: 0, lost: 0, atlasCreated: 0, atlasClosed: 0 };
    window.__phaseFourProbe = probe;
    const contexts = new WeakSet(); const extensions = new WeakSet();
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const gl = context.apply(this, args);
      if (args[0] === 'webgl2' && gl && !contexts.has(gl)) {
        contexts.add(gl); probe.contexts++;
        const get = gl.getExtension;
        gl.getExtension = function (name) {
          const extension = get.call(this, name);
          if (name === 'WEBGL_lose_context' && extension && !extensions.has(extension)) {
            extensions.add(extension); const lose = extension.loseContext.bind(extension);
            extension.loseContext = () => { probe.lost++; lose(); };
          }
          return extension;
        };
      }
      return gl;
    };
    const decode = window.createImageBitmap;
    window.createImageBitmap = async (...args) => {
      const bitmap = await decode(...args);
      if (bitmap.width === 1536 && [1872, 2288].includes(bitmap.height)) {
        probe.atlasCreated++; const close = bitmap.close.bind(bitmap); let closed = false;
        bitmap.close = () => { if (!closed) { closed = true; probe.atlasClosed++; } close(); };
      }
      return bitmap;
    };
  });
  await page.reload(); await ready();
}
function attachErrors(target) { target.on('pageerror', (error) => errors.push(error.message)); }
async function ready() {
  await page.locator('#restore-character:not([disabled])').waitFor({ timeout: 60000 });
}
async function packageIdle() {
  await page.waitForFunction(() => document.body.dataset.packageBusy === '', undefined, { timeout: 60000 });
  await page.locator('#restore-character:not([disabled])').waitFor();
}
async function currentId(target = page) { return target.locator('body').getAttribute('data-character-id'); }
async function name(value) {
  await page.locator('#character-alias').fill(value); await page.locator('#rename-character').click();
  await page.waitForFunction((value) => document.querySelector('#character-name').textContent === value, value);
}
async function importSource(file) {
  await page.locator('#model-file').setInputFiles(file);
  await page.waitForFunction(() => Boolean(document.body.dataset.characterId) && document.querySelector('#status')?.textContent.includes('角色已就绪'), undefined, { timeout: 60000 });
  await page.locator('#import-button:not([disabled])').waitFor({ timeout: 60000 });
  assert.ok(await currentId());
}
async function dialog(result) { await desktop.evaluate(({ dialog }, result) => { dialog.showSaveDialog = async () => result; }, result); }
async function save(file) {
  await dialog({ filePath: file }); await page.locator('#backup-character').click(); await packageIdle();
  assert.ok((await page.locator('#package-status').innerText()).includes(file));
  return readFile(file);
}
async function restore(file) { await page.locator('#package-file').setInputFiles(file); await packageIdle(); }
function inspect(data, source, expectedName, kind) {
  assert.equal(data.subarray(0, 8).toString(), 'OIPET001');
  const length = data.readUInt32LE(8); const manifest = JSON.parse(data.subarray(12, 12 + length).toString());
  const payload = data.subarray(12 + length);
  assert.equal(manifest.name, expectedName); assert.equal(manifest.kind, kind);
  assert.equal(manifest.sha256, hash(source)); assert.equal(manifest.encodedBytes, source.length);
  assert.deepEqual(payload, source);
  return { bytes: data.length, sha256: hash(data), manifest };
}
async function rejectRestore(buffer, label, beforeId) {
  await restore({ name: `${label}.oipet`, mimeType: 'application/octet-stream', buffer });
  assert.equal(await currentId(), beforeId);
  assert.equal(await page.locator('#package-status').evaluate((node) => node.classList.contains('error')), true);
}
try {
  await launch('A');
  assert.equal(await page.locator('#backup-character').isDisabled(), true, 'ephemeral demo must be imported before backup');
  const vrmPath = path.join(root, 'public/models/demo.vrm'); const vrm = await readFile(vrmPath);
  await importSource(vrmPath); await name('迁移用搭档');
  const vrmId = await currentId(); const vrmBackup = path.join(output, 'companion-vrm.oipet');
  const vrmPackage = await save(vrmBackup); const vrmRecord = inspect(vrmPackage, vrm, '迁移用搭档', 'vrm');
  await dialog({ filePath: path.join(output, 'missing-parent/failed.oipet') });
  await page.locator('#backup-character').click(); await packageIdle();
  assert.equal(await currentId(), vrmId); assert.equal(await page.locator('#package-status.error').count(), 1);
  await dialog({ canceled: true }); await page.locator('#backup-character').click(); await packageIdle();
  assert.match(await page.locator('#package-status').innerText(), /取消/);
  await desktop.evaluate(({ dialog }) => { dialog.showSaveDialog = () => new Promise((resolve) => { globalThis.__finishPackageDialog = resolve; }); });
  await page.locator('#backup-character').click();
  await desktop.evaluate(async () => { while (!globalThis.__finishPackageDialog) await new Promise((resolve) => setTimeout(resolve, 20)); });
  await page.locator('#cancel-package').click();
  const cancelledPath = path.join(output, 'cancelled.oipet');
  await desktop.evaluate((_electron, filePath) => { globalThis.__finishPackageDialog({ filePath }); delete globalThis.__finishPackageDialog; }, cancelledPath);
  await packageIdle(); assert.match(await page.locator('#package-status').innerText(), /取消/);
  await assert.rejects(stat(cancelledPath), { code: 'ENOENT' });
  const atlasPath = path.join(root, 'artifacts/animation-fixes/run-04/atlas-v2.png'); const atlas = await readFile(atlasPath);
  await importSource(atlasPath); await name('图集迁移');
  const spriteId = await currentId(); const spriteBackup = path.join(output, 'companion-sprite.oipet');
  const spritePackage = await save(spriteBackup); const spriteRecord = inspect(spritePackage, atlas, '图集迁移', 'sprite');
  assert.equal(spriteRecord.manifest.profile, 'v2');
  console.log('Profile A: native backup, disk failure and delayed-dialog cancellation passed.');
  await desktop.close(); desktop = undefined;

  await launch('B');
  assert.equal(await page.locator('#character-list .library-row').count(), 0);
  await restore(vrmBackup); assert.equal(await currentId(), vrmId);
  assert.equal(await page.locator('#character-name').innerText(), '迁移用搭档');
  await name('本地改名'); await restore(vrmBackup);
  assert.equal(await page.locator('#character-name').innerText(), '本地改名');
  assert.equal(await page.locator('#character-list .library-row').count(), 1);
  await restore(spriteBackup); assert.equal(await currentId(), spriteId);
  assert.equal(await page.locator('#character-name').innerText(), '图集迁移');
  assert.equal(await page.locator('#export-button').isDisabled(), true);
  const corrupt = Buffer.from(vrmPackage); corrupt[corrupt.length - 1] ^= 1;
  await rejectRestore(corrupt, 'bad-hash', spriteId);
  await rejectRestore(vrmPackage.subarray(0, 30), 'truncated', spriteId);
  const badVersion = Buffer.from(vrmPackage); const jsonEnd = 12 + badVersion.readUInt32LE(8);
  const badJson = badVersion.subarray(12, jsonEnd).toString().replace('"schemaVersion":1', '"schemaVersion":9');
  badVersion.write(badJson, 12); await rejectRestore(badVersion, 'bad-version', spriteId);
  const fakeManifest = { ...vrmRecord.manifest, kind: 'sprite', mime: 'image/png', profile: 'v2' };
  const fakeJson = Buffer.from(JSON.stringify(fakeManifest)); const fake = Buffer.alloc(12 + fakeJson.length + vrm.length);
  fake.write('OIPET001'); fake.writeUInt32LE(fakeJson.length, 8); fakeJson.copy(fake, 12); vrm.copy(fake, 12 + fakeJson.length);
  await rejectRestore(fake, 'wrong-source-kind', spriteId);
  assert.equal(await page.locator('#character-list .library-row').count(), 2);
  await page.evaluate(() => {
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function () { if (this.size === 12) await new Promise((resolve) => setTimeout(resolve, 400)); return read.call(this); };
  });
  await page.locator('#package-file').setInputFiles(vrmBackup); await page.locator('#cancel-package').click(); await packageIdle();
  assert.equal(await currentId(), spriteId); assert.match(await page.locator('#package-status').innerText(), /取消/);
  console.log('Profile B: restore, duplicate alias, invalid source/hash/version and decode cancellation passed.');
  const nextWindow = desktop.waitForEvent('window'); await page.locator('#open-pet').click(); pet = await nextWindow; attachErrors(pet);
  await pet.waitForFunction((id) => document.body.dataset.characterId === id, spriteId, { timeout: 60000 });
  await desktop.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.webContents.setBackgroundThrottling(false); });
  snapshots.push(await desktop.evaluate(({ app }) => app.getAppMetrics()));
  for (let i = 0; i < 20; i++) {
    const id = i % 2 === 0 ? vrmId : spriteId; const started = performance.now();
    await page.locator(`[data-select-character="${id}"]`).click();
    await page.waitForFunction((id) => document.body.dataset.characterId === id, id, { timeout: 60000 });
    await pet.waitForFunction((id) => document.body.dataset.characterId === id, id, { timeout: 60000 });
    await page.locator('#backup-character:not([disabled])').waitFor();
    switches.push({ index: i + 1, kind: i % 2 === 0 ? 'vrm' : 'sprite', elapsedMs: performance.now() - started });
    if ((i + 1) % 5 === 0) snapshots.push(await desktop.evaluate(({ app }) => app.getAppMetrics()));
    if ((i + 1) % 5 === 0) console.log(`Verified ${i + 1}/20 desktop switches.`);
  }
  const probe = await page.evaluate(() => window.__phaseFourProbe);
  assert.equal(probe.contexts, probe.lost, 'sprite is active so every workshop WebGL context has been released');
  assert.equal(probe.atlasCreated - probe.atlasClosed, 1, 'only the active workshop atlas bitmap remains');
  // Closing the actual workshop while a native dialog is pending must discard its late result.
  await desktop.evaluate(({ dialog }) => { dialog.showSaveDialog = () => new Promise((resolve) => { globalThis.__finishPackageDialog = resolve; }); });
  await page.locator('#backup-character').click();
  const closedPath = path.join(output, 'closed-window.oipet');
  await desktop.evaluate(async ({ BrowserWindow }, filePath) => {
    for (let attempt = 0; !globalThis.__finishPackageDialog && attempt < 100; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    if (!globalThis.__finishPackageDialog) throw new Error('Save dialog did not open');
    const workshop = BrowserWindow.getAllWindows().find((win) => win.isResizable()); workshop.close();
    for (let attempt = 0; !workshop.isDestroyed() && attempt < 100; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    if (!workshop.isDestroyed()) throw new Error('Workshop did not close');
    globalThis.__finishPackageDialog({ filePath }); delete globalThis.__finishPackageDialog;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }, closedPath);
  await assert.rejects(stat(closedPath), { code: 'ENOENT' });
  const reopened = desktop.waitForEvent('window'); await pet.locator('#workshop-button').click(); page = await reopened; attachErrors(page); await ready();
  assert.equal(await currentId(), spriteId);
  await page.screenshot({ path: path.join(output, 'restored-workshop.png') });
  await desktop.close(); desktop = undefined;
  await launch('B');
  assert.equal(await currentId(), spriteId); assert.equal(await page.locator('#character-list .library-row').count(), 2);
  assert.ok((await page.locator(`[data-select-character="${vrmId}"]`).innerText()).includes('本地改名'));
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, packaged: packagedRun, version: release?.version, vrmRecord, spriteRecord, crossProfileRestore: true, duplicatePreservesAlias: true, invalidPreservesCurrent: true, nativeSaveFailure: true, cancelledDialogNoFile: true, closedDialogNoFile: true, cancelledDecode: true, restartRestored: true, switches, workshopResources: probe, processMemorySamples: snapshots, memoryUnits: 'raw Electron getAppMetrics fields, not a long-term leak proof', conditions: 'Windows x64, Electron software rendering, isolated profiles, native desktop UI, 20 selections total; no one-hour soak or hardware energy measurement', pageErrors: errors }, null, 2));
  await writeFile(path.join(root, 'artifacts/phase-04/latest.json'), JSON.stringify({ directory: `run-${run}` }, null, 2));
  console.log(`Phase four desktop smoke passed: backup, cross-profile restore, failures/cancel, 20 switches, resources and restart. ${output}`);
} catch (error) {
  await writeFile(path.join(output, 'native-failure.log'), nativeLog.join(''));
  if (page) { console.error(await page.locator('#status').innerText().catch(() => 'No page')); console.error(await page.locator('#package-status').innerText().catch(() => '')); console.error(errors); await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); }
  throw error;
} finally { if (desktop) await desktop.close(); }
