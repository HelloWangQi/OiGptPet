import {
  ANIMATION_ROWS,
  CELL_HEIGHT,
  CELL_WIDTH,
  MAX_ENCODED_BYTES,
  atlasDimensions,
  type AnimationState,
  type AtlasProfile,
} from '../../../packages/target-chatgpt/contract';
import { SpriteStage } from '../../../packages/renderer-sprite/index.ts';

interface AtlasOptions {
  format?: 'png' | 'webp';
  empty?: { row: number; frame: number };
  pollute?: { row: number; frame: number };
}

interface LoadSummary {
  profile: AtlasProfile;
  inspection: {
    valid: boolean;
    profile: AtlasProfile;
    requiredFrames: number;
    errors: { code: string; message: string; row?: number; frame?: number }[];
    warnings: string[];
  };
  sha256: string;
  encodedBytes: number;
  sameBlob: boolean;
}

interface StablePoint {
  x: number;
  y: number;
  rgba: [number, number, number, number];
}

interface CellAnalysis {
  row: number;
  frame: number;
  opaque: StablePoint[];
  transparent: StablePoint[];
}

interface MarkerInfo {
  color: [number, number, number];
  local: { x: number; y: number };
  localTop: { x: number; y: number };
  localBottom: { x: number; y: number };
}

interface CanvasSnapshot {
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
  rect: { left: number; top: number; width: number; height: number };
}

interface SpriteFixture {
  mount: (options?: { width?: number; height?: number; pixelRatio?: number }) => void;
  dispose: () => void;
  isLoaded: () => boolean;
  hasStage: () => boolean;
  stageInfo: () => { loaded: boolean; canvas: CanvasSnapshot | null };
  loadKey: (key: string, profile: AtlasProfile, signal?: AbortSignal) => Promise<LoadSummary>;
  loadKeyTimed: (
    key: string,
    profile: AtlasProfile,
    signal?: AbortSignal,
  ) => Promise<{ summary: LoadSummary; elapsedMs: number }>;
  render: (state: AnimationState, timeSeconds: number, lookAngleDegrees?: number) => void;
  hitTest: (clientX: number, clientY: number) => boolean;
  resize: (width: number, height: number, pixelRatio?: number) => void;
  canvasPixel: (x: number, y: number) => number[];
  canvasDataUrl: () => string;
  canvasSnapshot: () => CanvasSnapshot | null;
  putBlob: (key: string, base64: string, type: string) => void;
  keyInfo: (key: string) => { size: number; type: string };
  registerBlob: (blob: Blob) => string;
  removeKey: (key: string) => void;
  rewrapKey: (key: string, type: string) => Promise<string>;
  makeMarker: (profile: AtlasProfile, options?: AtlasOptions) => Promise<{ key: string; size: number; type: string }>;
  makeCorruptPng: (profile?: AtlasProfile) => string;
  makeOversized: () => string;
  makeFakeImage: () => string;
  markerInfo: (row: number, frame: number) => MarkerInfo;
  analyzeKey: (key: string, row: number, frame: number) => Promise<CellAnalysis>;
  sampleKey: (
    key: string,
    row: number,
    frame: number,
    points: { x: number; y: number }[],
  ) => Promise<number[][]>;
  blobToBase64: (blob: Blob) => Promise<string>;
}

declare global {
  interface Window {
    __spriteFixture: SpriteFixture;
  }
}

const hostElement = document.querySelector<HTMLElement>('#host');
if (!hostElement) {
  throw new Error('Fixture host is missing.');
}
const host: HTMLElement = hostElement;
const LOG = document.querySelector<HTMLElement>('#log');

const registry = new Map<string, Blob>();
let sequence = 0;
let stage: SpriteStage | null = null;
let canvas: HTMLCanvasElement | null = null;
let disposed = false;

function requireStage(): SpriteStage {
  if (!stage) {
    throw new Error('SpriteStage is not mounted.');
  }
  return stage;
}

function requireCanvas(): HTMLCanvasElement {
  if (!canvas) {
    throw new Error('SpriteStage canvas is not mounted.');
  }
  return canvas;
}

function registerBlob(blob: Blob): string {
  sequence += 1;
  const key = `blob-${sequence}`;
  registry.set(key, blob);
  return key;
}

function requireBlob(key: string): Blob {
  const blob = registry.get(key);
  if (!blob) {
    throw new Error(`Unknown fixture blob key: ${key}`);
  }
  return blob;
}

function markerColor(row: number, frame: number): [number, number, number] {
  return [20 + row * 9, 20 + frame * 18, 200];
}

function markerBaseY(row: number): number {
  return 8 + row * 4;
}

function markerInfo(row: number, frame: number): MarkerInfo {
  return {
    color: markerColor(row, frame),
    local: {
      x: 8 + 3,
      y: markerBaseY(row) + 3,
    },
    localTop: { x: 1 + 2, y: 1 + 2 },
    localBottom: { x: 187 + 2, y: 203 + 2 },
  };
}

function framesInRow(profile: AtlasProfile, row: number): number {
  if (row < ANIMATION_ROWS.length) {
    return ANIMATION_ROWS[row].frames;
  }
  return profile === 'v2' && row < 11 ? 8 : 0;
}

function canvasToBlob(canvasElement: HTMLCanvasElement, format: 'png' | 'webp'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvasElement.toBlob(
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
      1,
    );
  });
}

function blobFromBase64(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  });
}

async function makeMarkerAtlas(
  profile: AtlasProfile,
  options: AtlasOptions = {},
): Promise<{ key: string; size: number; type: string }> {
  const { width, height } = atlasDimensions(profile);
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Fixture canvas 2D context is unavailable.');
  }

  const rows = profile === 'v2' ? 11 : 9;
  const skipped = (row: number, frame: number) => (
    options.empty?.row === row && options.empty.frame === frame
  );

  for (let row = 0; row < rows; row += 1) {
    const frameCount = framesInRow(profile, row);
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (skipped(row, frame)) {
        continue;
      }
      const cellX = frame * CELL_WIDTH;
      const cellY = row * CELL_HEIGHT;
      const [red, green, blue] = markerColor(row, frame);
      context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      context.fillRect(cellX + 8, cellY + markerBaseY(row), 6, 6);
      context.fillStyle = '#ff0000';
      context.fillRect(cellX + 1, cellY + 1, 4, 4);
      context.fillStyle = '#0000ff';
      context.fillRect(cellX + 187, cellY + 203, 4, 4);
    }
  }

  if (!skipped(0, 0)) {
    context.fillStyle = '#ffffff';
    context.fillRect(10, 20, 40, 80);
    context.fillStyle = 'rgba(255, 255, 255, 0.027450980392156862)';
    context.fillRect(60, 30, 1, 1);
    context.fillStyle = 'rgba(255, 255, 255, 0.7843137254901961)';
    context.fillRect(61, 30, 1, 1);
    context.fillStyle = 'rgba(255, 255, 255, 0.027450980392156862)';
    context.fillRect(30, 120, 1, 1);
    context.fillStyle = 'rgba(255, 255, 255, 0.03137254901960784)';
    context.fillRect(31, 120, 1, 1);
  }

  if (!skipped(4, 0)) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 4 * CELL_HEIGHT + 180, 51, 28);
  }

  if (profile === 'v2') {
    context.fillStyle = '#ffffff';
    context.fillRect(4 * CELL_WIDTH + 140, 9 * CELL_HEIGHT + 160, 40, 40);
  }

  if (options.pollute) {
    context.fillStyle = '#ff00ff';
    context.fillRect(
      options.pollute.frame * CELL_WIDTH + 1,
      options.pollute.row * CELL_HEIGHT + 1,
      1,
      1,
    );
  }

  const blob = await canvasToBlob(element, options.format ?? 'png');
  return { key: registerBlob(blob), size: blob.size, type: blob.type };
}

function makeCorruptPng(profile: AtlasProfile = 'v2'): string {
  const { width, height } = atlasDimensions(profile);
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return registerBlob(new Blob([bytes], { type: 'image/png' }));
}

function makeOversized(): string {
  return registerBlob(
    new Blob([new Uint8Array(MAX_ENCODED_BYTES + 1)], { type: 'image/png' }),
  );
}

function makeFakeImage(): string {
  return registerBlob(
    new Blob([new TextEncoder().encode('not really a png')], { type: 'image/png' }),
  );
}

async function rewrapKey(key: string, type: string): Promise<string> {
  const bytes = new Uint8Array(await requireBlob(key).arrayBuffer());
  return registerBlob(new Blob([bytes], { type }));
}

function alphaAt(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  return data[(y * width + x) * 4 + 3];
}

function neighborhoodMatches(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  radius: number,
  alpha: number,
): boolean {
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (alphaAt(data, width, x + offsetX, y + offsetY) !== alpha) {
        return false;
      }
    }
  }
  return true;
}

async function readAtlas(blob: Blob): Promise<{
  width: number;
  height: number;
  data: Uint8ClampedArray;
}> {
  const bitmap = await createImageBitmap(blob);
  try {
    const element = document.createElement('canvas');
    element.width = bitmap.width;
    element.height = bitmap.height;
    const context = element.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Fixture read canvas 2D context is unavailable.');
    }
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, data: image.data };
  } finally {
    bitmap.close();
  }
}

async function analyzeKey(key: string, row: number, frame: number): Promise<CellAnalysis> {
  const { width, data } = await readAtlas(requireBlob(key));
  const originX = frame * CELL_WIDTH;
  const originY = row * CELL_HEIGHT;
  const opaque: StablePoint[] = [];
  const transparent: StablePoint[] = [];

  for (let y = 3; y < CELL_HEIGHT - 3; y += 3) {
    for (let x = 3; x < CELL_WIDTH - 3; x += 3) {
      const globalX = originX + x;
      const globalY = originY + y;
      const alpha = alphaAt(data, width, globalX, globalY);
      if (alpha === 255 && neighborhoodMatches(data, width, globalX, globalY, 2, 255)) {
        const index = (globalY * width + globalX) * 4;
        opaque.push({
          x,
          y,
          rgba: [data[index], data[index + 1], data[index + 2], data[index + 3]],
        });
      } else if (alpha === 0 && neighborhoodMatches(data, width, globalX, globalY, 2, 0)) {
        transparent.push({ x, y, rgba: [0, 0, 0, 0] });
      }
      if (opaque.length >= 32 && transparent.length >= 32) {
        return { row, frame, opaque, transparent };
      }
    }
  }

  return { row, frame, opaque, transparent };
}

async function sampleKey(
  key: string,
  row: number,
  frame: number,
  points: { x: number; y: number }[],
): Promise<number[][]> {
  const { width, data } = await readAtlas(requireBlob(key));
  return points.map((point) => {
    const index = (
      (row * CELL_HEIGHT + point.y) * width
      + frame * CELL_WIDTH
      + point.x
    ) * 4;
    return [data[index], data[index + 1], data[index + 2], data[index + 3]];
  });
}

function mount(options: { width?: number; height?: number; pixelRatio?: number } = {}): void {
  if (stage) {
    stage.dispose();
  }
  host.replaceChildren();
  const element = document.createElement('canvas');
  element.dataset.spriteCanvas = '';
  host.append(element);
  stage = new SpriteStage(element);
  canvas = element;
  disposed = false;
  stage.resize(options.width ?? 192, options.height ?? 208, options.pixelRatio ?? 1);
}

function dispose(): void {
  stage?.dispose();
  disposed = true;
}

function canvasSnapshot(): CanvasSnapshot | null {
  if (!canvas) {
    return null;
  }
  const bounds = canvas.getBoundingClientRect();
  return {
    width: canvas.width,
    height: canvas.height,
    cssWidth: Number.parseFloat(canvas.style.width),
    cssHeight: Number.parseFloat(canvas.style.height),
    rect: {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    },
  };
}

async function loadSummary(blob: Blob, profile: AtlasProfile, signal?: AbortSignal): Promise<LoadSummary> {
  const result = await requireStage().load(blob, profile, signal);
  return {
    profile: result.profile,
    inspection: {
      valid: result.inspection.valid,
      profile: result.inspection.profile,
      requiredFrames: result.inspection.requiredFrames,
      errors: result.inspection.errors,
      warnings: result.inspection.warnings,
    },
    sha256: result.sha256,
    encodedBytes: result.encodedBytes,
    sameBlob: result.blob === blob,
  };
}

function canvasPixel(x: number, y: number): number[] {
  const element = requireCanvas();
  const context = element.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Display canvas 2D context is unavailable.');
  }
  return Array.from(context.getImageData(x, y, 1, 1).data);
}

const fixture: SpriteFixture = {
  mount,
  dispose,
  isLoaded: () => stage?.loaded ?? false,
  hasStage: () => stage !== null && !disposed,
  stageInfo: () => ({
    loaded: stage?.loaded ?? false,
    canvas: canvasSnapshot(),
  }),
  loadKey: (key, profile, signal) => loadSummary(requireBlob(key), profile, signal),
  loadKeyTimed: async (key, profile, signal) => {
    const started = performance.now();
    const summary = await loadSummary(requireBlob(key), profile, signal);
    return { summary, elapsedMs: performance.now() - started };
  },
  render: (state, timeSeconds, lookAngleDegrees) => {
    stage?.render(state, timeSeconds, lookAngleDegrees);
  },
  hitTest: (clientX, clientY) => stage?.hitTest(clientX, clientY) ?? false,
  resize: (width, height, pixelRatio) => {
    stage?.resize(width, height, pixelRatio);
  },
  canvasPixel,
  canvasDataUrl: () => requireCanvas().toDataURL('image/png'),
  canvasSnapshot,
  putBlob: (key, base64, type) => {
    registry.set(key, blobFromBase64(base64, type));
  },
  keyInfo: (key) => {
    const blob = requireBlob(key);
    return { size: blob.size, type: blob.type };
  },
  registerBlob,
  removeKey: (key) => {
    registry.delete(key);
  },
  rewrapKey,
  makeMarker: makeMarkerAtlas,
  makeCorruptPng,
  makeOversized,
  makeFakeImage,
  markerInfo,
  analyzeKey,
  sampleKey,
  blobToBase64,
};

window.__spriteFixture = fixture;

if (LOG) {
  LOG.textContent = 'fixture ready';
}
