export type SupportedImageFormat = 'png' | 'webp';

export interface ImageHeader {
  format: SupportedImageFormat;
  width: number;
  height: number;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export class ImageHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageHeaderError';
  }
}

function fail(message: string): never {
  throw new ImageHeaderError(message);
}

function requireBytes(bytes: Uint8Array, length: number, label: string): void {
  if (bytes.byteLength < length) {
    fail(`${label}不完整，文件可能已被截断。`);
  }
}

function matchesAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]
      | (bytes[offset + 1] << 8)
      | (bytes[offset + 2] << 16)
      | (bytes[offset + 3] << 24))
    >>> 0
  );
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24)
      | (bytes[offset + 1] << 16)
      | (bytes[offset + 2] << 8)
      | bytes[offset + 3])
    >>> 0
  );
}

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_SIGNATURE.length) {
    return false;
  }
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

export function sniffImageFormat(bytes: Uint8Array): SupportedImageFormat | null {
  if (hasPngSignature(bytes)) {
    return 'png';
  }
  if (
    bytes.byteLength >= 12
    && matchesAscii(bytes, 0, 'RIFF')
    && matchesAscii(bytes, 8, 'WEBP')
  ) {
    return 'webp';
  }
  return null;
}

export function imageFormatFromMime(mime: string): SupportedImageFormat | null {
  const base = mime.trim().toLowerCase().split(';', 1)[0] ?? '';
  if (base === 'image/png') {
    return 'png';
  }
  if (base === 'image/webp') {
    return 'webp';
  }
  return null;
}

function parsePng(bytes: Uint8Array): ImageHeader {
  requireBytes(bytes, 24, 'PNG 文件头');
  if (!hasPngSignature(bytes)) {
    fail('PNG 签名无效。');
  }
  if (readUint32BE(bytes, 8) !== 13 || !matchesAscii(bytes, 12, 'IHDR')) {
    fail('PNG 首个数据块不是有效的 IHDR。');
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (width === 0 || height === 0) {
    fail('PNG 声明的图片尺寸为 0。');
  }
  if (width > 0x7fffffff || height > 0x7fffffff) {
    fail('PNG 声明的图片尺寸超出规范允许范围。');
  }
  return { format: 'png', width, height };
}

function parseWebp(bytes: Uint8Array): ImageHeader {
  requireBytes(bytes, 12, 'WebP 文件头');
  if (!matchesAscii(bytes, 0, 'RIFF') || !matchesAscii(bytes, 8, 'WEBP')) {
    fail('WebP RIFF 文件头无效。');
  }
  const riffEnd = 8 + readUint32LE(bytes, 4);
  if (riffEnd > bytes.byteLength) {
    fail('WebP 声明的大小超过实际数据，文件可能已被截断。');
  }

  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const chunkType = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    const chunkSize = readUint32LE(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (dataEnd > riffEnd) {
      fail(`WebP ${chunkType.trim() || '未知'} 数据块已截断。`);
    }

    if (chunkType === 'VP8X') {
      if (chunkSize < 10) {
        fail('WebP VP8X 数据块不完整。');
      }
      return {
        format: 'webp',
        width: 1 + readUint24LE(bytes, dataStart + 4),
        height: 1 + readUint24LE(bytes, dataStart + 7),
      };
    }

    if (chunkType === 'VP8L') {
      if (chunkSize < 5) {
        fail('WebP VP8L 数据块不完整。');
      }
      if (bytes[dataStart] !== 0x2f) {
        fail('WebP VP8L 签名无效。');
      }
      const bits = readUint32LE(bytes, dataStart + 1);
      return {
        format: 'webp',
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }

    if (chunkType === 'VP8 ') {
      if (chunkSize < 10) {
        fail('WebP VP8 数据块不完整。');
      }
      if (bytes[dataStart + 3] !== 0x9d || bytes[dataStart + 4] !== 0x01 || bytes[dataStart + 5] !== 0x2a) {
        fail('WebP VP8 帧头无效。');
      }
      const width = readUint16LE(bytes, dataStart + 6) & 0x3fff;
      const height = readUint16LE(bytes, dataStart + 8) & 0x3fff;
      if (width === 0 || height === 0) {
        fail('WebP 声明的图片尺寸为 0。');
      }
      return { format: 'webp', width, height };
    }

    offset = dataEnd + (chunkSize & 1);
  }

  fail('WebP 文件缺少 VP8X、VP8L 或 VP8 图像数据块。');
}

export function parseImageHeader(bytes: Uint8Array): ImageHeader {
  const format = sniffImageFormat(bytes);
  if (format === 'png') {
    return parsePng(bytes);
  }
  if (format === 'webp') {
    return parseWebp(bytes);
  }
  fail('无法识别的图片格式；仅支持 PNG 或 WebP。');
}
