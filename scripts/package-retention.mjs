import { lstat, open, readdir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function assertTreeInside(directory, root) {
  const resolved = await realpath(directory);
  if (!resolved.startsWith(root + path.sep) || (await lstat(directory)).isSymbolicLink()) throw new Error('Unsafe package cleanup path');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Package cleanup refuses links');
    if (entry.isDirectory()) await assertTreeInside(path.join(directory, entry.name), root);
  }
}

// Only recognized OiGptPet distribution directories are eligible, never arbitrary folders.
async function executableIsInUse(app) {
  try {
    const handle = await open(path.join(app, 'OiGptPet.exe'), 'r+');
    await handle.close();
    return false;
  } catch (error) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) return true;
    throw error;
  }
}

export async function retainPackages(directory, { apply = false, isInUse = executableIsInUse } = {}) {
  const root = path.resolve(directory);
  if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw new Error('Release root must be a real directory');
  const candidates = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const match = /^(?:historical-)?v\d+\.\d+\.\d+-(\d+)$/.exec(entry.name);
    if (!match && entry.name !== 'OiGptPet-win32-x64') continue;
    const folder = path.join(root, entry.name);
    const app = match ? path.join(folder, 'OiGptPet-win32-x64') : folder;
    try {
      const metadata = JSON.parse(await readFile(path.join(app, 'resources/app/package.json'), 'utf8'));
      if (metadata.name !== 'oigptpet' || !(await lstat(path.join(app, 'OiGptPet.exe'))).isFile()) continue;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) continue;
      throw error;
    }
    candidates.push({ name: entry.name, folder, app, time: match ? Number(match[1]) : (await lstat(folder)).mtimeMs });
  }
  candidates.sort((a, b) => b.time - a.time || a.name.localeCompare(b.name));
  let current;
  try {
    const latest = JSON.parse(await readFile(path.join(root, 'latest.json'), 'utf8'));
    current = candidates.find(item => item.name === latest.directory?.replaceAll('\\', '/').split('/')[0]);
  } catch (error) {
    // An invalid pointer must not trigger deletion of an otherwise needed package.
    if (error.code !== 'ENOENT') throw error;
  }
  const keep = new Set();
  if (current) keep.add(current);
  for (const item of candidates) if (keep.size < 3) keep.add(item);
  const removed = candidates.filter(item => !keep.has(item));
  // Validate all deletion targets before the first removal; rm never crosses a link.
  for (const item of removed) await assertTreeInside(item.folder, root);
  const deleted = []; const deferred = [];
  if (apply) for (const item of removed) {
    if (await isInUse(item.app)) { deferred.push(item.name); continue; }
    try { await rm(item.folder, { recursive: true, force: false }); deleted.push(item.name); }
    catch (error) { if (error.code === 'EBUSY') deferred.push(item.name); else throw error; }
  }
  return { applied: apply, kept: [...keep].map(item => item.name), removed: apply ? deleted : removed.map(item => item.name), deferred };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../release/', import.meta.url));
  console.log(JSON.stringify(await retainPackages(root, { apply: process.argv.includes('--apply') }), null, 2));
}
