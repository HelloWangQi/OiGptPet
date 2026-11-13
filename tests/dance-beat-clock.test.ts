import { describe, expect, it } from 'vitest';
import { DanceBeatClock } from '../src/dance-beat-clock';

describe('dance beat clock', () => {
  it('advances across missing onsets and changes tempo without jumping back', () => {
    const clock = new DanceBeatClock();
    expect(clock.advance(1000, 120, true)).toBe(0);
    expect(clock.advance(2250, 120, true)).toBeCloseTo(2.5);
    expect(clock.advance(2250, 90, true)).toBeCloseTo(2.5);
    expect(clock.advance(3250, 90, true)).toBeCloseTo(4);
    expect(clock.advance(3000, 90, true)).toBeCloseTo(4);
    expect(clock.advance(3500, 90, true)).toBeCloseTo(4.375);
    clock.reset();
    expect(clock.advance(5000, 100, true)).toBe(0);
  });
});
