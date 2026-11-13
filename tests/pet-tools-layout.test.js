import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { expandedToolsLayout } = createRequire(import.meta.url)('../electron/pet-tools-layout.cjs');

describe('pet tools beside the model', () => {
  for (const x of [20, 1580]) {
    it(`keeps model and tools separate at screen position ${x}`, () => {
      const base = { x, y: 200, width: 320, height: 420 };
      const { bounds, layout } = expandedToolsLayout(base, { x: 0, y: 0, width: 1920, height: 1080 });
      expect(bounds.x + layout.petLeft).toBe(base.x);
      expect(layout.petWidth).toBe(320);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(1920);
      expect(layout.toolsLeft + layout.toolsWidth <= layout.petLeft
        || layout.toolsLeft >= layout.petLeft + layout.petWidth).toBe(true);
    });
  }
});
