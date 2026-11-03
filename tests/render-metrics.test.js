import { describe, expect, it } from 'vitest';
import metrics from '../electron/render-metrics.cjs';
const sample = () => ({ kind: 'vrm', mode: 'balanced', activity: 'active', paused: false, targetFps: 30,
  windowMs: 2000, frames: 40, fps: 20, durationSamples: 40, meanRenderMs: 2, p95RenderMs: 4 });
describe('per-window render diagnostics', () => {
  it('copies only permitted fields and cannot overwrite another window by payload', () => {
    const store = metrics.createRenderMetricsStore({ now: () => 100 }); const input = { ...sample(), id: 2, apiKey: 'private-data' };
    store.update(1, input); input.frames = 999;
    expect(store.read(1)).toMatchObject({ status: 'available', ageMs: 0, sample: { frames: 40 } });
    expect(store.read(2)).toEqual({ status: 'not-sampled', sample: null });
    expect(JSON.stringify(store.read(1))).not.toContain('private');
    const copy = store.read(1); copy.sample.frames = 999; expect(store.read(1).sample.frames).toBe(40);
  });
  it('marks delayed samples stale and clears a window on reload or close', () => {
    let time = 100; const store = metrics.createRenderMetricsStore({ now: () => time });
    store.update(1, sample()); time += 10001;
    expect(store.read(1)).toEqual({ status: 'stale', ageMs: 10001, sample: null });
    store.update(2, sample()); store.clear(1); expect(store.read(1).status).toBe('not-sampled');
    expect(store.read(2).status).toBe('available');
  });
  it.each([{ fps: NaN }, { kind: 'secret' }, { frames: 1.5 }, { durationSamples: 257 }, { durationSamples: 41 },
    { meanRenderMs: null }, { activity: 'hidden' }, { windowMs: 100 }, { targetFps: 61 }, { p95RenderMs: Infinity }])('rejects invalid or inconsistent samples %o', patch => {
    expect(() => metrics.normalizeRenderSample({ ...sample(), ...patch })).toThrow('Invalid render sample');
  });
  it('accepts a short, empty, or hidden sample without inventing a measured FPS', () => {
    expect(metrics.normalizeRenderSample({ ...sample(), activity: 'hidden', targetFps: 0, frames: 0, fps: null, durationSamples: 0, meanRenderMs: null, p95RenderMs: null }).fps).toBeNull();
  });
});
