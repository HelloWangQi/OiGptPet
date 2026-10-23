import {
  CELL_HEIGHT,
  CELL_WIDTH,
  type AnimationState,
  type AtlasInspection,
  type AtlasProfile,
} from '../target-chatgpt/contract';
import {
  validateAtlasMetadata,
  validateAtlasPreflight,
} from '../atlas-preview/input';
import { sha256Hex } from '../atlas-preview/sha256';
import { inspectAtlas } from '../atlas-tools/inspect';
import { getAnimationFrameRect, getLookFrameRect } from '../atlas-tools/playback';

export const SPRITE_ALPHA_HIT_THRESHOLD = 8;
export const SPRITE_MAX_CANVAS_DIMENSION = 4096;
export const SPRITE_MAX_PIXEL_RATIO = 2;

export interface SpriteLoadResult {
  blob: Blob;
  profile: AtlasProfile;
  inspection: AtlasInspection;
  sha256: string;
  encodedBytes: number;
}

export type SpriteStageErrorCode = 'inspection' | 'decode' | 'canvas';

export class SpriteStageError extends Error {
  readonly code: SpriteStageErrorCode;
  readonly inspection: AtlasInspection | null;

  constructor(
    code: SpriteStageErrorCode,
    message: string,
    inspection: AtlasInspection | null = null,
  ) {
    super(message);
    this.name = 'SpriteStageError';
    this.code = code;
    this.inspection = inspection;
  }
}

interface DestinationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RenderRequest {
  state: AnimationState;
  timeSeconds: number;
  lookAngleDegrees: number | undefined;
}

interface CommittedFrame {
  sourceX: number;
  sourceY: number;
}

function abortError(message = '精灵图加载已取消。'): DOMException {
  return new DOMException(message, 'AbortError');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function assertBlob(value: Blob): void {
  if (
    value === null
    || typeof value !== 'object'
    || typeof value.arrayBuffer !== 'function'
    || typeof value.size !== 'number'
    || typeof value.type !== 'string'
  ) {
    throw new TypeError('SpriteStage 只接受 Blob 输入。');
  }
}

function defaultPixelRatio(): number {
  const value = (globalThis as typeof globalThis & { devicePixelRatio?: number })
    .devicePixelRatio;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.min(value, SPRITE_MAX_PIXEL_RATIO);
}

function resolvePixelRatio(pixelRatio: number | undefined): number {
  if (pixelRatio === undefined) {
    return defaultPixelRatio();
  }
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    throw new RangeError(`pixelRatio 必须是有限正数，实际为 ${String(pixelRatio)}。`);
  }
  return Math.min(pixelRatio, SPRITE_MAX_PIXEL_RATIO);
}

function containDestination(
  canvasWidth: number,
  canvasHeight: number,
): DestinationRect | null {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return null;
  }
  const scale = Math.min(canvasWidth / CELL_WIDTH, canvasHeight / CELL_HEIGHT);
  const width = CELL_WIDTH * scale;
  const height = CELL_HEIGHT * scale;
  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
  };
}

export class SpriteStage {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private disposed = false;
  private generation = 0;
  private activeLoad: AbortController | null = null;
  private bitmap: ImageBitmap | null = null;
  private alphaMask: Uint8Array | null = null;
  private atlasWidth = 0;
  private profile: AtlasProfile | null = null;
  private lastRender: RenderRequest | null = null;
  private lastFrame: CommittedFrame | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new SpriteStageError(
        'canvas',
        '无法创建精灵图渲染所需的 Canvas 2D 上下文。',
      );
    }
    this.canvas = canvas;
    this.context = context;
  }

  get loaded(): boolean {
    return !this.disposed
      && this.bitmap !== null
      && this.alphaMask !== null
      && this.profile !== null;
  }

  async load(
    blob: Blob,
    profile: AtlasProfile,
    signal?: AbortSignal,
  ): Promise<SpriteLoadResult> {
    if (this.disposed) {
      throw abortError('SpriteStage 已销毁。');
    }

    const generation = ++this.generation;
    this.activeLoad?.abort();
    const controller = new AbortController();
    this.activeLoad = controller;
    const relayAbort = () => controller.abort();
    signal?.addEventListener('abort', relayAbort, { once: true });

    this.beginLoading();
    try {
      if (signal?.aborted) {
        controller.abort();
        throw abortError();
      }
      return await this.performLoad(blob, profile, controller.signal, generation);
    } catch (error) {
      if (
        this.disposed
        || generation !== this.generation
        || controller.signal.aborted
      ) {
        throw abortError();
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      signal?.removeEventListener('abort', relayAbort);
      if (this.activeLoad === controller) {
        this.activeLoad = null;
      }
    }
  }

  resize(width: number, height: number, pixelRatio?: number): void {
    if (this.disposed) {
      return;
    }
    if (!Number.isFinite(width) || width <= 0) {
      throw new RangeError(`画布 CSS 宽度必须是有限正数，实际为 ${String(width)}。`);
    }
    if (!Number.isFinite(height) || height <= 0) {
      throw new RangeError(`画布 CSS 高度必须是有限正数，实际为 ${String(height)}。`);
    }
    const ratio = resolvePixelRatio(pixelRatio);
    const backingWidth = Math.max(1, Math.round(width * ratio));
    const backingHeight = Math.max(1, Math.round(height * ratio));
    if (
      !Number.isFinite(backingWidth)
      || !Number.isFinite(backingHeight)
      || backingWidth > SPRITE_MAX_CANVAS_DIMENSION
      || backingHeight > SPRITE_MAX_CANVAS_DIMENSION
    ) {
      throw new RangeError(
        `画布 backing 尺寸 ${String(backingWidth)}×${String(backingHeight)} 超过 ${SPRITE_MAX_CANVAS_DIMENSION}×${SPRITE_MAX_CANVAS_DIMENSION} 上限（CSS ${width}×${height}，pixelRatio ${ratio}）。`,
      );
    }

    this.canvas.width = backingWidth;
    this.canvas.height = backingHeight;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    if (this.lastRender && this.loaded) {
      this.draw(this.lastRender);
    }
  }

  render(
    state: AnimationState,
    timeSeconds: number,
    lookAngleDegrees?: number,
  ): void {
    if (this.disposed || !this.loaded) {
      return;
    }
    this.draw({ state, timeSeconds, lookAngleDegrees });
  }

  hitTest(clientX: number, clientY: number): boolean {
    if (this.disposed || !this.loaded || !this.lastFrame || !this.alphaMask) {
      return false;
    }
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return false;
    }

    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return false;
    }
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const destination = containDestination(canvasWidth, canvasHeight);
    if (!destination) {
      return false;
    }

    const backingX = ((clientX - bounds.left) / bounds.width) * canvasWidth;
    const backingY = ((clientY - bounds.top) / bounds.height) * canvasHeight;
    if (
      backingX < destination.x
      || backingY < destination.y
      || backingX >= destination.x + destination.width
      || backingY >= destination.y + destination.height
    ) {
      return false;
    }

    const column = Math.floor(
      ((backingX - destination.x) / destination.width) * CELL_WIDTH,
    );
    const row = Math.floor(
      ((backingY - destination.y) / destination.height) * CELL_HEIGHT,
    );
    if (
      column < 0
      || column >= CELL_WIDTH
      || row < 0
      || row >= CELL_HEIGHT
    ) {
      return false;
    }

    const sourceX = this.lastFrame.sourceX + column;
    const sourceY = this.lastFrame.sourceY + row;
    const alpha = this.alphaMask[sourceY * this.atlasWidth + sourceX];
    return alpha >= SPRITE_ALPHA_HIT_THRESHOLD;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation += 1;
    this.activeLoad?.abort();
    this.activeLoad = null;
    this.releaseImage();
    this.clearCanvas();
  }

  private async performLoad(
    blob: Blob,
    profile: AtlasProfile,
    signal: AbortSignal,
    generation: number,
  ): Promise<SpriteLoadResult> {
    assertBlob(blob);
    validateAtlasPreflight(profile, blob.size, blob.type);
    this.throwIfStale(generation, signal);

    const buffer = await blob.arrayBuffer();
    this.throwIfStale(generation, signal);
    const header = validateAtlasMetadata(
      { bytes: new Uint8Array(buffer), size: blob.size, mime: blob.type },
      profile,
    );

    const sha256 = await sha256Hex(buffer, { signal });
    this.throwIfStale(generation, signal);

    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await this.decodeBitmap(blob, signal);
      this.throwIfStale(generation, signal);

      if (bitmap.width !== header.width || bitmap.height !== header.height) {
        throw new SpriteStageError(
          'decode',
          `解码后的图集尺寸为 ${bitmap.width}×${bitmap.height}，与文件头声明的 ${header.width}×${header.height} 不一致。`,
        );
      }

      const data = this.readPixels(bitmap);
      const inspection = inspectAtlas(
        { width: bitmap.width, height: bitmap.height, data },
        profile,
        blob.size,
      );
      const result: SpriteLoadResult = {
        blob,
        profile,
        inspection,
        sha256,
        encodedBytes: blob.size,
      };

      this.throwIfStale(generation, signal);
      if (!inspection.valid) {
        throw new SpriteStageError(
          'inspection',
          `图集结构检查未通过（${inspection.errors.length} 项）：${inspection.errors
            .map((issue) => issue.message)
            .join(' ')}`,
          inspection,
        );
      }

      const alphaMask = this.buildAlphaMask(data, bitmap.width, bitmap.height);
      this.throwIfStale(generation, signal);
      this.commit(bitmap, alphaMask, profile);
      bitmap = null;
      return result;
    } finally {
      bitmap?.close();
    }
  }

  private decodeBitmap(blob: Blob, signal: AbortSignal): Promise<ImageBitmap> {
    return new Promise<ImageBitmap>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) {
          return;
        }
        settled = true;
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });

      let decode: Promise<ImageBitmap>;
      try {
        decode = createImageBitmap(blob, {
          colorSpaceConversion: 'none',
          premultiplyAlpha: 'none',
        });
      } catch (error) {
        signal.removeEventListener('abort', onAbort);
        settled = true;
        reject(new SpriteStageError(
          'decode',
          `无法解码精灵图图集：${errorMessage(error)}`,
        ));
        return;
      }

      decode.then((bitmap) => {
        signal.removeEventListener('abort', onAbort);
        if (settled) {
          bitmap.close();
          return;
        }
        settled = true;
        resolve(bitmap);
      }, (error) => {
        signal.removeEventListener('abort', onAbort);
        if (settled) {
          return;
        }
        settled = true;
        reject(new SpriteStageError(
          'decode',
          `无法解码精灵图图集：${errorMessage(error)}`,
        ));
      });

      if (signal.aborted) {
        onAbort();
      }
    });
  }

  private readPixels(bitmap: ImageBitmap): Uint8ClampedArray {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new SpriteStageError(
        'canvas',
        '无法创建用于图集像素检查的 Canvas 2D 上下文。',
      );
    }
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  }

  private buildAlphaMask(
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ): Uint8Array {
    const mask = new Uint8Array(width * height);
    for (let pixel = 0, index = 3; pixel < mask.length; pixel += 1, index += 4) {
      mask[pixel] = data[index];
    }
    return mask;
  }

  private throwIfStale(generation: number, signal: AbortSignal): void {
    if (this.disposed || generation !== this.generation || signal.aborted) {
      throw abortError();
    }
  }

  private beginLoading(): void {
    this.releaseImage();
    this.clearCanvas();
  }

  private commit(
    bitmap: ImageBitmap,
    alphaMask: Uint8Array,
    profile: AtlasProfile,
  ): void {
    this.bitmap = bitmap;
    this.alphaMask = alphaMask;
    this.atlasWidth = bitmap.width;
    this.profile = profile;
    this.lastRender = null;
    this.lastFrame = null;
  }

  private releaseImage(): void {
    if (this.bitmap) {
      this.bitmap.close();
      this.bitmap = null;
    }
    this.alphaMask = null;
    this.atlasWidth = 0;
    this.profile = null;
    this.lastRender = null;
    this.lastFrame = null;
  }

  private clearCanvas(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw(request: RenderRequest): void {
    if (!this.bitmap || !this.profile) {
      return;
    }

    const source = this.profile === 'v2' && request.lookAngleDegrees !== undefined
      ? getLookFrameRect(request.lookAngleDegrees)
      : getAnimationFrameRect(request.state, request.timeSeconds);

    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const destination = containDestination(canvasWidth, canvasHeight);
    this.context.clearRect(0, 0, canvasWidth, canvasHeight);
    if (!destination) {
      this.lastRender = request;
      this.lastFrame = null;
      return;
    }

    this.context.drawImage(
      this.bitmap,
      source.x,
      source.y,
      CELL_WIDTH,
      CELL_HEIGHT,
      destination.x,
      destination.y,
      destination.width,
      destination.height,
    );
    this.lastRender = request;
    this.lastFrame = { sourceX: source.x, sourceY: source.y };
  }
}
