import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHARACTER_LIBRARY_MAX_NAME_LENGTH,
  CharacterLibraryError,
  createCharacterLibrary,
  type CharacterLibrary,
  type CharacterLibraryOptions,
} from '../packages/character-library/index';
import { installFakeIndexedDb, type FakeIndexedDb } from './fixtures/character-library/fake-indexeddb';

let fake: FakeIndexedDb;
let databaseCounter = 0;
let libraries: CharacterLibrary[] = [];
const databaseNames = new WeakMap<CharacterLibrary, string>();

function databaseName(): string {
  databaseCounter += 1;
  return `character-library-test-${databaseCounter}`;
}

function create(options: CharacterLibraryOptions = {}): CharacterLibrary {
  const library = createCharacterLibrary(options);
  databaseNames.set(library, options.databaseName ?? 'oigptpet-library');
  libraries.push(library);
  return library;
}

function glb(name: string, extra: Record<string, unknown> = {}): ArrayBuffer {
  const document = {
    extensions: {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: { name, authors: ['Tester'] },
      },
    },
    ...extra,
  };
  const json = new TextEncoder().encode(JSON.stringify(document));
  const length = Math.ceil(json.length / 4) * 4;
  const buffer = new ArrayBuffer(20 + length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20).fill(32);
  new Uint8Array(buffer, 20, json.length).set(json);
  return buffer;
}

function vrmBlob(name: string, extra: Record<string, unknown> = {}): Blob {
  return new Blob([glb(name, extra)]);
}

function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(33));
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

async function expectCode(
  promise: Promise<unknown>,
  code: CharacterLibraryError['code'],
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: 'CharacterLibraryError',
    code,
  });
}

beforeEach(() => {
  fake = installFakeIndexedDb();
  databaseCounter = 0;
  libraries = [];
});

afterEach(() => {
  for (const library of libraries) {
    library.close();
  }
  libraries = [];
  fake.reset();
  Reflect.deleteProperty(globalThis, 'indexedDB');
});

describe('input, identity and names', () => {
  it('stores the original bytes with a stable identity and does not activate', async () => {
    const library = create({ databaseName: databaseName() });
    const blob = vrmBlob('Static Name');

    const summary = await library.add({ kind: 'vrm', blob, name: '  Alice  ' });
    expect(summary).toMatchObject({
      kind: 'vrm',
      name: 'Alice',
      encodedBytes: blob.size,
    });
    expect(summary.id).toBe(`vrm:${summary.sha256}`);
    expect(summary.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.profile).toBeUndefined();
    expect(Number.isNaN(Date.parse(summary.createdAt))).toBe(false);

    const asset = await library.get(summary.id);
    expect(asset).not.toBeNull();
    expect(asset?.summary).toEqual(summary);
    expect(new Uint8Array(await (asset?.blob as Blob).arrayBuffer()))
      .toEqual(new Uint8Array(await blob.arrayBuffer()));
    expect(await library.getActive()).toBeNull();

    const duplicate = await library.add({ kind: 'vrm', blob, name: 'Changed' });
    expect(duplicate).toEqual(summary);
    expect(await library.list()).toHaveLength(1);

    const other = await library.add({ kind: 'vrm', blob: vrmBlob('Other') });
    expect(other.id).not.toBe(summary.id);
    expect(await library.list()).toHaveLength(2);
  });

  it('uses static VRM names as safe defaults and truncates long metadata', async () => {
    const library = create({
      databaseName: databaseName(),
      limits: { maxEntries: 2 },
    });

    const named = await library.add({ kind: 'vrm', blob: vrmBlob('  Sample Model  ') });
    expect(named.name).toBe('Sample Model');

    const longName = '角'.repeat(CHARACTER_LIBRARY_MAX_NAME_LENGTH + 20);
    const long = await library.add({ kind: 'vrm', blob: vrmBlob(longName) });
    expect(Array.from(long.name)).toHaveLength(CHARACTER_LIBRARY_MAX_NAME_LENGTH);
    expect(long.name).toBe('角'.repeat(CHARACTER_LIBRARY_MAX_NAME_LENGTH));
  });

  it('validates explicit names and never stores a File.name fallback', async () => {
    const library = create({ databaseName: databaseName() });
    const blob = vrmBlob('Metadata Name');

    await expectCode(library.add({ kind: 'vrm', blob, name: '   ' }), 'invalid-name');
    await expectCode(
      library.add({ kind: 'vrm', blob, name: '😀'.repeat(81) }),
      'invalid-name',
    );
    await expectCode(
      library.add({ kind: 'vrm', blob, name: 7 as unknown as string }),
      'invalid-name',
    );
    expect(await library.list()).toHaveLength(0);

    const maximum = await library.add({
      kind: 'vrm',
      blob,
      name: '😀'.repeat(CHARACTER_LIBRARY_MAX_NAME_LENGTH),
    });
    expect(Array.from(maximum.name)).toHaveLength(CHARACTER_LIBRARY_MAX_NAME_LENGTH);

    const defaultName = await library.add({ kind: 'vrm', blob: vrmBlob('') });
    expect(defaultName.name).toBe('本地角色');
  });

  it('rejects corrupted VRMs and external references without writing', async () => {
    const library = create({ databaseName: databaseName() });
    const corrupt = new Blob([new Uint8Array([1, 2, 3, 4])]);

    await expectCode(library.add({ kind: 'vrm', blob: corrupt }), 'invalid-input');
    await expectCode(
      library.add({
        kind: 'vrm',
        blob: vrmBlob('External', { images: [{ uri: 'https://example.com/a.png' }] }),
      }),
      'invalid-input',
    );
    expect(await library.list()).toHaveLength(0);
    expect(await library.getActive()).toBeNull();
  });

  it('rejects invalid sprite metadata before decoding and keeps the old active item', async () => {
    const library = create({ databaseName: databaseName() });
    const active = await library.add({ kind: 'vrm', blob: vrmBlob('Active') });
    await library.activate(active.id);

    await expectCode(
      library.add({
        kind: 'sprite',
        blob: new Blob([new Uint8Array(10)], { type: 'image/gif' }),
        profile: 'v1',
      }),
      'invalid-input',
    );
    await expectCode(
      library.add({
        kind: 'sprite',
        blob: new Blob([pngHeader(1, 1)], { type: 'image/png' }),
        profile: 'v2',
      }),
      'invalid-input',
    );
    await expectCode(
      library.add({
        kind: 'sprite',
        blob: new Blob([new Uint8Array(10)], { type: 'image/png' }),
        profile: 'v3' as unknown as 'v1',
      }),
      'invalid-input',
    );

    expect(await library.list()).toHaveLength(1);
    expect((await library.getActive())?.summary.id).toBe(active.id);
  });
});

describe('limits', () => {
  it('enforces the entry limit inside the write transaction', async () => {
    const library = create({
      databaseName: databaseName(),
      limits: { maxEntries: 2 },
    });
    const first = await library.add({ kind: 'vrm', blob: vrmBlob('One') });
    await library.add({ kind: 'vrm', blob: vrmBlob('Two') });

    await expectCode(
      library.add({ kind: 'vrm', blob: vrmBlob('Three') }),
      'entry-limit',
    );
    expect(await library.list()).toHaveLength(2);

    const duplicate = await library.add({ kind: 'vrm', blob: vrmBlob('One'), name: 'Ignore' });
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.name).toBe('One');
    expect(await library.list()).toHaveLength(2);
  });

  it('enforces the byte limit without touching existing entries or active', async () => {
    const firstBlob = vrmBlob('First');
    const secondBlob = vrmBlob('Second');
    const library = create({
      databaseName: databaseName(),
      limits: { maxBytes: firstBlob.size + secondBlob.size - 1 },
    });
    const first = await library.add({ kind: 'vrm', blob: firstBlob });
    await library.activate(first.id);

    await expectCode(
      library.add({ kind: 'vrm', blob: secondBlob }),
      'byte-limit',
    );
    expect(await library.list()).toHaveLength(1);
    expect((await library.getActive())?.summary.id).toBe(first.id);
  });

  it('clamps test limits to the production maximum', async () => {
    const library = create({
      databaseName: databaseName(),
      limits: { maxEntries: 999, maxBytes: Number.MAX_SAFE_INTEGER },
    });
    for (let index = 0; index < 12; index += 1) {
      await library.add({ kind: 'vrm', blob: vrmBlob(`Entry ${index}`) });
    }
    await expectCode(
      library.add({ kind: 'vrm', blob: vrmBlob('Entry 12') }),
      'entry-limit',
    );
    expect(await library.list()).toHaveLength(12);
  });

  it('rejects invalid limit overrides synchronously', () => {
    expect(() => createCharacterLibrary({ limits: { maxEntries: 0 } }))
      .toThrow(CharacterLibraryError);
    expect(() => createCharacterLibrary({ limits: { maxBytes: -1 } }))
      .toThrow(CharacterLibraryError);
  });
});

describe('activation, rename and removal', () => {
  it('activates verified entries and keeps the old active on failure', async () => {
    const library = create({ databaseName: databaseName() });
    const first = await library.add({ kind: 'vrm', blob: vrmBlob('First') });
    const second = await library.add({ kind: 'vrm', blob: vrmBlob('Second') });

    await library.activate(first.id);
    expect((await library.getActive())?.summary.id).toBe(first.id);

    await expectCode(library.activate('vrm:missing'), 'not-found');
    expect((await library.getActive())?.summary.id).toBe(first.id);

    await library.activate(second.id);
    expect((await library.getActive())?.summary.id).toBe(second.id);
  });

  it('renames entries, preserves active and rejects missing or invalid names', async () => {
    const library = create({ databaseName: databaseName() });
    const first = await library.add({ kind: 'vrm', blob: vrmBlob('First') });
    await library.activate(first.id);

    await library.rename(first.id, '  Renamed  ');
    expect((await library.get(first.id))?.summary.name).toBe('Renamed');
    expect((await library.getActive())?.summary.name).toBe('Renamed');

    await expectCode(library.rename('vrm:missing', 'Name'), 'not-found');
    await expectCode(library.rename(first.id, '   '), 'invalid-name');
    expect((await library.get(first.id))?.summary.name).toBe('Renamed');
  });

  it('refuses to remove the active entry and removes others idempotently', async () => {
    const library = create({ databaseName: databaseName() });
    const first = await library.add({ kind: 'vrm', blob: vrmBlob('First') });
    const second = await library.add({ kind: 'vrm', blob: vrmBlob('Second') });
    await library.activate(first.id);

    await expectCode(library.remove(first.id), 'active-character');
    expect(await library.list()).toHaveLength(2);
    expect((await library.getActive())?.summary.id).toBe(first.id);

    await library.remove(second.id);
    expect(await library.get(second.id)).toBeNull();
    await library.remove(second.id);
    await library.remove('vrm:missing');
    expect(await library.list()).toHaveLength(1);
    expect((await library.getActive())?.summary.id).toBe(first.id);
  });

  it('detects a missing blob during activation without changing active', async () => {
    const library = create({ databaseName: databaseName() });
    const first = await library.add({ kind: 'vrm', blob: vrmBlob('First') });
    const second = await library.add({ kind: 'vrm', blob: vrmBlob('Second') });
    await library.activate(first.id);

    fake.rawStore(libraryDatabaseName(library), 'assets')?.delete(second.id);
    await expectCode(library.activate(second.id), 'incomplete-asset');
    await expectCode(library.get(second.id), 'incomplete-asset');
    expect((await library.getActive())?.summary.id).toBe(first.id);
  });
});

// The library does not expose its database name; tests record the name used
// by create() when they need to corrupt the raw store.
function libraryDatabaseName(library: CharacterLibrary): string {
  return databaseNames.get(library) ?? '';
}

describe('legacy migration', () => {
  it('adds a valid legacy VRM and sets active only when no active exists', async () => {
    const library = create({ databaseName: databaseName() });
    const summary = await library.migrateLegacyVrm(glb('Legacy'));
    expect(summary.kind).toBe('vrm');
    expect(summary.name).toBe('Legacy');
    expect(await library.list()).toHaveLength(1);
    expect((await library.getActive())?.summary.id).toBe(summary.id);

    await library.rename(summary.id, 'Kept Name');
    const duplicate = await library.migrateLegacyVrm(glb('Legacy'));
    expect(duplicate.id).toBe(summary.id);
    expect(duplicate.name).toBe('Kept Name');
    expect((await library.get(summary.id))?.summary.name).toBe('Kept Name');
    expect(await library.list()).toHaveLength(1);
  });

  it('does not overwrite an existing active when migrating another model', async () => {
    const library = create({ databaseName: databaseName() });
    const active = await library.add({ kind: 'vrm', blob: vrmBlob('Active') });
    await library.activate(active.id);

    const migrated = await library.migrateLegacyVrm(glb('Other'));
    expect(migrated.id).not.toBe(active.id);
    expect(await library.list()).toHaveLength(2);
    expect((await library.getActive())?.summary.id).toBe(active.id);
  });

  it('activates an existing duplicate when the library has no active entry', async () => {
    const library = create({ databaseName: databaseName() });
    const existing = await library.add({ kind: 'vrm', blob: vrmBlob('Imported') });
    expect(await library.getActive()).toBeNull();

    const migrated = await library.migrateLegacyVrm(glb('Imported'));
    expect(migrated.id).toBe(existing.id);
    expect((await library.getActive())?.summary.id).toBe(existing.id);
  });

  it('rejects invalid legacy bytes and leaves the library unchanged', async () => {
    const library = create({ databaseName: databaseName() });
    const active = await library.add({ kind: 'vrm', blob: vrmBlob('Active') });
    await library.activate(active.id);

    await expectCode(
      library.migrateLegacyVrm(new Uint8Array([1, 2, 3]).buffer),
      'invalid-input',
    );
    expect(await library.list()).toHaveLength(1);
    expect((await library.getActive())?.summary.id).toBe(active.id);
  });

  it('rolls back the entry when setting the first active fails', async () => {
    const library = create({ databaseName: databaseName() });
    fake.failNextWrite('meta');

    await expectCode(library.migrateLegacyVrm(glb('Legacy')), 'quota');
    expect(await library.list()).toHaveLength(0);
    expect(await library.getActive()).toBeNull();

    const retried = await library.migrateLegacyVrm(glb('Legacy'));
    expect(await library.list()).toHaveLength(1);
    expect((await library.getActive())?.summary.id).toBe(retried.id);
  });
});

describe('transactions, cancellation and close', () => {
  it('rolls back a failed asset write and allows a retry', async () => {
    const library = create({ databaseName: databaseName() });
    fake.failNextWrite('assets');

    await expectCode(
      library.add({ kind: 'vrm', blob: vrmBlob('Rollback') }),
      'quota',
    );
    expect(await library.list()).toHaveLength(0);
    expect(await library.getActive()).toBeNull();

    const retried = await library.add({ kind: 'vrm', blob: vrmBlob('Rollback') });
    expect(retried.kind).toBe('vrm');
    expect(await library.list()).toHaveLength(1);
  });

  it('rejects an already-aborted signal without writing', async () => {
    const library = create({ databaseName: databaseName() });
    const controller = new AbortController();
    controller.abort();

    await expect(
      library.add({ kind: 'vrm', blob: vrmBlob('Cancelled') }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await library.list()).toHaveLength(0);
  });

  it('cancels during a delayed read without creating a partial entry', async () => {
    const library = create({ databaseName: databaseName() });
    const blob = vrmBlob('Cancelled Later');
    const original = blob.arrayBuffer.bind(blob);
    Object.defineProperty(blob, 'arrayBuffer', {
      configurable: true,
      value: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return original();
      },
    });

    const controller = new AbortController();
    const pending = library.add({ kind: 'vrm', blob }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(await library.list()).toHaveLength(0);
  });

  it('rejects operations after close, is idempotent, and does not hang in-flight work', async () => {
    const name = databaseName();
    const library = create({ databaseName: name });
    const blob = vrmBlob('In Flight');
    const original = blob.arrayBuffer.bind(blob);
    Object.defineProperty(blob, 'arrayBuffer', {
      configurable: true,
      value: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return original();
      },
    });

    const pending = library.add({ kind: 'vrm', blob });
    library.close();
    library.close();
    await expectCode(pending, 'closed');
    await expectCode(library.list(), 'closed');
    await expectCode(library.getActive(), 'closed');

    const reopened = create({ databaseName: name });
    expect(await reopened.list()).toHaveLength(0);
    expect(await reopened.getActive()).toBeNull();
  });

  it('reports closed when close races with transaction creation', async () => {
    const library = create({ databaseName: databaseName() });
    await library.list();

    const pending = library.list();
    library.close();
    await expectCode(pending, 'closed');
  });

  it('coordinates two instances importing and enforcing limits', async () => {
    const name = databaseName();
    const first = create({ databaseName: name, limits: { maxEntries: 1 } });
    const second = create({ databaseName: name, limits: { maxEntries: 1 } });
    const blob = vrmBlob('Shared');

    const [left, right] = await Promise.all([
      first.add({ kind: 'vrm', blob }),
      second.add({ kind: 'vrm', blob }),
    ]);
    expect(left.id).toBe(right.id);
    expect(await first.list()).toHaveLength(1);

    const limitName = databaseName();
    const third = create({ databaseName: limitName, limits: { maxEntries: 1 } });
    const fourth = create({ databaseName: limitName, limits: { maxEntries: 1 } });
    const settled = await Promise.allSettled([
      third.add({ kind: 'vrm', blob: vrmBlob('A') }),
      fourth.add({ kind: 'vrm', blob: vrmBlob('B') }),
    ]);
    const fulfilled = settled.filter((result) => result.status === 'fulfilled');
    const rejected = settled.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'entry-limit' });
    expect(await third.list()).toHaveLength(1);
  });

  it('keeps remove/activate races consistent', async () => {
    const name = databaseName();
    const first = create({ databaseName: name });
    const second = create({ databaseName: name });
    const target = await first.add({ kind: 'vrm', blob: vrmBlob('Target') });
    await first.add({ kind: 'vrm', blob: vrmBlob('Other') });

    const [activation, removal] = await Promise.allSettled([
      first.activate(target.id),
      second.remove(target.id),
    ]);
    const active = await first.getActive();
    const listed = await first.list();

    if (activation.status === 'fulfilled') {
      expect(removal.status).toBe('rejected');
      expect((removal as PromiseRejectedResult).reason).toMatchObject({
        code: 'active-character',
      });
      expect(active?.summary.id).toBe(target.id);
      expect(listed).toHaveLength(2);
    } else {
      expect((activation as PromiseRejectedResult).reason).toMatchObject({
        code: 'not-found',
      });
      expect(removal.status).toBe('fulfilled');
      expect(active).toBeNull();
      expect(listed).toHaveLength(1);
    }
  });

  it('persists summaries, blobs, names and active across reopen', async () => {
    const name = databaseName();
    const first = create({ databaseName: name });
    const added = await first.add({ kind: 'vrm', blob: vrmBlob('Persisted') });
    await first.activate(added.id);
    await first.rename(added.id, 'Renamed Persisted');
    first.close();

    const second = create({ databaseName: name });
    const list = await second.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: added.id,
      name: 'Renamed Persisted',
      sha256: added.sha256,
      encodedBytes: added.encodedBytes,
      createdAt: added.createdAt,
    });
    const active = await second.getActive();
    expect(active?.summary.id).toBe(added.id);
    expect(new Uint8Array(await (active?.blob as Blob).arrayBuffer()))
      .toEqual(new Uint8Array(glb('Persisted')));
  });

  it('returns summaries in the documented order and as detached objects', async () => {
    const library = create({ databaseName: databaseName() });
    for (const name of ['A', 'B', 'C']) {
      await library.add({ kind: 'vrm', blob: vrmBlob(name) });
    }
    const list = await library.list();
    const expected = [...list].sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt < right.createdAt ? -1 : 1;
      }
      return left.id < right.id ? -1 : 1;
    });
    expect(list).toEqual(expected);

    list[0].name = 'Mutated outside';
    expect((await library.list())[0].name).not.toBe('Mutated outside');
  });

  it('treats a stale active pointer as no active entry', async () => {
    const library = create({ databaseName: databaseName() });
    await library.add({ kind: 'vrm', blob: vrmBlob('Existing') });
    const meta = fake.rawStore(libraryDatabaseName(library), 'meta');
    meta?.set('active', { id: 'vrm:missing' });
    expect(await library.getActive()).toBeNull();
  });
});

describe('construction and open boundaries', () => {
  it('never opens the legacy database name', async () => {
    expect(() => createCharacterLibrary({ databaseName: 'oigptpet' }))
      .toThrow(CharacterLibraryError);
    const library = create();
    await library.list();
    expect(fake.openCalls).toContain('oigptpet-library');
    expect(fake.openCalls).not.toContain('oigptpet');
  });

  it('reports a blocked open without hanging and allows a retry', async () => {
    fake.blockedOnce = true;
    const library = create({ databaseName: databaseName() });
    await expectCode(library.list(), 'blocked');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await library.list()).toEqual([]);
  });

  it('rejects an empty database name synchronously', () => {
    expect(() => createCharacterLibrary({ databaseName: '   ' }))
      .toThrow(CharacterLibraryError);
  });
});
