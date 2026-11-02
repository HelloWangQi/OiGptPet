import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = Date.now();
const output = path.join(root, 'artifacts/window-state', `run-${run}`);
const profile = path.join(root, `.cache/window-state-smoke-${run}`);
const entry = path.join(root, `.cache/window-state-entry-${run}.cjs`);
const env = { ...process.env, OIGPTPET_TEST: '1', OIGPTPET_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.OIGPTPET_DEV_URL; delete env.OIGPTPET_SMOKE_DEMO;
await mkdir(output, { recursive: true });
await mkdir(path.dirname(entry), { recursive: true });
// Test-only launcher exposes the main-process fs object for fault injection.
// The application itself does not expose filesystem access through preload or IPC.
await writeFile(entry, `globalThis.__windowStateTestIO = require('node:fs/promises');\nrequire(${JSON.stringify(path.join(root, 'electron/main.cjs'))});\n`);
let desktop;
const errors = []; const logs = [];
async function launch() {
  desktop = await electron.launch({ args: [entry, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: root, env, timeout: 60000 });
  desktop.process().stderr.on('data', chunk => logs.push(chunk.toString()));
  const page = await desktop.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.petDesktop);
  const opened = desktop.waitForEvent('window'); await page.evaluate(() => window.petDesktop.openPet());
  const petPage = await opened; petPage.on('pageerror', error => errors.push(error.message));
  await petPage.waitForURL(/mode=pet/);
  await petPage.waitForFunction(() => !!window.petDesktop);
}
async function bounds() {
  return desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=pet')).getBounds());
}
async function moveAndQuit(fail) {
  const exited = once(desktop.process(), 'exit', { signal: AbortSignal.timeout(15000) });
  const expected = await desktop.evaluate(({ app, screen, BrowserWindow }, fail) => {
    const fs = globalThis.__windowStateTestIO;
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      if (String(to).endsWith('window-state.json')) {
        await new Promise(resolve => setTimeout(resolve, 150));
        if (fail) throw Object.assign(new Error('injected window-state save failure'), { code: 'EACCES' });
      }
      return rename(from, to);
    };
    const pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=pet'));
    const area = screen.getDisplayMatching(pet.getBounds()).workArea;
    const current = pet.getBounds();
    const offset = fail ? 100 : 25;
    pet.setBounds({ ...current, x: area.x + offset, y: area.y + offset });
    const expected = pet.getBounds();
    // Same main-process turn: quitting occurs before the 300ms debounce can save.
    app.quit();
    return expected;
  }, fail);
  const [code] = await exited; assert.equal(code, 0); desktop = undefined;
  return expected;
}
try {
  await launch();
  const expected = await moveAndQuit(false);
  const saved = JSON.parse(await readFile(path.join(profile, 'window-state.json'), 'utf8'));
  assert.deepEqual(saved, expected);
  await launch(); assert.deepEqual(await bounds(), expected);
  const unsaved = await moveAndQuit(true);
  assert.notDeepEqual(unsaved, expected);
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'window-state.json'), 'utf8')), expected);
  assert.equal((await readdir(profile)).some(name => /^window-state\.json\..*\.tmp$/.test(name)), false);
  assert.ok(logs.some(line => line.includes('Last window position could not be saved: injected window-state save failure')));
  await launch(); assert.deepEqual(await bounds(), expected);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, rapidQuitSaved: expected, restartRestored: true, failedSavePreservedPrevious: true, failedSaveReported: true, noTempLeft: true, pageErrors: errors, conditions: 'Real development Electron, production renderer, isolated profile, same-turn move/app.quit and delayed/injected rename failure; not forced kill, OS shutdown, hardware monitor changes or a one-hour soak' }, null, 2));
  console.log(`Window state smoke passed: ${output}`);
} catch (error) {
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, pageErrors: errors, logs }, null, 2));
  throw error;
} finally { if (desktop) await desktop.close(); }
