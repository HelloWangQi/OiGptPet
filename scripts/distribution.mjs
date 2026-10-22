import { readdir } from 'node:fs/promises';
import path from 'node:path';

async function files(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Distribution cannot contain links: ${relative}`);
    if (entry.isDirectory()) result.push(...await files(root, relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`Unsupported distribution entry: ${relative}`);
  }
  return result;
}

export async function assertClientDistribution(root) {
  const entries = await files(root);
  if (!entries.includes('index.html')) throw new Error('Missing built index.html');
  for (const name of entries) {
    if (name === 'index.html' || /^assets\/[^/]+\.(?:js|css)$/.test(name)) continue;
    throw new Error(`Unexpected client distribution file: ${name}. Models and local exports are not distributed.`);
  }
  return entries;
}

export async function assertAppDistribution(root) {
  const entries = await files(root);
  for (const name of entries) {
    if (['package.json', 'THIRD_PARTY_MODEL_NOTICE.md'].includes(name)) continue;
    if (/^electron\/[^/]+\.cjs$/.test(name) || name.startsWith('dist/')) continue;
    throw new Error(`Unexpected app distribution file: ${name}`);
  }
  await assertClientDistribution(path.join(root, 'dist'));
  return entries;
}
