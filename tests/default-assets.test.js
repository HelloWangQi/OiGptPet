import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { checkDefaultAssets, DEFAULT_ASSETS } from '../scripts/default-assets.mjs';

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() { const root = await mkdtemp(path.join(os.tmpdir(), 'pet-defaults-')); roots.push(root); return root; }
async function put(root, source, content) { const file = path.join(root, source); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); }
function glb() { const bytes = Buffer.alloc(28); bytes.write('glTF'); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8); return bytes; }
describe('default asset preflight', () => {
  it('reports both missing paths in one pass', async () => {
    const root = await fixture();
    await expect(checkDefaultAssets(root)).rejects.toThrow(/BREAK VENOM\.vrm[\s\S]*不是恶魔\.vrma/);
  });
  it('rejects truncated files and accepts complete GLB headers', async () => {
    const root = await fixture();
    await put(root, DEFAULT_ASSETS[0].source, glb());
    const truncated = glb(); truncated.writeUInt32LE(100, 8);
    await put(root, DEFAULT_ASSETS[1].source, truncated);
    await expect(checkDefaultAssets(root)).rejects.toThrow('GLB 文件头或文件大小无效');
    await put(root, DEFAULT_ASSETS[1].source, glb());
    await expect(checkDefaultAssets(root)).resolves.toBeUndefined();
  });
});
