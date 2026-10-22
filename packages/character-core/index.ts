import type { AnimationState } from '../target-chatgpt/contract';

export interface MotionPose {
  rootY: number;
  rootYaw: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  leftArm: [number, number, number];
  rightArm: [number, number, number];
  leftForearm: [number, number, number];
  rightForearm: [number, number, number];
  leftLeg: number;
  rightLeg: number;
  blink: number;
  happy: number;
  sad: number;
}

/** A deterministic timeline used by both live rendering and atlas sampling. */
export function sampleMotion(state: AnimationState, phase: number): MotionPose {
  const p = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  const wave = Math.sin(p * Math.PI * 2);
  const pose: MotionPose = {
    rootY: 0, rootYaw: 0, headPitch: 0, headYaw: 0, headRoll: 0.025 * wave,
    leftArm: [0, 0, -1.2], rightArm: [0, 0, 1.2],
    leftForearm: [0, 0, 0], rightForearm: [0, 0, 0],
    leftLeg: 0, rightLeg: 0,
    blink: Math.max(0, 1 - Math.abs(p - 0.75) / 0.055), happy: 0, sad: 0,
  };
  switch (state) {
    case 'idle':
      pose.leftArm[2] += wave * 0.018;
      pose.rightArm[2] -= wave * 0.018;
      break;
    case 'running-left':
    case 'running-right':
      pose.rootYaw = state === 'running-right' ? Math.PI / 3 : -Math.PI / 3;
      pose.leftLeg = 0.45 * wave;
      pose.rightLeg = -0.45 * wave;
      pose.leftArm[0] = -0.35 * wave;
      pose.rightArm[0] = 0.35 * wave;
      pose.leftForearm[0] = -0.45;
      pose.rightForearm[0] = -0.45;
      pose.rootY = 0.025 * (1 - Math.cos(p * Math.PI * 4));
      break;
    case 'waving':
      pose.rightArm = [0, 0, -0.6];
      pose.rightForearm = [0, 0, -0.35 + 0.3 * wave];
      pose.headRoll = 0.08;
      pose.happy = 0.65;
      break;
    case 'jumping':
      pose.rootY = Math.sin(Math.PI * p) ** 2 * 0.27;
      pose.leftArm[2] += Math.sin(Math.PI * p) * 0.7;
      pose.rightArm[2] -= Math.sin(Math.PI * p) * 0.7;
      pose.happy = 0.4;
      break;
    case 'failed':
      pose.headPitch = 0.24;
      pose.headRoll = -0.13 + wave * 0.03;
      pose.sad = 0.8;
      break;
    case 'waiting':
      pose.headRoll = 0.15 + wave * 0.04;
      pose.headYaw = wave * 0.12;
      pose.leftArm = [-0.5, 0, -0.7];
      pose.leftForearm = [-0.75, 0, -0.25];
      break;
    case 'running':
      pose.headPitch = 0.18 + wave * 0.035;
      pose.leftArm = [-0.7, 0, -1.0];
      pose.rightArm = [-0.7, 0, 1.0];
      pose.leftForearm = [-0.6 + wave * 0.13, 0, 0];
      pose.rightForearm = [-0.6 - wave * 0.13, 0, 0];
      break;
    case 'review':
      pose.headYaw = wave * 0.2;
      pose.headPitch = 0.12;
      pose.rightArm = [-0.65, 0, 0.75];
      pose.rightForearm = [-1.25, 0, 0.2];
      break;
  }
  return pose;
}

export function sampleLook(angleDegrees: number) {
  const radians = (Number.isFinite(angleDegrees) ? angleDegrees : 0) * Math.PI / 180;
  return { yaw: Math.sin(radians) * 0.55, pitch: -Math.cos(radians) * 0.35 };
}
