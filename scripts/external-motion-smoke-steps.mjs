import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSmokeVrma } from './vrma-smoke-fixture.mjs';

async function canvasHash(page, output, name) {
  const bytes = await page.locator('#character-canvas').screenshot({ path: path.join(output, `${name}.png`) });
  return createHash('sha256').update(bytes).digest('hex');
}

async function enterExactTime(input, seconds) {
  await input.fill(String(seconds));
  await input.press('Tab');
}

async function captureExportedAtlasRows(page, saveBaseline = false) {
  return page.evaluate(async (saveBaseline) => {
    const image = document.querySelector('#atlas-image');
    if (!image.complete || image.naturalWidth !== 1536) throw new Error('Exported PNG preview did not decode at the expected width');
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not decode exported atlas pixels');
    context.drawImage(image, 0, 0);
    const rows = [];
    const baselineRows = window.__vrmaBaselineAtlasRows;
    const differences = [];
    const currentRows = [];
    for (let row = 0; row < image.naturalHeight / 208; row += 1) {
      const pixels = context.getImageData(0, row * 208, image.naturalWidth, 208).data;
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      rows.push(Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''));
      const current = Uint8Array.from(pixels);
      currentRows.push(current);
      if (baselineRows) {
        let changedPixels = 0; let maxChannelDifference = 0;
        for (let offset = 0; offset < current.length; offset += 4) {
          let pixelChanged = false;
          for (let channel = 0; channel < 4; channel += 1) {
            const difference = Math.abs(current[offset + channel] - baselineRows[row][offset + channel]);
            if (difference > 0) pixelChanged = true;
            maxChannelDifference = Math.max(maxChannelDifference, difference);
          }
          if (pixelChanged) changedPixels += 1;
        }
        differences.push({ changedPixels, maxChannelDifference });
      }
    }
    if (saveBaseline) window.__vrmaBaselineAtlasRows = currentRows;
    return { width: image.naturalWidth, height: image.naturalHeight, rows, differences };
  }, saveBaseline);
}

async function exportAndSave(page, desktop, output, name) {
  await page.locator('#export-profile').selectOption('v1');
  await page.locator('#export-button').click();
  await page.waitForFunction(() => document.querySelector('#local-check-status')?.textContent === '通过', undefined, { timeout: 120000 });
  await page.waitForFunction(() => {
    const image = document.querySelector('#atlas-image');
    return image?.complete && image.naturalWidth === 1536 && image.naturalHeight === 1872;
  });
  const atlasRows = await captureExportedAtlasRows(page, name === 'vrma-baseline');
  const imagePath = path.join(output, `${name}.png`);
  const reportPath = path.join(output, `${name}-report.json`);
  await desktop.evaluate(({ dialog }, [imageFile, reportFile]) => {
    globalThis.__vrmaExportSaveDialog = dialog.showSaveDialog;
    const paths = [imageFile, reportFile];
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.shift() });
  }, [imagePath, reportPath]);
  try {
    await page.locator('#save-atlas').click();
    await page.waitForFunction(file => document.querySelector('#status')?.textContent.includes(file), imagePath);
    await page.locator('#save-report').click();
    await page.waitForFunction(file => document.querySelector('#status')?.textContent.includes(file), reportPath);
  } finally {
    await desktop.evaluate(({ dialog }) => { dialog.showSaveDialog = globalThis.__vrmaExportSaveDialog; delete globalThis.__vrmaExportSaveDialog; });
  }
  const png = await readFile(imagePath);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${name} must be an actual PNG`);
  assert.equal(png.readUInt32BE(16), 1536);
  assert.equal(png.readUInt32BE(20), 1872);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.file.sha256, createHash('sha256').update(png).digest('hex'));
  assert.equal(report.file.encodedBytes, png.length);
  assert.equal(report.localInspection.valid, true);
  await page.locator('#close-export').click();
  await page.locator('#export-dialog').waitFor({ state: 'hidden' });
  return { atlasRows, report };
}

export async function checkExternalMotion(page, output, desktop, root) {
  await page.locator('#external-motion-panel').waitFor({ state: 'visible' });
  const builtInAtlas = await exportAndSave(page, desktop, output, 'vrma-baseline');
  assert.equal(builtInAtlas.report.externalAnimation, undefined, 'the built-in baseline should not claim a VRMA replacement');
  const fixture = createSmokeVrma();
  await page.locator('#external-motion-file').setInputFiles({ name: 'smoke.vrma', mimeType: 'model/gltf-binary', buffer: fixture });
  await page.waitForFunction(() => document.querySelector('#external-motion-status')?.textContent.includes('2 段动作'));
  const select = page.locator('#external-motion-clip');
  assert.equal(await select.locator('option').count(), 2);
  assert.match(await select.inputValue(), /^0$/);
  assert.match(await select.locator('option').first().textContent() ?? '', /升降测试/);
  await select.selectOption('1');
  assert.match(await select.locator('option:checked').textContent() ?? '', /副本/);
  await select.selectOption('0');

  const exactTime = page.locator('#external-motion-exact-time');
  await exactTime.focus();
  await page.evaluate(() => { document.querySelector('#external-motion-exact-time').value = '0.42'; });
  await page.waitForTimeout(250);
  assert.equal(await exactTime.inputValue(), '0.42', 'the playback head should not overwrite a focused time edit');
  await enterExactTime(exactTime, 0.25);

  await page.locator('#external-motion-speed').selectOption('0.5');
  await select.selectOption('1');
  assert.equal(await page.locator('#external-motion-speed').inputValue(), '0.5', 'clip switching should preserve preview speed');
  await enterExactTime(exactTime, 0);
  await page.locator('#external-motion-toggle').click();
  await page.waitForFunction(() => Number(document.querySelector('#external-motion-time')?.value) >= 100, undefined, { timeout: 5000, polling: 50 });
  await page.waitForTimeout(250);
  const halfSpeedTime = Number(await page.locator('#external-motion-time').inputValue());
  await page.locator('#external-motion-toggle').click();
  await page.locator('#external-motion-speed').selectOption('2');
  await enterExactTime(exactTime, 0);
  await page.locator('#external-motion-toggle').click();
  await page.waitForFunction(() => Number(document.querySelector('#external-motion-time')?.value) >= 100, undefined, { timeout: 5000, polling: 50 });
  await page.waitForTimeout(250);
  const doubleSpeedTime = Number(await page.locator('#external-motion-time').inputValue());
  await page.locator('#external-motion-toggle').click();
  assert.ok(halfSpeedTime >= 50, `0.5× playback should advance; got ${halfSpeedTime} ms`);
  assert.ok(doubleSpeedTime > halfSpeedTime * 1.7, `2× playback should advance faster (${halfSpeedTime} ms vs ${doubleSpeedTime} ms)`);
  await page.locator('#external-motion-speed').selectOption('0.5');
  await select.selectOption('0');
  await page.locator('#external-motion-speed').selectOption('1');

  await page.locator('#external-motion-loop').selectOption('pingpong');
  await select.selectOption('0');
  await enterExactTime(exactTime, 0.25);
  await page.locator('#external-motion-toggle').click();
  await page.waitForFunction(() => Number(document.querySelector('#external-motion-time')?.value) > 800);
  await page.waitForFunction(() => Number(document.querySelector('#external-motion-time')?.value) < 250, undefined, { timeout: 5000 });
  await enterExactTime(exactTime, 0.25);
  assert.ok(Number(await exactTime.inputValue()) < 0.26, 'seek during the reverse ping-pong leg should display the requested pose time');
  const sliderAfterReverseSeek = Number(await page.locator('#external-motion-time').inputValue());
  assert.ok(sliderAfterReverseSeek >= 240 && sliderAfterReverseSeek <= 260, `reverse-leg seek should move the timeline to 250 ms; got ${sliderAfterReverseSeek} ms`);
  const reverseLabel = await page.locator('#external-motion-time-label').innerText();
  assert.ok(Math.abs(Number(reverseLabel.match(/^([0-9.]+)/)?.[1]) - 0.25) <= 0.05, `visible time label should reflect the reverse-leg pose time: ${reverseLabel}`);
  await page.locator('#external-motion-loop').selectOption('repeat');
  assert.equal(await exactTime.inputValue(), '0.25', 'switching away from the reverse leg should preserve the visible pose');
  await page.locator('#external-motion-loop').selectOption('pingpong');
  assert.equal(await exactTime.inputValue(), '0.25', 'switching back to ping-pong should preserve the visible pose');
  await page.locator('#external-motion-toggle').click();

  const rowFrames = { waving: 4, jumping: 5, idle: 6, failed: 8 };
  for (const [state, count] of Object.entries(rowFrames)) {
    await page.locator('#external-motion-export-state').selectOption(state);
    const frames = page.locator('#external-motion-sample-frame');
    assert.equal(await frames.locator('option').count(), count, `${state} row should expose its export frame count`);
    for (let frame = 0; frame < count; frame += 1) {
      await frames.selectOption(String(frame));
      const optionText = await frames.locator('option:checked').textContent() ?? '';
      const displayedSeconds = Number(optionText.match(/· ([0-9.]+) 秒/)?.[1]);
      const expectedSeconds = frame / count;
      assert.equal(displayedSeconds, Number(expectedSeconds.toFixed(2)), `${state} sample ${frame} must match duration × frame / frame count`);
      await page.locator('#external-motion-sample-jump').click();
      assert.equal(Number(await page.locator('#external-motion-exact-time').inputValue()), Number(expectedSeconds.toFixed(2)));
      const slider = Number(await page.locator('#external-motion-time').inputValue());
      assert.ok(slider >= Math.round(expectedSeconds * 1000) - 10 && slider <= Math.round(expectedSeconds * 1000) + 10);
    }
  }
  await page.locator('#external-motion-export-state').selectOption('waving');
  const replacedAtlas = await exportAndSave(page, desktop, output, 'vrma-waving-export');
  assert.deepEqual(replacedAtlas.report.externalAnimation, {
    state: 'waving', label: '挥手', clipName: '升降测试', duration: 1,
    sourceSha256: createHash('sha256').update(fixture).digest('hex'),
  });
  const replacedRow = 3; // idle, running-right, running-left, waving
  for (let row = 0; row < builtInAtlas.atlasRows.rows.length; row += 1) {
    const difference = replacedAtlas.atlasRows.differences[row];
    if (row === replacedRow) assert.ok(difference.changedPixels > 1000, 'the chosen export row should visibly render the VRMA');
    else assert.ok(difference.changedPixels <= 16, `non-target row ${row} should remain visually unchanged; ${difference.changedPixels} pixels differ`);
  }
  await page.locator('#external-motion-export-state').selectOption('');

  await page.locator('#external-motion-loop').selectOption('once');
  await select.selectOption('0');
  await enterExactTime(exactTime, 0.95);
  await page.locator('#external-motion-toggle').click();
  await page.waitForFunction(() => document.querySelector('#external-motion-toggle')?.textContent === '继续动作', undefined, { timeout: 5000 });
  await page.locator('#external-motion-toggle').click();
  assert.equal(await page.locator('#external-motion-toggle').innerText(), '暂停动作', 'continuing a completed one-shot should restart it');
  await page.locator('#external-motion-loop').selectOption('repeat');

  const frames = new Set();
  for (let index = 0; index < 4; index += 1) {
    frames.add(await canvasHash(page, output, `vrma-preview-${index}`));
    await page.waitForTimeout(180);
  }
  assert.ok(frames.size > 1, 'the imported VRMA clip should animate the current VRM preview');

  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    Object.defineProperty(File.prototype, 'arrayBuffer', { configurable: true, value: function (...args) {
      if (this.name !== 'invalid.vrma') return original.apply(this, args);
      return new Promise(resolve => { window.__releaseInvalidVrma = async () => resolve(await original.apply(this, args)); });
    } });
    window.__restoreInvalidVrma = () => Object.defineProperty(File.prototype, 'arrayBuffer', { configurable: true, value: original });
  });
  await page.locator('#external-motion-file').setInputFiles({ name: 'invalid.vrma', mimeType: 'model/gltf-binary', buffer: Buffer.from('invalid') });
  await page.waitForFunction(() => document.querySelector('#external-motion-status')?.textContent.includes('正在本机读取'));
  await page.evaluate(() => window.__releaseInvalidVrma());
  await page.waitForFunction(() => !document.querySelector('#external-motion-status')?.textContent.includes('正在本机读取'));
  assert.equal(await page.locator('#external-motion-controls').isVisible(), true, 'a rejected replacement should keep the previous clip loaded');
  assert.equal(await select.locator('option').count(), 2);
  await page.evaluate(() => window.__restoreInvalidVrma());

  await page.locator('#external-motion-toggle').click();
  assert.equal(await page.locator('#external-motion-toggle').innerText(), '继续动作');
  await page.locator('#external-motion-toggle').click();
  assert.equal(await page.locator('#external-motion-toggle').innerText(), '暂停动作');
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    Object.defineProperty(File.prototype, 'arrayBuffer', { configurable: true, value: function (...args) {
      if (!['pending.vrma', 'pending-model-change.vrma'].includes(this.name)) return original.apply(this, args);
      return new Promise(resolve => { window.__releasePendingVrma = async () => resolve(await original.apply(this, args)); });
    } });
    window.__restoreFileArrayBuffer = () => Object.defineProperty(File.prototype, 'arrayBuffer', { configurable: true, value: original });
  });
  await page.locator('#external-motion-file').setInputFiles({ name: 'pending.vrma', mimeType: 'model/gltf-binary', buffer: fixture });
  await page.waitForFunction(() => document.querySelector('#external-motion-status')?.textContent.includes('正在本机读取'));
  await page.locator('#external-motion-clear').click();
  await page.evaluate(() => window.__releasePendingVrma());
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#external-motion-controls').isVisible(), false, 'clearing during file read should prevent stale motion from appearing');
  assert.match(await page.locator('#external-motion-status').innerText(), /已恢复内置动作/);

  await page.locator('#external-motion-file').setInputFiles({ name: 'smoke-again.vrma', mimeType: 'model/gltf-binary', buffer: fixture });
  await page.waitForFunction(() => document.querySelector('#external-motion-controls')?.hidden === false);
  await page.locator('#external-motion-file').setInputFiles({ name: 'pending-model-change.vrma', mimeType: 'model/gltf-binary', buffer: fixture });
  await page.waitForFunction(() => document.querySelector('#external-motion-status')?.textContent.includes('正在本机读取'));
  await page.locator('#model-file').setInputFiles(path.join(root, 'public/models/demo.vrm'));
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('角色已就绪')
    && !document.querySelector('#import-button')?.disabled && document.querySelector('#external-motion-controls')?.hidden === true, undefined, { timeout: 60000 });
  await page.evaluate(() => window.__releasePendingVrma());
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#external-motion-controls').isVisible(), false, 'changing the VRM during file read should prevent stale motion from appearing');
  await page.evaluate(() => window.__restoreFileArrayBuffer());
  return { localVrmaImport: true, animatedPreview: true, multiClipSwitching: true, speedAndLoopControls: true, reversePingPongSeek: true, exactTimeEditProtection: true, atlasSampleFrameSeek: true, actualPngAndReport: true, selectedRowChangedOnly: true, oneShotRestart: true, rejectedReplacementPreservesCurrent: true, clearRestoresBuiltin: true, staleImportCancelledOnClear: true, staleImportCancelledOnCharacterChange: true };
}
