/** Rendering cadence only. The host owns RAF, visibility and animation state. */
export class FramePacer {
  private lastDraw?: number;
  private nextDraw?: number;
  private fps?: number;

  reset() { this.lastDraw = undefined; this.nextDraw = undefined; this.fps = undefined; }

  tick(now: number, fps: number, hidden = false): number | null {
    if (hidden || !Number.isFinite(now) || !Number.isFinite(fps) || fps <= 0) {
      this.reset();
      return null;
    }
    const interval = 1000 / Math.min(fps, 60);
    if (this.lastDraw === undefined || now < this.lastDraw || fps !== this.fps) {
      this.lastDraw = now;
      this.nextDraw = now + interval;
      this.fps = fps;
      return 0;
    }
    if (now + 0.1 < this.nextDraw!) return null;
    const delta = Math.min((now - this.lastDraw) / 1000, 0.25);
    this.lastDraw = now;
    const due = this.nextDraw!;
    this.nextDraw = due + (Math.floor(Math.max(0, now - due) / interval) + 1) * interval;
    return delta;
  }
}
