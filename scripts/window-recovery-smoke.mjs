import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = Date.now();
const output = path.join(root, 'artifacts/window-recovery', `run-${run}`);
await mkdir(output, { recursive: true });
const env = { ...process.env, OIGPTPET_TEST: '1', OIGPTPET_TEST_USER_DATA: path.join(root, `.cache/window-recovery-${run}`) };
delete env.ELECTRON_RUN_AS_NODE; delete env.OIGPTPET_DEV_URL; delete env.OIGPTPET_SMOKE_DEMO;
let desktop;
const errors = [];
const cases = [];
async function snapshot() {
  return desktop.evaluate(({ BrowserWindow }) => {
    const pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=pet'));
    return { bounds: pet.getBounds(), visible: pet.isVisible() };
  });
}
async function settled(expected) {
  await desktop.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
  assert.deepEqual(await snapshot(), expected);
  cases.push(expected);
}
try {
  desktop = await electron.launch({ args: ['.', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: root, env, timeout: 60000 });
  const page = await desktop.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.petDesktop);
  const opened = desktop.waitForEvent('window');
  await page.evaluate(() => window.petDesktop.openPet());
  const petPage = await opened; petPage.on('pageerror', error => errors.push(error.message));
  await petPage.waitForURL(/mode=pet/);
  await petPage.waitForFunction(() => !!window.petDesktop);
  // Inject only work-area information: events run the production listeners on a real BrowserWindow.
  // This does not emulate Windows monitor hardware or native DPI conversion.
  await desktop.evaluate(({ screen, BrowserWindow }) => {
    globalThis.__recoveryOriginalDisplay = screen.getDisplayMatching;
    globalThis.__recoveryArea = { x: 0, y: 0, width: 1000, height: 800 };
    screen.getDisplayMatching = () => ({ workArea: globalThis.__recoveryArea });
    const pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=pet'));
    pet.setBounds({ x: 900, y: 700, width: 320, height: 420 }); pet.hide();
    screen.emit('display-removed', {}, {});
  });
  await settled({ bounds: { x: 680, y: 380, width: 320, height: 420 }, visible: false });
  await desktop.evaluate(({ screen }) => { globalThis.__recoveryArea = { x: 0, y: 0, width: 800, height: 600 }; screen.emit('display-metrics-changed', {}, {}, ['workArea', 'scaleFactor']); });
  await settled({ bounds: { x: 480, y: 180, width: 320, height: 420 }, visible: false });
  await page.evaluate(() => window.petDesktop.setScale(1.2));
  await settled({ bounds: { x: 416, y: 96, width: 384, height: 504 }, visible: false });
  await desktop.evaluate(({ powerMonitor }) => { globalThis.__recoveryArea = { x: 0, y: 0, width: 600, height: 550 }; powerMonitor.emit('resume'); });
  await settled({ bounds: { x: 216, y: 46, width: 384, height: 504 }, visible: false });
  await page.evaluate(() => window.petDesktop.openPet());
  await settled({ bounds: { x: 216, y: 46, width: 384, height: 504 }, visible: true });
  await desktop.evaluate(({ screen }) => { screen.getDisplayMatching = globalThis.__recoveryOriginalDisplay; });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, cases, pageErrors: errors, conditions: 'Real Electron BrowserWindow, production build, isolated profile, injected work areas and monitor/resume events; no physical multi-monitor/DPI/sleep validation' }, null, 2));
  console.log(`Window recovery smoke passed: ${output}`);
} catch (error) {
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, cases, pageErrors: errors }, null, 2));
  throw error;
} finally { if (desktop) await desktop.close(); }
