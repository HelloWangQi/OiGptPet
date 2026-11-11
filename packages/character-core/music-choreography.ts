import type { MusicDanceSignal } from './music-dance';

export type MusicDanceStyle = 'groove' | 'idol-pop' | 'catwalk';

/** Small additive pose values layered over the character's idle pose. */
export interface MusicDancePose {
  bodyPitch: number;
  bodyRoll: number;
  bodyYaw: number;
  headPitch: number;
  headRoll: number;
  headYaw: number;
  leftShoulder: number;
  rightShoulder: number;
  leftArmPitch: number;
  rightArmPitch: number;
  leftElbow: number;
  rightElbow: number;
  leftStep: number;
  rightStep: number;
  leftKnee: number;
  rightKnee: number;
  bounce: number;
}

type PoseKeyframe = Partial<MusicDancePose>;

const idolPop: PoseKeyframe[] = [
  { bodyRoll: -0.04, headRoll: 0.03, leftShoulder: 0.52, rightShoulder: -0.52, leftElbow: 0.38, rightElbow: -0.38, bounce: 0.018 },
  { bodyRoll: 0.07, bodyYaw: 0.08, headYaw: -0.08, leftShoulder: 0.82, rightShoulder: -0.18, leftArmPitch: -0.12, rightArmPitch: -0.22, leftElbow: 0.18, rightElbow: -0.3, leftStep: -0.12, rightStep: 0.16, rightKnee: 0.12, bounce: 0.035 },
  { bodyRoll: 0.02, bodyPitch: -0.04, headRoll: -0.04, leftShoulder: 0.28, rightShoulder: -0.28, leftElbow: 0.58, rightElbow: -0.58, leftArmPitch: -0.2, rightArmPitch: -0.2, bounce: 0.012 },
  { bodyRoll: -0.08, bodyYaw: -0.08, headYaw: 0.08, leftShoulder: 0.12, rightShoulder: -0.72, leftElbow: 0.32, rightElbow: -0.12, leftStep: 0.16, rightStep: -0.12, leftKnee: 0.1, bounce: 0.035 },
  { bodyRoll: 0.04, headRoll: 0.04, leftShoulder: 0.48, rightShoulder: -0.48, leftElbow: 0.46, rightElbow: -0.46, bodyPitch: 0.03, bounce: 0.016 },
  { bodyRoll: -0.07, bodyYaw: 0.08, headYaw: -0.08, leftShoulder: 0.12, rightShoulder: -0.82, leftElbow: 0.28, rightElbow: -0.16, leftStep: -0.14, rightStep: 0.16, rightKnee: 0.12, bounce: 0.036 },
  { bodyRoll: -0.02, headRoll: -0.08, leftShoulder: 0.7, rightShoulder: -0.24, leftElbow: 0.52, rightElbow: -0.52, leftArmPitch: -0.3, rightArmPitch: -0.18, leftStep: 0.12, rightStep: -0.12, leftKnee: 0.1, bounce: 0.016 },
  { bodyRoll: 0.08, bodyYaw: -0.07, headYaw: 0.06, leftShoulder: 0.3, rightShoulder: -0.3, leftElbow: 0.12, rightElbow: -0.12, leftStep: -0.1, rightStep: 0.1, bounce: 0.045 },
];

const catwalk: PoseKeyframe[] = [
  { bodyRoll: -0.08, bodyYaw: 0.1, headRoll: 0.06, headYaw: -0.1, leftShoulder: 0.18, rightShoulder: -0.62, leftElbow: 0.12, rightElbow: -0.5, leftStep: -0.16, rightStep: 0.24, rightKnee: 0.2, bounce: 0.012 },
  { bodyRoll: 0.1, bodyYaw: -0.08, headRoll: -0.04, headYaw: 0.08, leftShoulder: 0.62, rightShoulder: -0.16, leftElbow: 0.5, rightElbow: -0.12, leftStep: 0.24, rightStep: -0.16, leftKnee: 0.2, bounce: 0.02 },
  { bodyRoll: -0.06, bodyYaw: 0.1, headRoll: 0.05, headYaw: -0.08, leftShoulder: 0.22, rightShoulder: -0.72, leftElbow: 0.16, rightElbow: -0.58, leftStep: -0.12, rightStep: 0.22, rightKnee: 0.18, bounce: 0.01 },
  { bodyRoll: 0.12, bodyYaw: -0.1, headRoll: -0.06, headYaw: 0.1, leftShoulder: 0.7, rightShoulder: -0.2, leftElbow: 0.56, rightElbow: -0.14, leftStep: 0.22, rightStep: -0.12, leftKnee: 0.18, bounce: 0.022 },
  { bodyRoll: -0.1, bodyYaw: 0.12, headPitch: -0.04, headRoll: 0.08, headYaw: -0.1, leftShoulder: 0.18, rightShoulder: -0.68, leftElbow: 0.16, rightElbow: -0.56, leftStep: -0.16, rightStep: 0.22, rightKnee: 0.2, bounce: 0.012 },
  { bodyRoll: 0.08, bodyYaw: -0.08, headRoll: -0.05, headYaw: 0.08, leftShoulder: 0.66, rightShoulder: -0.18, leftElbow: 0.52, rightElbow: -0.12, leftStep: 0.22, rightStep: -0.16, leftKnee: 0.2, bounce: 0.02 },
  { bodyRoll: -0.05, bodyYaw: 0.08, headRoll: 0.06, headYaw: -0.08, leftShoulder: 0.26, rightShoulder: -0.58, leftElbow: 0.18, rightElbow: -0.5, leftStep: -0.12, rightStep: 0.2, rightKnee: 0.16, bounce: 0.012 },
  { bodyRoll: 0.12, bodyYaw: -0.1, headRoll: -0.06, headYaw: 0.1, leftShoulder: 0.62, rightShoulder: -0.16, leftElbow: 0.52, rightElbow: -0.12, leftStep: 0.2, rightStep: -0.12, leftKnee: 0.18, bounce: 0.024 },
];

const channels: (keyof MusicDancePose)[] = [
  'bodyPitch', 'bodyRoll', 'bodyYaw', 'headPitch', 'headRoll', 'headYaw',
  'leftShoulder', 'rightShoulder', 'leftArmPitch', 'rightArmPitch',
  'leftElbow', 'rightElbow', 'leftStep', 'rightStep', 'leftKnee', 'rightKnee', 'bounce',
];

/** Sample an original eight-count phrase. Existing groove mode remains unchanged. */
export function sampleMusicDancePose(style: Exclude<MusicDanceStyle, 'groove'>, signal: MusicDanceSignal): MusicDancePose {
  const frames = style === 'idol-pop' ? idolPop : catwalk;
  const totalBeats = (signal.beatIndex ?? 0) + (Number.isFinite(signal.phase) ? Math.max(0, Math.min(0.999, signal.phase!)) : 0);
  const beat = ((Math.floor(totalBeats) % frames.length) + frames.length) % frames.length;
  const previous = (beat + frames.length - 1) % frames.length;
  const next = (beat + 1) % frames.length;
  const following = (beat + 2) % frames.length;
  const raw = totalBeats - Math.floor(totalBeats);
  const t2 = raw * raw;
  const t3 = t2 * raw;
  const pose = Object.fromEntries(channels.map(channel => {
    const p0 = frames[previous][channel] ?? 0;
    const p1 = frames[beat][channel] ?? 0;
    const p2 = frames[next][channel] ?? 0;
    const p3 = frames[following][channel] ?? 0;
    const value = 0.5 * ((2 * p1) + (-p0 + p2) * raw
      + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
      + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    return [channel, value];
  })) as unknown as MusicDancePose;

  // A gentle between-count body rhythm keeps transitions alive without snapping on beat edges.
  const microSway = Math.sin(raw * Math.PI * 2) * 0.025;
  pose.bodyYaw += microSway;
  pose.headRoll -= microSway * 0.55;
  return pose;
}
