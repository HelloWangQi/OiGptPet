import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { retainPackages } from '../scripts/package-retention.mjs';

const base = path.resolve('.cache/package-retention-tests');
const created = [];
afterEach(async () => {
  for (const directory of created.splice(0)) {
    if (!directory.startsWith(base + path.sep)) throw new Error('Unsafe test cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'case-')); created.push(root);
  for (let n = 1; n <= 5; n++) {
    const app = path.join(root, `v0.4.0-${n}`, 'OiGptPet-win32-x64');
    await mkdir(path.join(app, 'resources/app'), { recursive: true });
    await writeFile(path.join(app, 'resources/app/package.json'), JSON.stringify({ name: 'oigptpet' }));
    await writeFile(path.join(app, 'OiGptPet.exe'), 'test package');
  }
  return root;
}
describe('local EXE package retention', () => {
  it('previews by default and deletes only the oldest recognized packages when applied', async () => {
    const root = await fixture(); await mkdir(path.join(root, 'user-data'));
    await mkdir(path.join(root, 'v0.4.0-999')); // Incomplete or unknown output is not a verified package.
    expect((await retainPackages(root)).removed).toEqual(['v0.4.0-2', 'v0.4.0-1']);
    expect(await readdir(root)).toHaveLength(7);
    const result = await retainPackages(root, { apply: true });
    expect(result.kept).toEqual(['v0.4.0-5', 'v0.4.0-4', 'v0.4.0-3']);
    expect(await readdir(root)).toEqual(expect.arrayContaining(['user-data', 'v0.4.0-999']));
    expect((await retainPackages(root, { apply: true })).removed).toEqual([]);
  });
  it('protects the current package even if the pointer is older than other builds', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'latest.json'), JSON.stringify({ directory: 'v0.4.0-1/OiGptPet-win32-x64' }));
    expect((await retainPackages(root, { apply: true })).kept).toEqual(['v0.4.0-1', 'v0.4.0-5', 'v0.4.0-4']);
    expect(JSON.parse(await readFile(path.join(root, 'latest.json'), 'utf8')).directory).toContain('v0.4.0-1');
  });
  it('defers an occupied old executable without removing its files', async () => {
    const root = await fixture();
    const result = await retainPackages(root, { apply: true, isInUse: async app => app.includes('v0.4.0-2') });
    expect(result.deferred).toEqual(['v0.4.0-2']);
    expect(result.removed).toEqual(['v0.4.0-1']);
    expect(await readFile(path.join(root, 'v0.4.0-2', 'OiGptPet-win32-x64', 'OiGptPet.exe'), 'utf8')).toBe('test package');
  });
  it('refuses deletion when the latest pointer is corrupt', async () => {
    const root = await fixture(); await writeFile(path.join(root, 'latest.json'), '{broken');
    await expect(retainPackages(root, { apply: true })).rejects.toThrow();
    expect(await readdir(root)).toHaveLength(6);
  });
  it('rejects a junction inside a deletion target before deleting any package', async () => {
    const root = await fixture();
    await symlink(path.join(root, 'v0.4.0-5'), path.join(root, 'v0.4.0-1', 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(retainPackages(root, { apply: true })).rejects.toThrow('refuses links');
    expect(await readdir(root)).toHaveLength(5);
  });
});
