import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertAppDistribution } from './distribution.mjs';
import { checkPetBodyDrag } from './pet-drag-smoke-steps.mjs';
import { checkChat } from './chat-smoke-steps.mjs';
import { checkChatRestore } from './chat-restore-smoke-steps.mjs';
import { checkMotionCapabilities } from './motion-capabilities-smoke-steps.mjs';
import { checkExternalMotion } from './external-motion-smoke-steps.mjs';
import { checkRenderMonitor } from './render-monitor-smoke-steps.mjs';
import { checkWorkshopLayout } from './workshop-layout-smoke-steps.mjs';
import { checkSpriteTransitions, checkVrmTransitions } from './motion-transition-smoke-steps.mjs';
import { checkPetDock, checkPetQuickExit } from './pet-dock-smoke-steps.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const releaseRoot = path.resolve(root, 'release');
const latest = JSON.parse(await readFile(path.join(releaseRoot, 'latest.json'), 'utf8'));
if (typeof latest.directory !== 'string') throw new Error('Invalid release manifest');
const release = path.resolve(releaseRoot, latest.directory);
if (!release.startsWith(`${releaseRoot}${path.sep}`)) throw new Error('Release path escapes output directory');
const outputRoot = path.resolve(root, 'artifacts/release-smoke');
const output = path.join(outputRoot, `run-${Date.now()}`);
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
  const workshopLayout = await checkWorkshopLayout(desktop, page, output);
  const vrmTransitions = await checkVrmTransitions(page, output);
  const externalMotion = await checkExternalMotion(page, output, desktop, root);
  await page.screenshot({ path: path.join(output, 'imported-model.png') });
  await desktop.close(); desktop = undefined;
  page = await launch();
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('角色已就绪'), undefined, { timeout: 60000 });
  assert.match(await page.locator('#character-name').innerText(), /VRM1/);
  await page.locator('#model-file').setInputFiles(path.join(root, 'artifacts/animation-fixes/run-04/atlas-v2.png'));
  await page.waitForFunction(() => document.body.dataset.characterKind === 'sprite', undefined, { timeout: 60000 });
  const spriteTransitions = await checkSpriteTransitions(page);
  await page.locator('#import-button:not([disabled])').waitFor();
  assert.equal(await page.locator('#export-button').isDisabled(), true);
  await page.locator('#character-alias').fill('发布包精灵图');
  await page.locator('#rename-character').click();
  await page.waitForFunction(() => document.querySelector('#character-name').textContent === '发布包精灵图');
  await page.locator('#performance-mode').selectOption('battery');
  await page.locator('#performance-mode:not([disabled])').waitFor();
  await page.locator('#pet-scale').selectOption('1.2');
  await page.locator('#pet-scale:not([disabled])').waitFor();
  const nextWindow = desktop.waitForEvent('window');
  await page.locator('#open-pet').click();
  let pet = await nextWindow;
  pet.on('pageerror', (error) => errors.push(error.message));
  await desktop.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.setBackgroundThrottling(false);
  });
  await pet.waitForFunction(() => document.body.dataset.characterKind === 'sprite');
  await pet.waitForFunction(() => {
    const canvas = document.querySelector('#character-canvas');
    const context = canvas.getContext('2d');
    return context?.getImageData(0, 0, canvas.width, canvas.height).data.some((value, i) => i % 4 === 3 && value >= 8);
  });
  const bounds = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => !win.isResizable()).getBounds());
  assert.equal(bounds.width, 384); assert.equal(bounds.height, 504);
  await pet.screenshot({ path: path.join(output, 'packaged-sprite-pet.png') });
  const bodyDrag = await checkPetBodyDrag(desktop, pet);
  const petDock = await checkPetDock(desktop, page, pet);
  const diagnosticFile = await desktop.evaluate(({ app, dialog }) => {
    globalThis.__diagnosticDialog = dialog.showSaveDialog;
    dialog.showSaveDialog = async () => ({ canceled: true });
    return app.getPath('userData') + '/desktop-diagnostics.json';
  });
  try {
    await page.locator('#save-diagnostics').click();
    await page.waitForFunction(() => document.querySelector('#settings-status').textContent.includes('已取消'));
    await assert.rejects(readFile(diagnosticFile), { code: 'ENOENT' });
    await pet.evaluate(() => window.petDesktop.hidePet());
    await desktop.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, diagnosticFile);
    await page.locator('#save-diagnostics').click();
    await page.waitForFunction(() => document.querySelector('#settings-status').textContent.includes('诊断已保存'));
    const diagnostic = JSON.parse(await readFile(diagnosticFile, 'utf8'));
    assert.equal(diagnostic.format, 'oigptpet-desktop-diagnostics');
    assert.equal(diagnostic.application.version, latest.version);
    assert.equal(diagnostic.windows.find(win => win.role === 'pet').visible, false);
    assert.equal(diagnostic.coordinateUnit, 'DIP');
    assert.ok(diagnostic.displays.length > 0);
    assert.equal(JSON.stringify(diagnostic).includes(userData), false);
    await assert.rejects(pet.evaluate(() => window.petDesktop.saveDiagnostics()), /Only the workshop/);
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.isResizable()).isVisible()), false);
  } finally {
    await desktop.evaluate(({ dialog }) => { dialog.showSaveDialog = globalThis.__diagnosticDialog; delete globalThis.__diagnosticDialog; });
  }
  const renderMonitoring = await checkRenderMonitor(desktop, page, pet, output);
  await assert.rejects(page.evaluate(() => window.petDesktop.startDrag()), /Only the pet/);
  await checkChat(desktop, page, pet);
  ({ page, pet } = await checkChatRestore(desktop, page, pet, errors));
  await desktop.close(); desktop = undefined;
  page = await launch();
  await page.waitForFunction(() => document.body.dataset.characterKind === 'sprite', undefined, { timeout: 60000 });
  assert.equal(await page.locator('#character-name').innerText(), '发布包精灵图');
  assert.equal(await page.locator('#character-list .library-row').count(), 2);
  assert.equal(await page.locator('#performance-mode').inputValue(), 'battery');
  assert.equal(await page.locator('#pet-scale').inputValue(), '1.2');
  assert.equal((await page.evaluate(() => window.petDesktop.getChatSettings())).hasKey, true);
  const freshChat = await page.evaluate(() => window.petDesktop.getChatSnapshot());
  assert.equal(freshChat.history.length, 0); assert.equal(freshChat.attempt, null);
  await page.screenshot({ path: path.join(output, 'restored-sprite-library.png') });
  const motionCapabilities = await checkMotionCapabilities(desktop, page, root, output);
  assert.deepEqual(errors, []);
  const quickExit = await checkPetQuickExit(desktop, pet);
  desktop = undefined;
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, version: latest.version, directory: latest.directory, packaged, files, emptyFirstStart: true, localImport: true, persistedAfterRestart: true, spritePetRendered: true, spriteLibraryRestored: true, preferencesRestored: true, petBounds: bounds, bodyDrag, petDock, quickExit, workshopDragRejected: true, motionCapabilities, renderMonitoring, workshopLayout, vrmTransitions, externalMotion, spriteTransitions, rendererErrors: errors }, null, 2));
  await writeFile(path.join(outputRoot, 'latest.json'), JSON.stringify({ directory: path.basename(output), version: latest.version }, null, 2));
  console.log(`Release smoke passed: clean distribution, empty first launch, VRM/sprite library, actual pet drawing, settings and restart persistence. ${output}`);
} catch (error) {
  await writeFile(path.join(output, 'native-failure.log'), nativeLog.join(''));
  if (page) {
    console.error(await page.locator('#status').innerText().catch(() => 'Page unavailable'));
    console.error(errors);
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally { if (desktop) await desktop.close(); }
