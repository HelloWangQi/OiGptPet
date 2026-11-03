import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Keep the original binary chunk and buffers; only remove optional mappings.
function limitedModel(bytes) {
  const length = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8').trim());
  const vrm = doc.extensions.VRMC_vrm;
  vrm.meta.name = '适配检查缺少可选能力';
  delete vrm.humanoid.humanBones.chest; delete vrm.humanoid.humanBones.neck;
  for (const name of ['blink', 'happy', 'sad']) if (vrm.expressions?.preset) delete vrm.expressions.preset[name];
  delete vrm.lookAt;
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
  const result = Buffer.concat([bytes.subarray(0, 20), padded, bytes.subarray(20 + length)]);
  result.writeUInt32LE(result.length, 8); result.writeUInt32LE(padded.length, 12);
  return result;
}

export async function checkMotionCapabilities(desktop, page, root, output) {
  assert.equal(await page.locator('#model-capabilities').isHidden(), true, 'Sprite must not retain VRM capabilities');
  const original = page.locator('.library-select').filter({ hasText: 'VRM' }).first();
  const originalId = await original.getAttribute('data-select-character');
  const spriteId = await page.locator('.library-select').filter({ hasText: '发布包精灵图' }).getAttribute('data-select-character');
  await original.click();
  const ready = identity => page.waitForFunction(target => document.querySelector('#status').textContent.includes('角色已就绪') && !document.querySelector('#import-button').disabled
    && (!target.id || document.body.dataset.characterId === target.id) && (!target.name || document.querySelector('#character-name').textContent === target.name), identity);
  await ready({ id: originalId });
  assert.equal(await page.locator('#model-capabilities').isVisible(), true);
  assert.equal(await page.locator('#motion-capability-rows p').count(), 7);

  async function saveReport(label) {
    await page.locator('#export-profile').selectOption('v1');
    await page.locator('#export-button').click();
    await page.waitForFunction(() => document.querySelector('#local-check-status').textContent === '通过', undefined, { timeout: 120000 });
    const target = path.join(output, label + '-report.json');
    await desktop.evaluate(({ dialog }, filePath) => {
      globalThis.__motionSaveDialog = dialog.showSaveDialog;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, target);
    try {
      await page.locator('#save-report').click();
      await page.waitForFunction(file => document.querySelector('#status').textContent.includes(file), target);
    } finally {
      await desktop.evaluate(({ dialog }) => { dialog.showSaveDialog = globalThis.__motionSaveDialog; delete globalThis.__motionSaveDialog; });
    }
    const report = JSON.parse(await readFile(target, 'utf8'));
    assert.equal(report.modelCapabilities.source, 'loaded-vrm');
    assert.equal(report.modelCapabilities.visualReview, 'not-reviewed');
    assert.equal(report.platformPreflight.status, 'not-run'); assert.equal(report.platformInstallation.status, 'not-run');
    assert.equal(report.localInspection.valid, true);
    await page.locator('#close-export').click();
    return report;
  }
  const baseline = await saveReport('original-capabilities');
  const source = await readFile(path.join(root, 'public/models/demo.vrm'));
  const variant = limitedModel(source);
  const variantPath = path.join(output, 'limited-capabilities.vrm'); await writeFile(variantPath, variant);
  await page.locator('#model-file').setInputFiles(variantPath); await ready({ name: '适配检查缺少可选能力' });
  assert.equal(await page.locator('#character-name').textContent(), '适配检查缺少可选能力');
  assert.equal(await page.locator('#model-capabilities details').evaluate(el => el.open), true);
  assert.equal(await page.locator('#motion-capability-rows [data-warning="true"]').count(), 4);
  assert.match(await page.locator('#motion-capability-rows').textContent(), /缺少胸部、颈部/);
  await page.locator('#model-capabilities').screenshot({ path: path.join(output, 'limited-capabilities.png') });
  const limited = await saveReport('limited-capabilities');
  assert.deepEqual(limited.modelCapabilities.bones.missing, ['chest', 'neck']);
  assert.deepEqual(limited.modelCapabilities.expressions.missing, ['blink', 'happy', 'sad']);
  assert.equal(limited.modelCapabilities.lookAtController, false);
  const before = await page.locator('#motion-capability-rows').textContent();
  await page.locator('#model-file').setInputFiles({ name: 'invalid.vrm', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') });
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('已保留原角色'));
  assert.equal(await page.locator('#motion-capability-rows').textContent(), before);
  await page.locator(`[data-select-character="${spriteId}"]`).click(); await ready({ id: spriteId });
  assert.equal(await page.locator('#model-capabilities').isHidden(), true);
  assert.equal(await page.locator('#motion-capability-rows p').count(), 0);
  await page.locator(`[data-select-character="${originalId}"]`).click(); await ready({ id: originalId });
  // A fresh export after switching back must describe the original model again.
  const restored = await saveReport('restored-capabilities');
  assert.deepEqual(restored.modelCapabilities, baseline.modelCapabilities);
  await page.waitForFunction(() => {
    const value = document.querySelector('#render-performance').dataset;
    return value.kind === 'vrm' && value.fps !== '' && Number(value.fps) > 0;
  }, undefined, { timeout: 15000, polling: 100 });
  return { original: baseline.modelCapabilities, limited: limited.modelCapabilities, restored: true, failedImportPreserved: true, spriteCleared: true, sourceSha256: createHash('sha256').update(source).digest('hex'), variantSha256: createHash('sha256').update(variant).digest('hex') };
}
