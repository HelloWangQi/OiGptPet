export interface RenderContext {
  kind: 'empty' | 'vrm' | 'sprite';
  mode: 'quality' | 'balanced' | 'battery';
  activity: 'active' | 'idle' | 'hidden';
  targetFps: number;
  paused: boolean;
}
export interface RenderSample extends RenderContext {
  windowMs: number;
  frames: number;
  fps: number | null;
  durationSamples: number;
  meanRenderMs: number | null;
  p95RenderMs: number | null;
}

/** Counts completed stage.render calls, not RAF callbacks or GPU presentations. */
export class RenderMonitor {
  private context?: RenderContext;
  private since = 0;
  private frames = 0;
  private durations: number[] = [];
  private cursor = 0;

  reset(now: number) { this.since = now; this.frames = 0; this.durations = []; this.cursor = 0; }

  setContext(value: RenderContext, now: number) {
    if (!this.context || now < this.since || Object.keys(value).some(key => value[key as keyof RenderContext] !== this.context![key as keyof RenderContext])) {
      this.reset(now); this.context = { ...value };
    }
  }

  record(durationMs: number) {
    if (!this.context || this.context.kind === 'empty' || this.context.activity === 'hidden' || !Number.isFinite(durationMs) || durationMs < 0) return;
    this.frames++;
    // Bounded even if an interval is suspended for a long time.
    this.durations[this.cursor] = durationMs; this.cursor = (this.cursor + 1) % 256;
  }

  sample(now: number): RenderSample | null {
    if (!this.context) return null;
    if (now < this.since) this.reset(now);
    const windowMs = now - this.since;
    const sorted = [...this.durations].sort((a, b) => a - b);
    const result = { ...this.context, windowMs, frames: this.frames,
      fps: windowMs >= 500 && this.context.kind !== 'empty' && this.context.activity !== 'hidden' ? this.frames * 1000 / windowMs : null,
      durationSamples: sorted.length,
      meanRenderMs: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null,
      p95RenderMs: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    };
    this.reset(now); return result;
  }
}

export function renderSampleText(sample: RenderSample) {
  if (sample.kind === 'empty') return '本窗口：导入角色后开始采样。';
  if (sample.activity === 'hidden') return '本窗口：已隐藏，暂停绘制。';
  const rate = sample.fps === null ? '采样中' : `${sample.fps.toFixed(1)} 帧/秒`;
  const cost = sample.meanRenderMs === null ? '' : `，平均绘制 ${sample.meanRenderMs.toFixed(1)} 毫秒`;
  return `本窗口：${rate}，上限 ${sample.targetFps} 帧（${sample.activity === 'idle' ? '闲置' : '互动'}${sample.paused ? '，动作暂停' : ''}）${cost}。`;
}
