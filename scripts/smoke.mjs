import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifactRoot = new URL('../artifacts/smoke/', import.meta.url);
const runId = Date.now();
const preferencesOnly = process.argv.includes('--preferences-only');
const phase = 'phase-03';
const output = new URL(`${phase}/run-${runId}/`, artifactRoot);
const userData = new URL(`../.cache/smoke-profile-${Date.now()}/`, import.meta.url);
await mkdir(output, { recursive: true });
const env = { ...process.env, OIGPTPET_TEST: '1', OIGPTPET_SMOKE_DEMO: '1', OIGPTPET_TEST_USER_DATA: fileURLToPath(userData) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.OIGPTPET_DEV_URL;
const launchOptions = { args: ['.', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: root, env, timeout: 60000 };
let desktop = await electron.launch(launchOptions);
const errors = [];
const nativeLog = [];
desktop.process().stderr.on('data', (chunk) => nativeLog.push(chunk.toString()));
const profiles = [];
let page;
let cadence;

async function exportProfile(profile, valid = true) {
  await page.locator('#export-profile').selectOption(profile);
  await page.locator('#export-button').click();
  await page.locator('#export-dialog[open]').waitFor();
  await page.waitForFunction(() => ['通过', '未通过'].includes(document.querySelector('#local-check-status')?.textContent), undefined, { timeout: 120000 });
  const local = await page.locator('#local-check-status').innerText();
  assert.equal(local, valid ? '通过' : '未通过', await page.locator('#check-messages').innerText());
  assert.equal(await page.locator('#save-atlas').isEnabled(), valid);
}

async function saveRecord(profile, label, valid = true) {
  const pngPath = fileURLToPath(new URL(`${label}.png`, output));
  const reportPath = fileURLToPath(new URL(`${label}-report.json`, output));
  await desktop.evaluate(({ dialog }, destinations) => {
    const queue = [...destinations];
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: queue.shift() });
  }, valid ? [pngPath, reportPath] : [reportPath]);
  if (valid) {
    await page.locator('#save-atlas').click();
    await page.waitForFunction((path) => document.querySelector('#status')?.textContent.includes(path), pngPath);
  }
  await page.locator('#save-report').click();
  await page.waitForFunction((path) => document.querySelector('#status')?.textContent.includes(path), reportPath);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.file.profile, profile);
  assert.equal(report.localInspection.valid, valid);
  assert.equal(report.platformPreflight.status, 'not-run');
  assert.equal(report.platformInstallation.status, 'not-run');
  assert.ok(!JSON.stringify(report).includes(root), 'report contains no workspace path');
  if (valid) {
    const bytes = await readFile(pngPath);
    assert.equal(report.file.encodedBytes, bytes.length);
    assert.equal(report.file.sha256, createHash('sha256').update(bytes).digest('hex'));
    const rejected = await page.evaluate(async (profile) => {
      const bytes = new Uint8Array(await (await fetch(document.querySelector('#atlas-image').src)).arrayBuffer());
      try { await window.petDesktop.saveAtlas(bytes, profile, '0'.repeat(64)); return ''; }
      catch (error) { return error.message; }
    }, profile);
    assert.match(rejected, /hash mismatch/, 'native save rejects mismatched report identity');
  }
  return report;
}

try {
  page = await desktop.firstWindow();
  // Test-only: the user can keep Codex foreground without slowing each export timer.
  await desktop.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => {
    const button = document.querySelector('#export-button');
    return Boolean(button && !button.disabled);
  }, undefined, { timeout: 60000 });
  assert.match(await page.locator('#character-name').innerText(), /VRM1/);
  for (const state of ['waving', 'jumping', 'running', 'review', 'idle']) await page.locator(`[data-state="${state}"]`).click();
  await page.screenshot({ path: fileURLToPath(new URL('workshop.png', output)) });

  if (preferencesOnly) {
    assert.deepEqual(await page.evaluate(() => window.petDesktop.getPreferences()), { version: 1, scale: 1, performance: 'balanced' });
    await page.locator('#performance-mode').selectOption('battery');
    await page.waitForFunction(() => document.querySelector('#performance-mode')?.disabled === false);
    await page.locator('#pet-scale').selectOption('0.8');
    await page.waitForFunction(() => document.querySelector('#pet-scale')?.disabled === false);
    assert.deepEqual(await page.evaluate(() => window.petDesktop.getPreferences()), { version: 1, scale: 0.8, performance: 'battery' });
    const rejected = await page.evaluate(async () => {
      try { await window.petDesktop.setPreferences({ scale: 9 }); return ''; }
      catch (error) { return error.message; }
    });
    assert.match(rejected, /Invalid desktop preferences/);
    cadence = await page.evaluate(async () => {
      const gl = document.querySelector('#character-canvas').getContext('webgl2');
      const original = gl.clear;
      let frames = 0;
      gl.clear = function (...args) { frames++; return original.apply(this, args); };
      const started = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 700));
      gl.clear = original;
      return { frames, elapsedMs: performance.now() - started, hidden: document.hidden };
    });
    assert.ok(cadence.frames <= Math.ceil(cadence.elapsedMs / 1000 * 15) + 2, 'battery mode caps actual GPU render calls');
    if (!cadence.hidden) assert.ok(cadence.frames > 0, 'visible preview draws');
  }

  if (!process.argv.includes('--window-only') && !preferencesOnly) {
  for (const profile of ['v2', 'v1']) {
    await exportProfile(profile);
    assert.equal(await page.locator('[data-atlas-gaze]').count(), profile === 'v2' ? 1 : 0);
    assert.equal(await page.locator('.atlas-preview-widget').getAttribute('data-atlas-playing'), 'false');
    await page.locator('[data-atlas-action]').selectOption('jumping');
    await page.locator('[data-atlas-next]').click();
    assert.equal(await page.locator('[data-atlas-canvas]').getAttribute('data-frame-index'), '1');
    if (profile === 'v2') {
      await page.locator('[data-atlas-gaze]').selectOption('4');
      assert.equal(await page.locator('[data-atlas-canvas]').getAttribute('data-direction-index'), '4');
    }
    const report = await saveRecord(profile, `atlas-${profile}`);
    await page.screenshot({ path: fileURLToPath(new URL(`export-${profile}.png`, output)) });
    profiles.push({ profile, sha256: report.file.sha256, bytes: report.file.encodedBytes, valid: true });
    console.log(`Verified ${profile}: preview, native PNG/report save and hash rejection.`);
    await page.locator('#close-export').click();
    await page.locator('.atlas-preview-widget').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.atlas-preview-widget').count(), 0, 'close disposes preview');
    assert.equal(await page.locator('#export-sha256').innerText(), '', 'close clears old hash');
  }

  // Corrupt one unused cell in the real canvas immediately before PNG encoding.
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...options) {
      if (this.width === 1536 && this.height === 2288) {
        const context = this.getContext('2d');
        context.fillStyle = '#ff0000'; context.fillRect(6 * 192, 0, 1, 1);
        HTMLCanvasElement.prototype.toBlob = original;
      }
      return original.call(this, callback, ...options);
    };
  });
  await exportProfile('v2', false);
  const failed = await saveRecord('v2', 'invalid-atlas', false);
  assert.ok(failed.localInspection.errors.some((item) => item.code === 'unused-cell' && item.row === 0 && item.frame === 6));
  console.log('Verified invalid-cell rejection and PNG save blocking.');
  await page.locator('#close-export').click();
  await page.locator('.atlas-preview-widget').waitFor({ state: 'detached' });

  // Closing an in-flight export cannot restore stale results or leave a live preview.
  await page.locator('#export-button').click();
  await page.locator('#export-dialog[open]').waitFor();
  await page.locator('#close-export').click();
  await page.waitForFunction(() => document.querySelector('#save-atlas')?.disabled === true);
  assert.equal(await page.locator('#save-atlas').isDisabled(), true);
  await exportProfile('v2');
  console.log('Verified cancel then re-export.');
  await page.locator('#close-export').click();
  }

  await page.locator('#open-pet').click();
  const pet = await desktop.evaluate(async ({ BrowserWindow }) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const window = BrowserWindow.getAllWindows().find((item) => !item.isResizable());
      if (window) window.webContents.setBackgroundThrottling(false);
      if (window && !window.webContents.isLoading()) {
        const ui = await window.webContents.executeJavaScript(`({ background: getComputedStyle(document.documentElement).backgroundColor, message: document.querySelector('#pet-message')?.textContent })`);
        if (ui.message === '') return { ...ui, alwaysOnTop: window.isAlwaysOnTop(), png: (await window.webContents.capturePage()).toPNG().toString('base64') };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Pet window did not finish loading');
  });
  assert.equal(pet.background, 'rgba(0, 0, 0, 0)');
  assert.equal(pet.alwaysOnTop, true);
  await writeFile(new URL('desktop-pet.png', output), Buffer.from(pet.png, 'base64'));
  if (preferencesOnly) {
    const bounds = () => desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((item) => !item.isResizable());
      return window ? window.getBounds() : null;
    });
    assert.equal((await bounds()).width, 256);
    assert.equal((await bounds()).height, 336);
    await page.locator('#pet-scale').selectOption('1.2');
    await page.waitForFunction(() => document.querySelector('#pet-scale')?.disabled === false);
    assert.equal((await bounds()).width, 384);
    assert.equal((await bounds()).height, 504);
    await page.locator('#performance-mode').selectOption('quality');
    await page.waitForFunction(() => document.querySelector('#performance-mode')?.disabled === false);
    assert.deepEqual(JSON.parse(await readFile(new URL('preferences.json', userData), 'utf8')), { version: 1, scale: 1.2, performance: 'quality' });
    await desktop.close();
    desktop = await electron.launch(launchOptions);
    desktop.process().stderr.on('data', (chunk) => nativeLog.push(chunk.toString()));
    page = await desktop.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => document.querySelector('#performance-mode')?.disabled === false);
    assert.equal(await page.locator('#pet-scale').inputValue(), '1.2');
    assert.equal(await page.locator('#performance-mode').inputValue(), 'quality');
    await page.locator('#open-pet').click();
    for (let attempt = 0; attempt < 100 && !await bounds(); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await bounds()).width, 384);
    assert.equal((await bounds()).height, 504);
    await page.screenshot({ path: fileURLToPath(new URL('preferences-restored.png', output)) });
  }
  assert.deepEqual(errors, []);
  const windowOnly = process.argv.includes('--window-only') || preferencesOnly;
  await writeFile(new URL(preferencesOnly ? 'preferences-result.json' : windowOnly ? 'window-result.json' : 'result.json', output), JSON.stringify({ ok: true, profiles, preferencesVerified: preferencesOnly, cadence, invalidSaveBlocked: !windowOnly, cancelReopen: !windowOnly, nativePngAndReportSave: !windowOnly, rendererErrors: errors, officialValidation: 'not-run', installedAsChatGPTPet: false }, null, 2));
  await writeFile(new URL(preferencesOnly ? 'latest-preferences.json' : windowOnly ? 'latest-window.json' : 'latest.json', artifactRoot), JSON.stringify({ directory: `${phase}/run-${runId}`, generatedAt: new Date().toISOString() }, null, 2));
  console.log(preferencesOnly ? 'Preferences smoke passed: size, performance, IPC validation, GPU cadence and restart persistence.' : windowOnly ? 'Desktop window smoke passed: transparent always-on-top pet.' : 'Desktop smoke passed: v1/v2 previews, exact PNG/report hashes, invalid-save blocking, cancel/reopen and transparent pet.');
} catch (error) {
  await writeFile(new URL('native-failure.log', output), nativeLog.join(''));
  if (page) {
    await page.screenshot({ path: fileURLToPath(new URL('failure.png', output)) }).catch(() => {});
    console.error(await page.locator('#status').innerText().catch(() => 'Page unavailable'));
    console.error(await page.locator('#check-messages').innerText().catch(() => ''));
  }
  throw error;
} finally { await desktop.close(); }
