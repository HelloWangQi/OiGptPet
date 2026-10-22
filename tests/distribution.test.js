import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { assertClientDistribution } from '../scripts/distribution.mjs';

const created = [];
afterEach(async () => {
  const base = path.resolve('.cache/distribution-tests');
  for (const folder of created.splice(0)) {
    if (!path.resolve(folder).startsWith(`${base}${path.sep}`)) throw new Error('Unsafe test cleanup target');
    await rm(folder, { recursive: true, force: true });
  }
});
async function fixture() {
  const base = path.resolve('.cache/distribution-tests');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'case-'));
  created.push(root);
  await mkdir(path.join(root, 'assets'));
  await writeFile(path.join(root, 'index.html'), '<html></html>');
  await writeFile(path.join(root, 'assets', 'main-hash.js'), 'export {};');
  return root;
}
describe('release file boundary', () => {
  it('accepts compiled application assets', async () => expect(await assertClientDistribution(await fixture())).toHaveLength(2));
  it.each(['demo.vrm', 'DEMO.VRM', 'demo-source.json', 'atlas.png', 'current.vrm'])('rejects accidental asset %s', async (name) => {
    const root = await fixture();
    await writeFile(path.join(root, 'assets', name), 'not distributed');
    await expect(assertClientDistribution(root)).rejects.toThrow('Unexpected');
  });
  it('rejects a copied user profile even without a model', async () => {
    const root = await fixture();
    await mkdir(path.join(root, 'user-data'));
    await writeFile(path.join(root, 'user-data', 'window-state.json'), '{}');
    await expect(assertClientDistribution(root)).rejects.toThrow('Unexpected');
  });
});
