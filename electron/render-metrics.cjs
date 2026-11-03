const { performance } = require('node:perf_hooks');

function normalizeRenderSample(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid render sample');
  const number = (name, max, nullable = false) => {
    const result = value[name];
    if (nullable && result === null) return null;
    if (typeof result !== 'number' || !Number.isFinite(result) || result < 0 || result > max) throw new Error('Invalid render sample');
    return result;
  };
  if (!['empty', 'vrm', 'sprite'].includes(value.kind) || !['quality', 'balanced', 'battery'].includes(value.mode)
    || !['active', 'idle', 'hidden'].includes(value.activity) || typeof value.paused !== 'boolean') throw new Error('Invalid render sample');
  const result = { kind: value.kind, mode: value.mode, activity: value.activity, paused: value.paused,
    targetFps: number('targetFps', 60), windowMs: number('windowMs', 86400000), frames: number('frames', 6000000),
    fps: number('fps', 1000, true), durationSamples: number('durationSamples', 256),
    meanRenderMs: number('meanRenderMs', 3600000, true), p95RenderMs: number('p95RenderMs', 3600000, true) };
  if (!Number.isInteger(result.frames) || !Number.isInteger(result.durationSamples)
    || result.durationSamples > result.frames || (result.durationSamples === 0) !== (result.meanRenderMs === null)
    || (result.durationSamples === 0) !== (result.p95RenderMs === null)
    || ((result.activity === 'hidden' || result.kind === 'empty') && (result.frames !== 0 || result.fps !== null))
    || (result.fps !== null && result.windowMs < 500)) throw new Error('Invalid render sample');
  return result;
}

function createRenderMetricsStore({ now = () => performance.now(), staleMs = 10000 } = {}) {
  const samples = new Map();
  return {
    update(id, value) { samples.set(id, { receivedAt: now(), sample: normalizeRenderSample(value) }); },
    clear(id) { samples.delete(id); },
    read(id) {
      const entry = samples.get(id);
      if (!entry) return { status: 'not-sampled', sample: null };
      const ageMs = Math.max(0, now() - entry.receivedAt);
      if (ageMs > staleMs) return { status: 'stale', ageMs, sample: null };
      return { status: 'available', ageMs, sample: { ...entry.sample } };
    },
  };
}
module.exports = { normalizeRenderSample, createRenderMetricsStore };
