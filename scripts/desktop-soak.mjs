import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { soakOptions, summarizeMemory } from './stability-metrics.mjs';
import { installStabilityProbe } from './stability-probe.mjs';
import { checkPetBodyDrag } from './pet-drag-smoke-steps.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = soakOptions(process.argv.slice(2));
const run = Date.now();
const output = path.join(root, 'artifacts/desktop-soak', `run-${run}`);
const profile = path.join(root, `.cache/desktop-soak-${run}`);
const latest = JSON.parse(await readFile(path.join(root, 'release/latest.json'), 'utf8'));
const release = path.resolve(root, 'release', latest.directory);
if (!release.startsWith(path.join(root, 'release') + path.sep)) throw new Error('Unsafe release path');
// Refuse a stale package. Compare all application sources and built client files.
for (const file of ['main.cjs', 'preload.cjs', 'pet-drag.cjs', 'window-state.cjs', 'window-recovery.cjs']) {
  assert.deepEqual(await readFile(path.join(release, 'resources/app/electron', file)), await readFile(path.join(root, 'electron', file)), `Stale packaged ${file}`);
}
const index = await readFile(path.join(root, 'dist/index.html'));
assert.deepEqual(await readFile(path.join(release, 'resources/app/dist/index.html')), index, 'Stale packaged renderer');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const env = { ...process.env, OIGPTPET_TEST: '1', OIGPTPET_TEST_USER_DATA: profile };
for (const name of ['ELECTRON_RUN_AS_NODE', 'OIGPTPET_DEV_URL', 'OIGPTPET_SMOKE_DEMO']) delete env[name];
await mkdir(output, { recursive: true });
const errors = []; const samples = []; const switches = []; const actions = [];
let desktop; let page; let pet; let closing = false; let began; let cancelled = false;
const cancel = () => { cancelled = true; };
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
const elapsed = () => began === undefined ? 0 : (performance.now() - began) / 1000;
const durationSeconds = options.minutes * 60;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function attach(target) {
  target.on('pageerror', error => errors.push(error.message));
  target.on('crash', () => errors.push('Renderer crashed'));
}
async function probe(target) { return target.evaluate(() => ({ ...window.__stabilityProbe })); }
async function waitSelection(id) {
  for (const target of [page, pet].filter(Boolean)) await target.waitForFunction(id => document.body.dataset.characterId === id, id, { timeout: 60000 });
  await page.locator('#import-button:not([disabled])').waitFor();
}
async function record() {
  assert.deepEqual(errors, []);
  const row = { elapsedSeconds: elapsed(), time: new Date().toISOString(), processes: await desktop.evaluate(({ app }) => app.getAppMetrics()), workshop: await probe(page), pet: await probe(pet), kind: await pet.locator('body').getAttribute('data-character-kind') };
  for (const p of [row.workshop, row.pet]) {
    assert.equal(p.contexts - p.lost, row.kind === 'vrm' ? 1 : 0, 'Only the current VRM context may remain');
    assert.equal(p.bitmaps - p.closed, row.kind === 'sprite' ? 1 : 0, 'Only the current atlas bitmap may remain');
  }
  samples.push(row);
  await appendFile(path.join(output, 'samples.ndjson'), JSON.stringify(row) + '\n');
  await writeFile(path.join(output, 'progress.json'), JSON.stringify({ elapsedSeconds: row.elapsedSeconds, durationSeconds, switches: switches.length, samples: samples.length, errors }, null, 2));
}
try {
  desktop = await electron.launch({ executablePath: path.join(release, 'OiGptPet.exe'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: root, env, timeout: 60000 });
  desktop.process().stderr.on('data', data => { void appendFile(path.join(output, 'native.log'), data).catch(() => {}); });
  desktop.process().on('exit', () => { if (!closing) errors.push('Unexpected application exit'); });
  page = await desktop.firstWindow(); attach(page);
  await page.addInitScript(installStabilityProbe); await page.reload();
  await page.locator('#import-button').waitFor();
  await page.locator('#model-file').setInputFiles(path.join(root, 'public/models/demo.vrm'));
  await page.waitForFunction(() => document.body.dataset.characterKind === 'vrm', undefined, { timeout: 60000 });
  await page.locator('#import-button:not([disabled])').waitFor();
  const vrmId = await page.locator('body').getAttribute('data-character-id');
  await page.locator('#model-file').setInputFiles(path.join(root, 'artifacts/animation-fixes/run-04/atlas-v2.png'));
  await page.waitForFunction(() => document.body.dataset.characterKind === 'sprite', undefined, { timeout: 60000 });
  await page.locator('#import-button:not([disabled])').waitFor();
  const spriteId = await page.locator('body').getAttribute('data-character-id');
  const opened = desktop.waitForEvent('window'); await page.locator('#open-pet').click(); pet = await opened; attach(pet);
  await pet.addInitScript(installStabilityProbe); await pet.reload(); await waitSelection(spriteId);
  const conditions = await desktop.evaluate(({ app, screen }) => ({ electron: process.versions.electron, chrome: process.versions.chrome, packaged: app.isPackaged, displays: screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor })) }));
  await writeFile(path.join(output, 'conditions.json'), JSON.stringify({ ...conditions, options, sourceCommit, packageDirectory: latest.directory, packageMainSha256: createHash('sha256').update(await readFile(path.join(release, 'resources/app/electron/main.cjs'))).digest('hex'), os: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, ramBytes: os.totalmem(), rendering: 'SwiftShader software rendering; not a GPU energy benchmark', memoryUnits: 'Electron raw memory fields in KiB, CPU percentCPUUsage is per-process', startTime: new Date().toISOString() }, null, 2));
  began = performance.now(); let nextSwitch = 0; let nextSample = 0; let nextProgress = 0;
  await record();
  while (elapsed() < durationSeconds && !cancelled) {
    if (elapsed() >= nextSwitch) {
      const id = switches.length % 2 === 0 ? vrmId : spriteId;
      const started = performance.now();
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isResizable()).show());
      await page.locator(`[data-select-character="${id}"]`).click(); await waitSelection(id);
      switches.push({ elapsedSeconds: elapsed(), id, kind: id === vrmId ? 'vrm' : 'sprite', durationMs: performance.now() - started });
      await appendFile(path.join(output, 'actions.ndjson'), JSON.stringify(switches.at(-1)) + '\n');
      if (switches.length % 4 === 0) {
        const mode = ['quality', 'balanced', 'battery'][Math.floor(switches.length / 4) % 3];
        await page.locator('#performance-mode').selectOption(mode); await page.locator('#performance-mode:not([disabled])').waitFor();
        const drag = await checkPetBodyDrag(desktop, pet);
        await pet.evaluate(() => window.petDesktop.hidePet()); await delay(700);
        const hidden = await probe(pet); await delay(700); const stillHidden = await probe(pet);
        assert.equal(stillHidden.spriteDraws + stillHidden.glDraws, hidden.spriteDraws + hidden.glDraws, 'Hidden pet must stop drawing');
        await page.evaluate(() => window.petDesktop.openPet());
        actions.push({ elapsedSeconds: elapsed(), mode, drag, hiddenDrawingStopped: true });
      }
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isResizable()).hide());
      nextSwitch = elapsed() + options['switch-seconds'];
    }
    if (elapsed() >= nextSample) { await record(); nextSample = elapsed() + options['sample-seconds']; }
    if (elapsed() >= nextProgress) { console.log(`Soak ${Math.floor(elapsed())}/${durationSeconds}s; ${switches.length} switches; ${samples.length} samples`); nextProgress = elapsed() + 60; }
    await delay(500);
  }
  assert.equal(cancelled, false, 'Soak interrupted before completion');
  await record(); assert.deepEqual(errors, []);
  const completeHour = elapsed() >= 3600;
  if (durationSeconds >= 3600) assert.ok(switches.length >= 20, 'One-hour run must cover at least 20 switches');
  const memory = summarizeMemory(samples, completeHour ? 300 : 0);
  const result = { ok: true, completeHour, durationSeconds: elapsed(), requestedSeconds: durationSeconds, switches, actions, samples: samples.length, memory, memoryNeedsReview: memory.some(p => p.needsReview), errors, limitations: 'Single Windows host, injected cursor for drag, software rendering, no physical monitor/DPI/sleep changes; positive memory slope is a review signal, not a leak diagnosis; short runs never count as one-hour acceptance' };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(`Soak finished: ${output}; completeHour=${completeHour}; memoryNeedsReview=${result.memoryNeedsReview}`);
} catch (error) {
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, elapsedSeconds: elapsed(), switches, actions, samples: samples.length, errors }, null, 2)); throw error;
} finally { closing = true; if (desktop) await desktop.close(); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
