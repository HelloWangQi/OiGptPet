import { describe, expect, it } from 'vitest';
import { sampleMusicDancePose } from '../packages/character-core/music-choreography';

describe('authored dance normalized bone directions', () => {
  for (const style of ['idol-pop', 'catwalk', 'auto-mix'] as const) {
    it(`${style} keeps elbows bending inward throughout interpolation`, () => {
      for (let beat = 0; beat < 16; beat += 0.025) {
        const pose = sampleMusicDancePose(style, {
          level: 0.78, beat: 0, bpm: 124, beatIndex: Math.floor(beat), phase: beat % 1,
          bandFocus: 'mid',
        });
        expect(Object.values(pose).every(Number.isFinite)).toBe(true);
        expect(pose.leftElbow).toBeLessThanOrEqual(0);
        expect(pose.rightElbow).toBeGreaterThanOrEqual(0);
        expect(pose.leftArmAcross).toBeLessThanOrEqual(0);
        expect(pose.rightArmAcross).toBeGreaterThanOrEqual(0);
      }
    });
  }
  it('alternates an asymmetric gesture rather than holding both arms overhead', () => {
    const at = (beatIndex: number) => sampleMusicDancePose('idol-pop', { level: 0.8, beat: 0, bpm: 124, beatIndex, phase: 0 });
    expect(at(1).leftShoulder).toBeLessThan(at(1).rightShoulder * -1);
    expect(at(2).leftShoulder).toBeGreaterThan(at(2).rightShoulder * -1);
    expect(at(0).leftShoulder).toBeLessThan(-0.8);
  });
});
