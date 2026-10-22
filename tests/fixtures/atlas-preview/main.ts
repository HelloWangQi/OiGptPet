import {
  ANIMATION_ROWS,
  CELL_HEIGHT,
  CELL_WIDTH,
  MAX_ENCODED_BYTES,
  atlasDimensions,
  type AtlasInspection,
  type AtlasProfile,
} from '../../../packages/target-chatgpt/contract';
import {
  createAtlasPreview,
  type AtlasPreviewController,
} from '../../../packages/atlas-preview/index.ts';
import { sha256Hex } from '../../../packages/atlas-preview/sha256.ts';

interface AtlasOptions {
  empty?: { row: number; frame: number };
  pollute?: { row: number; frame: number };
  format?: 'png' | 'webp';
}

interface LoadSummary {
  profile: AtlasProfile;
  inspection: AtlasInspection;
  sha256: string;
  encodedBytes: number;
  sameBlob: boolean;
}

interface HashMetrics {
  hash: string;
  elapsedMs: number;
  yields: number;
}

interface HashComparison {
  isSecureContext: boolean;
  nativeAvailable: boolean;
  native: HashMetrics;
  fallback: HashMetrics;
}

interface AtlasFixture {
  host: HTMLElement;
  createAtlasPreview: typeof createAtlasPreview;
  mount: () => void;
  dispose: () => void;
  load: (
    blob: Blob,
    profile: AtlasProfile,
    signal?: AbortSignal,
  ) => Promise<LoadSummary>;
  makeAtlas: (profile: AtlasProfile, options?: AtlasOptions) => Promise<Blob>;
  makeCorruptPng: () => Blob;
  makeOversized: () => Blob;
  withType: (blob: Blob, type: string) => Promise<Blob>;
  blobToBase64: (blob: Blob) => Promise<string>;
  blobFromBase64: (base64: string, type: string) => Blob;
  canvasPixel: (x: number, y: number) => number[];
  sha256Hex: typeof sha256Hex;
  hashBoth: (buffer: ArrayBuffer) => Promise<HashComparison>;
  hashFallbackWithMetrics: (buffer: ArrayBuffer) => Promise<HashMetrics>;
  makeZeroBuffer: (size: number) => ArrayBuffer;
}

declare global {
  interface Window {
    __atlasFixture: AtlasFixture;
  }
}

const hostElement = document.querySelector<HTMLElement>('#host');
if (!hostElement) {
  throw new Error('Fixture host is missing.');
}
const host: HTMLElement = hostElement;

const LOG = document.querySelector<HTMLElement>('#log');
const PALETTE = [
  '#2563eb',
  '#0891b2',
  '#059669',
  '#65a30d',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#7c3aed',
  '#4f46e5',
  '#0d9488',
];

let controller: AtlasPreviewController | null = null;

function canvasToBlob(canvas: HTMLCanvasElement, format: 'png' | 'webp'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas could not encode the fixture atlas.'));
          return;
        }
        const expected = `image/${format}`;
        if (blob.type !== expected) {
          reject(new Error(`Expected ${expected}, received ${blob.type || 'no MIME type'}.`));
          return;
        }
        resolve(blob);
      },
      `image/${format}`,
      0.95,
    );
  });
}

async function makeAtlas(profile: AtlasProfile, options: AtlasOptions = {}): Promise<Blob> {
  const { width, height } = atlasDimensions(profile);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Fixture canvas 2D context is unavailable.');
  }

  const rowCount = profile === 'v2' ? 11 : 9;
  for (let row = 0; row < rowCount; row += 1) {
    const frames = row < ANIMATION_ROWS.length ? ANIMATION_ROWS[row].frames : 8;
    for (let frame = 0; frame < frames; frame += 1) {
      if (options.empty?.row === row && options.empty.frame === frame) {
        continue;
      }
      const cellX = frame * CELL_WIDTH;
      const cellY = row * CELL_HEIGHT;
      context.fillStyle = PALETTE[(row * 8 + frame) % PALETTE.length];
      context.fillRect(cellX + 8, cellY + 8, CELL_WIDTH - 16, CELL_HEIGHT - 24);
      context.fillStyle = '#ffffff';
      context.fillRect(cellX + 20, cellY + 20, 2, 2);
      context.fillStyle = '#000000';
      context.fillRect(cellX + 20, cellY + CELL_HEIGHT - 2, 2, 2);
    }
  }

  if (options.pollute) {
    const { row, frame } = options.pollute;
    context.fillStyle = '#ff0000';
    context.fillRect(frame * CELL_WIDTH, row * CELL_HEIGHT, 1, 1);
  }

  return canvasToBlob(canvas, options.format ?? 'png');
}

function makeCorruptPng(): Blob {
  const v2 = atlasDimensions('v2');
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, v2.width);
  view.setUint32(20, v2.height);
  bytes[24] = 8;
  bytes[25] = 6;
  return new Blob([bytes], { type: 'image/png' });
}

function makeOversized(): Blob {
  return new Blob([new Uint8Array(MAX_ENCODED_BYTES + 1)], { type: 'image/png' });
}

async function withType(blob: Blob, type: string): Promise<Blob> {
  return new Blob([await blob.arrayBuffer()], { type });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function blobFromBase64(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

async function measureHash(
  buffer: ArrayBuffer,
  forceFallback: boolean,
): Promise<HashMetrics> {
  let yields = 0;
  const started = performance.now();
  const hash = await sha256Hex(buffer, {
    subtle: forceFallback ? null : undefined,
    yieldToEventLoop: async () => {
      yields += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  });
  return { hash, elapsedMs: performance.now() - started, yields };
}

async function hashBoth(buffer: ArrayBuffer): Promise<HashComparison> {
  const native = await measureHash(buffer, false);
  const fallback = await measureHash(buffer, true);
  return {
    isSecureContext: window.isSecureContext,
    nativeAvailable: Boolean(globalThis.crypto?.subtle),
    native,
    fallback,
  };
}

async function hashFallbackWithMetrics(buffer: ArrayBuffer): Promise<HashMetrics> {
  return measureHash(buffer, true);
}

function makeZeroBuffer(size: number): ArrayBuffer {
  return new ArrayBuffer(size);
}

function canvasPixel(x: number, y: number): number[] {
  const canvas = host.querySelector<HTMLCanvasElement>('[data-atlas-canvas]');
  if (!canvas) {
    throw new Error('Preview canvas is not mounted.');
  }
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Preview canvas 2D context is unavailable.');
  }
  return Array.from(context.getImageData(x, y, 1, 1).data);
}

function mount(): void {
  controller?.dispose();
  controller = createAtlasPreview(host);
}

function dispose(): void {
  controller?.dispose();
  controller = null;
}

async function load(
  blob: Blob,
  profile: AtlasProfile,
  signal?: AbortSignal,
): Promise<LoadSummary> {
  if (!controller) {
    throw new Error('Preview controller is not mounted.');
  }
  const result = await controller.load(blob, profile, signal);
  return {
    profile: result.profile,
    inspection: result.inspection,
    sha256: result.sha256,
    encodedBytes: result.encodedBytes,
    sameBlob: result.blob === blob,
  };
}

const fixture: AtlasFixture = {
  host,
  createAtlasPreview,
  mount,
  dispose,
  load,
  makeAtlas,
  makeCorruptPng,
  makeOversized,
  withType,
  blobToBase64,
  blobFromBase64,
  canvasPixel,
  sha256Hex,
  hashBoth,
  hashFallbackWithMetrics,
  makeZeroBuffer,
};

window.__atlasFixture = fixture;

const auto = new URLSearchParams(window.location.search).get('auto') !== '0';
if (auto) {
  void (async () => {
    mount();
    const blob = await makeAtlas('v2');
    await load(blob, 'v2');
  })().catch((error: unknown) => {
    if (LOG) {
      LOG.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}
