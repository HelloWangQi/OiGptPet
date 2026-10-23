import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CHARACTER_PACKAGE_MAX_BYTES } from '../packages/character-package/contract';

const require = createRequire(import.meta.url);
const { createCharacterPackageSaver, validatePackageSave, MAX_PACKAGE_BYTES } = require('../electron/character-package-save.cjs');
const directories = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) {
    if (!path.resolve(dir).startsWith(path.join(os.tmpdir(), 'oigptpet-package-save-'))) throw new Error('Unexpected test directory');
    await rm(dir, { recursive: true, force: true });
  }
});
const id = '12345678-1234-1234-1234-123456789abc';
function bytes() {
  const data = Buffer.alloc(16); data.write('OIPET001'); data.writeUInt32LE(2, 8); data.write('{}', 12); data.set([1, 2], 14); return data;
}
const hash = (data) => createHash('sha256').update(data).digest('hex');
function owner(number = 1) {
  const value = new EventEmitter(); value.id = number; value.destroyed = false; value.isDestroyed = () => value.destroyed;
  value.close = () => { value.destroyed = true; value.emit('closed'); }; return value;
}
async function target() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oigptpet-package-save-')); directories.push(dir);
  return { dir, file: path.join(dir, 'character.oipet') };
}

describe('native character backup saving', () => {
  it('checks operation identity, envelope size and actual hash before opening any dialog', async () => {
    let dialogs = 0;
    const saver = createCharacterPackageSaver({ chooseFile: async () => { dialogs++; return { canceled: true }; } });
    await expect(saver.save(owner(), bytes(), '0'.repeat(64), id)).rejects.toThrow('hash mismatch');
    expect(() => validatePackageSave(bytes(), hash(bytes()), '../bad')).toThrow('operation');
    const bad = bytes(); bad.writeUInt32LE(65537, 8);
    expect(() => validatePackageSave(bad, hash(bad), id)).toThrow('header');
    expect(MAX_PACKAGE_BYTES).toBe(CHARACTER_PACKAGE_MAX_BYTES); expect(dialogs).toBe(0);
  });
  it('writes exact bytes through an atomic rename and removes temporary files', async () => {
    const { dir, file } = await target(); const data = bytes();
    const saver = createCharacterPackageSaver({ chooseFile: async () => ({ filePath: file }) });
    expect(await saver.save(owner(), data, hash(data), id)).toBe(file);
    expect(await readFile(file)).toEqual(data); expect(await readdir(dir)).toEqual(['character.oipet']);
  });
  it('native dialog cancellation writes nothing', async () => {
    const { dir } = await target();
    const saver = createCharacterPackageSaver({ chooseFile: async () => ({ canceled: true }) });
    expect(await saver.save(owner(), bytes(), hash(bytes()), id)).toBeNull(); expect(await readdir(dir)).toEqual([]);
  });
  it('cancellation and owner close discard a delayed dialog result without touching an existing file', async () => {
    for (const closed of [false, true]) {
      const { dir, file } = await target(); await writeFile(file, 'existing');
      let finish; const person = owner();
      const saver = createCharacterPackageSaver({ chooseFile: () => new Promise((resolve) => { finish = resolve; }) });
      const saving = saver.save(person, bytes(), hash(bytes()), id);
      if (closed) person.close(); else expect(saver.cancel(person, id)).toBe(true);
      finish({ filePath: file }); expect(await saving).toBeNull();
      expect(await readFile(file, 'utf8')).toBe('existing'); expect(await readdir(dir)).toEqual(['character.oipet']);
    }
  });
  it('a different window cannot cancel this window’s save; duplicate operations are rejected', async () => {
    let finish; const person = owner();
    const saver = createCharacterPackageSaver({ chooseFile: () => new Promise((resolve) => { finish = resolve; }) });
    const saving = saver.save(person, bytes(), hash(bytes()), id);
    expect(saver.cancel(owner(2), id)).toBe(false);
    await expect(saver.save(person, bytes(), hash(bytes()), id)).rejects.toThrow('already exists');
    finish({ canceled: true }); await saving;
  });
  it('failed writes preserve the destination and later saves can retry', async () => {
    const { dir, file } = await target(); await writeFile(file, 'original');
    let fail = true;
    const fs = await import('node:fs/promises');
    const saver = createCharacterPackageSaver({ chooseFile: async () => ({ filePath: file }), fileSystem: {
      ...fs, rename: async (...args) => { if (fail) throw new Error('disk failed'); return fs.rename(...args); },
    } });
    await expect(saver.save(owner(), bytes(), hash(bytes()), id)).rejects.toThrow('disk failed');
    expect(await readFile(file, 'utf8')).toBe('original'); expect(await readdir(dir)).toEqual(['character.oipet']);
    fail = false; await saver.save(owner(), bytes(), hash(bytes()), id); expect(await readFile(file)).toEqual(bytes());
  });
  it('once rename starts cancellation cannot falsely report rollback', async () => {
    const { file } = await target(); const fs = await import('node:fs/promises'); let release; let started;
    const committing = new Promise((resolve) => { started = resolve; }); const person = owner();
    const saver = createCharacterPackageSaver({ chooseFile: async () => ({ filePath: file }), fileSystem: {
      ...fs, rename: async (...args) => { started(); await new Promise((resolve) => { release = resolve; }); return fs.rename(...args); },
    } });
    const saving = saver.save(person, bytes(), hash(bytes()), id); await committing;
    expect(saver.cancel(person, id)).toBe(false); release(); expect(await saving).toBe(file);
  });
});
