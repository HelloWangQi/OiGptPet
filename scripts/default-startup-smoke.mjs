import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSmokeVrma } from './vrma-smoke-fixture.mjs';
import { checkDancingVrmDrag } from './vrm-dance-drag-smoke.mjs';

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
    await app.firstWindow();
    const deadline = Date.now() + 15000;
    let pet;
    while (Date.now() < deadline && !pet) {
      pet = app.windows().find(window => window.url().includes('mode=pet'));
      if (!pet) await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!pet) throw new Error('Pet window was not found');
    await pet.waitForFunction(() => document.body.dataset.characterKind === 'vrm'
      && document.querySelector('#pet-dance-clear')?.hidden === false, null, { timeout: 90000 });
    return pet;
  }
  async function workshop(pet) {
    await pet.evaluate(() => window.petDesktop.openWorkshop());
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const page = app.windows().find(window => window.url().includes('mode=workshop'));
      if (page) return page;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Workshop window was not found');
  }
  try {
    let pet = await launch();
    assert.equal(await pet.evaluate(() => document.body.dataset.characterId), expectedId);
    const states = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ resizable: w.isResizable(), visible: w.isVisible(), minimized: w.isMinimized() })));
    assert.ok(states.some(w => !w.resizable && w.visible && !w.minimized), 'Pet should be visible');
    assert.ok(states.some(w => w.resizable && w.minimized), 'Workshop should start minimized');
    assert.equal(await pet.locator('#pet-dance-style').evaluate(element => element.hidden), true);
    assert.equal(await pet.locator('#pet-dance-toggle').textContent(), '暂停舞步');
    const frameBefore = await pet.locator('#character-canvas').screenshot();
    await pet.waitForTimeout(700);
    const frameAfter = await pet.locator('#character-canvas').screenshot();
    assert.notDeepEqual(frameAfter, frameBefore, 'Default VRMA should animate without waiting for system audio');
    const dancingDrag = await checkDancingVrmDrag(app, pet);
    await pet.locator('#pet-tools-toggle').evaluate(button => button.click());
    await pet.locator('#pet-dance-toggle').click();
    assert.equal(await pet.locator('#pet-dance-toggle').textContent(), '继续舞步');
    await pet.locator('#pet-dance-toggle').click();
    assert.equal(await pet.locator('#pet-dance-toggle').textContent(), '暂停舞步');
    await pet.locator('#pet-tools-toggle').evaluate(button => button.click());
    await pet.evaluate(() => {
      window.__originalCapture = navigator.mediaDevices.getDisplayMedia;
      navigator.mediaDevices.getDisplayMedia = () => new Promise(resolve => { window.__resolveCapture = resolve; });
    });
    await pet.locator('#pet-music-dance').evaluate(button => button.click());
    await pet.waitForFunction(() => document.querySelector('#pet-music-dance')?.getAttribute('aria-busy') === 'true');
    await pet.locator('#pet-music-dance').evaluate(button => button.click());
    await pet.waitForFunction(() => document.querySelector('#pet-music-dance')?.getAttribute('aria-busy') === 'false');
    await pet.evaluate(() => { window.__resolveCapture(new MediaStream()); navigator.mediaDevices.getDisplayMedia = window.__originalCapture; });
    await pet.waitForTimeout(100);
    assert.equal(await pet.locator('#pet-music-dance').getAttribute('aria-pressed'), 'false', 'Late capture must not restart after cancellation');
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
    await page.waitForFunction(() => [...document.querySelectorAll('#dance-library-select option')].some(option => option.textContent === 'chosen.vrma'), null, { timeout: 30000 });
    await page.locator('#dance-library-name').fill('收藏舞步');
    await page.locator('#dance-library-rename').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#dance-library-select option')].some(option => option.textContent === '收藏舞步'), null, { timeout: 30000 });
    const secondDance = Buffer.from(selectedDance);
    secondDance.writeFloatLE(1.5, secondDance.length - 8);
    await page.locator('#workshop-dance-file').setInputFiles({ name: 'another.vrma', mimeType: 'model/gltf-binary', buffer: secondDance });
    await page.waitForFunction(() => [...document.querySelectorAll('#dance-library-select option')].some(option => option.textContent === 'another.vrma'), null, { timeout: 30000 });
    const secondHash = createHash('sha256').update(secondDance).digest('hex');
    assert.equal(await readDanceHash(pet), secondHash);
    await pet.locator('#pet-tools-toggle').evaluate(button => button.click());
    await pet.locator('#pet-dance-library').selectOption({ label: '收藏舞步' });
    await pet.waitForFunction(async expected => {
      const bytes = await window.petDesktop.getSelectedDance();
      if (!bytes) return false;
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') === expected;
    }, selectedHash, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#dance-library-select')?.selectedOptions[0]?.textContent === '收藏舞步', null, { timeout: 30000 });
    await pet.locator('#pet-tools-toggle').evaluate(button => button.click());

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
    const reopened = await workshop(pet);
    await reopened.waitForFunction(() => [...document.querySelectorAll('#dance-library-select option')].some(option => option.textContent === '收藏舞步'), null, { timeout: 30000 });
    return { launchesAsPet: true, workshopStartsMinimized: true, defaultModel: true, defaultVrmaLoaded: true, defaultDancePlaying: true, dancingDrag, dancePauseResume: true, workshopAvailable: true,
      workshopDanceSync: true, invalidDancePreserved: true, laterChoicePreserved: true, selectedDanceRestored: true };
  } finally { if (app) await app.close(); }
}
