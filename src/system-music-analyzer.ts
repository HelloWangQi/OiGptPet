import type { MusicDanceSignal } from '../packages/character-core/music-dance';

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 100;
}

/** Captures the Windows output mix in memory for local beat analysis only. */
export class SystemMusicAnalyzer {
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private bins?: Uint8Array<ArrayBuffer>;
  private previousEnergy = 0;
  private baseline = 0;
  private lastBeatAt = 0;
  private beatTimes: number[] = [];
  private bpm = 100;

  get active() { return Boolean(this.stream && this.analyser); }

  async start() {
    if (this.active) return;
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('当前桌面环境不支持系统播放音频采集。');

    // This call must happen directly from the user's button gesture.
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    // Electron requires a video source for getDisplayMedia. Close that track immediately;
    // only the system loopback audio track is connected to Web Audio.
    stream.getVideoTracks().forEach(item => item.stop());
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach(item => item.stop());
      throw new Error('没有取得系统播放音频。请确认当前 Windows 音频设备可用。');
    }

    let context: AudioContext | undefined;
    try {
      context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);

      this.stream = stream;
      this.context = context;
      this.source = source;
      this.analyser = analyser;
      this.bins = new Uint8Array(analyser.frequencyBinCount);
      this.previousEnergy = 0;
      this.baseline = 0;
      this.lastBeatAt = 0;
      this.beatTimes = [];
      this.bpm = 100;
      track.addEventListener('ended', this.handleTrackEnded, { once: true });
    } catch (error) {
      stream.getTracks().forEach(item => item.stop());
      await context?.close().catch(() => {});
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
    this.baseline += (energy - this.baseline) * 0.02;
    this.previousEnergy = energy;

    if (energy > 0.035 && onset > Math.max(0.012, this.baseline * 0.2) && now - this.lastBeatAt >= 240) {
      if (this.lastBeatAt > 0) {
        const interval = now - this.lastBeatAt;
        if (interval >= 300 && interval <= 1500) {
          this.beatTimes.push(interval);
          if (this.beatTimes.length > 7) this.beatTimes.shift();
          this.bpm = clamp(60_000 / median(this.beatTimes), 40, 200);
        }
      }
      this.lastBeatAt = now;
    }

    if (energy < 0.022) return undefined;
    return {
      level: clamp((energy - 0.018) * 8, 0, 1),
      beat: this.lastBeatAt ? clamp(1 - (now - this.lastBeatAt) / 180, 0, 1) : 0,
      bpm: this.bpm,
    };
  }

  stop() {
    const stream = this.stream;
    if (!stream) return;
    this.stream = undefined;
    this.analyser = undefined;
    this.bins = undefined;
    this.source?.disconnect(); this.source = undefined;
    stream.getTracks().forEach(track => track.stop());
    const context = this.context; this.context = undefined;
    void context?.close().catch(() => {});
  }

  private averageBins(bins: Uint8Array<ArrayBuffer>, start: number, end: number) {
    const boundedEnd = Math.min(end, bins.length);
    let total = 0;
    for (let index = start; index < boundedEnd; index += 1) total += bins[index] ?? 0;
    return boundedEnd > start ? total / (boundedEnd - start) / 255 : 0;
  }

  private handleTrackEnded = () => this.stop();
}
