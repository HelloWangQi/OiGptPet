import { inspectVrmFile, MAX_MODEL_BYTES } from '../character-core/vrm-file';
import {
  AtlasInputError,
  validateAtlasMetadata,
  validateAtlasPreflight,
} from '../atlas-preview/input';
import { sha256Hex } from '../atlas-preview/sha256';
import { inspectAtlas } from '../atlas-tools/inspect';
import type { AtlasInspection } from '../target-chatgpt/contract';
import {
  characterIdFor,
  defaultCharacterName,
  normalizeCharacterName,
} from './naming';
import {
  CharacterLibraryError,
  type CharacterInput,
  type CharacterKind,
  type CharacterSummary,
  type PreparedCharacter,
} from './types';

function abortError(message = '角色导入已取消。'): DOMException {
  return new DOMException(message, 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

function assertBlob(value: unknown): asserts value is Blob {
  if (
    value === null
    || typeof value !== 'object'
    || typeof (value as Blob).arrayBuffer !== 'function'
    || typeof (value as Blob).size !== 'number'
    || typeof (value as Blob).type !== 'string'
  ) {
    throw new CharacterLibraryError('invalid-input', '角色库只接受 Blob 文件。');
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function invalidInput(
  message: string,
  cause?: unknown,
  inspection: AtlasInspection | null = null,
): CharacterLibraryError {
  return new CharacterLibraryError('invalid-input', message, { cause, inspection });
}

async function readBlob(blob: Blob, signal?: AbortSignal): Promise<ArrayBuffer> {
  throwIfAborted(signal);
  const buffer = await blob.arrayBuffer();
  throwIfAborted(signal);
  if (buffer.byteLength !== blob.size) {
    throw new CharacterLibraryError(
      'invalid-input',
      `读取到的字节数与 Blob 大小不一致（Blob ${blob.size} 字节，读取 ${buffer.byteLength} 字节）。`,
    );
  }
  return buffer;
}

function decodeBitmap(blob: Blob, signal?: AbortSignal): Promise<ImageBitmap> {
  return new Promise<ImageBitmap>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    let decode: Promise<ImageBitmap>;
    try {
      if (typeof createImageBitmap !== 'function') {
        throw new Error('当前环境不支持 createImageBitmap。');
      }
      decode = createImageBitmap(blob, {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
      });
    } catch (error) {
      signal?.removeEventListener('abort', onAbort);
      settled = true;
      reject(invalidInput(`无法解码精灵图图集：${messageOf(error)}`, error));
      return;
    }

    decode.then((bitmap) => {
      signal?.removeEventListener('abort', onAbort);
      if (settled) {
        bitmap.close();
        return;
      }
      settled = true;
      resolve(bitmap);
    }, (error) => {
      signal?.removeEventListener('abort', onAbort);
      if (settled) {
        return;
      }
      settled = true;
      reject(invalidInput(`无法解码精灵图图集：${messageOf(error)}`, error));
    });

    if (signal?.aborted) {
      onAbort();
    }
  });
}

function readPixels(bitmap: ImageBitmap): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new CharacterLibraryError(
      'storage',
      '无法创建用于图集结构检查的 Canvas 2D 上下文。',
    );
  }
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

async function prepareVrm(
  blob: Blob,
  explicitName: string | null,
  signal?: AbortSignal,
): Promise<PreparedCharacter> {
  if (!Number.isSafeInteger(blob.size) || blob.size <= 0) {
    throw new CharacterLibraryError('invalid-input', 'VRM 文件必须是非空文件。');
  }
  if (blob.size > MAX_MODEL_BYTES) {
    throw new CharacterLibraryError(
      'invalid-input',
      `模型不能超过 64 MiB（${MAX_MODEL_BYTES} 字节）。`,
    );
  }
  const buffer = await readBlob(blob, signal);
  throwIfAborted(signal);

  let staticName: string;
  try {
    staticName = inspectVrmFile(buffer).name;
  } catch (error) {
    throw invalidInput(messageOf(error), error);
  }
  throwIfAborted(signal);

  const sha256 = await sha256Hex(buffer, { signal });
  throwIfAborted(signal);
  const name = explicitName ?? defaultCharacterName(staticName, '本地角色');
  const summary: CharacterSummary = {
    id: characterIdFor('vrm', sha256),
    kind: 'vrm',
    name,
    sha256,
    encodedBytes: blob.size,
    createdAt: new Date().toISOString(),
  };
  return { summary, blob };
}

async function prepareSprite(
  blob: Blob,
  profile: 'v1' | 'v2',
  explicitName: string | null,
  signal?: AbortSignal,
): Promise<PreparedCharacter> {
  try {
    validateAtlasPreflight(profile, blob.size, blob.type);
  } catch (error) {
    throw invalidInput(messageOf(error), error);
  }
  const buffer = await readBlob(blob, signal);
  throwIfAborted(signal);

  let header;
  try {
    header = validateAtlasMetadata(
      { bytes: new Uint8Array(buffer), size: blob.size, mime: blob.type },
      profile,
    );
  } catch (error) {
    throw invalidInput(messageOf(error), error);
  }
  throwIfAborted(signal);

  const sha256 = await sha256Hex(buffer, { signal });
  throwIfAborted(signal);

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await decodeBitmap(blob, signal);
    throwIfAborted(signal);
    if (bitmap.width !== header.width || bitmap.height !== header.height) {
      throw invalidInput(
        `解码后的图集尺寸为 ${bitmap.width}×${bitmap.height}，与文件头声明的 ${header.width}×${header.height} 不一致。`,
      );
    }
    const data = readPixels(bitmap);
    throwIfAborted(signal);
    const inspection = inspectAtlas(
      { width: bitmap.width, height: bitmap.height, data },
      profile,
      blob.size,
    );
    throwIfAborted(signal);
    if (!inspection.valid) {
      throw invalidInput(
        `图集结构检查未通过（${inspection.errors.length} 项）：${inspection.errors
          .map((issue) => issue.message)
          .join(' ')}`,
        undefined,
        inspection,
      );
    }

    const summary: CharacterSummary = {
      id: characterIdFor('sprite', sha256, profile),
      kind: 'sprite',
      name: explicitName ?? '精灵图',
      sha256,
      encodedBytes: blob.size,
      createdAt: new Date().toISOString(),
      profile,
    };
    return { summary, blob };
  } catch (error) {
    if (error instanceof CharacterLibraryError || (error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }
    if (error instanceof AtlasInputError) {
      throw invalidInput(error.message, error);
    }
    throw invalidInput(`无法检查精灵图图集：${messageOf(error)}`, error);
  } finally {
    bitmap?.close();
  }
}

export async function prepareCharacter(
  input: CharacterInput,
  signal?: AbortSignal,
): Promise<PreparedCharacter> {
  throwIfAborted(signal);
  if (input === null || typeof input !== 'object') {
    throw new CharacterLibraryError('invalid-input', '角色输入必须是对象。');
  }
  assertBlob(input.blob);

  const kind = input.kind as CharacterKind;
  const explicitName = input.name === undefined
    ? null
    : normalizeCharacterName(input.name);

  if (kind === 'vrm') {
    if ('profile' in input && input.profile !== undefined) {
      throw new CharacterLibraryError('invalid-input', 'VRM 条目不能携带图集 profile。');
    }
    return prepareVrm(input.blob, explicitName, signal);
  }

  if (kind === 'sprite') {
    const sprite = input as Extract<CharacterInput, { kind: 'sprite' }>;
    if (sprite.profile !== 'v1' && sprite.profile !== 'v2') {
      throw new CharacterLibraryError(
        'invalid-input',
        `精灵图条目必须指定 v1 或 v2 profile，实际为 ${String(sprite.profile)}。`,
      );
    }
    return prepareSprite(sprite.blob, sprite.profile, explicitName, signal);
  }

  throw new CharacterLibraryError(
    'invalid-input',
    `未知的角色类型：${String(input.kind)}。仅支持 vrm 或 sprite。`,
  );
}
