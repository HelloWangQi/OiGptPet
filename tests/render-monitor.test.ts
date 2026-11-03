import { describe, expect, it } from 'vitest';
import { RenderMonitor, renderSampleText, type RenderContext } from '../src/render-monitor';
const context: RenderContext = { kind: 'sprite', mode: 'balanced', activity: 'active', targetFps: 30, paused: false };

describe('completed render call sampling', () => {
  it('counts actual draws over wall time and calculates bounded CPU-call durations', () => {
    const monitor = new RenderMonitor(); monitor.setContext(context, 0);
    for (let i = 1; i <= 30; i++) monitor.record(i);
    expect(monitor.sample(2000)).toMatchObject({ frames: 30, fps: 15, windowMs: 2000, durationSamples: 30, meanRenderMs: 15.5, p95RenderMs: 29 });
    expect(monitor.sample(4000)).toMatchObject({ frames: 0, fps: 0, meanRenderMs: null });
  });
  it('does not mix modes, idle state, source changes or paused animation', () => {
    const monitor = new RenderMonitor(); monitor.setContext(context, 0); monitor.record(20);
    monitor.setContext({ ...context, kind: 'vrm', mode: 'battery', activity: 'idle', targetFps: 5, paused: true }, 1000);
    monitor.record(2);
    expect(monitor.sample(2000)).toMatchObject({ kind: 'vrm', activity: 'idle', frames: 1, fps: 1, meanRenderMs: 2, paused: true, windowMs: 1000 });
  });
  it('clears samples when hidden and resumes with a fresh interval', () => {
    const monitor = new RenderMonitor(); monitor.setContext(context, 0); monitor.record(5);
    monitor.setContext({ ...context, activity: 'hidden', targetFps: 0 }, 1000); monitor.record(10);
    expect(monitor.sample(9000)).toMatchObject({ activity: 'hidden', fps: null, frames: 0, durationSamples: 0 });
    monitor.setContext(context, 10000); monitor.record(1);
    expect(monitor.sample(10100)).toMatchObject({ windowMs: 100, frames: 1, fps: null });
    expect(monitor.sample(12100)).toMatchObject({ windowMs: 2000, frames: 0, fps: 0 });
  });
  it('does not count an empty stage and bounds duration storage after delayed timers', () => {
    const monitor = new RenderMonitor(); monitor.setContext({ ...context, kind: 'empty' }, 0); monitor.record(1);
    expect(monitor.sample(1000)).toMatchObject({ fps: null, frames: 0 });
    monitor.setContext(context, 1000);
    for (let i = 0; i < 1000; i++) monitor.record(i < 744 ? 100 : 1);
    for (const invalid of [-1, NaN, Infinity]) monitor.record(invalid);
    expect(monitor.sample(11000)).toMatchObject({ frames: 1000, fps: 100, durationSamples: 256, meanRenderMs: 1, p95RenderMs: 1 });
    expect(monitor.sample(10)).toMatchObject({ windowMs: 0, fps: null, frames: 0 });
  });
  it('labels the local window and keeps target and measured cadence distinct', () => {
    const monitor = new RenderMonitor(); monitor.setContext(context, 0); monitor.record(1);
    expect(renderSampleText(monitor.sample(1000)!)).toContain('本窗口：1.0 帧/秒，上限 30');
  });
});
