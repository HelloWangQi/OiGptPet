import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_PREFERENCES as frontendDefaults, normalizePreferences as normalizeFrontend } from '../src/desktop-preferences.ts';

const { DEFAULT_PREFERENCES, normalizePreferences, createPreferencesStore } = createRequire(import.meta.url)('../electron/preferences.cjs');
const base = path.resolve('.cache/preferences-tests');
const created = [];
async function fixture() {
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'case-'));
  created.push(directory);
  const file = path.join(directory, 'preferences.json');
  return { file, store: createPreferencesStore(file) };
}
afterEach(async () => {
  for (const folder of created.splice(0)) {
    if (!path.resolve(folder).startsWith(`${base}${path.sep}`)) throw new Error('Unsafe preferences cleanup');
    await rm(folder, { recursive: true, force: true });
  }
});

describe('desktop preferences persistence boundary', () => {
  it('starts from defaults without creating a settings file during a read', async () => {
    const { file, store } = await fixture();
    expect(await store.load()).toEqual(DEFAULT_PREFERENCES);
    const copy = store.get(); copy.scale = 9;
    expect(store.get()).toEqual(DEFAULT_PREFERENCES);
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers from corrupt settings without overwriting the original on load', async () => {
    const { file, store } = await fixture();
    await writeFile(file, '{broken');
    expect(await store.load()).toEqual(DEFAULT_PREFERENCES);
    expect(await readFile(file, 'utf8')).toBe('{broken');
    await store.update({ performance: 'battery' });
    expect(await createPreferencesStore(file).load()).toEqual({ version: 1, scale: 1, performance: 'battery' });
  });

  it('serializes simultaneous partial changes and restores them on restart', async () => {
    const { file, store } = await fixture();
    await store.load();
    const patch = { scale: 0.8 };
    const first = store.update(patch); patch.scale = 100;
    await Promise.all([first, store.update({ performance: 'battery' }), store.update({ scale: 1.2 })]);
    expect(await createPreferencesStore(file).load()).toEqual({ version: 1, scale: 1.2, performance: 'battery' });
    await expect(readFile(`${file}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([null, [], 'battery', { scale: '1.2' }, { scale: 2 }, { scale: NaN }, { performance: 'ultra' }, { version: 1 }, { path: '../other.json' }])('rejects an invalid IPC patch %j without changing state', async (patch) => {
    const { store, file } = await fixture();
    await expect(store.update(patch)).rejects.toThrow('Invalid desktop');
    expect(store.get()).toEqual(DEFAULT_PREFERENCES);
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not report unsaved changes as persisted and permits retry after a write failure', async () => {
    const { file, store } = await fixture();
    await mkdir(file);
    await expect(store.update({ scale: 0.8 })).rejects.toThrow();
    expect(store.get().scale).toBe(1);
    await rmdir(file);
    await store.update({ scale: 1.2 });
    expect(await createPreferencesStore(file).load()).toEqual({ ...DEFAULT_PREFERENCES, scale: 1.2 });
  });

  it('keeps browser and native settings compatible, including damaged or future records', () => {
    expect(frontendDefaults).toEqual(DEFAULT_PREFERENCES);
    for (const value of [null, [], {}, { version: 2, scale: 1.2 }, { version: 1, scale: -1, performance: 'bogus' }, { version: 1, scale: 0.8, performance: 'quality' }]) {
      expect(normalizeFrontend(value)).toEqual(normalizePreferences(value));
    }
  });
});
