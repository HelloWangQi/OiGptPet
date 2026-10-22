import {
  MAX_ENCODED_BYTES,
  atlasDimensions,
  type AtlasProfile,
} from '../target-chatgpt/contract';
import {
  ImageHeaderError,
  imageFormatFromMime,
  parseImageHeader,
  sniffImageFormat,
  type ImageHeader,
  type SupportedImageFormat,
} from './image-format';

export type AtlasInputErrorCode =
  | 'profile'
  | 'file-size'
  | 'mime'
  | 'format'
  | 'dimensions';

export class AtlasInputError extends Error {
  readonly code: AtlasInputErrorCode;

  constructor(code: AtlasInputErrorCode, message: string) {
    super(message);
    this.name = 'AtlasInputError';
    this.code = code;
  }
}

export interface AtlasInputMetadata {
  bytes: Uint8Array;
  size: number;
  mime: string;
}

function isKnownProfile(profile: unknown): profile is AtlasProfile {
  return profile === 'v1' || profile === 'v2';
}

/**
 * Cheap checks that run before reading the Blob, so an oversized or
 * unsupported file is rejected without allocating its bytes.
 */
export function validateAtlasPreflight(
  profile: AtlasProfile,
  size: number,
  mime: string,
): SupportedImageFormat {
  if (!isKnownProfile(profile)) {
    throw new AtlasInputError(
      'profile',
      `无效的图集规格：${String(profile)}。仅支持 v1 或 v2。`,
    );
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new AtlasInputError(
      'file-size',
      `图集文件大小必须是正整数，实际为 ${String(size)} 字节。`,
    );
  }
  if (size > MAX_ENCODED_BYTES) {
    throw new AtlasInputError(
      'file-size',
      `图集文件为 ${size} 字节，超过 20 MiB（${MAX_ENCODED_BYTES} 字节）上限。`,
    );
  }
  if (typeof mime !== 'string' || mime.trim() === '') {
    throw new AtlasInputError(
      'mime',
      '图集文件缺少 MIME 类型；请使用 image/png 或 image/webp。',
    );
  }
  const format = imageFormatFromMime(mime);
  if (format === null) {
    throw new AtlasInputError(
      'mime',
      `不支持的图集 MIME 类型：${mime}。仅支持 image/png 或 image/webp。`,
    );
  }
  return format;
}

export function validateAtlasMetadata(
  input: AtlasInputMetadata,
  profile: AtlasProfile,
): ImageHeader {
  const mimeFormat = validateAtlasPreflight(profile, input.size, input.mime);

  if (input.bytes.byteLength !== input.size) {
    throw new AtlasInputError(
      'file-size',
      `读取到的字节数与 Blob 大小不一致（Blob ${input.size} 字节，读取 ${input.bytes.byteLength} 字节）。`,
    );
  }

  const sniffed = sniffImageFormat(input.bytes);
  if (sniffed === null) {
    throw new AtlasInputError(
      'format',
      '无法识别的图集格式；仅支持 PNG 或 WebP。',
    );
  }
  if (sniffed !== mimeFormat) {
    throw new AtlasInputError(
      'format',
      `MIME 类型 image/${mimeFormat} 与实际的 ${sniffed.toUpperCase()} 格式不一致。`,
    );
  }

  let header: ImageHeader;
  try {
    header = parseImageHeader(input.bytes);
  } catch (error) {
    if (error instanceof ImageHeaderError) {
      throw new AtlasInputError('format', error.message);
    }
    throw error;
  }

  const expected = atlasDimensions(profile);
  if (header.width !== expected.width || header.height !== expected.height) {
    throw new AtlasInputError(
      'dimensions',
      `图集尺寸必须为 ${expected.width}×${expected.height}（${profile}），实际为 ${header.width}×${header.height}。`,
    );
  }

  return header;
}
