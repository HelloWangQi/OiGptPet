import { exportAtlas } from '../../../packages/pet-exporter/index.ts';
import { inspectAtlas } from '../../../packages/atlas-tools/index.ts';
import {
  atlasDimensions,
  type AtlasInspection,
  type AtlasProfile,
} from '../../../packages/target-chatgpt/contract';

interface ProbeSnapshot {
  contexts: number;
  lost: number;
  live: number;
  draws: number;
  clears: number;
}

interface RenderSummary {
  ok: true;
  profile: AtlasProfile;
  base64: string;
  bytes: number;
  width: number;
  height: number;
  frames: number;
  inspection: AtlasInspection;
  timing: {
    exportMs: number;
    /** Export start to first completed cell; includes VRM load and WebGL setup. */
    timeToFirstFrameMs: number;
    frameDurationsMs: number[];
    frameDrawCalls: number[];
    frameClearCalls: number[];
    drawCalls: number;
    clearCalls: number;
    glContextsCreated: number;
  };
}

interface CancellationSummary {
  ok: false;
  name: string;
  message: string;
  elapsedMs: number;
  framesCompleted: number;
  drawCalls: number;
  glContextsCreated: number;
  contextLossObserved: boolean;
  probe: ProbeSnapshot;
}

interface ModelSummary {
  bytes: number;
  url: string;
}

interface AnimationRenderFixture {
  loadModel: (url: string) => Promise<ModelSummary>;
  render: (profile: AtlasProfile) => Promise<RenderSummary>;
  cancel: (profile: AtlasProfile) => Promise<CancellationSummary>;
  probe: () => ProbeSnapshot;
}

declare global {
  interface Window {
    __animationRenderProbe: ProbeSnapshot;
    __animationRender: AnimationRenderFixture;
  }
}

const statusHost = document.querySelector<HTMLElement>('#status');
if (!statusHost) {
  throw new Error('Fixture status element is missing.');
}
const statusElement: HTMLElement = statusHost;

let model: ArrayBuffer | null = null;
let modelUrl = '';

function snapshotProbe(): ProbeSnapshot {
  return { ...window.__animationRenderProbe };
}

function requireModel(): ArrayBuffer {
  if (!model) {
    throw new Error('No model has been loaded.');
  }
  return model;
}

async function loadModel(url: string): Promise<ModelSummary> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Model fetch failed: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error('Model file is empty.');
  }
  model = buffer;
  modelUrl = url;
  statusElement.dataset.ready = 'true';
  statusElement.textContent = `Model loaded: ${buffer.byteLength} bytes`;
  return { bytes: buffer.byteLength, url };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function inspectBlob(blob: Blob, profile: AtlasProfile): Promise<AtlasInspection> {
  const expected = atlasDimensions(profile);
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width !== expected.width || bitmap.height !== expected.height) {
      throw new Error(`Decoded atlas is ${bitmap.width}×${bitmap.height}, expected ${expected.width}×${expected.height}.`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = expected.width;
    canvas.height = expected.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Fixture 2D context is unavailable.');
    }
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, expected.width, expected.height);
    return inspectAtlas(image, profile, blob.size);
  } finally {
    bitmap.close();
  }
}

async function render(profile: AtlasProfile): Promise<RenderSummary> {
  const buffer = requireModel();
  const before = snapshotProbe();
  const started = performance.now();
  const timestamps: number[] = [];
  const drawSnapshots: number[] = [];
  const clearSnapshots: number[] = [];
  const result = await exportAtlas(buffer, profile, () => {
    timestamps.push(performance.now());
    const current = snapshotProbe();
    drawSnapshots.push(current.draws);
    clearSnapshots.push(current.clears);
  });
  const exportMs = performance.now() - started;
  const frameDurationsMs = timestamps.map((timestamp, index) => (
    timestamp - (index === 0 ? started : timestamps[index - 1])
  ));
  const frameDrawCalls = drawSnapshots.map((draws, index) => (
    draws - (index === 0 ? before.draws : drawSnapshots[index - 1])
  ));
  const frameClearCalls = clearSnapshots.map((clears, index) => (
    clears - (index === 0 ? before.clears : clearSnapshots[index - 1])
  ));
  const after = snapshotProbe();
  const inspection = await inspectBlob(result.blob, profile);
  const base64 = await blobToBase64(result.blob);
  if (inspection.valid !== true) {
    throw new Error(`Rendered atlas failed structure inspection: ${inspection.errors.map((issue) => issue.message).join('; ')}`);
  }
  return {
    ok: true,
    profile,
    base64,
    bytes: result.blob.size,
    width: result.width,
    height: result.height,
    frames: result.frames,
    inspection,
    timing: {
      exportMs,
      timeToFirstFrameMs: frameDurationsMs[0] ?? 0,
      frameDurationsMs,
      frameDrawCalls,
      frameClearCalls,
      drawCalls: after.draws - before.draws,
      clearCalls: after.clears - before.clears,
      glContextsCreated: after.contexts - before.contexts,
    },
  };
}

async function waitForContextLoss(before: ProbeSnapshot): Promise<boolean> {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const current = snapshotProbe();
    if (current.live === before.live && current.lost > before.lost) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function cancel(profile: AtlasProfile): Promise<CancellationSummary> {
  const buffer = requireModel();
  const before = snapshotProbe();
  const controller = new AbortController();
  const started = performance.now();
  let framesCompleted = 0;
  try {
    await exportAtlas(buffer, profile, (done) => {
      framesCompleted = done;
      if (done === 3) {
        controller.abort();
      }
    }, controller.signal);
    throw new Error('Export unexpectedly completed before cancellation.');
  } catch (error) {
    if (error instanceof Error && error.message === 'Export unexpectedly completed before cancellation.') {
      throw error;
    }
    const after = snapshotProbe();
    const contextLossObserved = await waitForContextLoss(before);
    const finalProbe = snapshotProbe();
    return {
      ok: false,
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      elapsedMs: performance.now() - started,
      framesCompleted,
      drawCalls: after.draws - before.draws,
      glContextsCreated: after.contexts - before.contexts,
      contextLossObserved,
      probe: finalProbe,
    };
  }
}

window.__animationRender = {
  loadModel,
  render,
  cancel,
  probe: snapshotProbe,
};

statusElement.textContent = 'Animation render fixture ready';
