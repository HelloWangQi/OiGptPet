export interface MusicDanceSignal {
  /** Normalized music energy, from silence (0) to full motion (1). */
  level: number;
  /** A short beat pulse, from 0 to 1. */
  beat: number;
  /** Rolling tempo estimate, bounded to a useful dance range. */
  bpm: number;
}
