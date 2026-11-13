import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SystemMusicAnalyzer } from '../src/system-music-analyzer';

const FRAME_MS = 20;
type Signal = ReturnType<SystemMusicAnalyzer['sample']>;

class FakeTrack extends EventTarget {
  stopped = false;
  constructor(readonly kind: 'audio' | 'video') { super(); }
  stop() { this.stopped = true; }
}

class FakeStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  getTracks() { return [...this.tracks]; }
}

class FakeAnalyser {
  readonly fftSize = 2048;
  readonly frequencyBinCount = 1024;
  /** Loudness from 0 to 1, applied to every bin so each band reads the same level. */
  level = 0;
  getByteFrequencyData(bins: Uint8Array) { bins.fill(Math.round(this.level * 255)); }
}

class FakeSource {
  connect() {}
  disconnect() {}
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static resumeGate: Promise<void> = Promise.resolve();
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  readonly sampleRate = 48_000;
  readonly analyser = new FakeAnalyser();
  closed = 0;
  constructor() { FakeAudioContext.instances.push(this); }
  async resume() {
    await FakeAudioContext.resumeGate;
    if (this.state !== 'closed') this.state = 'running';
  }
  createMediaStreamSource() { return new FakeSource(); }
  createAnalyser() { return this.analyser; }
  close() { this.closed += 1; this.state = 'closed'; return Promise.resolve(); }
}

let getDisplayMedia: Mock<() => Promise<MediaStream>>;
let audioTracks: FakeTrack[];
let videoTracks: FakeTrack[];
let analyzer: SystemMusicAnalyzer;

function captureStream() {
  const video = new FakeTrack('video');
  const audio = new FakeTrack('audio');
  videoTracks.push(video);
  audioTracks.push(audio);
  return new FakeStream([video, audio]) as unknown as MediaStream;
}

function latestContext() {
  return FakeAudioContext.instances[FakeAudioContext.instances.length - 1]!;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function flushMicrotasks() {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

/** Feeds sample() on a 20 ms grid; levelAt picks the simulated loudness for each frame. */
function run(from: number, durationMs: number, levelAt: (time: number) => number) {
  const signals: Signal[] = [];
  let time = from;
  for (; time < from + durationMs; time += FRAME_MS) {
    latestContext().analyser.level = levelAt(time);
    signals.push(analyzer.sample(time));
  }
  return { signals, end: time };
}

/** A sharp 20 ms attack on every beat over a steady background. */
function beats(bpm: number, startAt: number, background = 0.08) {
  const interval = 60_000 / bpm;
  return (time: number) => {
    const phase = (time - startAt) % interval;
    return phase >= 0 && phase < FRAME_MS ? 0.8 : background;
  };
}

async function startCapture() {
  await analyzer.start();
  expect(analyzer.active).toBe(true);
}

beforeEach(() => {
  audioTracks = [];
  videoTracks = [];
  FakeAudioContext.instances = [];
  FakeAudioContext.resumeGate = Promise.resolve();
  getDisplayMedia = vi.fn(async () => captureStream());
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });
  vi.stubGlobal('AudioContext', FakeAudioContext);
  analyzer = new SystemMusicAnalyzer();
});

afterEach(() => {
  analyzer.stop();
  vi.unstubAllGlobals();
});

describe('system music analyzer', () => {
  it('reports nothing while the output is silent', async () => {
    await startCapture();
    const { signals } = run(1000, 3000, () => 0);
    expect(signals.every(signal => signal === undefined)).toBe(true);
  });

  it('shows a pending tempo while sound is present before any stable interval', async () => {
    await startCapture();
    const { signals } = run(1000, 1000, () => 0.08);
    expect(signals.every(signal => signal !== undefined)).toBe(true);
    expect(signals.at(-1)?.tempoReady).toBe(false);
  });

  it('estimates a steady tempo from beat intervals', async () => {
    await startCapture();
    const { signals } = run(1000, 4000, beats(120, 1000));
    expect(signals.at(-1)?.tempoReady).toBe(true);
    expect(signals.at(-1)?.bpm).toBeCloseTo(120, 0);
  });

  it('follows a tempo change without moving the dance clock backwards', async () => {
    await startCapture();
    const first = run(1000, 4000, beats(120, 1000));
    const second = run(first.end, 4000, beats(150, first.end));
    const indices = [...first.signals, ...second.signals].map(signal => signal?.beatIndex ?? -1);
    expect(indices.every((index, position) => position === 0 || index >= indices[position - 1]!)).toBe(true);
    expect(second.signals.at(-1)?.bpm).toBeCloseTo(150, 0);
  });

  it('restarts tempo estimation after a long silence', async () => {
    await startCapture();
    const steady = run(1000, 4000, beats(120, 1000));
    const silent = run(steady.end, 3000, () => 0);
    expect(silent.signals.at(-1)).toBeUndefined();
    const resumed = run(silent.end, 1000, beats(120, silent.end));
    expect(resumed.signals[0]?.tempoReady).toBe(false);
    expect(resumed.signals.at(-1)?.tempoReady).toBe(false);
    const confirmed = run(resumed.end, 1000, beats(120, silent.end));
    expect(confirmed.signals.at(-1)?.tempoReady).toBe(true);
  });

  it('stops reporting and releases every resource when stopped', async () => {
    await startCapture();
    const context = latestContext();
    analyzer.stop();
    expect(analyzer.active).toBe(false);
    expect(audioTracks[0]!.stopped).toBe(true);
    expect(videoTracks[0]!.stopped).toBe(true);
    expect(context.closed).toBe(1);
    expect(analyzer.sample(2000)).toBeUndefined();
  });

  it('releases the capture when the system audio track ends after a device change', async () => {
    await startCapture();
    audioTracks[0]!.dispatchEvent(new Event('ended'));
    expect(analyzer.active).toBe(false);
    expect(audioTracks[0]!.stopped).toBe(true);
    expect(latestContext().closed).toBe(1);
  });

  it('releases a stale capture before reconnecting after the audio context is suspended', async () => {
    await startCapture();
    const stale = latestContext();
    stale.state = 'suspended';
    expect(analyzer.active).toBe(false);
    await analyzer.start();
    expect(audioTracks[0]!.stopped).toBe(true);
    expect(stale.closed).toBe(1);
    expect(analyzer.active).toBe(true);
    expect(getDisplayMedia).toHaveBeenCalledTimes(2);
  });

  it('ignores a display grant that arrives after the user cancelled', async () => {
    const grant = deferred<MediaStream>();
    getDisplayMedia.mockImplementationOnce(() => grant.promise);
    const pending = analyzer.start();
    analyzer.stop();
    grant.resolve(captureStream());
    await expect(pending).resolves.toBeUndefined();
    expect(analyzer.active).toBe(false);
    expect(audioTracks[0]!.stopped).toBe(true);
    expect(videoTracks[0]!.stopped).toBe(true);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('keeps the newer capture when an older permission grant arrives later', async () => {
    const olderGrant = deferred<MediaStream>();
    getDisplayMedia.mockImplementationOnce(() => olderGrant.promise);
    const older = analyzer.start();
    await analyzer.start();
    expect(analyzer.active).toBe(true);
    const newerTrack = audioTracks[0]!;
    olderGrant.resolve(captureStream());
    await older;
    expect(analyzer.active).toBe(true);
    expect(newerTrack.stopped).toBe(false);
    expect(audioTracks[1]!.stopped).toBe(true);
    expect(videoTracks[1]!.stopped).toBe(true);
  });

  it('closes a capture whose audio context finishes resuming after cancellation', async () => {
    const gate = deferred<void>();
    FakeAudioContext.resumeGate = gate.promise;
    const pending = analyzer.start();
    await flushMicrotasks();
    expect(FakeAudioContext.instances).toHaveLength(1);
    analyzer.stop();
    gate.resolve();
    await expect(pending).resolves.toBeUndefined();
    expect(analyzer.active).toBe(false);
    expect(audioTracks[0]!.stopped).toBe(true);
    expect(latestContext().closed).toBeGreaterThanOrEqual(1);
  });

  it('explains when the grant contains no system audio track', async () => {
    getDisplayMedia.mockImplementationOnce(async () => {
      const video = new FakeTrack('video');
      videoTracks.push(video);
      return new FakeStream([video]) as unknown as MediaStream;
    });
    await expect(analyzer.start()).rejects.toThrow('没有取得系统播放音频');
    expect(videoTracks[0]!.stopped).toBe(true);
    expect(analyzer.active).toBe(false);
  });
});
