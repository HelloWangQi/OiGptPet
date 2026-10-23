import { describe, expect, it } from 'vitest';
import { FramePacer } from '../src/frame-pacer';
import { PERFORMANCE_POLICIES } from '../src/desktop-preferences';

describe('rendering cadence', () => {
  it.each([5, 12, 15, 30, 60])('limits a 240 Hz host loop to %i draws per second', (fps) => {
    const pacer = new FramePacer();
    let draws = 0;
    let animationSeconds = 0;
    for (let frame = 0; frame <= 240; frame++) {
      const delta = pacer.tick(frame * 1000 / 240, fps);
      if (delta !== null) { draws++; animationSeconds += delta; }
    }
    expect(draws).toBe(fps + 1); // Includes the initial frame at t=0.
    expect(animationSeconds).toBeCloseTo(1, 5);
  });

  it('suspends hidden drawing and resumes without a large animation jump', () => {
    const pacer = new FramePacer();
    expect(pacer.tick(0, 30)).toBe(0);
    expect(pacer.tick(20, 30)).toBeNull();
    expect(pacer.tick(34, 30)).toBeCloseTo(0.034);
    expect(pacer.tick(50_000, 30, true)).toBeNull();
    expect(pacer.tick(100_000, 30)).toBe(0);
    expect(pacer.tick(100_040, 30)).toBeCloseTo(0.04);
  });

  it('does not issue catch-up bursts after a slow frame or time reversal', () => {
    const pacer = new FramePacer();
    pacer.tick(0, 30);
    expect(pacer.tick(350, 30)).toBe(0.25);
    expect(pacer.tick(351, 30)).toBeNull();
    expect(pacer.tick(1, 30)).toBe(0);
    expect(pacer.tick(2, 30)).toBeNull();
  });

  it('can switch from idle cadence to active cadence immediately', () => {
    const pacer = new FramePacer();
    pacer.tick(0, PERFORMANCE_POLICIES.battery.idleFps);
    expect(pacer.tick(20, PERFORMANCE_POLICIES.battery.idleFps)).toBeNull();
    expect(pacer.tick(20, PERFORMANCE_POLICIES.battery.activeFps)).toBe(0);
    expect(pacer.tick(90, PERFORMANCE_POLICIES.battery.activeFps)).toBeCloseTo(0.07);
  });

  it('safely suspends invalid clocks/rates and caps an excessive rate at 60 fps', () => {
    const pacer = new FramePacer();
    for (const rate of [0, -1, NaN, Infinity]) expect(pacer.tick(0, rate)).toBeNull();
    expect(pacer.tick(NaN, 30)).toBeNull();
    expect(pacer.tick(0, 1000)).toBe(0);
    expect(pacer.tick(2, 1000)).toBeNull();
    expect(pacer.tick(17, 1000)).toBeCloseTo(0.017);
  });
});
