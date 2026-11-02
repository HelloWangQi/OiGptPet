import * as fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import state from '../electron/window-state.cjs';

const base = path.resolve('.cache/window-state-tests');
const created = [];
const stores = [];
const initial = { x: -100, y: 20, width: 320, height: 420 };
const moved = { ...initial, x: 500, y: 100 };
async function fixture(options) {
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'case-'));
  created.push(directory);
  const file = path.join(directory, 'window-state.json');
  const store = state.createWindowStateStore(file, options);
  stores.push(store);
  return { file, store, directory };
}
afterEach(async () => {
  for (const store of stores.splice(0)) await store.flush().catch(() => {});
  vi.useRealTimers();
  for (const directory of created.splice(0)) {
    if (!path.resolve(directory).startsWith(base + path.sep)) throw new Error('Unsafe window-state test cleanup');
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe('window position persistence', () => {
  it('does not create a file during construction or a missing-file load', async () => {
    const { file, store } = await fixture();
    expect(await store.load()).toBeNull(); await store.flush();
    await expect(fs.readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['{broken', 'null', '[]', '{"x":0,"y":0,"width":0,"height":420}', '{"x":"0","y":0,"width":320,"height":420}'])('leaves damaged records untouched: %s', async contents => {
    const { file, store } = await fixture(); await fs.writeFile(file, contents);
    expect(await store.load()).toBeNull(); expect(await fs.readFile(file, 'utf8')).toBe(contents);
  });
  it.each([null, [], { ...initial, x: NaN }, { ...initial, height: Infinity }, { ...initial, width: -1 }])('rejects invalid schedule input %j', async value => {
    const { store } = await fixture(); expect(() => store.schedule(value)).toThrow('Invalid window bounds');
    await store.flush(); expect(await store.load()).toBeNull();
  });
  it('copies input, strips extra fields, flushes immediately and restores on restart', async () => {
    const { file, store, directory } = await fixture();
    const input = { ...initial, path: 'ignored' }; store.schedule(input); input.x = 9000;
    await store.flush();
    const loaded = await state.createWindowStateStore(file).load(); expect(loaded).toEqual(initial);
    loaded.x = 123; expect(await store.load()).toEqual(initial);
    expect(await fs.readdir(directory)).toEqual(['window-state.json']);
  });
  it('debounces rapid moves and does not rewrite the same revision', async () => {
    vi.useFakeTimers();
    const writeFile = vi.fn(fs.writeFile);
    const { store } = await fixture({ io: { ...fs, writeFile } });
    store.schedule(initial); await vi.advanceTimersByTimeAsync(299);
    expect(writeFile).not.toHaveBeenCalled(); store.schedule(moved);
    await vi.advanceTimersByTimeAsync(299); expect(writeFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await store.flush();
    expect(await store.load()).toEqual(moved); expect(writeFile).toHaveBeenCalledTimes(1);
  });
  it('serializes in-flight flushes and preserves the newest bounds', async () => {
    let unblock; const blocked = new Promise(resolve => { unblock = resolve; });
    let entered; const started = new Promise(resolve => { entered = resolve; });
    let count = 0;
    const writeFile = vi.fn(async (...args) => { if (++count === 1) { entered(); await blocked; } return fs.writeFile(...args); });
    const { store } = await fixture({ io: { ...fs, writeFile } });
    store.schedule(initial); const first = store.flush(); await started;
    store.schedule(moved); const second = store.flush(); const duplicate = store.flush();
    expect(writeFile).toHaveBeenCalledTimes(1); unblock(); await Promise.all([first, second, duplicate]);
    expect(writeFile).toHaveBeenCalledTimes(2); expect(await store.load()).toEqual(moved);
  });
  it('preserves the previous file after rename failure, cleans temp files and retries', async () => {
    let fail = true;
    const rename = vi.fn(async (...args) => { if (fail) throw Object.assign(new Error('disk failure'), { code: 'EACCES' }); return fs.rename(...args); });
    const { store, file, directory } = await fixture({ io: { ...fs, rename } });
    await fs.writeFile(file, JSON.stringify(initial)); store.schedule(moved);
    await expect(store.flush()).rejects.toThrow('disk failure'); expect(await store.load()).toEqual(initial);
    expect(await fs.readdir(directory)).toEqual(['window-state.json']);
    fail = false; await store.flush(); expect(await store.load()).toEqual(moved);
  });
  it('reports a background failure without rejecting future attempts', async () => {
    vi.useFakeTimers(); const onError = vi.fn(); let fail = true;
    const writeFile = async (...args) => { if (fail) throw new Error('write blocked'); return fs.writeFile(...args); };
    const { store } = await fixture({ io: { ...fs, writeFile }, onError });
    store.schedule(initial); await vi.advanceTimersByTimeAsync(300);
    await expect(store.flush()).rejects.toThrow('write blocked');
    expect(onError).toHaveBeenCalledOnce(); fail = false;
    await store.flush(); expect(await store.load()).toEqual(initial);
  });
  it('propagates genuine read failures and never writes during load', async () => {
    const writeFile = vi.fn();
    const { store } = await fixture({ io: { ...fs, writeFile, readFile: async () => { throw Object.assign(new Error('read denied'), { code: 'EACCES' }); } } });
    await expect(store.load()).rejects.toThrow('read denied'); expect(writeFile).not.toHaveBeenCalled();
  });
});
