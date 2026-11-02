import {
  CHARACTER_PACKAGE_CONTRACT,
  CHARACTER_PACKAGE_FORMAT,
  CHARACTER_PACKAGE_HEADER_BYTES,
  CHARACTER_PACKAGE_MAGIC,
  CHARACTER_PACKAGE_MAX_MANIFEST_BYTES,
  CHARACTER_PACKAGE_MAX_NAME_LENGTH,
  CHARACTER_PACKAGE_MAX_SPRITE_BYTES,
  CHARACTER_PACKAGE_MAX_VRM_BYTES,
  CHARACTER_PACKAGE_SCHEMA_VERSION,
  CHARACTER_PACKAGE_SPRITE_MIMES,
  CHARACTER_PACKAGE_VRM_MIME,
  CharacterPackageError,
  SPRITE_MANIFEST_FIELD_ORDER,
  VRM_MANIFEST_FIELD_ORDER,
  decodeCharacterPackage,
  encodeCharacterPackage,
  type CharacterPackageResult,
} from '../../../packages/character-package/index.ts';
import { sha256Hex } from '../../../packages/atlas-preview/sha256.ts';
import {
  CHARACTER_LIBRARY_DEFAULT_DATABASE,
  CharacterLibraryError,
  createCharacterLibrary,
  type CharacterInput,
  type CharacterLibrary,
  type CharacterSummary,
} from '../../../packages/character-library/index.ts';

type Profile = 'v1' | 'v2';

interface ErrorInfo {
  name: string;
  message: string;
  code: string | null;
}

type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: ErrorInfo };

interface BlobInfo {
  key: string;
  size: number;
  type: string;
  sha256: string;
}

interface PackageInfo extends BlobInfo {
  encodedBytes: number;
  magic: string;
  manifestLength: number;
  totalSize: number;
  manifest: Record<string, unknown>;
  fieldOrder: string[];
}

interface DecodedInfo extends BlobInfo {
  name: string;
  kind: 'vrm' | 'sprite';
  profile?: Profile;
  assetSha256: string;
  packageSha256: string;
  encodedBytes: number;
}

interface StoredInfo {
  summary: CharacterSummary;
  sha256: string;
  size: number;
  type: string;
}

interface GeneratedWebp extends BlobInfo {
  base64: string;
}

interface CancelInfo {
  ok: boolean;
  error: ErrorInfo | null;
  elapsedMs: number;
  encodedBytes: number | null;
}

type TamperMode = 'truncate' | 'trailing' | 'payload-flip' | 'manifest-flip';

interface CharacterPackageFixture {
  constants: () => {
    magic: string;
    headerBytes: number;
    format: string;
    schemaVersion: number;
    maxNameLength: number;
    maxManifestBytes: number;
    maxVrmBytes: number;
    maxSpriteBytes: number;
    maxBytes: number;
    vrmMime: string;
    spriteMimes: string[];
    vrmFields: string[];
    spriteFields: string[];
    defaultDatabase: string;
  };
  create: (handle: string, databaseName: string) => Promise<Outcome<void>>;
  close: (handle: string) => Promise<Outcome<void>>;
  list: (handle: string) => Promise<Outcome<CharacterSummary[]>>;
  add: (
    handle: string,
    kind: 'vrm' | 'sprite',
    key: string,
    profile: Profile | null,
    name?: string,
  ) => Promise<Outcome<CharacterSummary>>;
  stored: (handle: string, id: string) => Promise<Outcome<StoredInfo | null>>;
  fetchUrl: (url: string) => Promise<Outcome<BlobInfo>>;
  encode: (handle: string, id: string) => Promise<Outcome<PackageInfo>>;
  decode: (key: string) => Promise<Outcome<DecodedInfo>>;
  addDecoded: (
    handle: string,
    decodedKey: string,
    name?: string,
  ) => Promise<Outcome<CharacterSummary>>;
  makeWebp: (key: string, quality?: number) => Promise<Outcome<GeneratedWebp>>;
  makeInvalidContainer: (
    kind: 'vrm' | 'sprite',
    name: string,
    profile: Profile | null,
    text: string,
  ) => Promise<Outcome<BlobInfo>>;
  tamper: (key: string, mode: TamperMode) => Promise<Outcome<BlobInfo>>;
  encodeCancelled: (
    handle: string,
    id: string,
    mode: 'immediate' | 'timer',
  ) => Promise<CancelInfo>;
  decodeCancelled: (
    key: string,
    mode: 'immediate' | 'timer',
  ) => Promise<CancelInfo>;
  setStatus: (text: string) => void;
}

declare global {
  interface Window {
    __packageFixture: CharacterPackageFixture;
  }
}

const LOG = document.querySelector<HTMLElement>('#log');
const STATUS = document.querySelector<HTMLElement>('#status');

const libraries = new Map<string, CharacterLibrary>();
const blobs = new Map<string, Blob>();
const decodedInputs = new Map<string, CharacterInput>();
let sequence = 0;

function log(message: string): void {
  if (!LOG) {
    return;
  }
  LOG.textContent = `${new Date().toISOString()} ${message}\n${LOG.textContent ?? ''}`;
}

function setStatus(text: string): void {
  if (STATUS) {
    STATUS.textContent = text;
  }
  log(text);
}

function errorInfo(error: unknown): ErrorInfo {
  let code: string | null = null;
  if (error instanceof CharacterPackageError || error instanceof CharacterLibraryError) {
    code = error.code;
  } else if (error !== null && typeof error === 'object') {
    const candidate = error as { code?: unknown };
    code = typeof candidate.code === 'string' ? candidate.code : null;
  }
  return {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    code,
  };
}

async function settle<T>(action: () => T | Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, error: errorInfo(error) };
  }
}

function requireLibrary(handle: string): CharacterLibrary {
  const library = libraries.get(handle);
  if (!library) {
    throw new Error(`未知的 fixture 句柄：${handle}`);
  }
  return library;
}

function requireBlob(key: string): Blob {
  const blob = blobs.get(key);
  if (!blob) {
    throw new Error(`未知的 fixture Blob：${key}`);
  }
  return blob;
}

function registerBlob(blob: Blob): string {
  sequence += 1;
  const key = `package-blob-${sequence}`;
  blobs.set(key, blob);
  return key;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function hashBlob(blob: Blob): Promise<string> {
  return sha256Hex(await blob.arrayBuffer());
}

async function describeBlob(key: string): Promise<BlobInfo> {
  const blob = requireBlob(key);
  return {
    key,
    size: blob.size,
    type: blob.type,
    sha256: await hashBlob(blob),
  };
}

function createInput(
  kind: 'vrm' | 'sprite',
  blob: Blob,
  profile: Profile | null,
  name: string | null | undefined,
): CharacterInput {
  if (kind === 'vrm') {
    return name === undefined || name === null
      ? { kind: 'vrm', blob }
      : { kind: 'vrm', blob, name };
  }
  if (profile !== 'v1' && profile !== 'v2') {
    throw new Error(`精灵图需要 v1 或 v2 profile，收到 ${String(profile)}。`);
  }
  return name === undefined || name === null
    ? { kind: 'sprite', blob, profile }
    : { kind: 'sprite', blob, profile, name };
}

function withName(input: CharacterInput, name: string | undefined): CharacterInput {
  if (name === undefined) {
    return input;
  }
  return input.kind === 'vrm'
    ? { kind: 'vrm', blob: input.blob, name }
    : { kind: 'sprite', blob: input.blob, profile: input.profile, name };
}

async function fetchUrl(url: string): Promise<BlobInfo> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`无法获取 fixture 输入 ${url}：HTTP ${response.status}。`);
  }
  const blob = await response.blob();
  return describeBlob(registerBlob(blob));
}

async function add(
  handle: string,
  kind: 'vrm' | 'sprite',
  key: string,
  profile: Profile | null,
  name?: string,
): Promise<CharacterSummary> {
  return requireLibrary(handle).add(createInput(kind, requireBlob(key), profile, name));
}

async function stored(handle: string, id: string): Promise<StoredInfo | null> {
  const asset = await requireLibrary(handle).get(id);
  if (!asset) {
    return null;
  }
  return {
    summary: asset.summary,
    sha256: await hashBlob(asset.blob),
    size: asset.blob.size,
    type: asset.blob.type,
  };
}

async function inspectPackage(
  key: string,
  result: CharacterPackageResult,
): Promise<PackageInfo> {
  const blob = requireBlob(key);
  const header = new Uint8Array(
    await blob.slice(0, CHARACTER_PACKAGE_HEADER_BYTES).arrayBuffer(),
  );
  const magic = new TextDecoder().decode(header.subarray(0, 8));
  const manifestLength = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  ).getUint32(8, true);
  const manifestBytes = new Uint8Array(
    await blob.slice(
      CHARACTER_PACKAGE_HEADER_BYTES,
      CHARACTER_PACKAGE_HEADER_BYTES + manifestLength,
    ).arrayBuffer(),
  );
  const manifest = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes),
  ) as Record<string, unknown>;
  return {
    key,
    size: blob.size,
    type: blob.type,
    sha256: result.sha256,
    encodedBytes: result.encodedBytes,
    magic,
    manifestLength,
    totalSize: blob.size,
    manifest,
    fieldOrder: Object.keys(manifest),
  };
}

async function encode(handle: string, id: string): Promise<PackageInfo> {
  const asset = await requireLibrary(handle).get(id);
  if (!asset) {
    throw new Error(`未找到角色：${id}`);
  }
  const result = await encodeCharacterPackage(asset);
  return inspectPackage(registerBlob(result.blob), result);
}

async function decode(key: string): Promise<DecodedInfo> {
  const decoded = await decodeCharacterPackage(requireBlob(key));
  const payloadKey = registerBlob(decoded.input.blob);
  decodedInputs.set(payloadKey, decoded.input);
  const payload = decoded.input.blob;
  return {
    key: payloadKey,
    size: payload.size,
    type: payload.type,
    sha256: await hashBlob(payload),
    name: decoded.input.name ?? '',
    kind: decoded.input.kind,
    ...(decoded.input.kind === 'sprite' ? { profile: decoded.input.profile } : {}),
    assetSha256: decoded.assetSha256,
    packageSha256: decoded.packageSha256,
    encodedBytes: decoded.encodedBytes,
  };
}

async function addDecoded(
  handle: string,
  decodedKey: string,
  name?: string,
): Promise<CharacterSummary> {
  const input = decodedInputs.get(decodedKey);
  if (!input) {
    throw new Error(`未知的解码结果：${decodedKey}`);
  }
  return requireLibrary(handle).add(withName(input, name));
}

async function makeWebp(key: string, quality = 1): Promise<GeneratedWebp> {
  const source = requireBlob(key);
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Fixture 无法创建 Canvas 2D 上下文。');
    }
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (encoded) => {
          if (!encoded) {
            reject(new Error('Canvas 无法编码 WebP。'));
            return;
          }
          resolve(encoded);
        },
        'image/webp',
        quality,
      );
    });
    if (blob.type !== 'image/webp') {
      throw new Error(`Canvas 编码类型为 ${blob.type || '空'}，预期 image/webp。`);
    }
    const generated = registerBlob(blob);
    return {
      ...(await describeBlob(generated)),
      base64: await blobToBase64(blob),
    };
  } finally {
    bitmap.close();
  }
}

function buildRawContainer(
  manifest: Record<string, unknown>,
  payload: Uint8Array,
): Blob {
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const bytes = new Uint8Array(
    CHARACTER_PACKAGE_HEADER_BYTES + manifestBytes.byteLength + payload.byteLength,
  );
  bytes.set(new TextEncoder().encode(CHARACTER_PACKAGE_MAGIC), 0);
  new DataView(bytes.buffer).setUint32(8, manifestBytes.byteLength, true);
  bytes.set(manifestBytes, CHARACTER_PACKAGE_HEADER_BYTES);
  bytes.set(payload, CHARACTER_PACKAGE_HEADER_BYTES + manifestBytes.byteLength);
  return new Blob([bytes], { type: 'application/octet-stream' });
}

async function makeInvalidContainer(
  kind: 'vrm' | 'sprite',
  name: string,
  profile: Profile | null,
  text: string,
): Promise<BlobInfo> {
  const mime = kind === 'vrm'
    ? CHARACTER_PACKAGE_VRM_MIME
    : CHARACTER_PACKAGE_SPRITE_MIMES[0];
  const payloadBytes = new Uint8Array(
    await new Blob([text], { type: mime }).arrayBuffer(),
  );
  const manifest: Record<string, unknown> = {
    format: CHARACTER_PACKAGE_FORMAT,
    schemaVersion: CHARACTER_PACKAGE_SCHEMA_VERSION,
    name,
    kind,
    mime,
    encodedBytes: payloadBytes.byteLength,
    sha256: await sha256Hex(payloadBytes.buffer),
  };
  if (kind === 'sprite') {
    if (profile !== 'v1' && profile !== 'v2') {
      throw new Error(`精灵图需要 v1 或 v2 profile，收到 ${String(profile)}。`);
    }
    manifest.profile = profile;
  }
  return describeBlob(registerBlob(buildRawContainer(manifest, payloadBytes)));
}

async function tamper(key: string, mode: TamperMode): Promise<BlobInfo> {
  const source = requireBlob(key);
  const bytes = new Uint8Array(await source.arrayBuffer());
  if (bytes.byteLength < CHARACTER_PACKAGE_HEADER_BYTES + 2) {
    throw new Error('角色包过短，无法构造损坏样本。');
  }
  let mutated: Uint8Array<ArrayBuffer>;
  if (mode === 'truncate') {
    mutated = bytes.slice(0, bytes.byteLength - 1);
  } else if (mode === 'trailing') {
    mutated = new Uint8Array(new ArrayBuffer(bytes.byteLength + 1));
    mutated.set(bytes);
  } else {
    mutated = bytes.slice();
    if (mode === 'payload-flip') {
      mutated[mutated.byteLength - 1] ^= 0xff;
    } else {
      mutated[CHARACTER_PACKAGE_HEADER_BYTES] ^= 0x01;
    }
  }
  return describeBlob(
    registerBlob(new Blob([mutated], { type: source.type })),
  );
}

async function encodeCancelled(
  handle: string,
  id: string,
  mode: 'immediate' | 'timer',
): Promise<CancelInfo> {
  const asset = await requireLibrary(handle).get(id);
  if (!asset) {
    throw new Error(`未找到角色：${id}`);
  }
  const controller = new AbortController();
  const startedAt = performance.now();
  let timer: number | null = null;
  if (mode === 'immediate') {
    controller.abort();
  } else {
    timer = window.setTimeout(() => controller.abort(), 0);
  }
  try {
    const result = await encodeCharacterPackage(asset, controller.signal);
    return {
      ok: true,
      error: null,
      elapsedMs: performance.now() - startedAt,
      encodedBytes: result.encodedBytes,
    };
  } catch (error) {
    return {
      ok: false,
      error: errorInfo(error),
      elapsedMs: performance.now() - startedAt,
      encodedBytes: null,
    };
  } finally {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  }
}

async function decodeCancelled(
  key: string,
  mode: 'immediate' | 'timer',
): Promise<CancelInfo> {
  const blob = requireBlob(key);
  const controller = new AbortController();
  const startedAt = performance.now();
  let timer: number | null = null;
  if (mode === 'immediate') {
    controller.abort();
  } else {
    timer = window.setTimeout(() => controller.abort(), 0);
  }
  try {
    const result = await decodeCharacterPackage(blob, controller.signal);
    return {
      ok: true,
      error: null,
      elapsedMs: performance.now() - startedAt,
      encodedBytes: result.encodedBytes,
    };
  } catch (error) {
    return {
      ok: false,
      error: errorInfo(error),
      elapsedMs: performance.now() - startedAt,
      encodedBytes: null,
    };
  } finally {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  }
}

window.__packageFixture = {
  constants: () => ({
    magic: CHARACTER_PACKAGE_MAGIC,
    headerBytes: CHARACTER_PACKAGE_HEADER_BYTES,
    format: CHARACTER_PACKAGE_FORMAT,
    schemaVersion: CHARACTER_PACKAGE_SCHEMA_VERSION,
    maxNameLength: CHARACTER_PACKAGE_MAX_NAME_LENGTH,
    maxManifestBytes: CHARACTER_PACKAGE_MAX_MANIFEST_BYTES,
    maxVrmBytes: CHARACTER_PACKAGE_MAX_VRM_BYTES,
    maxSpriteBytes: CHARACTER_PACKAGE_MAX_SPRITE_BYTES,
    maxBytes: CHARACTER_PACKAGE_CONTRACT.maxPackageBytes,
    vrmMime: CHARACTER_PACKAGE_VRM_MIME,
    spriteMimes: [...CHARACTER_PACKAGE_SPRITE_MIMES],
    vrmFields: [...VRM_MANIFEST_FIELD_ORDER],
    spriteFields: [...SPRITE_MANIFEST_FIELD_ORDER],
    defaultDatabase: CHARACTER_LIBRARY_DEFAULT_DATABASE,
  }),
  create: (handle, databaseName) => settle(() => {
    if (libraries.has(handle)) {
      throw new Error(`fixture 句柄已存在：${handle}`);
    }
    libraries.set(handle, createCharacterLibrary({ databaseName }));
  }),
  close: (handle) => settle(() => {
    const library = requireLibrary(handle);
    library.close();
    libraries.delete(handle);
  }),
  list: (handle) => settle(() => requireLibrary(handle).list()),
  add: (handle, kind, key, profile, name) => settle(
    () => add(handle, kind, key, profile, name),
  ),
  stored: (handle, id) => settle(() => stored(handle, id)),
  fetchUrl: (url) => settle(() => fetchUrl(url)),
  encode: (handle, id) => settle(() => encode(handle, id)),
  decode: (key) => settle(() => decode(key)),
  addDecoded: (handle, decodedKey, name) => settle(
    () => addDecoded(handle, decodedKey, name),
  ),
  makeWebp: (key, quality) => settle(() => makeWebp(key, quality)),
  makeInvalidContainer: (kind, name, profile, text) => settle(
    () => makeInvalidContainer(kind, name, profile, text),
  ),
  tamper: (key, mode) => settle(() => tamper(key, mode)),
  encodeCancelled: (handle, id, mode) => encodeCancelled(handle, id, mode),
  decodeCancelled: (key, mode) => decodeCancelled(key, mode),
  setStatus,
};
