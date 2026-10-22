import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleLook, sampleMotion } from '../packages/character-core';
import type { AnimationState } from '../packages/target-chatgpt/contract';

const LOOP_PHASES = [0, 0.25, 0.5, 0.75, 0.999];

interface MockStage {
  calls: {
    load: unknown[][];
    resize: unknown[][];
    renderSettled: unknown[][];
    render: unknown[][];
    dispose: number;
  };
}

const stageHarness = vi.hoisted(() => ({
  instances: [] as MockStage[],
  loadError: null as Error | null,
  renderError: null as Error | null,
}));

vi.mock('../packages/renderer-vrm', () => {
  class VrmStage {
    calls: MockStage['calls'] = {
      load: [],
      resize: [],
      renderSettled: [],
      render: [],
      dispose: 0,
    };

    constructor() {
      stageHarness.instances.push(this as unknown as MockStage);
    }

    async load(source: ArrayBuffer) {
      this.calls.load.push([source]);
      if (stageHarness.loadError) {
        throw stageHarness.loadError;
      }
      return { name: 'Test' };
    }

    resize(...args: unknown[]) {
      this.calls.resize.push(args);
    }

    render(...args: unknown[]) {
      this.calls.render.push(args);
    }

    renderSettled(...args: unknown[]) {
      if (stageHarness.renderError) {
        throw stageHarness.renderError;
      }
      this.calls.renderSettled.push(args);
    }

    dispose() {
      this.calls.dispose += 1;
    }
  }
  return { VrmStage };
});

interface FakeCanvas {
  width: number;
  height: number;
  drawnFrames: number;
  toBlobCalls: number;
}

function installFakeDocument(onEncode?: () => void): FakeCanvas[] {
  const canvases: FakeCanvas[] = [];
  const documentStub = {
    createElement(tag: string) {
      if (tag !== 'canvas') {
        throw new Error(`Unexpected element: ${tag}`);
      }
      const canvas: FakeCanvas = {
        width: 0,
        height: 0,
        drawnFrames: 0,
        toBlobCalls: 0,
      };
      const getContext = (type: string) => {
        if (type !== '2d') {
          throw new Error(`Unexpected context: ${type}`);
        }
        return {
          drawImage: () => {
            canvas.drawnFrames += 1;
          },
        };
      };
      Object.assign(canvas, {
        getContext,
        toBlob: (callback: (blob: Blob | null) => void, mime: string) => {
          canvas.toBlobCalls += 1;
          onEncode?.();
          callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: mime }));
        },
      });
      canvases.push(canvas);
      return canvas;
    },
  };
  vi.stubGlobal('document', documentStub as unknown as Document);
  return canvases;
}

async function loadExporter() {
  return import('../packages/pet-exporter/index.ts');
}

afterEach(() => {
  vi.unstubAllGlobals();
  stageHarness.instances.length = 0;
  stageHarness.loadError = null;
  stageHarness.renderError = null;
});

describe('failed posture boundaries', () => {
  it('stays in a loss posture for the whole loop instead of collapsing to idle', () => {
    for (const phase of LOOP_PHASES) {
      const failed = sampleMotion('failed', phase);
      expect(failed.sad).toBe(1);
      expect(failed.happy).toBe(0);
      expect(failed.headPitch).toBeGreaterThanOrEqual(0.35);
      expect(Math.abs(failed.headRoll)).toBeGreaterThanOrEqual(0.08);
      expect(failed.spine?.[0]).toBeGreaterThan(0.15);
      expect(failed.chest?.[0]).toBeGreaterThan(0.08);
      expect(failed.neck?.[0]).toBeGreaterThan(0.1);
      expect(failed.leftArm[0]).toBeLessThanOrEqual(-0.65);
      expect(failed.rightArm[0]).toBeLessThanOrEqual(-0.65);
      expect(Math.abs(failed.leftArm[2])).toBeGreaterThanOrEqual(0.55);
      expect(Math.abs(failed.rightArm[2])).toBeGreaterThanOrEqual(0.55);
      expect(failed.leftForearm[2]).toBeLessThanOrEqual(-2.3);
      expect(failed.rightForearm[2]).toBeGreaterThanOrEqual(2.3);
    }
  });

  it('differs from idle through torso, arms and expression at every phase', () => {
    for (const phase of LOOP_PHASES) {
      const failed = sampleMotion('failed', phase);
      const idle = sampleMotion('idle', phase);
      expect(failed.leftArm).not.toEqual(idle.leftArm);
      expect(failed.rightArm).not.toEqual(idle.rightArm);
      expect(failed.leftForearm[2] - idle.leftForearm[2]).toBeLessThan(-1.5);
      expect(failed.sad - idle.sad).toBe(1);
      expect(failed.spine).toBeDefined();
      expect(failed.chest).toBeDefined();
      expect(failed.neck).toBeDefined();
      expect(idle.spine).toBeUndefined();
    }
  });
});

describe('working posture boundaries', () => {
  it('keeps legs planted and folds both forearms while leaning into the task', () => {
    for (const phase of LOOP_PHASES) {
      const working = sampleMotion('running', phase);
      expect(working.leftLeg).toBe(0);
      expect(working.rightLeg).toBe(0);
      expect(working.rootY).toBe(0);
      expect(working.rootYaw).toBe(0);
      expect(working.headPitch).toBeGreaterThanOrEqual(0.2);
      expect(working.headYaw).toBeGreaterThanOrEqual(0.02);
      expect(working.spine?.[0]).toBeGreaterThan(0.08);
      expect(working.chest?.[0]).toBeGreaterThan(0.05);
      expect(working.leftForearm[2]).toBeLessThanOrEqual(-1.15);
      expect(working.rightForearm[2]).toBeGreaterThanOrEqual(2.15);
      expect(working.leftArm[2]).toBeLessThanOrEqual(-0.95);
      expect(working.rightArm[2]).toBeGreaterThanOrEqual(0.3);
      expect(working.rightArm[2]).toBeLessThanOrEqual(0.4);
      expect(working.rightArm[2] - working.leftArm[2]).toBeGreaterThanOrEqual(1.4);
    }
  });

  it('remains distinguishable from waiting and review across the loop', () => {
    for (const phase of LOOP_PHASES) {
      const working = sampleMotion('running', phase);
      const waiting = sampleMotion('waiting', phase);
      const review = sampleMotion('review', phase);
      expect(working.headPitch - review.headPitch).toBeGreaterThan(0.07);
      expect(working.leftForearm[2] - waiting.leftForearm[2]).toBeLessThan(-0.8);
      expect(working.rightForearm[2] - review.rightForearm[2]).toBeGreaterThan(1.2);
      expect(working.spine).toBeDefined();
      expect(waiting.spine).toBeUndefined();
      expect(review.spine).toBeUndefined();
    }
  });

  it('leaves the directional running gait untouched', () => {
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      const right = sampleMotion('running-right', phase);
      const left = sampleMotion('running-left', phase);
      expect(right.leftLeg).toBeCloseTo(left.leftLeg, 12);
      expect(right.rightLeg).toBeCloseTo(left.rightLeg, 12);
      expect(right.leftArm).toEqual(left.leftArm);
      expect(right.rootYaw).toBeGreaterThan(0);
      expect(left.rootYaw).toBeLessThan(0);
      expect(right.rootYaw).toBeCloseTo(-left.rootYaw, 12);
      expect(right.spine).toBeUndefined();
    }
  });
});

describe('optional torso fields stay scoped and finite', () => {
  it('only failed and running use torso rotations', () => {
    const torsoStates: AnimationState[] = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'waiting', 'review'];
    for (const state of torsoStates) {
      const pose = sampleMotion(state, 0.37);
      expect(pose.spine).toBeUndefined();
      expect(pose.chest).toBeUndefined();
      expect(pose.neck).toBeUndefined();
    }
    const failed = sampleMotion('failed', 0.37);
    const working = sampleMotion('running', 0.37);
    expect(failed.spine).toBeDefined();
    expect(failed.chest).toBeDefined();
    expect(failed.neck).toBeDefined();
    expect(working.spine).toBeDefined();
    expect(working.chest).toBeDefined();
    expect(working.neck).toBeUndefined();
    for (const rotation of [failed.spine, failed.chest, failed.neck, working.spine, working.chest]) {
      for (const value of rotation ?? []) {
        expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(value)).toBeLessThan(Math.PI / 2);
      }
    }
  });

  it('normalizes hostile phase inputs without NaN', () => {
    for (const phase of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -3.25, 12.75]) {
      for (const state of ['failed', 'running'] as const) {
        const pose = sampleMotion(state, phase);
        const values = [
          pose.rootY, pose.rootYaw, pose.headPitch, pose.headYaw, pose.headRoll,
          ...pose.leftArm, ...pose.rightArm, ...pose.leftForearm, ...pose.rightForearm,
          ...pose.spine ?? [], ...pose.chest ?? [], ...pose.neck ?? [],
          pose.leftLeg, pose.rightLeg, pose.blink, pose.happy, pose.sad,
        ];
        expect(values.every(Number.isFinite)).toBe(true);
      }
    }
  });
});

describe('settled atlas export loop', () => {
  it('rejects an already cancelled export before allocating a stage', async () => {
    const canvases = installFakeDocument();
    const { exportAtlas } = await loadExporter();
    const controller = new AbortController();
    controller.abort();
    await expect(exportAtlas(new ArrayBuffer(8), 'v1', () => {}, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(canvases).toHaveLength(0);
    expect(stageHarness.instances).toHaveLength(0);
  });

  it('rejects cancellation after the last frame before encoding a partial result', async () => {
    const canvases = installFakeDocument();
    const { exportAtlas } = await loadExporter();
    const controller = new AbortController();
    await expect(exportAtlas(new ArrayBuffer(8), 'v1', (done, total) => {
      if (done === total) controller.abort();
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(canvases[0].toBlobCalls).toBe(0);
    expect(stageHarness.instances[0].calls.dispose).toBe(1);
  });

  it('rejects cancellation during PNG encoding and releases the stage', async () => {
    const controller = new AbortController();
    const canvases = installFakeDocument(() => controller.abort());
    const { exportAtlas } = await loadExporter();
    await expect(exportAtlas(new ArrayBuffer(8), 'v2', () => {}, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(canvases[0].toBlobCalls).toBe(1);
    expect(stageHarness.instances[0].calls.dispose).toBe(1);
  });

  it('renders each cell once after fixed physics warm-up and disposes the stage', async () => {
    const canvases = installFakeDocument();
    const { exportAtlas } = await loadExporter();
    const progress = vi.fn();
    const source = new ArrayBuffer(8);
    const result = await exportAtlas(source, 'v1', progress);
    const stage = stageHarness.instances[0];
    expect(stage).toBeDefined();
    expect(stageHarness.instances).toHaveLength(1);
    expect(stage.calls.load).toEqual([[source]]);
    expect(stage.calls.resize).toEqual([[192, 208, 1]]);
    expect(stage.calls.render).toHaveLength(0);
    expect(stage.calls.renderSettled).toHaveLength(57);
    expect(stage.calls.renderSettled[0]).toEqual(['idle', 0, undefined, 30]);
    expect(stage.calls.renderSettled.slice(26, 31)).toEqual([
      ['jumping', 0, undefined, 30],
      ['jumping', 0.25, undefined, 30],
      ['jumping', 0.5, undefined, 30],
      ['jumping', 0.75, undefined, 30],
      ['jumping', 1, undefined, 30],
    ]);
    expect(stage.calls.dispose).toBe(1);
    expect(progress).toHaveBeenCalledTimes(57);
    expect(progress).toHaveBeenNthCalledWith(1, 1, 57);
    expect(progress).toHaveBeenNthCalledWith(57, 57, 57);
    expect(canvases).toHaveLength(2);
    expect(canvases[0].drawnFrames).toBe(57);
    expect(canvases[0].width).toBe(1536);
    expect(canvases[0].height).toBe(1872);
    expect(result.frames).toBe(57);
    expect(result.profile).toBe('v1');
  });

  it('adds settled gaze frames only to v2 using screen-angle samples', async () => {
    installFakeDocument();
    const { exportAtlas } = await loadExporter();
    const result = await exportAtlas(new ArrayBuffer(8), 'v2', () => {});
    const stage = stageHarness.instances[0];
    expect(stage.calls.renderSettled).toHaveLength(73);
    expect(stage.calls.dispose).toBe(1);
    const gazeCalls = stage.calls.renderSettled.slice(57);
    expect(gazeCalls).toHaveLength(16);
    gazeCalls.forEach((call, index) => {
      expect(call).toEqual(['idle', 0, sampleLook(index * 22.5), 30]);
    });
    expect(result.frames).toBe(73);
    expect(result.width).toBe(1536);
    expect(result.height).toBe(2288);
  });

  it('aborts between cells, keeps completed cells out, and disposes the stage', async () => {
    installFakeDocument();
    const { exportAtlas } = await loadExporter();
    const controller = new AbortController();
    const progress = vi.fn((done: number) => {
      if (done === 3) {
        controller.abort();
      }
    });
    await expect(
      exportAtlas(new ArrayBuffer(8), 'v2', progress, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const stage = stageHarness.instances[0];
    expect(stage.calls.renderSettled).toHaveLength(3);
    expect(stage.calls.dispose).toBe(1);
    expect(progress).toHaveBeenCalledTimes(3);
  });

  it('disposes the stage when model loading fails', async () => {
    installFakeDocument();
    stageHarness.loadError = new Error('bad model');
    const { exportAtlas } = await loadExporter();
    await expect(exportAtlas(new ArrayBuffer(8), 'v1', () => {})).rejects.toThrow('bad model');
    expect(stageHarness.instances[0].calls.dispose).toBe(1);
  });

  it('disposes the stage when rendering throws and never encodes a partial atlas', async () => {
    const canvases = installFakeDocument();
    stageHarness.renderError = new Error('render failed');
    const { exportAtlas } = await loadExporter();
    await expect(exportAtlas(new ArrayBuffer(8), 'v1', () => {})).rejects.toThrow('render failed');
    expect(stageHarness.instances[0].calls.dispose).toBe(1);
    expect(canvases[0].toBlobCalls).toBe(0);
  });
});
