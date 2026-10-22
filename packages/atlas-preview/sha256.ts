const BLOCK_BYTES = 64;
const DEFAULT_CHUNK_BYTES = 512 * 1024;
const INITIAL_HASH = new Uint32Array([
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
]);
const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export interface Sha256Options {
  signal?: AbortSignal;
  /** Test hook: `null` forces the pure JavaScript path. */
  subtle?: Pick<SubtleCrypto, 'digest'> | null;
  yieldToEventLoop?: () => Promise<void>;
  chunkBytes?: number;
}

function abortError(): DOMException {
  return new DOMException('SHA-256 计算已取消。', 'AbortError');
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function defaultYieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (scheduler && typeof scheduler.yield === 'function') {
    return scheduler.yield();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function writeLength(padded: Uint8Array, byteLength: number): void {
  let bitLength = BigInt(byteLength) * 8n;
  for (let index = 1; index <= 8; index += 1) {
    padded[padded.byteLength - index] = Number(bitLength & 0xffn);
    bitLength >>= 8n;
  }
}

function compressBlock(
  padded: Uint8Array,
  offset: number,
  hash: Uint32Array,
  schedule: Uint32Array,
): void {
  for (let index = 0; index < 16; index += 1) {
    const position = offset + index * 4;
    schedule[index] = (
      (padded[position] << 24)
      | (padded[position + 1] << 16)
      | (padded[position + 2] << 8)
      | padded[position + 3]
    ) >>> 0;
  }
  for (let index = 16; index < 64; index += 1) {
    const first = schedule[index - 15];
    const second = schedule[index - 2];
    const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
    const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
    schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) >>> 0;
  }

  let a = hash[0];
  let b = hash[1];
  let c = hash[2];
  let d = hash[3];
  let e = hash[4];
  let f = hash[5];
  let g = hash[6];
  let h = hash[7];

  for (let index = 0; index < 64; index += 1) {
    const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
    const choice = (e & f) ^ (~e & g);
    const temp1 = (h + sum1 + choice + ROUND_CONSTANTS[index] + schedule[index]) >>> 0;
    const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (sum0 + majority) >>> 0;

    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }

  hash[0] = (hash[0] + a) >>> 0;
  hash[1] = (hash[1] + b) >>> 0;
  hash[2] = (hash[2] + c) >>> 0;
  hash[3] = (hash[3] + d) >>> 0;
  hash[4] = (hash[4] + e) >>> 0;
  hash[5] = (hash[5] + f) >>> 0;
  hash[6] = (hash[6] + g) >>> 0;
  hash[7] = (hash[7] + h) >>> 0;
}

async function fallbackSha256(
  buffer: ArrayBuffer,
  signal: AbortSignal | undefined,
  yieldToEventLoop: () => Promise<void>,
  chunkBytes: number,
): Promise<string> {
  assertNotAborted(signal);
  const bytes = new Uint8Array(buffer);
  const paddedLength = Math.ceil((bytes.byteLength + 9) / BLOCK_BYTES) * BLOCK_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  writeLength(padded, bytes.byteLength);

  const hash = new Uint32Array(INITIAL_HASH);
  const schedule = new Uint32Array(64);
  const blockCount = paddedLength / BLOCK_BYTES;
  const blocksPerChunk = Math.max(1, Math.floor(chunkBytes / BLOCK_BYTES));

  for (let block = 0; block < blockCount; block += 1) {
    if (block % blocksPerChunk === 0) {
      assertNotAborted(signal);
      if (block > 0) {
        await yieldToEventLoop();
        assertNotAborted(signal);
      }
    }
    compressBlock(padded, block * BLOCK_BYTES, hash, schedule);
  }
  assertNotAborted(signal);

  const digest = new Uint8Array(32);
  for (let index = 0; index < hash.length; index += 1) {
    const value = hash[index];
    digest[index * 4] = value >>> 24;
    digest[index * 4 + 1] = value >>> 16;
    digest[index * 4 + 2] = value >>> 8;
    digest[index * 4 + 3] = value;
  }
  return toHex(digest);
}

export async function sha256Hex(
  buffer: ArrayBuffer,
  options: Sha256Options = {},
): Promise<string> {
  assertNotAborted(options.signal);
  const subtle = options.subtle === undefined
    ? globalThis.crypto?.subtle ?? null
    : options.subtle;

  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', buffer);
      assertNotAborted(options.signal);
      return toHex(new Uint8Array(digest));
    } catch {
      if (options.signal?.aborted) {
        throw abortError();
      }
    }
  }

  const chunkBytes = options.chunkBytes !== undefined
    && Number.isFinite(options.chunkBytes)
    && options.chunkBytes >= BLOCK_BYTES
    ? Math.floor(options.chunkBytes)
    : DEFAULT_CHUNK_BYTES;
  return fallbackSha256(
    buffer,
    options.signal,
    options.yieldToEventLoop ?? defaultYieldToEventLoop,
    chunkBytes,
  );
}
