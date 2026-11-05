import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createSmokeVrma } from './vrma-smoke-fixture.mjs';

async function canvasHash(page, output, name) {
  const bytes = await page.locator('#character-canvas').screenshot({ path: path.join(output, `${name}.png`) });
  return createHash('sha256').update(bytes).digest('hex');
}

export async function checkExternalMotion(page, output) {
  await page.locator('#external-motion-panel').waitFor({ state: 'visible' });
  const fixture = createSmokeVrma();
  await page.locator('#external-motion-file').setInputFiles({ name: 'smoke.vrma', mimeType: 'model/gltf-binary', buffer: fixture });
  await page.waitForFunction(() => document.querySelector('#external-motion-status')?.textContent.includes('1 段动作'));
  const select = page.locator('#external-motion-clip');
  assert.equal(await select.locator('option').count(), 1);
  assert.match(await select.inputValue(), /^0$/);
  assert.match(await select.locator('option').first().textContent() ?? '', /升降测试/);

  const frames = new Set();
  for (let index = 0; index < 4; index += 1) {
    frames.add(await canvasHash(page, output, `vrma-preview-${index}`));
    await page.waitForTimeout(180);
  }
  assert.ok(frames.size > 1, 'the imported VRMA clip should animate the current VRM preview');

  await page.locator('#external-motion-file').setInputFiles({ name: 'invalid.vrma', mimeType: 'model/gltf-binary', buffer: Buffer.from('invalid') });
  await page.waitForFunction(() => !document.querySelector('#external-motion-status')?.textContent.includes('正在本机读取'));
  assert.equal(await page.locator('#external-motion-controls').isVisible(), true, 'a rejected replacement should keep the previous clip loaded');
  assert.equal(await select.locator('option').count(), 1);

  await page.locator('#external-motion-toggle').click();
  assert.equal(await page.locator('#external-motion-toggle').innerText(), '继续动作');
  await page.locator('#external-motion-toggle').click();
  assert.equal(await page.locator('#external-motion-toggle').innerText(), '暂停动作');
  await page.locator('#external-motion-clear').click();
  await page.waitForFunction(() => document.querySelector('#external-motion-controls')?.hidden === true);
  return { localVrmaImport: true, animatedPreview: true, rejectedReplacementPreservesCurrent: true, pauseResume: true, clearRestoresBuiltin: true };
}
