import type { CharacterAsset, CharacterInput } from '../character-library';
import type { AtlasProfile } from '../target-chatgpt/contract';
import { sha256Hex } from '../atlas-preview/sha256';
import {
  CHARACTER_PACKAGE_FORMAT,
  CHARACTER_PACKAGE_HEADER_BYTES,
  CHARACTER_PACKAGE_MAGIC,
  CHARACTER_PACKAGE_MAX_BYTES,
  CHARACTER_PACKAGE_MAX_MANIFEST_BYTES,
  CHARACTER_PACKAGE_MAX_NAME_LENGTH,
  CHARACTER_PACKAGE_SCHEMA_VERSION,
  CHARACTER_PACKAGE_SPRITE_MIMES,
  CHARACTER_PACKAGE_VRM_MIME,
  CharacterPackageError,
  SPRITE_MANIFEST_FIELD_ORDER,
  VRM_MANIFEST_FIELD_ORDER,
  characterPackageLimitForKind,
  type CharacterPackageKind,
  type CharacterPackageManifest,
  type CharacterPackageResult,
  type CharacterPackageSpriteMime,
  type DecodedCharacterPackage,
  type SpritePackageManifest,
  type VrmPackageManifest,
} from './contract';

export * from './contract';

const textEncoder = new TextEncoder();
const manifestDecoder = new TextDecoder('utf-8', { fatal: true });
const magicBytes = textEncoder.encode(CHARACTER_PACKAGE_MAGIC);
const packageMime = 'application/octet-stream';

function abortError(): DOMException {
  return new DOMException('角色包操作已取消。', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

function packageError(
  code: CharacterPackageError['code'],
  message: string,
  cause?: unknown,
): CharacterPackageError {
  return new CharacterPackageError(code, message, { cause });
}

function assertBlob(value: unknown, label: string): asserts value is Blob {
  if (
    value === null
    || typeof value !== 'object'
    || typeof (value as Blob).arrayBuffer !== 'function'
    || typeof (value as Blob).slice !== 'function'
    || typeof (value as Blob).size !== 'number'
    || typeof (value as Blob).type !== 'string'
  ) {
    throw packageError('invalid-input', `${label}必须是 Blob。`);
  }
}

function assertCharacterAsset(value: unknown): asserts value is CharacterAsset {
  if (value === null || typeof value !== 'object') {
    throw packageError('invalid-input', '角色条目必须是包含 summary 和 blob 的对象。');
  }
  const asset = value as { summary?: unknown; blob?: unknown };
  if (
    asset.summary === null
    || typeof asset.summary !== 'object'
    || Array.isArray(asset.summary)
  ) {
    throw packageError('invalid-input', '角色条目缺少有效的 summary。');
  }
  assertBlob(asset.blob, '角色条目文件');
}

function normalizePackageName(value: unknown): string {
  if (typeof value !== 'string') {
    throw packageError('invalid-name', '角色名称必须是字符串。');
  }
  const name = value.trim();
  const length = Array.from(name).length;
  if (length < 1 || length > CHARACTER_PACKAGE_MAX_NAME_LENGTH) {
    throw packageError(
      'invalid-name',
      `角色名称去除首尾空白后必须为 1–${CHARACTER_PACKAGE_MAX_NAME_LENGTH} 个字符。`,
    );
  }
  return name;
}

function normalizeSpriteMime(value: unknown): CharacterPackageSpriteMime {
  if (typeof value !== 'string') {
    throw packageError('invalid-mime', '精灵图 MIME 必须是 image/png 或 image/webp。');
  }
  const base = value.trim().toLowerCase().split(';', 1)[0] ?? '';
  if (base === 'image/png' || base === 'image/webp') {
    return base;
  }
  throw packageError(
    'invalid-mime',
    `精灵图 MIME 必须为 image/png 或 image/webp，实际为 ${value || '空'}。`,
  );
}

function isSpriteProfile(value: unknown): value is AtlasProfile {
  return value === 'v1' || value === 'v2';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readManifestHeader(bytes: Uint8Array): number {
  if (bytes.byteLength !== CHARACTER_PACKAGE_HEADER_BYTES) {
    throw packageError(
      'invalid-container',
      `容器头必须为 ${CHARACTER_PACKAGE_HEADER_BYTES} 字节，实际读取 ${bytes.byteLength} 字节。`,
    );
  }
  for (let index = 0; index < magicBytes.byteLength; index += 1) {
    if (bytes[index] !== magicBytes[index]) {
      throw packageError('invalid-container', '容器标识不是 OIPET001。');
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(magicBytes.byteLength, true);
  if (length < 1 || length > CHARACTER_PACKAGE_MAX_MANIFEST_BYTES) {
    throw packageError(
      'invalid-container',
      `清单长度必须在 1–${CHARACTER_PACKAGE_MAX_MANIFEST_BYTES} 字节，实际为 ${length}。`,
    );
  }
  return length;
}

function parseManifest(bytes: Uint8Array): CharacterPackageManifest {
  let text: string;
  try {
    text = manifestDecoder.decode(bytes);
  } catch (error) {
    throw packageError('invalid-manifest', '清单不是合法的 UTF-8 数据。', error);
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw packageError('invalid-manifest', '清单不是合法的 JSON。', error);
  }
  if (!isPlainObject(value)) {
    throw packageError('invalid-manifest', '清单必须是 JSON 对象。');
  }

  if (value.format !== CHARACTER_PACKAGE_FORMAT) {
    throw packageError(
      'invalid-manifest',
      `清单 format 必须为 ${CHARACTER_PACKAGE_FORMAT}。`,
    );
  }
  if (typeof value.schemaVersion !== 'number' || !Number.isSafeInteger(value.schemaVersion)) {
    throw packageError('invalid-manifest', '清单 schemaVersion 必须是安全整数。');
  }
  if (value.schemaVersion !== CHARACTER_PACKAGE_SCHEMA_VERSION) {
    throw packageError(
      'unsupported-version',
      `不支持的角色包版本：${value.schemaVersion}。仅支持版本 ${CHARACTER_PACKAGE_SCHEMA_VERSION}。`,
    );
  }
  if (value.kind !== 'vrm' && value.kind !== 'sprite') {
    throw packageError('invalid-kind', `未知的角色类型：${String(value.kind)}。仅支持 vrm 或 sprite。`);
  }
  const kind: CharacterPackageKind = value.kind;

  const hasProfile = Object.prototype.hasOwnProperty.call(value, 'profile');
  if (kind === 'vrm' && hasProfile) {
    throw packageError('invalid-profile', 'VRM 角色包不能携带精灵图 profile。');
  }
  if (kind === 'sprite' && !hasProfile) {
    throw packageError('invalid-profile', '精灵图角色包必须携带 profile。');
  }

  for (const key of Object.keys(value)) {
    const allowed = kind === 'sprite'
      ? (SPRITE_MANIFEST_FIELD_ORDER as readonly string[]).includes(key)
      : (VRM_MANIFEST_FIELD_ORDER as readonly string[]).includes(key);
    if (!allowed) {
      throw packageError('invalid-manifest', `清单包含未知字段：${key}。`);
    }
  }

  const name = normalizePackageName(value.name);

  let mime: string;
  if (kind === 'vrm') {
    if (value.mime !== CHARACTER_PACKAGE_VRM_MIME) {
      throw packageError(
        'invalid-mime',
        `VRM 角色包 MIME 必须为 ${CHARACTER_PACKAGE_VRM_MIME}。`,
      );
    }
    mime = CHARACTER_PACKAGE_VRM_MIME;
  } else {
    if (
      value.mime !== CHARACTER_PACKAGE_SPRITE_MIMES[0]
      && value.mime !== CHARACTER_PACKAGE_SPRITE_MIMES[1]
    ) {
      throw packageError('invalid-mime', '精灵图角色包 MIME 必须为 image/png 或 image/webp。');
    }
    mime = value.mime;
  }

  if (
    typeof value.encodedBytes !== 'number'
    || !Number.isSafeInteger(value.encodedBytes)
    || value.encodedBytes <= 0
  ) {
    throw packageError('invalid-size', '清单 encodedBytes 必须是正的安全整数。');
  }
  const encodedBytes = value.encodedBytes;

  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) {
    throw packageError('invalid-manifest', '清单 sha256 必须是 64 位小写十六进制字符串。');
  }
  const sha256 = value.sha256;

  if (kind === 'vrm') {
    return {
      format: CHARACTER_PACKAGE_FORMAT,
      schemaVersion: CHARACTER_PACKAGE_SCHEMA_VERSION,
      name,
      kind: 'vrm',
      mime: CHARACTER_PACKAGE_VRM_MIME,
      encodedBytes,
      sha256,
    } satisfies VrmPackageManifest;
  }

  if (!isSpriteProfile(value.profile)) {
    throw packageError('invalid-profile', `精灵图 profile 必须为 v1 或 v2，实际为 ${String(value.profile)}。`);
  }
  return {
    format: CHARACTER_PACKAGE_FORMAT,
    schemaVersion: CHARACTER_PACKAGE_SCHEMA_VERSION,
    name,
    kind: 'sprite',
    mime: mime as CharacterPackageSpriteMime,
    encodedBytes,
    sha256,
    profile: value.profile,
  } satisfies SpritePackageManifest;
}

function buildPackage(manifest: CharacterPackageManifest, payload: ArrayBuffer): Uint8Array<ArrayBuffer> {
  const manifestBytes = textEncoder.encode(JSON.stringify(manifest));
  if (manifestBytes.byteLength > CHARACTER_PACKAGE_MAX_MANIFEST_BYTES) {
    throw packageError(
      'too-large',
      `清单为 ${manifestBytes.byteLength} 字节，超过 ${CHARACTER_PACKAGE_MAX_MANIFEST_BYTES} 字节上限。`,
    );
  }
  const total = CHARACTER_PACKAGE_HEADER_BYTES + manifestBytes.byteLength + payload.byteLength;
  if (total > CHARACTER_PACKAGE_MAX_BYTES) {
    throw packageError('too-large', `角色包为 ${total} 字节，超过 ${CHARACTER_PACKAGE_MAX_BYTES} 字节上限。`);
  }
  const container = new Uint8Array(new ArrayBuffer(total));
  container.set(magicBytes, 0);
  new DataView(container.buffer).setUint32(CHARACTER_PACKAGE_MAGIC.length, manifestBytes.byteLength, true);
  container.set(manifestBytes, CHARACTER_PACKAGE_HEADER_BYTES);
  container.set(new Uint8Array(payload), CHARACTER_PACKAGE_HEADER_BYTES + manifestBytes.byteLength);
  return container;
}

export async function encodeCharacterPackage(
  asset: CharacterAsset,
  signal?: AbortSignal,
): Promise<CharacterPackageResult> {
  throwIfAborted(signal);
  assertCharacterAsset(asset);
  const { summary, blob } = asset;
  throwIfAborted(signal);

  if (!Number.isSafeInteger(blob.size) || blob.size <= 0) {
    throw packageError('invalid-size', '角色文件大小必须是正的安全整数。');
  }
  if (summary.kind !== 'vrm' && summary.kind !== 'sprite') {
    throw packageError('invalid-kind', `未知的角色类型：${String(summary.kind)}。`);
  }
  const kind: CharacterPackageKind = summary.kind;
  if (blob.size > characterPackageLimitForKind(kind)) {
    throw packageError(
      'too-large',
      `${kind === 'vrm' ? 'VRM' : '精灵图'}为 ${blob.size} 字节，超过 ${characterPackageLimitForKind(kind)} 字节上限。`,
    );
  }
  if (!Number.isSafeInteger(summary.encodedBytes) || summary.encodedBytes !== blob.size) {
    throw packageError(
      'invalid-size',
      `条目声明 ${String(summary.encodedBytes)} 字节，实际文件为 ${blob.size} 字节。`,
    );
  }
  if (typeof summary.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(summary.sha256)) {
    throw packageError('hash-mismatch', '条目摘要必须是 64 位小写十六进制字符串。');
  }
  const name = normalizePackageName(summary.name);

  let manifest: CharacterPackageManifest;
  if (kind === 'vrm') {
    if (summary.profile !== undefined) {
      throw packageError('invalid-profile', 'VRM 条目不能携带精灵图 profile。');
    }
    manifest = {
      format: CHARACTER_PACKAGE_FORMAT,
      schemaVersion: CHARACTER_PACKAGE_SCHEMA_VERSION,
      name,
      kind: 'vrm',
      mime: CHARACTER_PACKAGE_VRM_MIME,
      encodedBytes: blob.size,
      sha256: summary.sha256,
    };
  } else {
    if (!isSpriteProfile(summary.profile)) {
      throw packageError('invalid-profile', '精灵图条目必须携带 v1 或 v2 profile。');
    }
    manifest = {
      format: CHARACTER_PACKAGE_FORMAT,
      schemaVersion: CHARACTER_PACKAGE_SCHEMA_VERSION,
      name,
      kind: 'sprite',
      mime: normalizeSpriteMime(blob.type),
      encodedBytes: blob.size,
      sha256: summary.sha256,
      profile: summary.profile,
    };
  }

  throwIfAborted(signal);
  const payload = await blob.arrayBuffer();
  throwIfAborted(signal);
  if (payload.byteLength !== blob.size) {
    throw packageError(
      'invalid-size',
      `读取到的字节数与 Blob 大小不一致（Blob ${blob.size} 字节，读取 ${payload.byteLength} 字节）。`,
    );
  }
  const assetSha256 = await sha256Hex(payload, { signal });
  throwIfAborted(signal);
  if (assetSha256 !== summary.sha256) {
    throw packageError(
      'hash-mismatch',
      `条目摘要与实际内容不一致（声明 ${summary.sha256}，实际 ${assetSha256}）。`,
    );
  }

  const container = buildPackage(manifest, payload);
  throwIfAborted(signal);
  const packageSha256 = await sha256Hex(container.buffer, { signal });
  throwIfAborted(signal);
  return {
    blob: new Blob([container], { type: packageMime }),
    sha256: packageSha256,
    encodedBytes: container.byteLength,
  };
}

async function readSlice(
  blob: Blob,
  start: number,
  end: number,
  signal: AbortSignal | undefined,
  label: string,
): Promise<Uint8Array<ArrayBuffer>> {
  throwIfAborted(signal);
  const buffer = await blob.slice(start, end).arrayBuffer();
  throwIfAborted(signal);
  if (buffer.byteLength !== end - start) {
    throw packageError(
      'invalid-container',
      `${label}读取不完整：期望 ${end - start} 字节，实际 ${buffer.byteLength} 字节。`,
    );
  }
  return new Uint8Array(buffer);
}

export async function decodeCharacterPackage(
  blob: Blob,
  signal?: AbortSignal,
): Promise<DecodedCharacterPackage> {
  throwIfAborted(signal);
  assertBlob(blob, '角色包');
  if (!Number.isSafeInteger(blob.size) || blob.size <= 0) {
    throw packageError('invalid-size', '角色包大小必须是正的安全整数。');
  }
  if (blob.size > CHARACTER_PACKAGE_MAX_BYTES) {
    throw packageError(
      'too-large',
      `角色包为 ${blob.size} 字节，超过 ${CHARACTER_PACKAGE_MAX_BYTES} 字节上限。`,
    );
  }
  if (blob.size < CHARACTER_PACKAGE_HEADER_BYTES + 2) {
    throw packageError('invalid-container', '角色包长度不足以包含清单和 payload。');
  }

  const headerBytes = await readSlice(blob, 0, CHARACTER_PACKAGE_HEADER_BYTES, signal, '容器头');
  const manifestLength = readManifestHeader(headerBytes);
  if (CHARACTER_PACKAGE_HEADER_BYTES + manifestLength >= blob.size) {
    throw packageError('invalid-container', '角色包在清单之后缺少 payload。');
  }

  const manifestBytes = await readSlice(
    blob,
    CHARACTER_PACKAGE_HEADER_BYTES,
    CHARACTER_PACKAGE_HEADER_BYTES + manifestLength,
    signal,
    '清单',
  );
  const manifest = parseManifest(manifestBytes);
  if (manifest.encodedBytes > characterPackageLimitForKind(manifest.kind)) {
    throw packageError(
      'too-large',
      `${manifest.kind === 'vrm' ? 'VRM' : '精灵图'} payload 为 ${manifest.encodedBytes} 字节，超过 ${characterPackageLimitForKind(manifest.kind)} 字节上限。`,
    );
  }

  const expectedSize = CHARACTER_PACKAGE_HEADER_BYTES + manifestLength + manifest.encodedBytes;
  if (!Number.isSafeInteger(expectedSize) || expectedSize !== blob.size) {
    throw packageError(
      'invalid-container',
      `角色包大小与清单不一致：声明 ${expectedSize} 字节，实际 ${blob.size} 字节（截断或尾随字节）。`,
    );
  }

  throwIfAborted(signal);
  const containerBuffer = await blob.arrayBuffer();
  throwIfAborted(signal);
  if (containerBuffer.byteLength !== blob.size) {
    throw packageError(
      'invalid-size',
      `读取到的字节数与 Blob 大小不一致（Blob ${blob.size} 字节，读取 ${containerBuffer.byteLength} 字节）。`,
    );
  }
  const payload = new Uint8Array(
    containerBuffer,
    CHARACTER_PACKAGE_HEADER_BYTES + manifestLength,
    manifest.encodedBytes,
  );
  if (payload.byteLength !== manifest.encodedBytes) {
    throw packageError('invalid-container', '角色包 payload 长度与清单不一致。');
  }
  const payloadForHash = payload.slice();
  const assetSha256 = await sha256Hex(payloadForHash.buffer, { signal });
  throwIfAborted(signal);
  if (assetSha256 !== manifest.sha256) {
    throw packageError(
      'hash-mismatch',
      `payload 摘要与清单不一致（清单 ${manifest.sha256}，实际 ${assetSha256}）。`,
    );
  }
  const packageSha256 = await sha256Hex(containerBuffer, { signal });
  throwIfAborted(signal);

  const payloadBlob = new Blob([payload], { type: manifest.mime });
  let input: CharacterInput;
  if (manifest.kind === 'vrm') {
    input = { kind: 'vrm', blob: payloadBlob, name: manifest.name };
  } else {
    input = {
      kind: 'sprite',
      blob: payloadBlob,
      profile: manifest.profile,
      name: manifest.name,
    };
  }
  return {
    input,
    assetSha256,
    packageSha256,
    encodedBytes: containerBuffer.byteLength,
  };
}
