import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const environment = { ...process.env, OIGPTPET_DEV_URL: 'http://127.0.0.1:5173' };
delete environment.ELECTRON_RUN_AS_NODE;
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { cwd: root, stdio: 'inherit', windowsHide: true });
let desktop;
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  desktop?.kill(); vite.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
vite.on('error', (error) => { console.error(error); stop(1); });
vite.on('exit', (code) => { if (!stopping) stop(code ?? 1); });
try {
  let ready = false;
  for (let i = 0; i < 80 && !stopping; i++) {
    try { if ((await fetch(environment.OIGPTPET_DEV_URL)).ok) { ready = true; break; } } catch { /* Server starting. */ }
    await setTimeout(250);
  }
  if (!ready) throw new Error('Vite did not start on port 5173.');
  desktop = spawn(require('electron'), ['.'], { cwd: root, stdio: 'inherit', env: environment, windowsHide: true });
  desktop.on('error', (error) => { console.error(error); stop(1); });
  desktop.on('exit', (code) => stop(code ?? 0));
} catch (error) { console.error(error); stop(1); }
