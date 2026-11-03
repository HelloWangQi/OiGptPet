import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertAppDistribution } from './distribution.mjs';
import { summarizeMemory } from './stability-metrics.mjs';
import { installStabilityProbe } from './stability-probe.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const mixed = args.includes('--mixed');
const cycleArgs = args.filter(arg => arg !== '--mixed');
const cycles = cycleArgs.length === 0 ? 24 : cycleArgs.length === 2 && cycleArgs[0] === '--cycles' ? Number(cycleArgs[1]) : NaN;
if (args.filter(arg => arg === '--mixed').length > 1 || !Number.isInteger(cycles) || cycles < 4 || cycles > 200) throw new Error('Use [--mixed] [--cycles N] (integer, 4–200; default 24).');
const latest = JSON.parse(await readFile(path.join(root, 'release/latest.json'), 'utf8'));
const releaseRoot = path.resolve(root, 'release');
assert.equal(typeof latest.directory, 'string');
const release = path.resolve(releaseRoot, latest.directory);
assert.ok(release.startsWith(releaseRoot + path.sep), 'Release path escapes output');
const appRoot = path.join(release, 'resources/app');
const files = await assertAppDistribution(appRoot);
// Every runtime file must match, including modules added after the older soak.
const expectedElectron = (await readdir(path.join(root, 'electron'))).filter(name => name.endsWith('.cjs')).sort();
assert.deepEqual(files.filter(name => name.startsWith('electron/')).map(name => name.slice(9)).sort(), expectedElectron);
const digests = {};
for (const file of files.filter(name => name.startsWith('electron/') || name.startsWith('dist/'))) {
  const bytes = await readFile(path.join(appRoot, file));
  assert.deepEqual(bytes, await readFile(path.join(root, file)), `Stale packaged ${file}; run npm run verify:desktop`);
  digests[file] = createHash('sha256').update(bytes).digest('hex');
}
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
assert.equal(JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8')).version, version);
assert.equal(latest.version, version);
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const source = { commit: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])), runtimeSha256: digests };
const run = Date.now();
const outputRoot = path.join(root, mixed ? 'artifacts/chat-mixed' : 'artifacts/chat-stress');
const output = path.join(outputRoot, `run-${run}`);
const profile = path.join(root, `.cache/chat-stress-${run}`);
await mkdir(output, { recursive: true });
const env = { ...process.env, OIGPTPET_TEST: '1', OIGPTPET_TEST_USER_DATA: profile };
for (const name of ['ELECTRON_RUN_AS_NODE', 'OIGPTPET_DEV_URL', 'OIGPTPET_SMOKE_DEMO']) delete env[name];
const errors = []; const samples = []; const actions = [];
const began = performance.now();
let desktop; let page; let pet; let closing = false; let interrupted = false; let expected = []; let requests = 0;
let currentKind = 'sprite'; const characters = {}; const mixedActions = [];
const stop = () => { interrupted = true; };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
const elapsed = () => (performance.now() - began) / 1000;
const ready = target => target.waitForFunction(kind => document.body.dataset.characterKind === kind && !document.querySelector('#chat-model').disabled, currentKind, { timeout: 60000, polling: 100 });
const snapshot = () => page.evaluate(() => window.petDesktop.getChatSnapshot());
function attach(target) {
  target.on('pageerror', error => errors.push(error.message));
  target.on('crash', () => errors.push('Renderer crashed'));
}
async function launch() {
  closing = false;
  desktop = await electron.launch({ executablePath: path.join(release, 'OiGptPet.exe'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: root, env, timeout: 60000 });
  desktop.process().stderr.on('data', bytes => { void appendFile(path.join(output, 'native.log'), bytes).catch(() => {}); });
  desktop.process().on('exit', () => { if (!closing) errors.push('Unexpected application exit'); });
  // Entire main-process fetch is replaced before configuring chat. It never
  // forwards: unexpected requests fail the test, rather than reaching a service.
  await desktop.evaluate(() => {
    globalThis.__chatStress = { calls: [], faults: [], cancelled: 0, lateCancelled: 0 };
    globalThis.fetch = async (url, options) => {
      const test = globalThis.__chatStress;
      if (url !== 'https://api.openai.com/v1/responses' || options?.method !== 'POST' || !test.next) {
        test.faults.push('Unplanned fetch'); throw new Error('Unplanned fetch');
      }
      const plan = test.next; delete test.next;
      const body = JSON.parse(options.body);
      test.calls.push(body);
      if (plan.kind === 'late') return new Promise(resolve => { test.resolveLate = resolve; });
      return new Response(new ReadableStream({
        start(controller) {
          test.controller = controller;
          controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: plan.partial, output_index: 0, content_index: 0 }) + '\n\n'));
        },
        cancel() { test.cancelled++; delete test.controller; },
      }), { headers: { 'content-type': 'text/event-stream' } });
    };
  });
  page = await desktop.firstWindow(); attach(page);
  await page.locator('#import-button').waitFor();
  if (mixed) { await desktop.context().addInitScript(installStabilityProbe); await page.reload(); await page.locator('#import-button').waitFor(); }
}
async function openPet() {
  const opening = desktop.waitForEvent('window');
  await page.evaluate(() => window.petDesktop.openPet()); pet = await opening; attach(pet);
  await pet.waitForFunction(kind => document.body.dataset.characterKind === kind, currentKind, { timeout: 60000, polling: 100 });
}
async function probe(target) { return target.evaluate(() => ({ ...window.__stabilityProbe })); }
async function measure(label, extra = {}) {
  const row = { label, ...extra, elapsedSeconds: elapsed(), kind: currentKind, processes: await desktop.evaluate(({ app }) => app.getAppMetrics()) };
  if (mixed) {
    for (const [name, target] of [['workshop', page], ['pet', pet]]) {
      const value = await probe(target); row[name] = value;
      assert.equal(value.contexts - value.lost, currentKind === 'vrm' ? 1 : 0, `${name}: only the current VRM context may remain`);
      assert.equal(value.bitmaps - value.closed, currentKind === 'sprite' ? 1 : 0, `${name}: only the current atlas bitmap may remain`);
    }
  }
  samples.push(row); await appendFile(path.join(output, 'samples.ndjson'), JSON.stringify(row) + '\n');
}
async function switchCharacter(kind, message, cycle, phase) {
  const before = await snapshot(); const started = performance.now();
  await page.locator(`[data-select-character="${characters[kind]}"]`).click(); currentKind = kind;
  for (const target of [page, pet]) await target.waitForFunction(id => document.body.dataset.characterId === id, characters[kind], { timeout: 60000, polling: 100 });
  await page.locator('#import-button:not([disabled])').waitFor();
  assert.deepEqual(await snapshot(), before, 'Changing character must not change conversation state');
  // No further deltas are emitted here: the latest bubble must survive loading.
  await pet.waitForFunction(message => document.querySelector('#pet-message').textContent === message, message, { timeout: 5000, polling: 100 });
  await measure('character-switch', { cycle, phase });
  mixedActions.push({ cycle, phase, kind, durationMs: performance.now() - started });
}
async function hideDuringReply() {
  await pet.evaluate(() => window.petDesktop.hidePet());
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.isResizable()).isVisible()), false);
  // Hidden renderer timers can be suspended. Use native visibility and drawing
  // counters from explicit evaluations, rather than scheduling a hidden timer.
  await page.waitForTimeout(700);
  return probe(pet);
}
async function resumeAfterReply(hidden, cycle) {
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.isResizable()).isVisible()), false, 'A reply must not reveal the hidden pet');
  await page.waitForTimeout(350);
  const after = await probe(pet);
  assert.equal(after.glDraws + after.spriteDraws, hidden.glDraws + hidden.spriteDraws, 'Hidden reply must not draw');
  await page.evaluate(() => window.petDesktop.openPet());
  await pet.waitForFunction(draws => !document.hidden && window.__stabilityProbe.glDraws + window.__stabilityProbe.spriteDraws > draws, after.glDraws + after.spriteDraws, { timeout: 10000, polling: 100 });
  mixedActions.push({ cycle, phase: 'hidden-reply-resume', kind: currentKind, hiddenDrawingStopped: true });
}
async function reopenWorkshop() {
  const closed = page.waitForEvent('close');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.isResizable()).close()); await closed;
  const opening = desktop.waitForEvent('window');
  await pet.evaluate(() => window.petDesktop.openWorkshop()); page = await opening; attach(page); await ready(page);
}
async function plan(kind, partial = '') {
  await desktop.evaluate((_electron, value) => { globalThis.__chatStress.next = value; }, { kind, partial });
}
async function checkRequest(text) {
  requests++;
  await page.waitForFunction(() => !document.querySelector('#chat-cancel').hidden, undefined, { polling: 100 });
  // Encryption can complete after the renderer enters its busy state.
  for (let i = 0; i < 100; i++) {
    const calls = await desktop.evaluate(() => globalThis.__chatStress.calls);
    if (calls.length === requests) {
      const body = calls.at(-1);
      assert.equal(body.model, 'stress-model'); assert.equal(body.store, false); assert.equal(body.stream, true);
      assert.deepEqual(body.input, [...expected, { role: 'user', content: text }]);
      return;
    }
    assert.ok(calls.length < requests, 'Unsolicited extra request');
    await page.waitForTimeout(50);
  }
  assert.fail('Expected mock request was not received');
}
async function send(text, kind = 'stream', partial = '片段：' + text) {
  await plan(kind, partial); await page.locator('#chat-input').fill(text); await page.locator('#chat-send').click(); await checkRequest(text);
  if (kind === 'stream') await page.waitForFunction(text => document.querySelector('#chat-log [data-reply-state="partial"]')?.textContent === '伙伴：' + text, partial, { polling: 100 });
}
async function finish(text, reply) {
  await desktop.evaluate((_electron, reply) => {
    const test = globalThis.__chatStress;
    test.controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: reply }] }] } }) + '\n\n'));
    // Deliberately leave the connection open. Completion must cancel the reader.
  }, reply);
  await page.waitForFunction(() => document.querySelector('#chat-status').textContent.includes('回复完成') && !document.querySelector('#chat-send').disabled, undefined, { polling: 100 });
  expected = [...expected, { role: 'user', content: text }, { role: 'assistant', content: reply }].slice(-8);
  assert.deepEqual((await snapshot()).history, expected);
  assert.equal((await snapshot()).attempt, null);
  await pet.waitForFunction(reply => document.querySelector('#pet-message').textContent === reply, reply, { polling: 100 });
  assert.ok(await page.locator('#chat-log p').count() <= 12);
  assert.equal(await page.locator('#chat-log [data-reply-state]').count(), 0);
}
async function record(cycle, mode) {
  const native = await desktop.evaluate(({ BrowserWindow, app }) => ({
    windows: BrowserWindow.getAllWindows().map(win => ({ id: win.id, workshop: win.isResizable(), destroyed: win.isDestroyed() })),
    processes: app.getAppMetrics(), calls: globalThis.__chatStress.calls.length, faults: globalThis.__chatStress.faults,
    cancelled: globalThis.__chatStress.cancelled, openStream: Boolean(globalThis.__chatStress.controller), pendingPlan: Boolean(globalThis.__chatStress.next),
  }));
  assert.equal(native.windows.length, 2); assert.equal(native.windows.filter(win => win.workshop).length, 1);
  assert.equal(native.calls, requests); assert.equal(native.openStream, false); assert.equal(native.pendingPlan, false);
  assert.equal(native.cancelled, requests - cycle, 'Each streaming body must be released, including completed but still-open connections');
  assert.deepEqual(native.faults, []); assert.deepEqual(errors, []);
  const state = await snapshot(); assert.deepEqual(state.history, expected); assert.ok(state.history.length <= 8);
  await measure('cycle-end', { cycle, mode, ...native, historyMessages: state.history.length, visibleRows: await page.locator('#chat-log p').count() });
  await writeFile(path.join(output, 'progress.json'), JSON.stringify({ cycles: cycle, requestedCycles: cycles, requests, elapsedSeconds: elapsed(), errors }, null, 2));
  console.log(`Chat stress ${cycle}/${cycles}; ${requests} mock requests; ${Math.round(elapsed())}s`);
}
try {
  await launch();
  assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), true);
  if (mixed) {
    await page.locator('#model-file').setInputFiles(path.join(root, 'public/models/demo.vrm'));
    await page.waitForFunction(() => document.body.dataset.characterKind === 'vrm', undefined, { timeout: 60000, polling: 100 });
    await page.locator('#import-button:not([disabled])').waitFor();
    characters.vrm = await page.locator('body').getAttribute('data-character-id');
  }
  await page.locator('#model-file').setInputFiles(path.join(root, 'artifacts/animation-fixes/run-04/atlas-v2.png')); await ready(page);
  await page.locator('#import-button:not([disabled])').waitFor();
  characters.sprite = await page.locator('body').getAttribute('data-character-id');
  await page.evaluate(() => window.petDesktop.saveChatSettings({ model: 'stress-model', apiKey: 'stress-key-not-real' }));
  await page.reload(); await ready(page); await openPet();
  const conditions = await desktop.evaluate(({ app, screen }) => ({ electron: process.versions.electron, os: process.platform, arch: process.arch, packaged: app.isPackaged, displays: screen.getAllDisplays().map(({ bounds, workArea, scaleFactor }) => ({ bounds, workArea, scaleFactor })) }));
  await writeFile(path.join(output, 'conditions.json'), JSON.stringify({ ...conditions, cycles, mixed, version, packageDirectory: latest.directory, source, rendering: 'SwiftShader; mock service; isolated synthetic configuration; no real API calls', startedAt: new Date().toISOString() }, null, 2));
  await record(0, 'initial');
  for (let cycle = 1; cycle <= cycles; cycle++) {
    assert.equal(interrupted, false, 'Interrupted before all cycles completed');
    // Repeated success without clearing fills and rolls the four-turn context.
    for (let turn = 0; turn < 2; turn++) {
      const text = `消息 ${cycle}.${turn}`; const reply = `回复 ${cycle}.${turn}`;
      await send(text);
      let hidden;
      if (turn === 0) {
        if (mixed) await switchCharacter('vrm', '片段：' + text, cycle, 'streaming');
        if (cycle % 2) { await pet.reload(); await pet.waitForFunction(kind => document.body.dataset.characterKind === kind, currentKind, { timeout: 60000, polling: 100 }); }
        else {
          const closed = pet.waitForEvent('close');
          await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.isResizable()).close()); await closed; await openPet();
        }
        await pet.waitForFunction(text => document.querySelector('#pet-message').textContent === '片段：' + text, text, { polling: 100 });
        if (mixed) hidden = await hideDuringReply();
      }
      await finish(text, reply);
      if (hidden) {
        await resumeAfterReply(hidden, cycle);
        await switchCharacter('sprite', reply, cycle, 'completed');
        const beforeRename = await snapshot();
        // Wait for metadata application in the pet, rather than mistaking its
        // unchanged pre-sync bubble for successful name synchronization.
        await pet.evaluate(() => {
          window.__renameObserved = false;
          window.__renameObserver = new MutationObserver(() => { window.__renameObserved = true; window.__renameObserver.disconnect(); });
          window.__renameObserver.observe(document.body, { attributes: true, attributeFilter: ['data-character-id'] });
        });
        try {
          await page.locator('#character-alias').fill(`混合负载角色 ${cycle}`); await page.locator('#rename-character').click();
          await page.waitForFunction(name => document.querySelector('#character-name').textContent === name, `混合负载角色 ${cycle}`, { polling: 100 });
          await pet.waitForFunction(reply => window.__renameObserved && document.querySelector('#pet-message').textContent === reply, reply, { polling: 100 });
          assert.deepEqual(await snapshot(), beforeRename, 'Renaming must preserve the conversation');
        } finally {
          await pet.evaluate(() => { window.__renameObserver?.disconnect(); delete window.__renameObserver; delete window.__renameObserved; });
        }
      }
    }
    const text = `中断 ${cycle}`; await send(text);
    const mode = ['cancel', 'reload', 'reopen', 'clear'][(cycle - 1) % 4];
    if (mode === 'cancel') await page.locator('#chat-cancel').click();
    else if (mode === 'reload') { await page.reload(); await ready(page); }
    else if (mode === 'reopen') await reopenWorkshop();
    else { await page.locator('#chat-clear').click(); expected = []; }
    await page.waitForFunction(() => !document.querySelector('#chat-send').disabled, undefined, { polling: 100 });
    const state = await snapshot(); assert.deepEqual(state.history, expected);
    if (mode !== 'clear') {
      assert.equal(state.attempt.status, 'cancelled'); assert.equal(state.attempt.text, text);
      assert.equal(state.attempt.partial, '片段：' + text);
      assert.equal(await page.locator('#chat-log [data-reply-state="incomplete"]').count(), 1);
      await page.locator('#chat-input').fill('保留的新草稿'); await plan('stream', '重试片段'); await page.locator('#chat-retry').click(); await checkRequest(text);
      await page.waitForFunction(() => document.querySelector('#chat-log [data-reply-state="partial"]')?.textContent === '伙伴：重试片段', undefined, { polling: 100 });
      await finish(text, `重试成功 ${cycle}`);
      assert.equal(await page.locator('#chat-input').inputValue(), '保留的新草稿');
    } else { assert.equal(state.attempt, null); assert.equal(await page.locator('#chat-log p').count(), 0); }
    // A provider ignoring abort must not let its late response replace a new one.
    await send(`迟到 ${cycle}`, 'late'); await page.locator('#chat-cancel').click();
    await page.waitForFunction(() => !document.querySelector('#chat-send').disabled, undefined, { polling: 100 });
    const replacement = `替换 ${cycle}`; await send(replacement); await finish(replacement, `最终 ${cycle}`);
    const beforeLate = await snapshot();
    await desktop.evaluate(() => {
      const test = globalThis.__chatStress;
      test.resolveLate(new Response(new ReadableStream({ cancel() { test.lateCancelled++; } })));
      delete test.resolveLate;
    });
    for (let i = 0; i < 100; i++) {
      if (await desktop.evaluate(() => globalThis.__chatStress.lateCancelled) === cycle) break;
      await page.waitForTimeout(20);
    }
    assert.equal(await desktop.evaluate(() => globalThis.__chatStress.lateCancelled), cycle);
    assert.deepEqual(await snapshot(), beforeLate, 'Late response changed the current conversation');
    await page.reload(); await ready(page);
    assert.deepEqual((await snapshot()).history, expected);
    assert.equal(await page.locator('#chat-log p').count(), expected.length);
    await record(cycle, mode); actions.push({ cycle, mode, requests });
  }
  assert.equal(interrupted, false, 'Interrupted before all cycles completed');
  assert.ok(expected.length > 0);
  closing = true; await desktop.close(); desktop = undefined;
  await launch(); await ready(page);
  const fresh = await snapshot(); assert.deepEqual(fresh.history, []); assert.equal(fresh.attempt, null);
  assert.equal(fresh.state.status, 'idle');
  assert.equal((await page.evaluate(() => window.petDesktop.getChatSettings())).hasKey, true);
  assert.equal(await desktop.evaluate(() => globalThis.__chatStress.calls.length), 0, 'Restart must not send a request');
  assert.deepEqual(errors, []);
  const memory = summarizeMemory(samples, 0);
  const result = { ok: true, version, packageDirectory: latest.directory, source, mixed, cycles, requests, elapsedSeconds: elapsed(), actions, mixedActions, samples: samples.length, memory, memoryNeedsReview: memory.some(row => row.needsReview), restartClearedHistory: true, errors, limitations: `Bounded synthetic chat/window stress, ${mixed ? 'VRM/sprite switches and hidden replies' : 'sprite only'}, software rendering. Not one-hour, real API, hardware DPI/sleep or energy acceptance. Memory includes initialization and renderer restarts; no forced GC or leak conclusion.` };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  await writeFile(path.join(outputRoot, 'latest.json'), JSON.stringify({ directory: path.basename(output), version }, null, 2));
  console.log(`Chat stress passed: ${output}`);
} catch (error) {
  const windows = [];
  for (const [name, target] of [['workshop', page], ['pet', pet]]) {
    if (!target || target.isClosed()) continue;
    windows.push({ name, state: await target.evaluate(() => ({ hidden: document.hidden, kind: document.body.dataset.characterKind, status: document.querySelector('#chat-status, #pet-message')?.textContent, rows: document.querySelector('#chat-log')?.textContent, probe: window.__stabilityProbe })).catch(() => null) });
    await target.screenshot({ path: path.join(output, `${name}-failure.png`), timeout: 5000 }).catch(() => {});
  }
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, elapsedSeconds: elapsed(), cyclesCompleted: actions.length, requests, mixed, mixedActions, source, errors, windows }, null, 2));
  throw error;
} finally {
  closing = true; if (desktop) await desktop.close();
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
}
