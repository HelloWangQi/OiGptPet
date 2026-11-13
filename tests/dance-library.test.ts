import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createDanceLibrary } = createRequire(import.meta.url)('../electron/dance-library.cjs');

describe('persistent dance library', () => {
  it('preserves copied dances, prevents duplicates, renames and removes without touching source', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pet-dance-'));
    try {
      const source = path.join(root, 'source.vrma');
      const bytes = Buffer.alloc(32); bytes.write('glTF'); bytes[12] = 1;
      await writeFile(source, bytes);
      const library = createDanceLibrary(path.join(root, 'library'));
      const first = await library.add(bytes, '原舞步');
      expect((await library.add(bytes, '重复')).id).toBe(first.id);
      await library.rename(first.id, '新名字');
      const reopened = createDanceLibrary(path.join(root, 'library'));
      expect(await reopened.list()).toMatchObject([{ name: '新名字' }]);
      expect(await reopened.get(first.id)).toEqual(bytes);
      await reopened.remove(first.id);
      expect(await reopened.list()).toEqual([]);
      expect(await readFile(source)).toEqual(bytes);
      await expect(reopened.get('../source')).rejects.toThrow();
      await expect(reopened.add(Buffer.from('bad'), '无效')).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
