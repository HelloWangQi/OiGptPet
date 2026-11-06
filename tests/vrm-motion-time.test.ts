import { describe, expect, it } from 'vitest';
import { actionTimeToPoseTime, poseTimeToActionTime } from '../packages/renderer-vrm/motion-time';

describe('VRMA ping-pong timeline', () => {
  it('maps a requested pose time to the raw action time during the reverse leg', () => {
    const actionTime = poseTimeToActionTime(0.25, 1, 'pingpong', 1);
    expect(actionTime).toBeCloseTo(0.75);
    expect(actionTimeToPoseTime(actionTime, 1, 'pingpong', 1)).toBeCloseTo(0.25);
  });

  it('keeps forward, repeat, once and initial ping-pong time unchanged', () => {
    expect(poseTimeToActionTime(0.25, 1, 'pingpong', 0)).toBeCloseTo(0.25);
    expect(poseTimeToActionTime(0.25, 1, 'repeat', 1)).toBeCloseTo(0.25);
    expect(poseTimeToActionTime(0.25, 1, 'once', 0)).toBeCloseTo(0.25);
  });

  it('preserves the visible pose when switching loop modes', () => {
    const poseTime = actionTimeToPoseTime(0.75, 1, 'pingpong', 1);
    expect(poseTimeToActionTime(poseTime, 1, 'repeat', 1)).toBeCloseTo(0.25);
  });

  it('clamps seek requests to the clip boundaries', () => {
    expect(poseTimeToActionTime(-2, 1, 'pingpong', 1)).toBeCloseTo(1);
    expect(poseTimeToActionTime(3, 1, 'pingpong', 1)).toBeCloseTo(0);
  });
});
