import { sha256Hex } from '../atlas-preview/sha256';
import { prepareCharacter } from './prepare';
import { CharacterStore, resolveLibraryLimits } from './store';
import {
  CHARACTER_LIBRARY_DEFAULT_DATABASE,
  CharacterLibraryError,
  type CharacterAsset,
  type CharacterInput,
  type CharacterLibrary,
  type CharacterLibraryOptions,
  type CharacterSummary,
} from './types';

export * from './types';

class IndexedDbCharacterLibrary implements CharacterLibrary {
  private readonly store: CharacterStore;

  constructor(databaseName: string, options: CharacterLibraryOptions) {
    this.store = new CharacterStore(
      databaseName,
      resolveLibraryLimits(options.limits),
    );
  }

  list(): Promise<CharacterSummary[]> {
    return this.store.list();
  }

  get(id: string): Promise<CharacterAsset | null> {
    return this.store.get(id);
  }

  async add(
    input: CharacterInput,
    signal?: AbortSignal,
  ): Promise<CharacterSummary> {
    const prepared = await prepareCharacter(input, signal);
    if (signal?.aborted) {
      throw new DOMException('角色导入已取消。', 'AbortError');
    }
    return this.store.add(prepared, signal);
  }

  getActive(): Promise<CharacterAsset | null> {
    return this.store.getActive();
  }

  async addAndActivate(input: CharacterInput, signal?: AbortSignal, beforeCommit?: () => void): Promise<CharacterSummary> {
    const prepared = await prepareCharacter(input, signal);
    if (signal?.aborted) throw new DOMException('角色导入已取消。', 'AbortError');
    beforeCommit?.();
    return this.store.add(prepared, signal, true);
  }

  async activate(id: string): Promise<void> {
    const asset = await this.store.get(id);
    if (!asset) {
      throw new CharacterLibraryError('not-found', `角色不存在：${id}。`);
    }

    let buffer: ArrayBuffer;
    try {
      buffer = await asset.blob.arrayBuffer();
    } catch (error) {
      throw new CharacterLibraryError(
        'storage',
        `无法读取角色字节：${id}。`,
        { cause: error },
      );
    }
    const sha256 = await sha256Hex(buffer);
    if (
      sha256 !== asset.summary.sha256
      || buffer.byteLength !== asset.summary.encodedBytes
    ) {
      throw new CharacterLibraryError(
        'incomplete-asset',
        `角色数据与实际字节不一致，未切换当前角色：${id}。`,
      );
    }

    await this.store.activate(id, {
      kind: asset.summary.kind,
      sha256: asset.summary.sha256,
      encodedBytes: asset.summary.encodedBytes,
      profile: asset.summary.profile,
    });
  }

  rename(id: string, name: string): Promise<void> {
    return this.store.rename(id, name);
  }

  remove(id: string): Promise<void> {
    return this.store.remove(id);
  }

  async migrateLegacyVrm(buffer: ArrayBuffer): Promise<CharacterSummary> {
    if (!(buffer instanceof ArrayBuffer)) {
      throw new CharacterLibraryError(
        'invalid-input',
        '旧模型迁移需要传入 ArrayBuffer。',
      );
    }
    const blob = new Blob([buffer], { type: 'model/gltf-binary' });
    const prepared = await prepareCharacter({ kind: 'vrm', blob });
    return this.store.migrate(prepared);
  }

  close(): void {
    this.store.close();
  }
}

export function createCharacterLibrary(
  options: CharacterLibraryOptions = {},
): CharacterLibrary {
  const rawName = options.databaseName ?? CHARACTER_LIBRARY_DEFAULT_DATABASE;
  if (typeof rawName !== 'string' || rawName.trim().length === 0) {
    throw new CharacterLibraryError(
      'invalid-input',
      'databaseName 必须是非空字符串。',
    );
  }
  const databaseName = rawName.trim();
  if (databaseName === 'oigptpet') {
    throw new CharacterLibraryError(
      'invalid-input',
      '禁止打开或升级旧版 oigptpet 数据库；请使用独立数据库名。',
    );
  }
  return new IndexedDbCharacterLibrary(databaseName, options);
}
