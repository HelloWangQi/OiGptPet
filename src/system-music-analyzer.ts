import { MUSIC_SILENCE_RESET_MS, musicSignalGraceMs, type MusicDanceSignal } from '../packages/character-core/music-dance';

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 100;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[middle] ?? 100;
  const lower = sorted[middle - 1] ?? 100;
  const upper = sorted[middle] ?? lower;
  return (lower + upper) / 2;
}

/** Captures the Windows output mix in memory for local beat analysis only. */
export class SystemMusicAnalyzer {
  private readonly pendingCaptures = new Set<{ stream: MediaStream; context?: AudioContext }>();
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private bins?: Uint8Array<ArrayBuffer>;
  private previousEnergy = 0;
  private smoothedEnergy = 0;
  private baseline = 0;
  private quietSince = 0;
  private lastBeatAt = 0;
  private lastBeatLevel = 0;
  private beatTimes: number[] = [];
  private bpm = 100;
  private sensitivity = 1;
  private captureRevision = 0;

  get active() { return Boolean(this.stream && this.analyser && this.context?.state === 'running'); }

  setSensitivity(value: number) {
    if (!Number.isFinite(value)) return;
    this.sensitivity = clamp(value, 0.6, 1.5);
  }

  async start() {
    if (this.active) return;
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('当前桌面环境不支持系统播放音频采集。');
    const revision = ++this.captureRevision;

    // This call must happen directly from the user's button gesture.
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    if (revision !== this.captureRevision) {
      this.stopTracks(stream);
      return;
    }
    // Electron requires a video source for getDisplayMedia. Close that track immediately;
    // only the system loopback audio track is connected to Web Audio.
    stream.getVideoTracks().forEach(item => this.stopTrack(item));
    const track = stream.getAudioTracks()[0];
    if (!track) {
      this.stopTracks(stream);
      throw new Error('没有取得系统播放音频。请确认当前 Windows 音频设备可用。');
    }

    const pending: { stream: MediaStream; context?: AudioContext } = { stream };
    this.pendingCaptures.add(pending);
    let context: AudioContext | undefined;
    try {
      context = new AudioContext();
      pending.context = context;
      await context.resume();
      if (revision !== this.captureRevision) {
        this.disposePending(pending);
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);

      const bins = new Uint8Array(analyser.frequencyBinCount);
      track.addEventListener('ended', this.handleTrackEnded, { once: true });
      this.stream = stream;
      this.context = context;
      this.source = source;
      this.analyser = analyser;
      this.bins = bins;
      this.previousEnergy = 0;
      this.smoothedEnergy = 0;
      this.baseline = 0;
      this.quietSince = 0;
      this.lastBeatAt = 0;
      this.lastBeatLevel = 0;
      this.beatTimes = [];
      this.bpm = 100;
      this.pendingCaptures.delete(pending);
    } catch (error) {
      this.disposePending(pending);
      throw error;
    }
  }

  sample(now: number): MusicDanceSignal | undefined {
    const analyser = this.analyser;
    const bins = this.bins;
    if (!analyser || !bins) return undefined;
    analyser.getByteFrequencyData(bins);

    // Focus on kick/bass and low-mid energy; the app never records or transmits these samples.
    const lowEnd = this.averageBins(bins, 2, 12);
    const lowMid = this.averageBins(bins, 13, 42);
    const energy = lowEnd * 0.72 + lowMid * 0.28;
    const onset = energy - this.previousEnergy;
    this.smoothedEnergy += (energy - this.smoothedEnergy) * (energy > this.smoothedEnergy ? 0.45 : 0.18);
    if (energy < 0.022 / this.sensitivity) this.quietSince ||= now;
    else this.quietSince = 0;
    this.baseline += (energy - this.baseline) * 0.02;
    this.previousEnergy = energy;

    if (this.quietSince && now - this.quietSince >= MUSIC_SILENCE_RESET_MS) {
      this.beatTimes = [];
      this.lastBeatAt = 0;
      this.lastBeatLevel = 0;
      this.bpm = 100;
    }

    if (energy > 0.035 / this.sensitivity && onset > Math.max(0.012 / this.sensitivity, this.baseline * 0.2) && now - this.lastBeatAt >= 240) {
      if (this.lastBeatAt > 0) {
        const interval = now - this.lastBeatAt;
        if (interval >= 300 && interval <= 1500) {
          this.beatTimes.push(interval);
          if (this.beatTimes.length > 7) this.beatTimes.shift();
          this.bpm = clamp(60_000 / median(this.beatTimes), 40, 200);
        }
      }
      this.lastBeatAt = now;
      this.lastBeatLevel = clamp((this.smoothedEnergy - 0.018 / this.sensitivity) * 8 * this.sensitivity, 0, 1);
    }

    const lowEnergy = this.smoothedEnergy < 0.02 / this.sensitivity
      || (this.quietSince && now - this.quietSince >= 300 && this.smoothedEnergy < 0.055 / this.sensitivity);
    if (lowEnergy) {
      const quietFor = this.quietSince ? now - this.quietSince : 0;
      const grace = musicSignalGraceMs(this.bpm);
      if (!this.lastBeatAt || now - this.lastBeatAt >= grace || quietFor >= grace) return undefined;
    }
    const beatDuration = 60_000 / this.bpm;
    const energyLevel = clamp((this.smoothedEnergy - 0.018 / this.sensitivity) * 8 * this.sensitivity, 0, 1);
    const quietFade = lowEnergy && this.quietSince
      ? clamp(1 - (now - this.quietSince) / musicSignalGraceMs(this.bpm), 0, 1)
      : 1;
    return {
      level: lowEnergy ? Math.max(energyLevel, this.lastBeatLevel * quietFade) : energyLevel,
      beat: this.lastBeatAt ? clamp(1 - (now - this.lastBeatAt) / 180, 0, 1) : 0,
      phase: this.lastBeatAt ? (Math.max(0, now - this.lastBeatAt) % beatDuration) / beatDuration : 0,
      tempoReady: this.beatTimes.length >= 2,
      fresh: !lowEnergy,
      bpm: this.bpm,
    };
  }

  stop() {
    // Also invalidate a permission prompt or AudioContext.resume() still in flight.
    this.captureRevision += 1;
    for (const pending of this.pendingCaptures) this.disposePending(pending);
    const stream = this.stream;
    this.stream = undefined;
    this.analyser = undefined;
    this.bins = undefined;
    const source = this.source; this.source = undefined;
    try { source?.disconnect(); } catch { /* The context may already have closed. */ }
    this.stopTracks(stream);
    const context = this.context; this.context = undefined;
    void context?.close().catch(() => {});
  }

  private disposePending(pending: { stream: MediaStream; context?: AudioContext }) {
    this.pendingCaptures.delete(pending);
    this.stopTracks(pending.stream);
    void pending.context?.close().catch(() => {});
  }

  private stopTracks(stream?: MediaStream) {
    stream?.getTracks().forEach(track => this.stopTrack(track));
  }

  private stopTrack(track: MediaStreamTrack) {
    try { track.stop(); } catch { /* Continue releasing the remaining tracks. */ }
  }

  private averageBins(bins: Uint8Array<ArrayBuffer>, start: number, end: number) {
    const boundedEnd = Math.min(end, bins.length);
    let total = 0;
    for (let index = start; index < boundedEnd; index += 1) total += bins[index] ?? 0;
    return boundedEnd > start ? total / (boundedEnd - start) / 255 : 0;
  }

  private handleTrackEnded = () => this.stop();
}
