import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  imageFormatFromMime,
  parseImageHeader,
  sniffImageFormat,
} from '../packages/atlas-preview/image-format';
import { sha256Hex } from '../packages/atlas-preview/sha256';
import {
  AtlasInputError,
  validateAtlasMetadata,
  validateAtlasPreflight,
  type AtlasInputErrorCode,
} from '../packages/atlas-preview/input';
import {
  MAX_ENCODED_BYTES,
  atlasDimensions,
  type AtlasProfile,
} from '../packages/target-chatgpt/contract';

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    bytes[offset + index] = text.charCodeAt(index);
  }
}

function writeUint16LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint24LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  writeUint32BE(bytes, 8, 13);
  writeAscii(bytes, 12, 'IHDR');
  writeUint32BE(bytes, 16, width);
  writeUint32BE(bytes, 20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((length, part) => length + part.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function webpChunk(fourcc: string, payload: Uint8Array): Uint8Array {
  const padded = payload.byteLength + (payload.byteLength & 1);
  const bytes = new Uint8Array(8 + padded);
  writeAscii(bytes, 0, fourcc);
  writeUint32LE(bytes, 4, payload.byteLength);
  bytes.set(payload, 8);
  return bytes;
}

function webpBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  const body = concatenate(chunks);
  const riffSize = 4 + body.byteLength;
  const bytes = new Uint8Array(8 + riffSize);
  writeAscii(bytes, 0, 'RIFF');
  writeUint32LE(bytes, 4, riffSize);
  writeAscii(bytes, 8, 'WEBP');
  bytes.set(body, 12);
  return bytes;
}

function vp8xChunk(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(10);
  payload[0] = 0x10;
  writeUint24LE(payload, 4, width - 1);
  writeUint24LE(payload, 7, height - 1);
  return webpChunk('VP8X', payload);
}

function vp8lChunk(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(5);
  payload[0] = 0x2f;
  const bits = (width - 1) | ((height - 1) << 14);
  writeUint32LE(payload, 1, bits);
  return webpChunk('VP8L', payload);
}

function vp8Chunk(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(10);
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  writeUint16LE(payload, 6, width);
  writeUint16LE(payload, 8, height);
  return webpChunk('VP8 ', payload);
}

function expectInputError(
  action: () => unknown,
  code: AtlasInputErrorCode,
): AtlasInputError {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected AtlasInputError(${code})`).toBeInstanceOf(AtlasInputError);
  const inputError = caught as AtlasInputError;
  expect(inputError.code).toBe(code);
  expect(inputError.message.length).toBeGreaterThan(0);
  return inputError;
}

describe('image header detection', () => {
  it('sniffs PNG and WebP signatures and ignores unknown data', () => {
    expect(sniffImageFormat(pngBytes(1536, 2288))).toBe('png');
    expect(sniffImageFormat(webpBytes(vp8xChunk(1536, 2288)))).toBe('webp');
    expect(sniffImageFormat(new Uint8Array([137, 80, 78, 71]))).toBeNull();
    expect(sniffImageFormat(new Uint8Array(0))).toBeNull();
    expect(sniffImageFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    const riffNotWebp = new Uint8Array(12);
    writeAscii(riffNotWebp, 0, 'RIFF');
    writeAscii(riffNotWebp, 8, 'WAVE');
    expect(sniffImageFormat(riffNotWebp)).toBeNull();
  });

  it('parses PNG dimensions from a valid IHDR chunk', () => {
    expect(parseImageHeader(pngBytes(1536, 2288))).toEqual({
      format: 'png',
      width: 1536,
      height: 2288,
    });
    expect(parseImageHeader(pngBytes(1, 1))).toEqual({
      format: 'png',
      width: 1,
      height: 1,
    });
  });

  it('rejects truncated PNG headers and malformed IHDR data', () => {
    expect(() => parseImageHeader(pngBytes(1536, 2288).slice(0, 20))).toThrow(/不完整/);
    expect(() => parseImageHeader(pngBytes(0, 2288))).toThrow(/尺寸为 0/);
    expect(() => parseImageHeader(pngBytes(1536, 0))).toThrow(/尺寸为 0/);
    expect(() => parseImageHeader(pngBytes(0xffffffff, 2288))).toThrow(/超出规范/);

    const badLength = pngBytes(1536, 2288);
    writeUint32BE(badLength, 8, 12);
    expect(() => parseImageHeader(badLength)).toThrow(/IHDR/);

    const badType = pngBytes(1536, 2288);
    writeAscii(badType, 12, 'IDAT');
    expect(() => parseImageHeader(badType)).toThrow(/IHDR/);
  });

  it('parses VP8X, VP8L and VP8 WebP dimensions', () => {
    expect(parseImageHeader(webpBytes(vp8xChunk(1536, 2288)))).toEqual({
      format: 'webp',
      width: 1536,
      height: 2288,
    });
    expect(parseImageHeader(webpBytes(vp8lChunk(192, 208)))).toEqual({
      format: 'webp',
      width: 192,
      height: 208,
    });
    expect(parseImageHeader(webpBytes(vp8Chunk(1536, 1872)))).toEqual({
      format: 'webp',
      width: 1536,
      height: 1872,
    });
  });

  it('rejects truncated or unrecognized WebP containers', () => {
    const truncated = webpBytes(vp8xChunk(1536, 2288)).slice(0, -4);
    expect(() => parseImageHeader(truncated)).toThrow(/截断|大小超过实际数据/);

    const noImage = webpBytes(webpChunk('JUNK', new Uint8Array([1, 2, 3])));
    expect(() => parseImageHeader(noImage)).toThrow(/缺少/);

    const shortChunk = webpBytes(webpChunk('VP8L', new Uint8Array([0x2f, 1])));
    expect(() => parseImageHeader(shortChunk)).toThrow(/VP8L 数据块不完整/);

    const badLosslessSignature = webpBytes(webpChunk('VP8L', new Uint8Array(5)));
    expect(() => parseImageHeader(badLosslessSignature)).toThrow(/VP8L 签名无效/);

    const badLossyHeader = webpBytes(webpChunk('VP8 ', new Uint8Array(10)));
    expect(() => parseImageHeader(badLossyHeader)).toThrow(/VP8 帧头无效/);
  });

  it('normalizes supported MIME values and rejects others', () => {
    expect(imageFormatFromMime('image/png')).toBe('png');
    expect(imageFormatFromMime('IMAGE/PNG')).toBe('png');
    expect(imageFormatFromMime(' image/webp; charset=binary ')).toBe('webp');
    expect(imageFormatFromMime('')).toBeNull();
    expect(imageFormatFromMime('image/jpeg')).toBeNull();
    expect(imageFormatFromMime('image/pngx')).toBeNull();
    expect(imageFormatFromMime('application/octet-stream')).toBeNull();
  });
});

describe('atlas input preflight', () => {
  it('accepts both profiles with supported MIME types and the size limit', () => {
    expect(validateAtlasPreflight('v1', 1, 'image/png')).toBe('png');
    expect(validateAtlasPreflight('v2', MAX_ENCODED_BYTES, 'image/webp')).toBe('webp');
    expect(validateAtlasPreflight('v2', MAX_ENCODED_BYTES, 'IMAGE/WEBP')).toBe('webp');
  });

  it('rejects unknown profiles', () => {
    const error = expectInputError(
      () => validateAtlasPreflight('v3' as AtlasProfile, 10, 'image/png'),
      'profile',
    );
    expect(error.message).toMatch(/v1 或 v2/);
    expectInputError(
      () => validateAtlasPreflight(undefined as unknown as AtlasProfile, 10, 'image/png'),
      'profile',
    );
  });

  it('rejects invalid and oversized encoded sizes before reading the blob', () => {
    for (const size of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expectInputError(
        () => validateAtlasPreflight('v1', size, 'image/png'),
        'file-size',
      );
    }
    const oversized = expectInputError(
      () => validateAtlasPreflight('v2', MAX_ENCODED_BYTES + 1, 'image/png'),
      'file-size',
    );
    expect(oversized.message).toMatch(/20 MiB/);
  });

  it('requires an explicit supported MIME type', () => {
    expectInputError(() => validateAtlasPreflight('v1', 10, ''), 'mime');
    expectInputError(() => validateAtlasPreflight('v1', 10, '   '), 'mime');
    expectInputError(
      () => validateAtlasPreflight('v1', 10, undefined as unknown as string),
      'mime',
    );
    expectInputError(
      () => validateAtlasPreflight('v1', 10, 'image/jpeg'),
      'mime',
    );
    expectInputError(
      () => validateAtlasPreflight('v1', 10, 'application/octet-stream'),
      'mime',
    );
  });
});

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function referenceSha256(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return createHash('sha256').update(bytes).digest('hex');
}

function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

const REAL_PNG = base64Bytes(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
);
const REAL_WEBP = base64Bytes(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
);

describe('SHA-256 digest', () => {
  it('matches standard vectors on the native and fallback paths', async () => {
    const vectors = [
      '',
      'abc',
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(63),
      'a'.repeat(64),
      'a'.repeat(65),
      'a'.repeat(1000),
    ];
    for (const vector of vectors) {
      const buffer = toArrayBuffer(new TextEncoder().encode(vector));
      const expected = referenceSha256(buffer);
      expect(await sha256Hex(buffer), `native: ${vector.slice(0, 12)}`).toBe(expected);
      expect(await sha256Hex(buffer, { subtle: null }), `fallback: ${vector.slice(0, 12)}`).toBe(expected);
    }
  });

  it('uses Web Crypto when it is available', async () => {
    const realSubtle = globalThis.crypto?.subtle;
    expect(realSubtle).toBeTruthy();
    let calls = 0;
    const subtle = {
      digest: (...args: Parameters<SubtleCrypto['digest']>) => {
        calls += 1;
        return realSubtle.digest(...args);
      },
    };
    const hash = await sha256Hex(
      toArrayBuffer(new TextEncoder().encode('abc')),
      { subtle },
    );
    expect(calls).toBe(1);
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('falls back when crypto.subtle is absent', async () => {
    const bytes = new TextEncoder().encode('abc');
    vi.stubGlobal('crypto', {});
    try {
      expect(await sha256Hex(toArrayBuffer(bytes))).toBe(referenceSha256(bytes));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hashes binary zero bytes identically on both paths', async () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 1024, 1024 * 1024]) {
      const buffer = new ArrayBuffer(length);
      const expected = referenceSha256(buffer);
      expect(await sha256Hex(buffer), `native zeros: ${length}`).toBe(expected);
      expect(await sha256Hex(buffer, { subtle: null }), `fallback zeros: ${length}`).toBe(expected);
    }
  });

  it('hashes real encoded PNG and WebP bytes on both paths', async () => {
    expect(parseImageHeader(REAL_PNG)).toEqual({ format: 'png', width: 1, height: 1 });
    expect(parseImageHeader(REAL_WEBP)).toEqual({ format: 'webp', width: 1, height: 1 });
    for (const bytes of [REAL_PNG, REAL_WEBP]) {
      const buffer = toArrayBuffer(bytes);
      const expected = referenceSha256(buffer);
      expect(await sha256Hex(buffer)).toBe(expected);
      expect(await sha256Hex(buffer, { subtle: null })).toBe(expected);
    }
  });

  it('aborts the fallback between chunks', async () => {
    const controller = new AbortController();
    let yields = 0;
    let failure: unknown;
    try {
      await sha256Hex(new ArrayBuffer(1024 * 1024), {
        subtle: null,
        signal: controller.signal,
        chunkBytes: 64 * 1024,
        yieldToEventLoop: async () => {
          yields += 1;
          controller.abort();
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ name: 'AbortError' });
    expect(yields).toBe(1);
  });

  it('hashes the 20 MiB limit in yielding chunks', async () => {
    const buffer = new ArrayBuffer(MAX_ENCODED_BYTES);
    let yields = 0;
    const started = performance.now();
    const hash = await sha256Hex(buffer, {
      subtle: null,
      yieldToEventLoop: async () => {
        yields += 1;
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    });
    const elapsed = performance.now() - started;
    expect(hash).toBe(referenceSha256(buffer));
    expect(yields).toBeGreaterThanOrEqual(39);
    expect(elapsed).toBeLessThan(5000);
  });
});

describe('atlas metadata validation', () => {
  it('accepts exact PNG and WebP dimensions for their profiles', () => {
    const v1 = atlasDimensions('v1');
    const v2 = atlasDimensions('v2');
    const png = pngBytes(v1.width, v1.height);
    expect(
      validateAtlasMetadata(
        { bytes: png, size: png.byteLength, mime: 'image/png' },
        'v1',
      ),
    ).toEqual({ format: 'png', width: v1.width, height: v1.height });

    const webp = webpBytes(vp8xChunk(v2.width, v2.height));
    expect(
      validateAtlasMetadata(
        { bytes: webp, size: webp.byteLength, mime: 'image/webp' },
        'v2',
      ),
    ).toEqual({ format: 'webp', width: v2.width, height: v2.height });
  });

  it('rejects a MIME type that does not match the actual bytes', () => {
    const png = pngBytes(1536, 2288);
    const pngAsWebp = expectInputError(
      () => validateAtlasMetadata(
        { bytes: png, size: png.byteLength, mime: 'image/webp' },
        'v2',
      ),
      'format',
    );
    expect(pngAsWebp.message).toMatch(/不一致/);

    const webp = webpBytes(vp8xChunk(1536, 2288));
    expectInputError(
      () => validateAtlasMetadata(
        { bytes: webp, size: webp.byteLength, mime: 'image/png' },
        'v2',
      ),
      'format',
    );
  });

  it('rejects bytes that are not PNG or WebP even with an image MIME type', () => {
    const junk = new Uint8Array(32);
    expectInputError(
      () => validateAtlasMetadata(
        { bytes: junk, size: junk.byteLength, mime: 'image/png' },
        'v1',
      ),
      'format',
    );
  });

  it('rejects wrong atlas dimensions before decoding', () => {
    const v1 = atlasDimensions('v1');
    const v2 = atlasDimensions('v2');

    const v2AsV1 = pngBytes(v2.width, v2.height);
    const error = expectInputError(
      () => validateAtlasMetadata(
        { bytes: v2AsV1, size: v2AsV1.byteLength, mime: 'image/png' },
        'v1',
      ),
      'dimensions',
    );
    expect(error.message).toContain(`${v1.width}×${v1.height}`);

    const tiny = pngBytes(192, 208);
    expectInputError(
      () => validateAtlasMetadata(
        { bytes: tiny, size: tiny.byteLength, mime: 'image/png' },
        'v2',
      ),
      'dimensions',
    );
  });

  it('rejects a byte count that differs from the promised blob size', () => {
    const png = pngBytes(1536, 1872);
    expectInputError(
      () => validateAtlasMetadata(
        { bytes: png, size: png.byteLength + 1, mime: 'image/png' },
        'v1',
      ),
      'file-size',
    );
  });

  it('surfaces malformed headers as format errors with a clear message', () => {
    const truncated = pngBytes(1536, 1872).slice(0, 20);
    const error = expectInputError(
      () => validateAtlasMetadata(
        { bytes: truncated, size: truncated.byteLength, mime: 'image/png' },
        'v1',
      ),
      'format',
    );
    expect(error.message).toMatch(/不完整/);

    const badWebp = new Uint8Array(30);
    writeAscii(badWebp, 0, 'RIFF');
    writeUint32LE(badWebp, 4, 22);
    writeAscii(badWebp, 8, 'WEBP');
    writeAscii(badWebp, 12, 'JUNK');
    writeUint32LE(badWebp, 16, 10);
    expectInputError(
      () => validateAtlasMetadata(
        { bytes: badWebp, size: badWebp.byteLength, mime: 'image/webp' },
        'v2',
      ),
      'format',
    );
  });
});
