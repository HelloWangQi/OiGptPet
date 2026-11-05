import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function checkRenderMonitor(desktop, page, pet, output) {
  await page.evaluate(() => window.petDesktop.openWorkshop());
  await page.evaluate(() => window.petDesktop.openPet());
  await pet.waitForFunction(() => !document.hidden, undefined, { polling: 100 });
  async function waitSample(activity, target) {
    await page.waitForFunction(([activity, target]) => {
      const sample = document.querySelector('#render-performance').dataset;
      return sample.kind === 'sprite' && sample.activity === activity && Number(sample.targetFps) === target && sample.fps !== '' && Number(sample.fps) > 0;
    }, [activity, target], { timeout: 20000, polling: 100 });
    const result = await page.locator('#render-performance').evaluate(el => ({ text: el.textContent, ...el.dataset }));
    assert.ok(Number(result.fps) <= target + 3, 'Measured draw cadence exceeds configured cap');
    return result;
  }
  async function diagnostic(label) {
    const file = path.join(output, label + '.json');
    await desktop.evaluate(({ dialog }, filePath) => {
      globalThis.__renderSaveDialog = dialog.showSaveDialog;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, file);
    try { assert.equal(await page.evaluate(() => window.petDesktop.saveDiagnostics()), true); }
    finally { await desktop.evaluate(({ dialog }) => { dialog.showSaveDialog = globalThis.__renderSaveDialog; delete globalThis.__renderSaveDialog; }); }
    return JSON.parse(await readFile(file, 'utf8'));
  }
  async function diagnosticWhen(label, accepts, requireBothVisible = false) {
    // Each window reports independently. A native show intentionally clears its
    // previous sample, so the workshop's ready HUD does not imply the pet is ready.
    for (let i = 0; i < 24; i++) {
      const report = await diagnostic(label);
      if (accepts(report)) return report;
      if (requireBothVisible) {
        if (!report.windows.find(win => win.role === 'workshop').visible) await page.evaluate(() => window.petDesktop.openWorkshop());
        if (!report.windows.find(win => win.role === 'pet').visible) await page.evaluate(() => window.petDesktop.openPet());
      }
      await page.waitForTimeout(250);
    }
    throw new Error('Fresh per-window render samples did not arrive');
  }
  await assert.rejects(page.evaluate(() => window.petDesktop.reportRenderSample({ kind: 'malformed' })), /Invalid render sample/);
  await page.locator('#wave-button').click();
  const battery = await waitSample('active', 15);
  const first = await diagnosticWhen('render-battery', report => report.windows.every(win => win.rendering?.status === 'available' && win.rendering.sample.durationSamples > 0), true);
  assert.equal(first.windows.find(win => win.role === 'workshop').rendering.status, 'available');
  assert.equal(first.windows.find(win => win.role === 'pet').rendering.status, 'available');
  for (const win of first.windows) {
    const data = win.rendering.sample;
    assert.equal(data.kind, 'sprite'); assert.equal(data.mode, 'battery');
    assert.ok(data.durationSamples > 0); assert.ok(data.meanRenderMs >= 0); assert.ok(data.p95RenderMs >= 0);
    assert.ok(win.rendering.ageMs <= 10000);
  }
  await page.locator('#performance-mode').selectOption('quality');
  // selectOption changes the setting without the pointer/key event a user
  // generates, so explicitly interact before expecting the active cadence.
  await page.evaluate(() => window.petDesktop.openWorkshop());
  await page.locator('#wave-button').click();
  const quality = await waitSample('active', 60);
  await page.locator('#performance-mode').selectOption('battery');
  await page.locator('#wave-button').click();
  await waitSample('active', 15);
  // Leave the interaction area and wait beyond the product's 10-second idle threshold.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(12000);
  const idle = await waitSample('idle', 5);
  const idleDiagnostic = await diagnostic('render-idle');
  const idleWindow = idleDiagnostic.windows.find(win => win.role === 'workshop');
  if (idleWindow.visible) assert.equal(idleWindow.rendering.sample?.activity, 'idle');
  else assert.deepEqual(idleWindow.rendering, { status: 'hidden', sample: null });
  await page.locator('#render-performance').screenshot({ path: path.join(output, 'render-monitor.png') });
  await pet.evaluate(() => {
    const context = document.querySelector('#character-canvas').getContext('2d');
    globalThis.__monitorDraws = 0; const draw = context.drawImage;
    globalThis.__monitorRestore = () => { context.drawImage = draw; };
    context.drawImage = function (...args) { globalThis.__monitorDraws++; return draw.apply(this, args); };
  });
  await pet.evaluate(() => window.petDesktop.hidePet());
  assert.equal(await pet.evaluate(() => window.petDesktop.getWindowVisibility()), false);
  await page.waitForTimeout(300);
  const draws = await pet.evaluate(() => globalThis.__monitorDraws);
  await page.waitForTimeout(700);
  assert.equal(await pet.evaluate(() => globalThis.__monitorDraws), draws, 'Native hidden pet must stop drawing even when Page Visibility is emulated');
  const hidden = await diagnostic('render-hidden');
  const hiddenPet = hidden.windows.find(win => win.role === 'pet');
  assert.equal(hiddenPet.visible, false); assert.deepEqual(hiddenPet.rendering, { status: 'hidden', sample: null });
  await page.evaluate(() => window.petDesktop.openPet());
  assert.equal(await pet.evaluate(() => window.petDesktop.getWindowVisibility()), true);
  // Wait for a new post-show sample; native show invalidates the old record.
  const resumed = await diagnosticWhen('render-resumed', report => {
    const value = report.windows.find(win => win.role === 'pet').rendering;
    return value.status === 'available' && value.sample.activity === 'active' && value.sample.fps > 0;
  });
  const resumedPet = resumed.windows.find(win => win.role === 'pet');
  assert.equal(resumedPet.visible, true); assert.equal(resumedPet.rendering.status, 'available');
  assert.equal(resumedPet.rendering.sample.activity, 'active');
  assert.ok(resumedPet.rendering.sample.fps > 0);
  assert.ok(await pet.evaluate(() => globalThis.__monitorDraws) > draws);
  await pet.evaluate(() => { globalThis.__monitorRestore(); delete globalThis.__monitorRestore; delete globalThis.__monitorDraws; });
  return { battery, quality, idle, perWindow: true, hiddenOmittedOldSample: true, resumedFresh: true, renderer: 'requested SwiftShader test environment; not hardware FPS/energy acceptance' };
}
