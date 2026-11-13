import { _electron as electron } from '@playwright/test';
import { createSmokeVrma } from './vrma-smoke-fixture.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
const exe = path.join(root, 'release', JSON.parse(await (await import('node:fs/promises')).readFile('release/latest.json','utf8')).directory, 'OiGptPet.exe');
const profile = path.join(root, '.cache', `migration-smoke-${Date.now()}`);
await mkdir(profile, { recursive: true });
await writeFile(path.join(profile, 'selected-dance.vrma'), createSmokeVrma());
const env = { ...process.env, OIGPTPET_TEST: '1', OIGPTPET_TEST_DEFAULTS: '1', OIGPTPET_TEST_USER_DATA: profile };
for (const name of ['ELECTRON_RUN_AS_NODE', 'OIGPTPET_DEV_URL', 'OIGPTPET_SMOKE_DEMO']) delete env[name];
let app;
try {
  app = await electron.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: root, env, timeout: 60000 });
  await app.firstWindow();
  let workshop;
  for (let i = 0; i < 300 && !workshop; i++) { workshop = app.windows().find(w => w.url().includes('mode=workshop')); if (!workshop) await new Promise(r => setTimeout(r, 50)); }
  assert.ok(workshop);
  await workshop.waitForFunction(() => !!window.petDesktop);
  const list = await workshop.evaluate(() => window.petDesktop.listDances());
  assert.equal(list.length, 1); assert.equal(list[0].name, '此前选择的舞步');
  await workshop.evaluate(id => window.petDesktop.removeDance(id), list[0].id);
  assert.equal((await workshop.evaluate(() => window.petDesktop.listDances())).length, 0);
  await app.close(); app = undefined;
  app = await electron.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], cwd: root, env, timeout: 60000 });
  await app.firstWindow();
  for (let i = 0; i < 300; i++) { workshop = app.windows().find(w => w.url().includes('mode=workshop')); if (workshop) break; await new Promise(r => setTimeout(r, 50)); }
  await workshop.waitForFunction(() => !!window.petDesktop);
  assert.equal((await workshop.evaluate(() => window.petDesktop.listDances())).length, 0);
  assert.ok(await workshop.evaluate(() => window.petDesktop.getSelectedDance()));
  console.log('Legacy migration, removal and restart checks passed');
} finally { if (app) await app.close(); }
