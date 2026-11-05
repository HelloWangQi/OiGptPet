import { blinkChannels, type BlinkChannel } from './blink';
// Only the bones and expressions used by this application's procedural motions.
// Presence is not a VRM conformance test or a judgement of animation quality.
export const MOTION_BONES = ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftUpperLeg', 'rightUpperLeg', 'spine', 'chest', 'neck', 'head'] as const;
export const MOTION_EXPRESSIONS = ['blink', 'happy', 'sad'] as const;
export type MotionBone = typeof MOTION_BONES[number];
export type MotionExpression = typeof MOTION_EXPRESSIONS[number];

export interface MotionCapabilities {
  schemaVersion: 1;
  source: 'loaded-vrm';
  bones: { present: MotionBone[]; missing: MotionBone[] };
  expressions: { present: MotionExpression[]; missing: MotionExpression[] };
  speechMouth: boolean;
  lookAtController: boolean;
  blinkMode?: 'combined' | 'paired' | 'none';
  visualReview: 'not-reviewed';
}

export function inspectMotionCapabilities(probe: {
  hasBone(name: MotionBone): boolean;
  hasExpression(name: MotionExpression | BlinkChannel | 'aa'): boolean;
  lookAtController: boolean;
}): MotionCapabilities {
  const bones = MOTION_BONES.filter(name => probe.hasBone(name));
  const expressions = MOTION_EXPRESSIONS.filter(name => probe.hasExpression(name));
  const blink = blinkChannels(name => probe.hasExpression(name));
  return {
    schemaVersion: 1, source: 'loaded-vrm',
    bones: { present: bones, missing: MOTION_BONES.filter(name => !bones.includes(name)) },
    expressions: { present: expressions, missing: MOTION_EXPRESSIONS.filter(name => !expressions.includes(name)) },
    speechMouth: probe.hasExpression('aa'),
    lookAtController: probe.lookAtController, blinkMode: blink.length === 1 ? 'combined' : blink.length === 2 ? 'paired' : 'none', visualReview: 'not-reviewed',
  };
}
