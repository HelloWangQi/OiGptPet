import { describe, expect, it } from 'vitest';
import { sampleMusicDancePose } from '../packages/character-core/music-choreography';

describe('authored dance normalized bone directions', () => {
  for (const style of ['idol-pop', 'catwalk', 'douyin-mix', 'auto-mix'] as const) {
    it(`${style} visibly transfers weight through hips and alternating knees`, () => {
      const poses = Array.from({ length: 640 }, (_, index) => {
        const beat = index / 40;
        return sampleMusicDancePose(style, { level: 0.8, beat: 0, bpm: 120, beatIndex: Math.floor(beat), phase: beat % 1 });
      });
      const yaw = poses.map(p => p.hipYaw);
      expect(Math.max(...yaw) - Math.min(...yaw)).toBeGreaterThan(0.55);
      expect(poses.some(p => p.bodySway < -0.03 && p.leftLegSide > 0.27)).toBe(true);
      expect(poses.some(p => p.bodySway > 0.03 && p.rightLegSide < -0.27)).toBe(true);
      expect(Math.max(...poses.map(p => p.leftKnee))).toBeGreaterThan(0.6);
      expect(Math.max(...poses.map(p => p.leftKnee - p.rightKnee))).toBeGreaterThan(0.25);
      expect(Math.min(...poses.map(p => p.leftKnee - p.rightKnee))).toBeLessThan(-0.25);
      expect(poses.every(p => p.leftKnee >= 0 && p.rightKnee >= 0)).toBe(true);
    });
  }
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
