import type { MusicDanceSignal } from './music-dance';

export type MusicDanceStyle = 'groove' | 'idol-pop' | 'catwalk' | 'douyin-mix';

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
  leftArmAcross: number;
  rightArmAcross: number;
  leftElbow: number;
  rightElbow: number;
  leftWrist: number;
  rightWrist: number;
  leftStep: number;
  rightStep: number;
  leftKnee: number;
  rightKnee: number;
  bounce: number;
}

type PoseKeyframe = Partial<MusicDancePose>;

const idolPop: PoseKeyframe[] = [
  // Experimental single-avatar phrase inspired by the three publicly named point-dance motifs.
  // Timing, order, and pose shapes have not been visually checked against the official video.
  { bodyRoll: -0.035, bodyYaw: 0.04, headRoll: 0.035, leftShoulder: 0.24, rightShoulder: -0.24, leftArmPitch: -0.34, rightArmPitch: -0.34, leftArmAcross: 0.3, rightArmAcross: -0.3, leftElbow: 0.48, rightElbow: -0.48, leftWrist: 0.08, rightWrist: -0.08, leftStep: -0.12, rightStep: 0.12, bounce: 0.018 },
  { bodyPitch: -0.08, bodyRoll: 0.07, bodyYaw: 0.06, headYaw: -0.06, leftShoulder: 0.42, rightShoulder: -0.76, leftArmPitch: -0.2, rightArmPitch: -0.38, leftArmAcross: 0.18, rightArmAcross: -0.38, leftElbow: 0.18, rightElbow: -0.82, rightWrist: -0.18, leftStep: 0.16, rightStep: -0.1, rightKnee: 0.1, bounce: 0.06 },
  { bodyPitch: -0.07, bodyRoll: -0.07, bodyYaw: -0.06, headYaw: 0.06, leftShoulder: 0.76, rightShoulder: -0.42, leftArmPitch: -0.38, rightArmPitch: -0.2, leftArmAcross: 0.38, rightArmAcross: -0.18, leftElbow: 0.82, rightElbow: -0.18, leftWrist: 0.18, leftStep: -0.1, rightStep: 0.16, leftKnee: 0.1, bounce: 0.058 },
  { bodyPitch: -0.035, bodyRoll: 0.02, headRoll: -0.025, leftShoulder: 0.55, rightShoulder: -0.55, leftArmPitch: -0.38, rightArmPitch: -0.38, leftArmAcross: 0.44, rightArmAcross: -0.44, leftElbow: 0.72, rightElbow: -0.72, leftWrist: 0.12, rightWrist: -0.12, leftStep: 0.1, rightStep: -0.1, bounce: 0.026 },
  { bodyPitch: 0.08, bodyRoll: 0.035, headPitch: -0.035, leftShoulder: 0.62, rightShoulder: -0.62, leftArmPitch: -0.62, rightArmPitch: -0.62, leftArmAcross: 0.06, rightArmAcross: -0.06, leftElbow: 0.12, rightElbow: -0.12, leftWrist: -0.12, rightWrist: 0.12, leftStep: -0.16, rightStep: 0.16, bounce: 0.03 },
  { bodyRoll: 0.075, bodyYaw: 0.07, headYaw: -0.08, leftShoulder: 0.18, rightShoulder: -0.72, leftArmPitch: -0.24, rightArmPitch: -0.62, leftArmAcross: 0.25, rightArmAcross: -0.1, leftElbow: 0.5, rightElbow: -0.9, rightWrist: 0.62, leftStep: 0.18, rightStep: -0.12, rightKnee: 0.13, bounce: 0.038 },
  { bodyRoll: -0.06, bodyYaw: -0.07, headYaw: 0.08, leftShoulder: 0.72, rightShoulder: -0.2, leftArmPitch: -0.62, rightArmPitch: -0.24, leftArmAcross: 0.1, rightArmAcross: -0.25, leftElbow: 0.9, rightElbow: -0.5, leftWrist: -0.62, leftStep: -0.12, rightStep: 0.18, leftKnee: 0.13, bounce: 0.04 },
  { bodyPitch: -0.015, bodyRoll: 0.04, headRoll: -0.07, leftShoulder: 0.48, rightShoulder: -0.48, leftArmPitch: -0.3, rightArmPitch: -0.3, leftArmAcross: 0.16, rightArmAcross: -0.16, leftElbow: 0.46, rightElbow: -0.46, leftWrist: 0.08, rightWrist: -0.08, leftStep: 0.12, rightStep: -0.12, bounce: 0.024 },
];

const catwalk: PoseKeyframe[] = [
  // Original single-avatar adaptation of Like a Cat's wings, catwalk, and meow-sway ideas.
  { bodyRoll: -0.035, bodyYaw: 0.07, headRoll: 0.06, headYaw: -0.08, leftShoulder: 0.72, rightShoulder: -0.72, leftArmPitch: -0.12, rightArmPitch: -0.12, leftElbow: 0.42, rightElbow: -0.42, leftWrist: 0.28, rightWrist: -0.28, leftStep: -0.12, rightStep: 0.12, bounce: 0.014 },
  { bodyRoll: 0.1, bodyYaw: -0.08, headRoll: -0.04, headYaw: 0.08, leftShoulder: 0.38, rightShoulder: -0.22, leftArmPitch: -0.16, rightArmPitch: -0.18, leftArmAcross: 0.16, rightArmAcross: -0.2, leftElbow: 0.42, rightElbow: -0.6, rightWrist: 0.48, leftStep: 0.24, rightStep: -0.16, leftKnee: 0.16, bounce: 0.018 },
  { bodyRoll: -0.06, bodyYaw: 0.09, headRoll: 0.08, headYaw: -0.08, leftShoulder: 0.62, rightShoulder: -0.3, leftArmPitch: -0.36, rightArmPitch: -0.18, leftArmAcross: 0.22, rightArmAcross: -0.12, leftElbow: 0.68, rightElbow: -0.44, leftWrist: 0.52, rightWrist: -0.34, leftStep: -0.1, rightStep: 0.2, rightKnee: 0.15, bounce: 0.014 },
  { bodyRoll: 0.12, bodyYaw: -0.11, headRoll: -0.07, headYaw: 0.09, leftShoulder: 0.28, rightShoulder: -0.66, leftArmPitch: -0.18, rightArmPitch: -0.36, leftElbow: 0.58, rightElbow: -0.24, leftWrist: 0.32, rightWrist: -0.52, leftStep: 0.2, rightStep: -0.12, leftKnee: 0.16, bounce: 0.02 },
  { bodyRoll: -0.1, bodyYaw: 0.12, headPitch: -0.04, headRoll: 0.08, headYaw: -0.1, leftShoulder: 0.74, rightShoulder: -0.68, leftArmPitch: -0.1, rightArmPitch: -0.1, leftElbow: 0.38, rightElbow: -0.38, leftWrist: 0.24, rightWrist: -0.24, leftStep: -0.16, rightStep: 0.22, rightKnee: 0.18, bounce: 0.014 },
  { bodyRoll: 0.08, bodyYaw: -0.08, headRoll: -0.05, headYaw: 0.08, leftShoulder: 0.24, rightShoulder: -0.58, leftArmPitch: -0.18, rightArmPitch: -0.34, leftArmAcross: 0.18, rightArmAcross: -0.18, leftElbow: 0.54, rightElbow: -0.68, leftWrist: 0.42, rightWrist: 0.48, leftStep: 0.22, rightStep: -0.16, leftKnee: 0.18, bounce: 0.02 },
  { bodyRoll: -0.055, bodyYaw: 0.08, headRoll: 0.07, headYaw: -0.08, leftShoulder: 0.64, rightShoulder: -0.3, leftArmPitch: -0.34, rightArmPitch: -0.18, leftArmAcross: 0.18, rightArmAcross: -0.1, leftElbow: 0.68, rightElbow: -0.48, leftWrist: -0.46, rightWrist: -0.3, leftStep: -0.12, rightStep: 0.2, rightKnee: 0.16, bounce: 0.014 },
  { bodyRoll: 0.12, bodyYaw: -0.1, headRoll: -0.06, headYaw: 0.1, leftShoulder: 0.42, rightShoulder: -0.72, leftArmPitch: -0.2, rightArmPitch: -0.24, leftElbow: 0.56, rightElbow: -0.58, leftWrist: 0.48, rightWrist: -0.48, leftStep: 0.2, rightStep: -0.12, leftKnee: 0.18, bounce: 0.024 },
];

const douyinMix: PoseKeyframe[] = [
  // Single-avatar adaptation of the local 科目三 reference clip: raised-fist hops,
  // chest accents, forward points, and cross-body arm sweeps from its two sampled phrases.
  { bodyRoll: -0.025, bodyYaw: 0.025, rightShoulder: -0.18, rightArmPitch: -0.22, rightElbow: -0.26, leftShoulder: 0.12, leftArmPitch: -0.14, leftElbow: 0.14, leftStep: -0.08, rightStep: 0.08, bounce: 0.025 },
  { bodyRoll: 0.035, bodyYaw: 0.025, rightShoulder: -0.78, rightArmPitch: -0.28, rightElbow: -0.9, leftShoulder: 0.1, leftArmPitch: -0.08, leftElbow: 0.12, leftStep: 0.08, rightStep: -0.12, rightKnee: 0.14, bounce: 0.075 },
  { bodyRoll: -0.025, bodyYaw: -0.025, rightShoulder: -0.86, rightArmPitch: -0.3, rightElbow: -0.88, leftShoulder: 0.1, leftArmPitch: -0.1, leftElbow: 0.12, leftStep: -0.12, rightStep: 0.08, leftKnee: 0.14, bounce: 0.07 },
  { bodyRoll: 0.035, bodyYaw: 0.025, rightShoulder: -0.8, rightArmPitch: -0.28, rightElbow: -0.9, leftShoulder: 0.1, leftArmPitch: -0.08, leftElbow: 0.12, leftStep: 0.08, rightStep: -0.12, rightKnee: 0.14, bounce: 0.075 },
  { bodyRoll: -0.025, bodyYaw: -0.025, rightShoulder: -0.84, rightArmPitch: -0.3, rightElbow: -0.88, leftShoulder: 0.1, leftArmPitch: -0.1, leftElbow: 0.12, leftStep: -0.12, rightStep: 0.08, leftKnee: 0.14, bounce: 0.07 },
  { bodyPitch: -0.035, bodyRoll: 0.045, rightShoulder: -0.3, rightArmPitch: -0.28, rightArmAcross: -0.2, rightElbow: -0.58, leftShoulder: 0.08, leftArmPitch: -0.12, leftElbow: 0.12, leftStep: 0.08, rightStep: -0.1, bounce: 0.045 },
  { bodyPitch: -0.02, bodyRoll: -0.04, rightShoulder: -0.26, rightArmPitch: -0.3, rightArmAcross: -0.22, rightElbow: -0.58, leftShoulder: 0.08, leftArmPitch: -0.12, leftElbow: 0.12, leftStep: -0.1, rightStep: 0.08, rightKnee: 0.08, bounce: 0.04 },
  { bodyPitch: -0.035, bodyRoll: 0.04, rightShoulder: -0.3, rightArmPitch: -0.28, rightArmAcross: -0.2, rightElbow: -0.58, leftShoulder: 0.08, leftArmPitch: -0.12, leftElbow: 0.12, leftStep: 0.08, rightStep: -0.1, bounce: 0.045 },
  { bodyRoll: -0.045, bodyYaw: 0.06, rightShoulder: -0.34, rightArmPitch: -0.7, rightElbow: -0.18, leftShoulder: 0.55, leftArmPitch: -0.18, leftElbow: -0.12, leftStep: -0.2, rightStep: 0.2, bounce: 0.025 },
  { bodyRoll: 0.045, bodyYaw: -0.06, rightShoulder: -0.34, rightArmPitch: -0.72, rightElbow: -0.18, leftShoulder: 0.58, leftArmPitch: -0.16, leftElbow: -0.12, leftStep: 0.2, rightStep: -0.18, bounce: 0.025 },
  { bodyRoll: -0.07, bodyYaw: 0.08, rightShoulder: 0.26, rightArmPitch: -0.18, rightArmAcross: -0.5, rightElbow: -0.46, leftShoulder: 0.42, leftArmPitch: -0.2, leftArmAcross: 0.18, leftElbow: -0.16, leftStep: -0.16, rightStep: 0.16, bounce: 0.02 },
  { bodyRoll: 0.07, bodyYaw: -0.08, rightShoulder: 0.3, rightArmPitch: -0.14, rightArmAcross: -0.5, rightElbow: -0.5, leftShoulder: 0.38, leftArmPitch: -0.16, leftArmAcross: 0.2, leftElbow: -0.14, leftStep: 0.16, rightStep: -0.16, bounce: 0.02 },
  { bodyRoll: -0.04, bodyYaw: 0.04, rightShoulder: -0.22, rightArmPitch: -0.72, rightElbow: -0.2, leftShoulder: 0.6, leftArmPitch: -0.18, leftElbow: -0.08, leftStep: -0.18, rightStep: 0.18, bounce: 0.025 },
  { bodyRoll: 0.06, bodyYaw: -0.06, rightShoulder: 0.24, rightArmPitch: -0.2, rightArmAcross: -0.34, rightElbow: -0.62, leftShoulder: 0.12, leftArmPitch: -0.06, leftArmAcross: 0.14, leftElbow: -0.12, leftStep: 0.14, rightStep: -0.14, bounce: 0.02 },
  { bodyRoll: -0.055, bodyYaw: 0.06, rightShoulder: 0.3, rightArmPitch: -0.2, rightArmAcross: -0.36, rightElbow: -0.62, leftShoulder: 0.14, leftArmPitch: -0.06, leftArmAcross: 0.16, leftElbow: -0.12, leftStep: -0.14, rightStep: 0.14, bounce: 0.02 },
  { bodyRoll: 0.045, bodyYaw: -0.05, rightShoulder: -0.32, rightArmPitch: -0.72, rightElbow: -0.18, leftShoulder: 0.56, leftArmPitch: -0.16, leftElbow: -0.1, leftStep: 0.18, rightStep: -0.18, bounce: 0.025 },
];

const channels: (keyof MusicDancePose)[] = [
  'bodyPitch', 'bodyRoll', 'bodyYaw', 'headPitch', 'headRoll', 'headYaw',
  'leftShoulder', 'rightShoulder', 'leftArmPitch', 'rightArmPitch', 'leftArmAcross', 'rightArmAcross',
  'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftStep', 'rightStep', 'leftKnee', 'rightKnee', 'bounce',
];

/** Sample an experimental eight-count phrase. Existing groove mode remains unchanged. */
export function sampleMusicDancePose(style: Exclude<MusicDanceStyle, 'groove'>, signal: MusicDanceSignal): MusicDancePose {
  const frames = style === 'idol-pop' ? idolPop : style === 'douyin-mix' ? douyinMix : catwalk;
  const totalBeats = (signal.beatIndex ?? 0) + (Number.isFinite(signal.phase) ? Math.max(0, Math.min(0.999, signal.phase!)) : 0);
  const beat = ((Math.floor(totalBeats) % frames.length) + frames.length) % frames.length;
  const previous = (beat + frames.length - 1) % frames.length;
  const next = (beat + 1) % frames.length;
  const following = (beat + 2) % frames.length;
  const raw = totalBeats - Math.floor(totalBeats);
  // Briefly hold each experimental point pose on the beat, then travel to the next.
  const idolTravel = Math.max(0, Math.min(1, (raw - 0.16) / 0.84));
  const idolBlend = idolTravel * idolTravel * (3 - 2 * idolTravel);
  const t2 = raw * raw;
  const t3 = t2 * raw;
  const pose = Object.fromEntries(channels.map(channel => {
    const p0 = frames[previous][channel] ?? 0;
    const p1 = frames[beat][channel] ?? 0;
    const p2 = frames[next][channel] ?? 0;
    const p3 = frames[following][channel] ?? 0;
    const value = style === 'idol-pop' || style === 'douyin-mix'
      ? p1 + (p2 - p1) * idolBlend
      : 0.5 * ((2 * p1) + (-p0 + p2) * raw
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    return [channel, value];
  })) as unknown as MusicDancePose;

  // Keep the experimental point poses readable; the other style retains a small continuous sway.
  const microSway = style === 'idol-pop' || style === 'douyin-mix' ? 0 : Math.sin(raw * Math.PI * 2) * 0.025;
  pose.bodyYaw += microSway;
  pose.headRoll -= microSway * 0.55;
  return pose;
}
