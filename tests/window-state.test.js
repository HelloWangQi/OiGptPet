import { describe, it, expect } from 'vitest';
import geometry from '../electron/geometry.cjs';

const defaults = { width: 320, height: 420 };
describe('desktop bounds recovery', () => {
  it('recovers a removed monitor without losing the pet', () => {
    const result = geometry.fitBounds({ x: -9000, y: 10000 }, { x: 0, y: 0, width: 1920, height: 1040 }, defaults);
    expect(result).toEqual({ x: 0, y: 620, ...defaults });
  });
  it('supports negative display coordinates and rejects nonfinite saved values', () => {
    const area = { x: -1920, y: -100, width: 1920, height: 1080 };
    const result = geometry.fitBounds({ x: NaN, y: Infinity, width: -50, height: 100000 }, area, defaults);
    expect(result.x).toBeGreaterThanOrEqual(area.x);
    expect(result.y).toBeGreaterThanOrEqual(area.y);
    expect(result.width).toBe(240);
    expect(result.height).toBe(1080);
    expect(result.x + result.width).toBeLessThanOrEqual(0);
  });
});
