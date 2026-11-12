/** Continuous dance position in beats; onsets can be sparse or irregular. */
export class DanceBeatClock {
  private position = 0;
  private lastTime?: number;

  reset() { this.position = 0; this.lastTime = undefined; }

  advance(now: number, bpm: number, started: boolean): number {
    if (!started || !Number.isFinite(now)) return this.position;
    if (this.lastTime !== undefined && now > this.lastTime && Number.isFinite(bpm) && bpm > 0) {
      this.position += (now - this.lastTime) * bpm / 60_000;
    }
    if (this.lastTime === undefined || now > this.lastTime) this.lastTime = now;
    return this.position;
  }
}
