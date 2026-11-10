export interface MusicDanceSignal {
  /** Normalized music energy, from silence (0) to full motion (1). */
  level: number;
  /** A short beat pulse, from 0 to 1. */
  beat: number;
  /** Estimated progress through the current beat, from 0 to 1; omitted by older producers. */
  phase?: number;
  /** Count of detected beats since capture began, for multi-beat animation phrases. */
  beatIndex?: number;
  /** False while there are too few intervals for a stable tempo estimate. */
  tempoReady?: boolean;
  /** False for the short fading tail retained after the last fresh audio energy. */
  fresh?: boolean;
  /** Rolling tempo estimate, bounded to a useful dance range. */
  bpm: number;
}

export const MUSIC_SILENCE_RESET_MS = 2500;

/** Hold motion through sparse beats while still pausing within two seconds of silence. */
export function musicSignalGraceMs(bpm: number): number {
  const tempo = Number.isFinite(bpm) && bpm > 0 ? bpm : 100;
  return Math.min(2000, Math.max(700, 60_000 / tempo * 1.6));
}

/** Pick a playback rate that makes a looping motion last an integer musical phrase. */
export function musicSynchronizedPlaybackRate(durationSeconds: number, bpm: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(bpm) || bpm <= 0) return 1;
  const beatsPerLoop = durationSeconds * bpm / 60;
  const phrases = [1, 2, 4, 8, 16, 32];
  const candidates = phrases.map(beats => beatsPerLoop / beats).filter(rate => rate >= 0.5 && rate <= 2);
  if (!candidates.length) return clampRate(beatsPerLoop / phrases.reduce((best, beats) =>
    Math.abs(Math.log2(beatsPerLoop / beats)) < Math.abs(Math.log2(beatsPerLoop / best)) ? beats : best, phrases[0]));
  return candidates.reduce((best, rate) => Math.abs(Math.log2(rate)) < Math.abs(Math.log2(best)) ? rate : best);
}

function clampRate(rate: number) { return Math.min(2, Math.max(0.5, rate)); }
