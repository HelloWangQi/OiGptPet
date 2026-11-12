import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSmokeVrma } from './vrma-smoke-fixture.mjs';

// Exercise the production startup path with an isolated user profile.
export async function checkDefaultStartup(executablePath, root) {
  const profile = path.join(root, '.cache', `default-startup-${Date.now()}`);
  const env = { ...process.env, OIGPTPET_TEST: '1', OIGPTPET_TEST_DEFAULTS: '1', OIGPTPET_TEST_USER_DATA: profile };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'OIGPTPET_DEV_URL', 'OIGPTPET_SMOKE_DEMO']) delete env[name];
  const model = await readFile(path.join(root, 'artifacts/model-library/VRM/BREAK VENOM.vrm'));
  const expectedId = `vrm:${createHash('sha256').update(model).digest('hex')}`;
  let app;
  async function launch() {
    app = await electron.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: root, env, timeout: 60000 });
    const pet = await app.firstWindow();
    await pet.waitForFunction(() => document.body.dataset.characterKind === 'vrm'
      && !document.querySelector('#pet-dance-clear')?.hidden, null, { timeout: 90000 });
    return pet;
  }
  async function workshop(pet) {
    const next = app.waitForEvent('window');
    await pet.evaluate(() => window.petDesktop.openWorkshop());
    return await next;
  }
  try {
    let pet = await launch();
    assert.equal(await pet.evaluate(() => document.body.dataset.characterId), expectedId);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.isVisible()).length), 1);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isResizable()), false);
    assert.equal(await pet.locator('#pet-dance-style').evaluate(element => element.hidden), true);
    const page = await workshop(pet);
    await page.waitForFunction(() => document.querySelector('#character-name')?.textContent === 'BREAK VENOM', null, { timeout: 90000 });
    assert.equal(await page.locator('#format-badge').innerText(), 'VRM 0.0');
    const selectedDance = createSmokeVrma();
    const selectedHash = createHash('sha256').update(selectedDance).digest('hex');
    const readDanceHash = target => target.evaluate(async () => {
      const bytes = await window.petDesktop.getSelectedDance();
      if (!bytes) return null;
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    });
    await page.locator('#workshop-dance-file').setInputFiles({ name: 'chosen.vrma', mimeType: 'model/gltf-binary', buffer: selectedDance });
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('桌宠正在同步'), null, { timeout: 90000 });
    await pet.waitForFunction(() => document.querySelector('#pet-message')?.textContent.includes('上次导入的舞步.vrma'), null, { timeout: 90000 });
    assert.equal(await readDanceHash(pet), selectedHash, 'Workshop dance must be saved for the pet');
    await page.locator('#workshop-dance-file').setInputFiles({ name: 'bad.vrma', mimeType: 'model/gltf-binary', buffer: Buffer.from('invalid') });
    await page.waitForFunction(() => document.querySelector('#status')?.classList.contains('error'), null, { timeout: 30000 });
    assert.equal(await readDanceHash(pet), selectedHash, 'Invalid replacement must preserve the selected dance');
    await page.locator('#model-file').setInputFiles(path.join(root, 'public/models/demo.vrm'));
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('角色已就绪') && document.querySelector('#format-badge')?.textContent === 'VRM 1.0', null, { timeout: 90000 });
    const chosenId = await page.evaluate(() => document.body.dataset.characterId);
    assert.notEqual(chosenId, expectedId);
    await app.close(); app = undefined;
    pet = await launch();
    assert.equal(await pet.evaluate(() => document.body.dataset.characterId), chosenId, 'Restart should retain a later user-selected model');
    assert.equal(await readDanceHash(pet), selectedHash, 'Restart should retain the selected dance');
    return { launchesAsPet: true, defaultModel: true, defaultVrmaLoaded: true, workshopAvailable: true,
      workshopDanceSync: true, invalidDancePreserved: true, laterChoicePreserved: true, selectedDanceRestored: true };
  } finally { if (app) await app.close(); }
}
