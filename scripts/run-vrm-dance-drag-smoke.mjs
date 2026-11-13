import { _electron as electron } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkDancingVrmDrag } from './vrm-dance-drag-smoke.mjs';
const root = process.cwd();
const latest = JSON.parse(await readFile('release/latest.json', 'utf8'));
const env = { ...process.env, OIGPTPET_TEST: '1', OIGPTPET_TEST_DEFAULTS: '1', OIGPTPET_TEST_USER_DATA: path.join(root, '.cache', `vrm-drag-${Date.now()}`) };
for (const name of ['ELECTRON_RUN_AS_NODE', 'OIGPTPET_DEV_URL', 'OIGPTPET_SMOKE_DEMO']) delete env[name];
let app;
try {
  app = await electron.launch({ executablePath: path.join(root, 'release', latest.directory, 'OiGptPet.exe'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], env, cwd: root, timeout: 60000 });
  await app.firstWindow(); let pet;
  for (let i = 0; i < 300 && !pet; i++) { pet = app.windows().find(window => window.url().includes('mode=pet')); if (!pet) await new Promise(resolve => setTimeout(resolve, 50)); }
  if (!pet) throw new Error('未找到桌宠窗口');
  await pet.waitForFunction(() => document.body.dataset.characterKind === 'vrm' && document.querySelector('#pet-dance-clear')?.hidden === false, null, { timeout: 90000 });
  console.log(JSON.stringify(await checkDancingVrmDrag(app, pet)));
} finally { if (app) await app.close(); }
