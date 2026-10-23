import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANIMATION_ROWS,
  CELL_HEIGHT,
  CELL_WIDTH,
  MAX_ENCODED_BYTES,
  atlasDimensions,
  type AnimationState,
  type AtlasProfile,
} from '../packages/target-chatgpt/contract';
import {
  SPRITE_ALPHA_HIT_THRESHOLD,
  SPRITE_MAX_CANVAS_DIMENSION,
  SpriteStage,
  SpriteStageError,
  type SpriteLoadResult,
} from '../packages/renderer-sprite/index';

interface FakeBitmap {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  closed: boolean;
  close: ReturnType<typeof vi.fn>;
}

interface PendingDecode {
  blob: Blob;
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface DrawCall {
  image: FakeBitmap;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

interface AtlasOptions {
  empty?: { row: number; frame: number };
  pollute?: { row: number; frame: number };
}

const PROFILE_ROWS: Readonly<Record<AtlasProfile, number>> = { v1: 9, v2: 11 };

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    bytes[offset + index] = text.charCodeAt(index);
  }
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  writeAscii(bytes, 12, 'IHDR');
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

function paint(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  alpha = 255,
): void {
  const index = (y * width + x) * 4;
  data[index] = 255;
  data[index + 1] = 255;
  data[index + 2] = 255;
  data[index + 3] = alpha;
}

function paintBlock(
  data: Uint8ClampedArray,
  width: number,
  startX: number,
  startY: number,
  blockWidth: number,
  blockHeight: number,
  alpha = 255,
): void {
  for (let y = startY; y < startY + blockHeight; y += 1) {
    for (let x = startX; x < startX + blockWidth; x += 1) {
      paint(data, width, x, y, alpha);
    }
  }
}

function framesInRow(profile: AtlasProfile, row: number): number {
  if (row < ANIMATION_ROWS.length) {
    return ANIMATION_ROWS[row].frames;
  }
  return 8;
}

function buildAtlas(
  profile: AtlasProfile,
  options: AtlasOptions = {},
): Uint8ClampedArray {
  const { width, height } = atlasDimensions(profile);
  const data = new Uint8ClampedArray(width * height * 4);
  const rows = PROFILE_ROWS[profile];

  for (let row = 0; row < rows; row += 1) {
    const frameCount = framesInRow(profile, row);
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (options.empty?.row === row && options.empty.frame === frame) {
        continue;
      }
      const cellX = frame * CELL_WIDTH;
      const cellY = row * CELL_HEIGHT;
      paintBlock(data, width, cellX + 8, cellY + 8, 2, 2);
    }
  }

  const idleX = 0;
  const idleY = 0;
  if (!(options.empty?.row === 0 && options.empty.frame === 0)) {
    paintBlock(data, width, idleX + 10, idleY + 20, 40, 80);
    paint(data, width, idleX + 60, idleY + 30, SPRITE_ALPHA_HIT_THRESHOLD - 1);
    paint(data, width, idleX + 61, idleY + 30, 200);
    paint(data, width, idleX + 30, idleY + 120, SPRITE_ALPHA_HIT_THRESHOLD - 1);
    paint(data, width, idleX + 31, idleY + 120, SPRITE_ALPHA_HIT_THRESHOLD);
  }

  if (!(options.empty?.row === 4 && options.empty.frame === 0)) {
    paintBlock(data, width, 0, 4 * CELL_HEIGHT + 180, 51, 28);
  }

  if (profile === 'v2') {
    paintBlock(data, width, 4 * CELL_WIDTH + 140, 9 * CELL_HEIGHT + 160, 40, 40);
  }

  if (options.pollute) {
    paint(
      data,
      width,
      options.pollute.frame * CELL_WIDTH + 1,
      options.pollute.row * CELL_HEIGHT + 1,
    );
  }

  return data;
}

function cachedAtlas(profile: AtlasProfile, options: AtlasOptions = {}): Uint8ClampedArray {
  const key = `${profile}:${JSON.stringify(options)}`;
  const existing = atlasCache.get(key);
  if (existing) {
    return existing;
  }
  const data = buildAtlas(profile, options);
  atlasCache.set(key, data);
  return data;
}

const atlasCache = new Map<string, Uint8ClampedArray>();

class FakeReadCanvas {
  width = 0;
  height = 0;
  source: FakeBitmap | null = null;

  constructor(private readonly harness: FakeHarness) {}

  getContext(type: string): unknown {
    if (type !== '2d') {
      return null;
    }
    return {
      drawImage: (image: FakeBitmap) => {
        this.source = image;
      },
      getImageData: (x: number, y: number, width: number, height: number) => {
        this.harness.imageReads += 1;
        if (!this.source) {
          throw new Error('fake read canvas has no source');
        }
        if (width !== this.source.width || height !== this.source.height) {
          throw new Error('fake read canvas only supports full reads');
        }
        return { data: this.source.pixels, width, height };
      },
    };
  }
}

class FakeDisplayContext {
  readonly draws: DrawCall[] = [];
  readonly clears: number[][] = [];

  clearRect(x: number, y: number, width: number, height: number): void {
    this.clears.push([x, y, width, height]);
  }

  drawImage(
    image: FakeBitmap,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.draws.push({ image, sx, sy, sw, sh, dx, dy, dw, dh });
  }
}

class FakeDisplayCanvas {
  width = 300;
  height = 150;
  readonly style: Record<string, string> = {};
  readonly context = new FakeDisplayContext();
  left = 0;
  top = 0;
  cssWidth: number | null = null;
  cssHeight: number | null = null;

  constructor(private readonly harness: FakeHarness) {}

  getContext(type: string): unknown {
    return type === '2d' ? this.context : null;
  }

  getBoundingClientRect(): DOMRect {
    const width = this.cssWidth
      ?? (this.style.width ? Number.parseFloat(this.style.width) : this.width);
    const height = this.cssHeight
      ?? (this.style.height ? Number.parseFloat(this.style.height) : this.height);
    return {
      x: this.left,
      y: this.top,
      left: this.left,
      top: this.top,
      width,
      height,
      right: this.left + width,
      bottom: this.top + height,
      toJSON: () => ({}),
    } as DOMRect;
  }
}

class FakeHarness {
  readonly display = new FakeDisplayCanvas(this);
  readonly stage: SpriteStage;
  readonly created: FakeBitmap[] = [];
  readonly pending: PendingDecode[] = [];
  readonly blobs = new WeakMap<Blob, { width: number; height: number; pixels: Uint8ClampedArray }>();
  readonly createImageBitmap = vi.fn((blob: Blob) => this.decode(blob));
  imageReads = 0;
  manualDecode = false;
  decodeError: Error | null = null;
  sizeOverride: { width: number; height: number } | null = null;

  constructor() {
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') {
          throw new Error(`unexpected element: ${tag}`);
        }
        return new FakeReadCanvas(this);
      },
    });
    vi.stubGlobal('createImageBitmap', this.createImageBitmap);
    this.stage = new SpriteStage(this.display as unknown as HTMLCanvasElement);
  }

  get openBitmaps(): number {
    return this.created.filter((bitmap) => !bitmap.closed).length;
  }

  get closedBitmaps(): number {
    return this.created.filter((bitmap) => bitmap.closed).length;
  }

  get lastDraw(): DrawCall | undefined {
    return this.display.context.draws[this.display.context.draws.length - 1];
  }

  createAtlasBlob(
    profile: AtlasProfile,
    options: AtlasOptions = {},
    salt = '',
  ): { blob: Blob; pixels: Uint8ClampedArray; digest: string } {
    const { width, height } = atlasDimensions(profile);
    const pixels = cachedAtlas(profile, options);
    const header = pngHeader(width, height);
    const saltBytes = new TextEncoder().encode(salt);
    const bytes = new Uint8Array(header.byteLength + saltBytes.byteLength);
    bytes.set(header);
    bytes.set(saltBytes, header.byteLength);
    const blob = new Blob([bytes], { type: 'image/png' });
    this.blobs.set(blob, { width, height, pixels });
    return {
      blob,
      pixels,
      digest: createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
    };
  }

  createRawBlob(bytes: Uint8Array, type = 'image/png'): Blob {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy], { type });
  }

  resolveDecode(index: number): void {
    const pending = this.pending[index];
    if (!pending) {
      throw new Error(`no pending decode at index ${index}`);
    }
    pending.resolve();
  }

  rejectDecode(index: number, error: unknown): void {
    const pending = this.pending[index];
    if (!pending) {
      throw new Error(`no pending decode at index ${index}`);
    }
    pending.reject(error);
  }

  dispose(): void {
    this.stage.dispose();
    vi.unstubAllGlobals();
  }

  private decode(blob: Blob): Promise<FakeBitmap> {
    if (this.decodeError) {
      return Promise.reject(this.decodeError);
    }
    if (this.manualDecode) {
      return new Promise<FakeBitmap>((resolve, reject) => {
        this.pending.push({
          blob,
          resolve: () => {
            try {
              resolve(this.makeBitmap(blob));
            } catch (error) {
              reject(error);
            }
          },
          reject,
        });
      });
    }
    try {
      return Promise.resolve(this.makeBitmap(blob));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private makeBitmap(blob: Blob): FakeBitmap {
    const info = this.blobs.get(blob);
    if (!info) {
      throw new Error('fake decode received an unregistered blob');
    }
    const width = this.sizeOverride?.width ?? info.width;
    const height = this.sizeOverride?.height ?? info.height;
    let bitmap: FakeBitmap;
    bitmap = {
      width,
      height,
      pixels: info.pixels,
      closed: false,
      close: vi.fn(() => {
        bitmap.closed = true;
      }),
    };
    this.created.push(bitmap);
    return bitmap;
  }
}

function expectClose(actual: number, expected: number, tolerance = 1e-6): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function contain(width: number, height: number) {
  const scale = Math.min(width / CELL_WIDTH, height / CELL_HEIGHT);
  const destinationWidth = CELL_WIDTH * scale;
  const destinationHeight = CELL_HEIGHT * scale;
  return {
    x: (width - destinationWidth) / 2,
    y: (height - destinationHeight) / 2,
    width: destinationWidth,
    height: destinationHeight,
  };
}

function clientFor(canvas: FakeDisplayCanvas, sourceX: number, sourceY: number) {
  const bounds = canvas.getBoundingClientRect();
  const destination = contain(canvas.width, canvas.height);
  const backingX = destination.x + ((sourceX + 0.5) / CELL_WIDTH) * destination.width;
  const backingY = destination.y + ((sourceY + 0.5) / CELL_HEIGHT) * destination.height;
  return {
    clientX: bounds.left + (backingX / canvas.width) * bounds.width,
    clientY: bounds.top + (backingY / canvas.height) * bounds.height,
  };
}

async function waitForDecodes(harness: FakeHarness, count: number): Promise<void> {
  await vi.waitFor(() => expect(harness.pending.length).toBe(count));
}

async function expectRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('SpriteStage', () => {
  let harness: FakeHarness;
  let stage: SpriteStage;

  beforeEach(() => {
    harness = new FakeHarness();
    stage = harness.stage;
  });

  afterEach(() => {
    harness.dispose();
    vi.restoreAllMocks();
  });

  it('loads a valid v2 atlas, hashes the actual blob and keeps one bitmap', async () => {
    const { blob, digest } = harness.createAtlasBlob('v2');
    const result = await stage.load(blob, 'v2');

    expect(result.blob).toBe(blob);
    expect(result.profile).toBe('v2');
    expect(result.inspection.valid).toBe(true);
    expect(result.inspection.requiredFrames).toBe(73);
    expect(result.encodedBytes).toBe(blob.size);
    expect(result.sha256).toBe(digest);
    expect(stage.loaded).toBe(true);
    expect(harness.openBitmaps).toBe(1);
    expect(harness.display.context.clears.length).toBeGreaterThan(0);
  });

  it('returns the same blob object and a hash from the file bytes, not the decode', async () => {
    const first = harness.createAtlasBlob('v2', {}, 'first');
    const second = harness.createAtlasBlob('v2', {}, 'second');
    const firstResult = await stage.load(first.blob, 'v2');
    const secondResult = await stage.load(second.blob, 'v2');

    expect(firstResult.blob).toBe(first.blob);
    expect(secondResult.blob).toBe(second.blob);
    expect(firstResult.sha256).toBe(first.digest);
    expect(secondResult.sha256).toBe(second.digest);
    expect(firstResult.sha256).not.toBe(secondResult.sha256);
    expect(harness.closedBitmaps).toBe(1);
    expect(harness.openBitmaps).toBe(1);
  });

  it('rejects structurally invalid atlases with inspection data and drops the old image', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    stage.resize(192, 208, 1);
    stage.render('idle', 0);
    expect(stage.loaded).toBe(true);
    expect(harness.display.context.draws).toHaveLength(1);

    const empty = harness.createAtlasBlob('v2', { empty: { row: 4, frame: 2 } });
    const emptyError = await expectRejection(stage.load(empty.blob, 'v2'));
    expect(emptyError).toBeInstanceOf(SpriteStageError);
    expect((emptyError as SpriteStageError).code).toBe('inspection');
    expect((emptyError as SpriteStageError).inspection?.valid).toBe(false);
    expect(
      (emptyError as SpriteStageError).inspection?.errors.some(
        (issue) => issue.code === 'empty-frame' && issue.row === 4 && issue.frame === 2,
      ),
    ).toBe(true);
    expect(stage.loaded).toBe(false);
    expect(harness.openBitmaps).toBe(0);
    expect(harness.display.context.draws).toHaveLength(1);
    expect(harness.display.context.clears.at(-1)).toEqual([0, 0, 192, 208]);
    expect(stage.hitTest(10, 10)).toBe(false);

    const polluted = harness.createAtlasBlob('v2', { pollute: { row: 0, frame: 6 } });
    const pollutedError = await expectRejection(stage.load(polluted.blob, 'v2'));
    expect((pollutedError as SpriteStageError).code).toBe('inspection');
    expect((pollutedError as SpriteStageError).inspection?.errors[0]?.code).toBe('unused-cell');
    expect(stage.loaded).toBe(false);
    expect(harness.openBitmaps).toBe(0);
  });

  it('clears the previous image synchronously when a new load starts', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    stage.resize(192, 208, 1);
    stage.render('idle', 0);
    const clearsBefore = harness.display.context.clears.length;

    harness.manualDecode = true;
    const pending = stage.load(harness.createAtlasBlob('v2', {}, 'next').blob, 'v2');

    expect(stage.loaded).toBe(false);
    expect(harness.openBitmaps).toBe(0);
    expect(harness.display.context.clears.length).toBe(clearsBefore + 1);
    expect(stage.hitTest(10, 10)).toBe(false);

    await waitForDecodes(harness, 1);
    harness.resolveDecode(0);
    await pending;
    expect(stage.loaded).toBe(true);
    expect(harness.openBitmaps).toBe(1);
  });

  it('validates preflight before decoding and rejects with the shared input errors', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    const callsBefore = harness.createImageBitmap.mock.calls.length;

    const wrongDimensions = harness.createAtlasBlob('v1').blob;
    const dimensionsError = await expectRejection(stage.load(wrongDimensions, 'v2'));
    expect(dimensionsError).toMatchObject({ name: 'AtlasInputError', code: 'dimensions' });

    const wrongMime = harness.createRawBlob(pngHeader(1536, 2288), 'image/gif');
    const mimeError = await expectRejection(stage.load(wrongMime, 'v2'));
    expect(mimeError).toMatchObject({ name: 'AtlasInputError', code: 'mime' });

    const fake = harness.createRawBlob(new TextEncoder().encode('not an image'));
    const formatError = await expectRejection(stage.load(fake, 'v2'));
    expect(formatError).toMatchObject({ name: 'AtlasInputError', code: 'format' });

    const oversized = harness.createRawBlob(
      new Uint8Array(MAX_ENCODED_BYTES + 1),
      'image/png',
    );
    const sizeError = await expectRejection(stage.load(oversized, 'v2'));
    expect(sizeError).toMatchObject({ name: 'AtlasInputError', code: 'file-size' });

    const profileError = await expectRejection(
      stage.load(harness.createAtlasBlob('v2').blob, 'v3' as AtlasProfile),
    );
    expect(profileError).toMatchObject({ name: 'AtlasInputError', code: 'profile' });

    expect(harness.createImageBitmap.mock.calls.length).toBe(callsBefore);
    expect(stage.loaded).toBe(false);
    expect(harness.openBitmaps).toBe(0);
  });

  it('rejects a pre-aborted signal after clearing the old image', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    const controller = new AbortController();
    controller.abort();

    const error = await expectRejection(
      stage.load(harness.createAtlasBlob('v2').blob, 'v2', controller.signal),
    );
    expect((error as DOMException).name).toBe('AbortError');
    expect(stage.loaded).toBe(false);
    expect(harness.openBitmaps).toBe(0);
  });

  it('rejects decode failures without leaking a bitmap', async () => {
    harness.decodeError = new Error('bad payload');
    const error = await expectRejection(
      stage.load(harness.createAtlasBlob('v2').blob, 'v2'),
    );
    expect(error).toBeInstanceOf(SpriteStageError);
    expect((error as SpriteStageError).code).toBe('decode');
    expect((error as Error).message).toMatch(/无法解码/);
    expect(harness.openBitmaps).toBe(0);
    expect(stage.loaded).toBe(false);

    harness.decodeError = null;
    harness.sizeOverride = { width: 1536, height: 1872 };
    const mismatch = await expectRejection(
      stage.load(harness.createAtlasBlob('v2').blob, 'v2'),
    );
    expect((mismatch as SpriteStageError).code).toBe('decode');
    expect(harness.openBitmaps).toBe(0);
    expect(harness.closedBitmaps).toBe(1);
  });

  it('lets the latest load win and releases the superseded decode', async () => {
    harness.manualDecode = true;
    const first = harness.createAtlasBlob('v1', {}, 'stale');
    const second = harness.createAtlasBlob('v2', {}, 'latest');

    const firstLoad = stage.load(first.blob, 'v1');
    void firstLoad.catch(() => undefined);
    await waitForDecodes(harness, 1);
    const secondLoad = stage.load(second.blob, 'v2');
    await waitForDecodes(harness, 2);

    const firstError = await expectRejection(firstLoad);
    expect((firstError as DOMException).name).toBe('AbortError');
    expect(stage.loaded).toBe(false);

    harness.resolveDecode(0);
    await vi.waitFor(() => expect(harness.closedBitmaps).toBe(1));
    expect(harness.openBitmaps).toBe(0);

    harness.resolveDecode(1);
    const secondResult = await secondLoad;
    expect(secondResult.profile).toBe('v2');
    expect(secondResult.sha256).toBe(second.digest);
    expect(stage.loaded).toBe(true);
    expect(harness.openBitmaps).toBe(1);
    expect(harness.closedBitmaps).toBe(1);
  });

  it('aborts a pending load and closes the late bitmap', async () => {
    harness.manualDecode = true;
    const controller = new AbortController();
    const pending = stage.load(
      harness.createAtlasBlob('v2').blob,
      'v2',
      controller.signal,
    );
    await waitForDecodes(harness, 1);
    controller.abort();

    const error = await expectRejection(pending);
    expect((error as DOMException).name).toBe('AbortError');
    expect(stage.loaded).toBe(false);

    harness.resolveDecode(0);
    await vi.waitFor(() => expect(harness.closedBitmaps).toBe(1));
    expect(harness.openBitmaps).toBe(0);
    expect(stage.loaded).toBe(false);
  });

  it('disposes idempotently and cannot be revived', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    stage.resize(192, 208, 1);
    stage.render('idle', 0);
    const draws = harness.display.context.draws.length;

    stage.dispose();
    stage.dispose();
    expect(stage.loaded).toBe(false);
    expect(harness.openBitmaps).toBe(0);
    expect(harness.closedBitmaps).toBe(1);

    stage.render('idle', 0.5);
    stage.resize(100, 100);
    expect(harness.display.context.draws).toHaveLength(draws);
    expect(stage.hitTest(10, 10)).toBe(false);

    const error = await expectRejection(
      stage.load(harness.createAtlasBlob('v2').blob, 'v2'),
    );
    expect((error as DOMException).name).toBe('AbortError');
    expect(stage.loaded).toBe(false);
  });

  it('disposing during a load rejects it and closes the late bitmap', async () => {
    harness.manualDecode = true;
    const pending = stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    await waitForDecodes(harness, 1);

    stage.dispose();
    const error = await expectRejection(pending);
    expect((error as DOMException).name).toBe('AbortError');

    harness.resolveDecode(0);
    await vi.waitFor(() => expect(harness.closedBitmaps).toBe(1));
    expect(harness.openBitmaps).toBe(0);
    expect(stage.loaded).toBe(false);
  });

  it('draws the full 192x208 cell with a centered contain fit', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    stage.resize(400, 300, 1);
    stage.render('idle', 0);

    const draw = harness.lastDraw;
    expect(draw).toBeDefined();
    expect([draw?.sx, draw?.sy, draw?.sw, draw?.sh]).toEqual([0, 0, CELL_WIDTH, CELL_HEIGHT]);
    const expected = contain(400, 300);
    expectClose(draw?.dx ?? 0, expected.x);
    expectClose(draw?.dy ?? 0, expected.y);
    expectClose(draw?.dw ?? 0, expected.width);
    expectClose(draw?.dh ?? 0, expected.height);
    expect(harness.display.context.clears.at(-1)).toEqual([0, 0, 400, 300]);

    stage.resize(300, 400, 1);
    stage.render('idle', 0);
    const tall = contain(300, 400);
    expectClose(harness.lastDraw?.dx ?? 0, tall.x);
    expectClose(harness.lastDraw?.dy ?? 0, tall.y);
    expect(harness.lastDraw?.dw ?? 0).toBe(300);
    expect(harness.lastDraw?.dh ?? 0).toBe(325);
  });

  it('samples action frames at 8 fps without leaking between rows', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    stage.resize(192, 208, 1);

    stage.render('idle', 0);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual([0, 0]);
    stage.render('idle', 0.125);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual([CELL_WIDTH, 0]);
    stage.render('idle', -4);
    expect(harness.lastDraw?.sx).toBe(0);
    stage.render('idle', Number.POSITIVE_INFINITY);
    expect(harness.lastDraw?.sx).toBe(0);
    stage.render('idle', Number.NaN);
    expect(harness.lastDraw?.sx).toBe(0);
    stage.render('idle', 1e12);
    expect(harness.lastDraw?.sx).toBe((Math.floor((1e12 * 8) % 6)) * CELL_WIDTH);

    stage.render('waving', 0.25);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual([2 * CELL_WIDTH, 3 * CELL_HEIGHT]);
    stage.render('idle', 0);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual([0, 0]);

    stage.render('jumping', 0);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual([0, 4 * CELL_HEIGHT]);
    stage.render('running-right', 0);
    expect(harness.lastDraw?.sy).toBe(1 * CELL_HEIGHT);
    stage.render('review', 0);
    expect(harness.lastDraw?.sy).toBe(8 * CELL_HEIGHT);
  });

  it('uses v2 gaze frames and ignores look on v1', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    stage.resize(192, 208, 1);

    stage.render('idle', 0, 90);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual([4 * CELL_WIDTH, 9 * CELL_HEIGHT]);
    stage.render('idle', 0, -90);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual([4 * CELL_WIDTH, 10 * CELL_HEIGHT]);
    stage.render('idle', 0, 22.5);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual([CELL_WIDTH, 9 * CELL_HEIGHT]);
    stage.render('idle', 0, 11.25);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual([CELL_WIDTH, 9 * CELL_HEIGHT]);
    stage.render('idle', 0, 11.24);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual([0, 9 * CELL_HEIGHT]);
    stage.render('idle', 0, Number.POSITIVE_INFINITY);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual([0, 9 * CELL_HEIGHT]);
    stage.render('idle', 0, Number.NaN);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual([0, 9 * CELL_HEIGHT]);

    await stage.load(harness.createAtlasBlob('v1').blob, 'v1');
    stage.resize(192, 208, 1);
    stage.render('idle', 0, 90);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual([0, 0]);
  });

  it('resizes with DPR, caps the ratio and redraws the current frame', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');

    vi.stubGlobal('devicePixelRatio', 3);
    stage.resize(200, 250);
    expect([harness.display.width, harness.display.height]).toEqual([400, 500]);
    expect(harness.display.style.width).toBe('200px');
    expect(harness.display.style.height).toBe('250px');

    vi.stubGlobal('devicePixelRatio', 1.5);
    stage.resize(200, 250);
    expect([harness.display.width, harness.display.height]).toEqual([300, 375]);

    stage.resize(200, 100, 8);
    expect([harness.display.width, harness.display.height]).toEqual([400, 200]);

    stage.render('idle', 0.25);
    const source = [harness.lastDraw?.sx, harness.lastDraw?.sy];
    const drawsBefore = harness.display.context.draws.length;
    stage.resize(320, 240, 1);
    expect(harness.display.context.draws).toHaveLength(drawsBefore + 1);
    expect([harness.lastDraw?.sx, harness.lastDraw?.sy]).toEqual(source);
    const expected = contain(320, 240);
    expectClose(harness.lastDraw?.dx ?? 0, expected.x);
    expectClose(harness.lastDraw?.dy ?? 0, expected.y);
  });

  it('rejects invalid or oversized resize requests before changing the canvas', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    stage.resize(200, 250, 1);
    expect([harness.display.width, harness.display.height]).toEqual([200, 250]);

    for (const [width, height] of [
      [Number.NaN, 100],
      [100, Number.NaN],
      [Number.POSITIVE_INFINITY, 100],
      [0, 100],
      [100, -1],
    ]) {
      expect(() => stage.resize(width, height)).toThrow(RangeError);
    }
    expect(() => stage.resize(100, 100, Number.NaN)).toThrow(RangeError);
    expect(() => stage.resize(100, 100, 0)).toThrow(RangeError);
    expect(() => stage.resize(100, 100, -2)).toThrow(RangeError);
    expect(() => stage.resize(SPRITE_MAX_CANVAS_DIMENSION + 1, 100, 1)).toThrow(RangeError);
    expect(() => stage.resize(SPRITE_MAX_CANVAS_DIMENSION, 100, 2)).toThrow(RangeError);
    expect([harness.display.width, harness.display.height]).toEqual([200, 250]);
  });

  it('maps client coordinates through contain, DPR and CSS scaling', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    stage.resize(192, 208, 1);
    harness.display.left = 100;
    harness.display.top = 50;
    stage.render('idle', 0);

    const hit = clientFor(harness.display, 40, 40);
    expect(stage.hitTest(hit.clientX, hit.clientY)).toBe(true);
    const miss = clientFor(harness.display, 100, 40);
    expect(stage.hitTest(miss.clientX, miss.clientY)).toBe(false);
    expect(stage.hitTest(100 + 60.5, 50 + 30.5)).toBe(false);
    expect(stage.hitTest(100 + 61.5, 50 + 30.5)).toBe(true);
    expect(stage.hitTest(100 + 30.5, 50 + 120.5)).toBe(false);
    expect(stage.hitTest(100 + 31.5, 50 + 120.5)).toBe(true);
    expect(stage.hitTest(Number.NaN, 50)).toBe(false);

    stage.resize(384, 208, 1);
    stage.render('idle', 0);
    const letterboxed = clientFor(harness.display, 40, 40);
    expect(stage.hitTest(letterboxed.clientX, letterboxed.clientY)).toBe(true);
    expect(stage.hitTest(100 + 50, 50 + 100)).toBe(false);
    expect(stage.hitTest(100 + 192, 50 + 100)).toBe(false);

    stage.resize(192, 400, 1);
    stage.render('idle', 0);
    const vertical = clientFor(harness.display, 40, 40);
    expect(stage.hitTest(vertical.clientX, vertical.clientY)).toBe(true);
    expect(stage.hitTest(100 + 100, 50 + 50)).toBe(false);

    stage.resize(200, 250, 2);
    stage.render('idle', 0);
    const dpr = clientFor(harness.display, 40, 40);
    expect(stage.hitTest(dpr.clientX, dpr.clientY)).toBe(true);
    const dprMiss = clientFor(harness.display, 100, 40);
    expect(stage.hitTest(dprMiss.clientX, dprMiss.clientY)).toBe(false);

    harness.display.cssWidth = 300;
    harness.display.cssHeight = 300;
    const stretched = clientFor(harness.display, 40, 40);
    expect(stage.hitTest(stretched.clientX, stretched.clientY)).toBe(true);
  });

  it('hit-tests the currently displayed action, gaze direction and frame', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    stage.resize(192, 208, 1);

    expect(stage.hitTest(10, 10)).toBe(false);
    stage.render('idle', 0);
    const idle = clientFor(harness.display, 40, 40);
    expect(stage.hitTest(idle.clientX, idle.clientY)).toBe(true);

    stage.render('idle', 0, 90);
    const gaze = clientFor(harness.display, 160, 180);
    expect(stage.hitTest(gaze.clientX, gaze.clientY)).toBe(true);
    expect(stage.hitTest(idle.clientX, idle.clientY)).toBe(false);

    stage.render('jumping', 0);
    const jump = clientFor(harness.display, 20, 190);
    const jumpMiss = clientFor(harness.display, 20, 20);
    expect(stage.hitTest(jump.clientX, jump.clientY)).toBe(true);
    expect(stage.hitTest(jumpMiss.clientX, jumpMiss.clientY)).toBe(false);
    expect(stage.hitTest(gaze.clientX, gaze.clientY)).toBe(false);

    stage.render('idle', 0.125);
    expect(stage.hitTest(idle.clientX, idle.clientY)).toBe(false);
    const marker = clientFor(harness.display, 8, 8);
    expect(stage.hitTest(marker.clientX, marker.clientY)).toBe(true);

    await stage.load(harness.createAtlasBlob('v1').blob, 'v1');
    stage.resize(192, 208, 1);
    stage.render('jumping', 0);
    const v1Jump = clientFor(harness.display, 20, 190);
    expect(stage.hitTest(v1Jump.clientX, v1Jump.clientY)).toBe(true);
  });

  it('reuses decoded data and never reads the atlas on pointer moves', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    stage.resize(192, 208, 1);
    stage.render('idle', 0);
    const reads = harness.imageReads;
    const draws = harness.display.context.draws.length;
    const point = clientFor(harness.display, 40, 40);

    for (let index = 0; index < 200; index += 1) {
      stage.hitTest(point.clientX, point.clientY);
    }
    expect(harness.imageReads).toBe(reads);
    expect(harness.display.context.draws).toHaveLength(draws);
  });

  it('never schedules playback timers', async () => {
    const interval = vi.fn();
    const raf = vi.fn();
    vi.stubGlobal('setInterval', interval);
    vi.stubGlobal('requestAnimationFrame', raf);

    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    stage.resize(192, 208, 1);
    stage.render('idle', 0);
    stage.hitTest(10, 10);
    stage.render('idle', 0.5, 90);
    stage.dispose();

    expect(interval).not.toHaveBeenCalled();
    expect(raf).not.toHaveBeenCalled();
  });

  it('accepts all declared animation states at runtime', async () => {
    await stage.load(harness.createAtlasBlob('v2').blob, 'v2');
    stage.resize(192, 208, 1);
    const states: AnimationState[] = ANIMATION_ROWS.map((row) => row.state);
    for (const [index, state] of states.entries()) {
      stage.render(state, 0);
      expect(harness.lastDraw?.sy).toBe(index * CELL_HEIGHT);
      expect(harness.lastDraw?.sx).toBe(0);
    }
    expect(harness.lastDraw).toBeDefined();
  });

  it('returns a result whose inspection warnings never claim platform acceptance', async () => {
    const result: SpriteLoadResult = await stage.load(
      harness.createAtlasBlob('v2').blob,
      'v2',
    );
    expect(result.inspection.warnings.join(' ')).toMatch(/不能替代/);
  });
});
