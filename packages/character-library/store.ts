import {
  compareCharacterSummaries,
  normalizeCharacterName,
} from './naming';
import {
  CHARACTER_LIBRARY_MAX_BYTES,
  CHARACTER_LIBRARY_MAX_ENTRIES,
  CHARACTER_LIBRARY_DATABASE_VERSION,
  CharacterLibraryError,
  type CharacterAsset,
  type CharacterLibraryLimits,
  type CharacterSummary,
  type PreparedCharacter,
} from './types';

const CHARACTERS = 'characters';
const ASSETS = 'assets';
const META = 'meta';
const ACTIVE_KEY = 'active';
const STORE_NAMES = [CHARACTERS, ASSETS, META];

interface StoredAsset {
  id: string;
  blob: Blob;
}

interface ActivePointer {
  id: string;
}

interface ExpectedAsset {
  kind: CharacterSummary['kind'];
  sha256: string;
  encodedBytes: number;
  profile?: CharacterSummary['profile'];
}

function abortError(message = '角色库操作已取消。'): DOMException {
  return new DOMException(message, 'AbortError');
}

function closedError(): CharacterLibraryError {
  return new CharacterLibraryError('closed', '角色库已关闭。');
}

function storageError(error: unknown): CharacterLibraryError {
  if (error instanceof CharacterLibraryError) {
    return error;
  }
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new CharacterLibraryError(
      'quota',
      '浏览器存储空间不足，角色库操作未写入。',
      { cause: error },
    );
  }
  const message = error instanceof Error && error.message
    ? error.message
    : String(error);
  return new CharacterLibraryError(
    'storage',
    `角色库存储操作失败：${message}`,
    { cause: error },
  );
}

function operationError(error: unknown): Error {
  if (error instanceof CharacterLibraryError) {
    return error;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return error;
  }
  return storageError(error);
}

function notFoundError(id: string): CharacterLibraryError {
  return new CharacterLibraryError('not-found', `角色不存在：${id}。`);
}

function incompleteError(id: string, detail = ''): CharacterLibraryError {
  return new CharacterLibraryError(
    'incomplete-asset',
    `角色数据不完整或与实际字节不一致：${id}。${detail}`,
  );
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new CharacterLibraryError('invalid-input', '角色 ID 必须是非空字符串。');
  }
}

function cloneSummary(summary: CharacterSummary): CharacterSummary {
  return summary.profile === undefined
    ? { ...summary }
    : { ...summary, profile: summary.profile };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败。'));
  });
}

export function resolveLibraryLimits(
  partial: Partial<CharacterLibraryLimits> | undefined,
): CharacterLibraryLimits {
  const maxEntries = partial?.maxEntries ?? CHARACTER_LIBRARY_MAX_ENTRIES;
  const maxBytes = partial?.maxBytes ?? CHARACTER_LIBRARY_MAX_BYTES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new CharacterLibraryError('invalid-input', 'maxEntries 必须是正整数。');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new CharacterLibraryError('invalid-input', 'maxBytes 必须是正整数。');
  }
  return {
    maxEntries: Math.min(maxEntries, CHARACTER_LIBRARY_MAX_ENTRIES),
    maxBytes: Math.min(maxBytes, CHARACTER_LIBRARY_MAX_BYTES),
  };
}

export class CharacterStore {
  private readonly databaseName: string;
  private readonly limits: CharacterLibraryLimits;
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  private closed = false;

  constructor(databaseName: string, limits: CharacterLibraryLimits) {
    this.databaseName = databaseName;
    this.limits = limits;
  }

  async list(): Promise<CharacterSummary[]> {
    const all = await this.run(
      [CHARACTERS],
      'readonly',
      async (tx) => requestResult<CharacterSummary[]>(
        tx.objectStore(CHARACTERS).getAll(),
      ),
    );
    return all.map(cloneSummary).sort(compareCharacterSummaries);
  }

  async get(id: string): Promise<CharacterAsset | null> {
    assertId(id);
    return this.run([CHARACTERS, ASSETS], 'readonly', async (tx) => {
      const summary = await requestResult<CharacterSummary | undefined>(
        tx.objectStore(CHARACTERS).get(id),
      );
      if (!summary) {
        return null;
      }
      const asset = await requestResult<StoredAsset | undefined>(
        tx.objectStore(ASSETS).get(id),
      );
      if (!asset || !(asset.blob instanceof Blob) || asset.blob.size !== summary.encodedBytes) {
        throw incompleteError(id);
      }
      return { summary: cloneSummary(summary), blob: asset.blob };
    });
  }

  async add(
    prepared: PreparedCharacter,
    signal?: AbortSignal,
  ): Promise<CharacterSummary> {
    return this.run([CHARACTERS, ASSETS], 'readwrite', async (tx) => {
      const characters = tx.objectStore(CHARACTERS);
      const assets = tx.objectStore(ASSETS);
      const existing = await requestResult<CharacterSummary | undefined>(
        characters.get(prepared.summary.id),
      );
      if (existing) {
        const currentAsset = await requestResult<StoredAsset | undefined>(
          assets.get(existing.id),
        );
        if (
          !currentAsset
          || !(currentAsset.blob instanceof Blob)
          || currentAsset.blob.size !== existing.encodedBytes
        ) {
          throw incompleteError(existing.id);
        }
        return cloneSummary(existing);
      }

      const all = await requestResult<CharacterSummary[]>(characters.getAll());
      if (all.length >= this.limits.maxEntries) {
        throw new CharacterLibraryError(
          'entry-limit',
          `角色库最多保存 ${this.limits.maxEntries} 个条目。`,
        );
      }
      const totalBytes = all.reduce((total, summary) => total + summary.encodedBytes, 0);
      if (totalBytes + prepared.summary.encodedBytes > this.limits.maxBytes) {
        throw new CharacterLibraryError(
          'byte-limit',
          `角色库原始文件合计不能超过 ${this.limits.maxBytes} 字节。`,
        );
      }

      await requestResult(characters.add(prepared.summary));
      await requestResult(assets.add({
        id: prepared.summary.id,
        blob: prepared.blob,
      }));
      return cloneSummary(prepared.summary);
    }, signal);
  }

  async getActive(): Promise<CharacterAsset | null> {
    return this.run([CHARACTERS, ASSETS, META], 'readonly', async (tx) => {
      const pointer = await requestResult<ActivePointer | undefined>(
        tx.objectStore(META).get(ACTIVE_KEY),
      );
      if (!pointer || typeof pointer.id !== 'string') {
        return null;
      }
      const summary = await requestResult<CharacterSummary | undefined>(
        tx.objectStore(CHARACTERS).get(pointer.id),
      );
      if (!summary) {
        return null;
      }
      const asset = await requestResult<StoredAsset | undefined>(
        tx.objectStore(ASSETS).get(pointer.id),
      );
      if (!asset || !(asset.blob instanceof Blob) || asset.blob.size !== summary.encodedBytes) {
        throw incompleteError(pointer.id);
      }
      return { summary: cloneSummary(summary), blob: asset.blob };
    });
  }

  async activate(id: string, expected: ExpectedAsset): Promise<void> {
    assertId(id);
    await this.run([CHARACTERS, ASSETS, META], 'readwrite', async (tx) => {
      const summary = await requestResult<CharacterSummary | undefined>(
        tx.objectStore(CHARACTERS).get(id),
      );
      if (!summary) {
        throw notFoundError(id);
      }
      const asset = await requestResult<StoredAsset | undefined>(
        tx.objectStore(ASSETS).get(id),
      );
      if (!asset || !(asset.blob instanceof Blob) || asset.blob.size !== summary.encodedBytes) {
        throw incompleteError(id);
      }
      if (
        summary.kind !== expected.kind
        || summary.sha256 !== expected.sha256
        || summary.encodedBytes !== expected.encodedBytes
        || (summary.kind === 'sprite' && summary.profile !== expected.profile)
      ) {
        throw new CharacterLibraryError(
          'conflict',
          `角色在选中前发生了变化：${id}。`,
        );
      }
      await requestResult(tx.objectStore(META).put({ id }, ACTIVE_KEY));
    });
  }

  async rename(id: string, name: string): Promise<void> {
    assertId(id);
    const normalized = normalizeCharacterName(name);
    await this.run([CHARACTERS], 'readwrite', async (tx) => {
      const characters = tx.objectStore(CHARACTERS);
      const summary = await requestResult<CharacterSummary | undefined>(
        characters.get(id),
      );
      if (!summary) {
        throw notFoundError(id);
      }
      await requestResult(characters.put({ ...summary, name: normalized }));
    });
  }

  async remove(id: string): Promise<void> {
    assertId(id);
    await this.run([CHARACTERS, ASSETS, META], 'readwrite', async (tx) => {
      const characters = tx.objectStore(CHARACTERS);
      const summary = await requestResult<CharacterSummary | undefined>(
        characters.get(id),
      );
      if (!summary) {
        return;
      }
      const pointer = await requestResult<ActivePointer | undefined>(
        tx.objectStore(META).get(ACTIVE_KEY),
      );
      if (pointer && pointer.id === id) {
        throw new CharacterLibraryError(
          'active-character',
          '不能删除当前选中的角色，请先切换到其他角色。',
        );
      }
      await requestResult(characters.delete(id));
      await requestResult(tx.objectStore(ASSETS).delete(id));
    });
  }

  async migrate(prepared: PreparedCharacter): Promise<CharacterSummary> {
    return this.run([CHARACTERS, ASSETS, META], 'readwrite', async (tx) => {
      const characters = tx.objectStore(CHARACTERS);
      const assets = tx.objectStore(ASSETS);
      let summary = await requestResult<CharacterSummary | undefined>(
        characters.get(prepared.summary.id),
      );

      if (summary) {
        const asset = await requestResult<StoredAsset | undefined>(
          assets.get(summary.id),
        );
        if (!asset || !(asset.blob instanceof Blob) || asset.blob.size !== summary.encodedBytes) {
          throw incompleteError(summary.id);
        }
      } else {
        const all = await requestResult<CharacterSummary[]>(characters.getAll());
        if (all.length >= this.limits.maxEntries) {
          throw new CharacterLibraryError(
            'entry-limit',
            `角色库最多保存 ${this.limits.maxEntries} 个条目。`,
          );
        }
        const totalBytes = all.reduce((total, item) => total + item.encodedBytes, 0);
        if (totalBytes + prepared.summary.encodedBytes > this.limits.maxBytes) {
          throw new CharacterLibraryError(
            'byte-limit',
            `角色库原始文件合计不能超过 ${this.limits.maxBytes} 字节。`,
          );
        }
        await requestResult(characters.add(prepared.summary));
        await requestResult(assets.add({
          id: prepared.summary.id,
          blob: prepared.blob,
        }));
        summary = prepared.summary;
      }

      const pointer = await requestResult<ActivePointer | undefined>(
        tx.objectStore(META).get(ACTIVE_KEY),
      );
      if (!pointer) {
        await requestResult(tx.objectStore(META).put({ id: summary.id }, ACTIVE_KEY));
      }
      return cloneSummary(summary);
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const db = this.db;
    this.db = null;
    if (db) {
      db.close();
    }
  }

  private async database(): Promise<IDBDatabase> {
    if (this.closed) {
      throw closedError();
    }
    if (this.db) {
      return this.db;
    }
    if (!this.opening) {
      this.opening = this.openDatabase();
      this.opening.catch(() => {
        if (this.opening) {
          this.opening = null;
        }
      });
    }
    const db = await this.opening;
    if (this.closed) {
      throw closedError();
    }
    return db;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new CharacterLibraryError(
          'storage',
          '当前环境不支持 IndexedDB，无法使用角色库。',
        ));
        return;
      }

      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(this.databaseName, CHARACTER_LIBRARY_DATABASE_VERSION);
      } catch (error) {
        reject(storageError(error));
        return;
      }

      let settled = false;
      const fail = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(operationError(error));
      };

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CHARACTERS)) {
          db.createObjectStore(CHARACTERS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(ASSETS)) {
          db.createObjectStore(ASSETS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META);
        }
      };
      request.onblocked = () => {
        fail(new CharacterLibraryError(
          'blocked',
          `角色库数据库 ${this.databaseName} 被其他页面阻塞，无法打开。`,
        ));
      };
      request.onerror = () => {
        fail(storageError(request.error ?? new Error('无法打开角色库数据库。')));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled || this.closed) {
          db.close();
          if (!settled) {
            fail(closedError());
          }
          return;
        }
        settled = true;
        this.attachDatabase(db);
        this.db = db;
        resolve(db);
      };
    });
  }

  private attachDatabase(db: IDBDatabase): void {
    db.onversionchange = () => {
      db.close();
      if (this.db === db) {
        this.db = null;
      }
      this.closed = true;
    };
    db.onclose = () => {
      if (this.db === db) {
        this.db = null;
      }
      this.closed = true;
    };
  }

  private async run<T>(
    stores: string[],
    mode: IDBTransactionMode,
    action: (tx: IDBTransaction) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) {
      throw abortError();
    }
    const db = await this.database();
    if (signal?.aborted) {
      throw abortError();
    }

    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      throw this.closed ? closedError() : storageError(error);
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let failure: unknown = null;

      const onAbort = () => {
        try {
          tx.abort();
          failure = abortError();
        } catch {
          // The transaction already finished; a committed write stands.
        }
      };
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const finish = (error: unknown, value?: T) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error !== null) {
          reject(operationError(error));
        } else {
          resolve(value as T);
        }
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      tx.oncomplete = () => {
        actionPromise.then(
          (value) => finish(null, value),
          (error) => finish(error),
        );
      };
      tx.onabort = () => {
        finish(failure ?? storageError(tx.error ?? new Error('角色库事务已中止。')));
      };
      tx.onerror = () => {
        if (!failure) {
          failure = tx.error ?? new Error('角色库事务失败。');
        }
      };

      const actionPromise = action(tx);
      actionPromise.catch((error) => {
        if (!failure) {
          failure = error;
        }
        try {
          tx.abort();
        } catch {
          // Already committed by the browser; the caller sees the outcome.
        }
      });
    });
  }
}
