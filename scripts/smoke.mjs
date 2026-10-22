import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../artifacts/smoke/', import.meta.url);
await mkdir(output, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.OIGPTPET_DEV_URL;
const desktop = await electron.launch({ args: ['.', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: root, env, timeout: 60000 });
const errors = [];
try {
  const page = await desktop.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#export-button').waitFor();
  await page.waitForFunction(() => !document.querySelector('#export-button').disabled, undefined, { timeout: 60000 });
  assert.match(await page.locator('#character-name').innerText(), /VRM1/);
  for (const state of ['waving', 'jumping', 'running', 'review', 'idle']) await page.locator(`[data-state="${state}"]`).click();
  await page.screenshot({ path: fileURLToPath(new URL('workshop.png', output)) });
  await page.locator('#export-button').click();
  await page.locator('#export-dialog[open]').waitFor({ timeout: 120000 });
  const atlas = await page.evaluate(async () => {
    const img = document.querySelector('#atlas-image');
    await img.decode();
    const bytes = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
    const counts = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];
    let populated = 0; let unused = 0;
    const jumpBottoms = [];
    for (let row = 0; row < 11; row++) for (let col = 0; col < 8; col++) {
      const pixels = context.getImageData(col * 192, row * 208, 192, 208).data;
      let occupied = false; let bottom = -1;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { occupied = true; bottom = Math.floor((i - 3) / 4 / 192); }
      if (col < counts[row] && occupied) populated++;
      if (col >= counts[row] && !occupied) unused++;
      if (row === 4 && col < counts[row]) jumpBottoms.push(bottom);
    }
    return { width: img.naturalWidth, height: img.naturalHeight, bytes: Array.from(bytes), populated, unused, jumpBottoms };
  });
  assert.equal(atlas.width, 1536); assert.equal(atlas.height, 2288);
  assert.equal(atlas.populated, 73); assert.equal(atlas.unused, 15);
  assert.ok(atlas.jumpBottoms[2] < atlas.jumpBottoms[0] - 10, 'jump must leave baseline');
  assert.ok(Math.abs(atlas.jumpBottoms[4] - atlas.jumpBottoms[0]) <= 3, 'jump must land at baseline');
  await writeFile(new URL('atlas-v2.png', output), Buffer.from(atlas.bytes));
  await page.locator('#close-export').click();
  await page.locator('#open-pet').click();
  await desktop.waitForEvent('window', { timeout: 15000 }).catch(() => {});
  const pet = desktop.windows().find((window) => window !== page);
  assert.ok(pet, 'pet window opens');
  await pet.waitForFunction(() => document.querySelector('#pet-message')?.textContent === '', undefined, { timeout: 60000 });
  assert.equal(await pet.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgba(0, 0, 0, 0)', 'pet root is transparent');
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((item) => !item.isResizable()).isAlwaysOnTop()), true);
  await pet.screenshot({ path: fileURLToPath(new URL('desktop-pet.png', output)) });
  await pet.evaluate(() => window.petDesktop.setClickThrough(true));
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isResizable());
    window.setIgnoreMouseEvents(false);
    window.webContents.send('pet:interactive');
  });
  assert.deepEqual(errors, []);
  await writeFile(new URL('result.json', output), JSON.stringify({ ok: true, requiredFrames: atlas.populated, unusedCells: atlas.unused, jumpBottoms: atlas.jumpBottoms, rendererErrors: errors, officialValidation: 'not-run', installedAsChatGPTPet: false }, null, 2));
  console.log('Desktop smoke test passed: model loaded, actions switched, 73-frame export checked, pet window opened.');
} finally { await desktop.close(); }
