import type { MusicDanceSignal } from './music-dance';

export type MusicDanceStyle = 'groove' | 'idol-pop' | 'catwalk' | 'douyin-mix' | 'auto-mix';

/** Preserve the reference dance's deliberate, slower movement rate. */
export function musicDancePlaybackRate(style: MusicDanceStyle): number {
  return style === 'douyin-mix' ? 0.65 : style === 'auto-mix' ? 0.82 : 1;
}

/** Pose channels for the authored, fixed-count single-avatar dance phrases. */
export interface MusicDancePose {
  bodyPitch: number;
  bodyRoll: number;
  bodyYaw: number;
  bodySway: number;
  bodyTilt: number;
  rootYaw: number;
  hipPitch: number;
  hipRoll: number;
  hipYaw: number;
  chestPitch: number;
  chestRoll: number;
  chestYaw: number;
  upperChestPitch: number;
  upperChestRoll: number;
  upperChestYaw: number;
  headPitch: number;
  headRoll: number;
  headYaw: number;
  neckPitch: number;
  neckRoll: number;
  neckYaw: number;
  leftShoulder: number;
  rightShoulder: number;
  leftShoulderJoint: number;
  rightShoulderJoint: number;
  leftArmPitch: number;
  rightArmPitch: number;
  leftArmAcross: number;
  rightArmAcross: number;
  leftElbow: number;
  rightElbow: number;
  leftWrist: number;
  leftWristYaw: number;
  leftWristRoll: number;
  rightWrist: number;
  rightWristYaw: number;
  rightWristRoll: number;
  leftStep: number;
  rightStep: number;
  leftLegSide: number;
  rightLegSide: number;
  leftKnee: number;
  rightKnee: number;
  leftFootPitch: number;
  leftFootRoll: number;
  rightFootPitch: number;
  rightFootRoll: number;
  bounce: number;
}

type PoseKeyframe = Partial<MusicDancePose>;
const TAU = Math.PI * 2;
const degrees = (value: number) => value * Math.PI / 180;

// These two phrases were authored as lifts from relaxed arms, while VRM
// normalized arms start horizontal. Convert once before interpolation/blending.
function normalizedArmPhrase(frames: PoseKeyframe[]): PoseKeyframe[] {
  return frames.map(frame => ({
    ...frame,
    leftShoulder: -Math.PI / 2 + (frame.leftShoulder ?? 0) * 2,
    rightShoulder: Math.PI / 2 + (frame.rightShoulder ?? 0) * 2,
    leftArmAcross: -Math.abs(frame.leftArmAcross ?? 0) - Math.abs(frame.leftArmPitch ?? 0),
    rightArmAcross: Math.abs(frame.rightArmAcross ?? 0) + Math.abs(frame.rightArmPitch ?? 0),
    leftArmPitch: 0, rightArmPitch: 0,
    leftElbow: -Math.abs(frame.leftElbow ?? 0),
    rightElbow: Math.abs(frame.rightElbow ?? 0),
  }));
}

const idolPop = normalizedArmPhrase([
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
]);

const catwalk = normalizedArmPhrase([
  // Original single-avatar adaptation of Like a Cat's wings, catwalk, and meow-sway ideas.
  { bodyRoll: -0.035, bodyYaw: 0.07, headRoll: 0.06, headYaw: -0.08, leftShoulder: 0.72, rightShoulder: -0.72, leftArmPitch: -0.12, rightArmPitch: -0.12, leftElbow: 0.42, rightElbow: -0.42, leftWrist: 0.28, rightWrist: -0.28, leftStep: -0.12, rightStep: 0.12, bounce: 0.014 },
  { bodyRoll: 0.1, bodyYaw: -0.08, headRoll: -0.04, headYaw: 0.08, leftShoulder: 0.38, rightShoulder: -0.22, leftArmPitch: -0.16, rightArmPitch: -0.18, leftArmAcross: 0.16, rightArmAcross: -0.2, leftElbow: 0.42, rightElbow: -0.6, rightWrist: 0.48, leftStep: 0.24, rightStep: -0.16, leftKnee: 0.16, bounce: 0.018 },
  { bodyRoll: -0.06, bodyYaw: 0.09, headRoll: 0.08, headYaw: -0.08, leftShoulder: 0.62, rightShoulder: -0.3, leftArmPitch: -0.36, rightArmPitch: -0.18, leftArmAcross: 0.22, rightArmAcross: -0.12, leftElbow: 0.68, rightElbow: -0.44, leftWrist: 0.52, rightWrist: -0.34, leftStep: -0.1, rightStep: 0.2, rightKnee: 0.15, bounce: 0.014 },
  { bodyRoll: 0.12, bodyYaw: -0.11, headRoll: -0.07, headYaw: 0.09, leftShoulder: 0.28, rightShoulder: -0.66, leftArmPitch: -0.18, rightArmPitch: -0.36, leftElbow: 0.58, rightElbow: -0.24, leftWrist: 0.32, rightWrist: -0.52, leftStep: 0.2, rightStep: -0.12, leftKnee: 0.16, bounce: 0.02 },
  { bodyRoll: -0.1, bodyYaw: 0.12, headPitch: -0.04, headRoll: 0.08, headYaw: -0.1, leftShoulder: 0.74, rightShoulder: -0.68, leftArmPitch: -0.1, rightArmPitch: -0.1, leftElbow: 0.38, rightElbow: -0.38, leftWrist: 0.24, rightWrist: -0.24, leftStep: -0.16, rightStep: 0.22, rightKnee: 0.18, bounce: 0.014 },
  { bodyRoll: 0.08, bodyYaw: -0.08, headRoll: -0.05, headYaw: 0.08, leftShoulder: 0.24, rightShoulder: -0.58, leftArmPitch: -0.18, rightArmPitch: -0.34, leftArmAcross: 0.18, rightArmAcross: -0.18, leftElbow: 0.54, rightElbow: -0.68, leftWrist: 0.42, rightWrist: 0.48, leftStep: 0.22, rightStep: -0.16, leftKnee: 0.18, bounce: 0.02 },
  { bodyRoll: -0.055, bodyYaw: 0.08, headRoll: 0.07, headYaw: -0.08, leftShoulder: 0.64, rightShoulder: -0.3, leftArmPitch: -0.34, rightArmPitch: -0.18, leftArmAcross: 0.18, rightArmAcross: -0.1, leftElbow: 0.68, rightElbow: -0.48, leftWrist: -0.46, rightWrist: -0.3, leftStep: -0.12, rightStep: 0.2, rightKnee: 0.16, bounce: 0.014 },
  { bodyRoll: 0.12, bodyYaw: -0.1, headRoll: -0.06, headYaw: 0.1, leftShoulder: 0.42, rightShoulder: -0.72, leftArmPitch: -0.2, rightArmPitch: -0.24, leftElbow: 0.56, rightElbow: -0.58, leftWrist: 0.48, rightWrist: -0.48, leftStep: 0.2, rightStep: -0.12, leftKnee: 0.18, bounce: 0.024 },
]);

const douyinMix: PoseKeyframe[] = [
  // Eight-count solo adaptation following the supplied VRM dance reference:
  // chest gather, alternating raised-fist accents, double-arm hits and a cross-body finish.
  // Arm values follow normalized VRM axes: upper-arm Y reaches forward, Z raises;
  // lower-arm Y flexes the elbow. This is an adaptation, not a claim of exact choreography.
  { leftArmAcross: degrees(-58), leftShoulder: degrees(-30), leftElbow: degrees(-74), rightArmAcross: degrees(58), rightShoulder: degrees(30), rightElbow: degrees(74) },
  { leftArmAcross: degrees(-12), leftShoulder: degrees(-52), leftElbow: degrees(-18), rightArmAcross: degrees(46), rightShoulder: degrees(-8), rightElbow: degrees(20), bodyRoll: degrees(5) },
  { leftArmAcross: degrees(-16), leftShoulder: degrees(-50), leftElbow: degrees(-14), rightArmAcross: degrees(40), rightShoulder: degrees(-42), rightElbow: degrees(88), bodyRoll: degrees(-5) },
  { leftArmAcross: degrees(-46), leftShoulder: degrees(-34), leftElbow: degrees(-32), rightArmAcross: degrees(42), rightShoulder: degrees(-36), rightElbow: degrees(86), bodyYaw: degrees(5) },
  { leftArmAcross: degrees(-74), leftShoulder: degrees(-12), leftElbow: degrees(-82), rightArmAcross: degrees(74), rightShoulder: degrees(12), rightElbow: degrees(82), bodyPitch: degrees(4) },
  { leftArmAcross: degrees(-76), leftShoulder: degrees(-56), leftElbow: degrees(-34), rightArmAcross: degrees(76), rightShoulder: degrees(56), rightElbow: degrees(34), bodyPitch: degrees(-3) },
  { leftArmAcross: degrees(-84), leftShoulder: degrees(-20), leftElbow: degrees(-22), rightArmAcross: degrees(84), rightShoulder: degrees(20), rightElbow: degrees(22), bodyYaw: degrees(-5) },
  { leftArmAcross: degrees(-30), leftShoulder: degrees(-30), leftElbow: degrees(-86), rightArmAcross: degrees(20), rightShoulder: degrees(44), rightElbow: degrees(16), bodyRoll: degrees(6) },
];

const channels: (keyof MusicDancePose)[] = [
  'bodyPitch', 'bodyRoll', 'bodyYaw', 'bodySway', 'bodyTilt', 'rootYaw',
  'hipPitch', 'hipRoll', 'hipYaw', 'chestPitch', 'chestRoll', 'chestYaw',
  'upperChestPitch', 'upperChestRoll', 'upperChestYaw', 'headPitch', 'headRoll', 'headYaw',
  'neckPitch', 'neckRoll', 'neckYaw', 'leftLegSide', 'rightLegSide',
  'leftShoulder', 'rightShoulder', 'leftShoulderJoint', 'rightShoulderJoint',
  'leftArmPitch', 'rightArmPitch', 'leftArmAcross', 'rightArmAcross',
  'leftElbow', 'rightElbow', 'leftWrist', 'leftWristYaw', 'leftWristRoll',
  'rightWrist', 'rightWristYaw', 'rightWristRoll', 'leftStep', 'rightStep',
  'leftKnee', 'rightKnee', 'leftFootPitch', 'leftFootRoll', 'rightFootPitch', 'rightFootRoll', 'bounce',
];

/** Sample an experimental eight-count phrase. Existing groove mode remains unchanged. */
export function sampleMusicDancePose(style: Exclude<MusicDanceStyle, 'groove'>, signal: MusicDanceSignal): MusicDancePose {
  if (style === 'auto-mix') {
    const beatCount = (signal.beatIndex ?? 0) + (Number.isFinite(signal.phase) ? Math.max(0, Math.min(0.999, signal.phase!)) : 0);
    const targetBeats = beatCount * musicDancePlaybackRate('auto-mix');
    const sampleAtRate = (baseStyle: Exclude<MusicDanceStyle, 'groove' | 'auto-mix'>) => {
      const sourceBeat = targetBeats / musicDancePlaybackRate(baseStyle);
      const remapped = { ...signal, beatIndex: Math.floor(sourceBeat), phase: sourceBeat - Math.floor(sourceBeat) };
      return sampleMusicDancePose(baseStyle, remapped);
    };
    const bass = clampDanceSignal(signal.bass ?? signal.level);
    const mid = clampDanceSignal(signal.mid ?? signal.level);
    const treble = clampDanceSignal(signal.treble ?? signal.level);
    const layers = [
      { style: 'douyin-mix' as const, pose: sampleAtRate('douyin-mix'), weight: 0 },
      { style: 'idol-pop' as const, pose: sampleAtRate('idol-pop'), weight: 0 },
      { style: 'catwalk' as const, pose: sampleAtRate('catwalk'), weight: 0 },
    ];
    const strongest = Math.max(bass, mid, treble);
    const weakest = Math.min(bass, mid, treble);
    const dominantStyle = signal.bandFocus === 'mid' ? 'idol-pop'
      : signal.bandFocus === 'treble' ? 'catwalk'
        : signal.bandFocus === 'bass' ? 'douyin-mix'
          : strongest - weakest < 0.1 ? 'douyin-mix'
            : bass >= mid && bass >= treble ? 'douyin-mix'
              : mid >= treble ? 'idol-pop' : 'catwalk';
    const dominantWeight = 0.82 + (strongest - weakest) * 0.12;
    for (const layer of layers) {
      layer.weight = layer.style === dominantStyle ? dominantWeight : (1 - dominantWeight) / 2;
    }
    const mixed = Object.fromEntries(Object.keys(layers[0]!.pose).map(key => [
      key,
      layers.reduce((sum, layer) => sum + (layer.pose[key as keyof MusicDancePose] ?? 0) * layer.weight, 0),
    ])) as unknown as MusicDancePose;
    const transfer = Math.sin(targetBeats * TAU);
    const handFlourish = Math.sin(targetBeats * TAU * 1.5);
    mixed.hipYaw += degrees((bass - 0.3) * 5 * transfer);
    mixed.chestRoll += degrees((mid - 0.3) * 3 * transfer);
    mixed.leftWrist += degrees((treble - 0.25) * 10 * handFlourish);
    mixed.rightWrist -= degrees((treble - 0.25) * 10 * handFlourish);
    mixed.bounce += 0.008 * bass + 0.018 * clampDanceSignal(signal.hit ?? signal.beat);
    return mixed;
  }
  const frames = style === 'idol-pop' ? idolPop : style === 'douyin-mix' ? douyinMix : catwalk;
  const detectedBeats = (signal.beatIndex ?? 0) + (Number.isFinite(signal.phase) ? Math.max(0, Math.min(0.999, signal.phase!)) : 0);
  // Match the reference app's default 0.65 motion rate while keeping the
  // detected audio beat untouched for other UI/response timing.
  const totalBeats = detectedBeats * musicDancePlaybackRate(style);
  const beat = ((Math.floor(totalBeats) % frames.length) + frames.length) % frames.length;
  const previous = (beat + frames.length - 1) % frames.length;
  const next = (beat + 1) % frames.length;
  const following = (beat + 2) % frames.length;
  const raw = totalBeats - Math.floor(totalBeats);
  // Briefly hold each experimental point pose on the beat, then travel to the next.
  const heldTravel = Math.max(0, Math.min(1, (raw - 0.16) / 0.84));
  const idolBlend = heldTravel * heldTravel * (3 - 2 * heldTravel);
  const smoothTravel = raw * raw * (3 - 2 * raw);
  const t2 = raw * raw;
  const t3 = t2 * raw;
  const pose = Object.fromEntries(channels.map(channel => {
    const p0 = frames[previous][channel] ?? 0;
    const p1 = frames[beat][channel] ?? 0;
    const p2 = frames[next][channel] ?? 0;
    const p3 = frames[following][channel] ?? 0;
    const value = style === 'idol-pop' || style === 'douyin-mix'
      ? p1 + (p2 - p1) * (style === 'douyin-mix' ? smoothTravel : idolBlend)
      : 0.5 * ((2 * p1) + (-p0 + p2) * raw
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    return [channel, value];
  })) as unknown as MusicDancePose;

  // Add visible weight transfer and knee action between hand poses. The provided
  // reference uses a grounded side-to-side step, not isolated arm waving.
  const transfer = Math.sin(totalBeats * TAU);
  if (style === 'douyin-mix') {
    const sink = 0.55 + 0.45 * Math.cos(totalBeats * Math.PI);
    const kneeBase = 12 + 8 * sink;
    const kneeL = kneeBase + 12 * Math.max(0, -transfer);
    const kneeR = kneeBase + 12 * Math.max(0, transfer);
    const sideTilt = -0.14 * transfer;
    const cosine = Math.cos(totalBeats * TAU);
    const torsoRoll = -9 * transfer - 5 * cosine;
    pose.hipPitch = degrees(4);
    pose.hipYaw = degrees(18 * transfer);
    pose.hipRoll = degrees(10 * cosine);
    pose.bodyPitch += degrees(4);
    pose.bodyYaw += degrees(-9 * transfer);
    pose.bodyRoll += degrees(torsoRoll);
    pose.bodySway = 0.042 * transfer;
    pose.bodyTilt = sideTilt;
    const energy = Math.max(0, Math.min(1, signal.level * 1.35));
    pose.rootYaw = Math.sin(totalBeats * Math.PI / 2) * 0.10 * (0.5 + energy);
    pose.chestPitch = degrees(2.5);
    pose.chestYaw = degrees(-6 * transfer);
    pose.chestRoll = degrees(2 * cosine);
    pose.upperChestPitch = degrees(1.5);
    pose.upperChestYaw = degrees(-4 * transfer);
    pose.neckPitch = degrees(1.5);
    pose.neckYaw = degrees(3 * transfer);
    pose.headYaw += degrees(8) * transfer;
    pose.headPitch += degrees(4 * Math.sin(totalBeats * TAU * 2));
    pose.headRoll += degrees(4 * Math.cos(totalBeats * TAU));
    pose.leftShoulderJoint = degrees(5 * transfer);
    pose.rightShoulderJoint = degrees(-5 * transfer);
    pose.leftStep = degrees(-3 - kneeL * 0.45);
    pose.rightStep = degrees(-3 - kneeR * 0.45);
    pose.leftLegSide = degrees(13 + 3 * transfer);
    pose.rightLegSide = degrees(-13 + 3 * transfer);
    pose.leftKnee = degrees(kneeL);
    pose.rightKnee = degrees(kneeR);
    pose.leftFootPitch = degrees(-5 - 3 * sink);
    pose.rightFootPitch = pose.leftFootPitch;
    pose.leftFootRoll = degrees(9 * transfer);
    pose.rightFootRoll = pose.leftFootRoll;
    pose.bounce = -0.020 - 0.034 * sink - 0.012 * Math.abs(Math.sin(raw * Math.PI)) * (0.4 + signal.level);
    const wristSpin = 0.7 * Math.sin(totalBeats * TAU * 0.75);
    pose.leftWrist += wristSpin;
    pose.rightWrist -= wristSpin;
    pose.leftWristYaw = degrees(10 * Math.cos(totalBeats * TAU * 0.75));
    pose.rightWristYaw = -pose.leftWristYaw;
    pose.leftWristRoll = degrees(14 * Math.sin(totalBeats * TAU * 0.75));
    pose.rightWristRoll = -pose.leftWristRoll;

    // Low-amplitude groove layer from the reference: it keeps the torso and
    // head alive between the eight authored hand poses.
    const grooveBeat = totalBeats * TAU / 8;
    const breath = Math.sin(totalBeats * Math.PI);
    pose.bodyPitch += degrees(2 * breath);
    pose.bodyRoll += degrees(1.5 * Math.sin(grooveBeat));
    pose.chestPitch += degrees(1.2 * breath);
    pose.neckPitch += degrees(Math.sin(grooveBeat + 0.6));
    pose.headPitch += degrees(2 * Math.sin(grooveBeat * 2 + 0.4));
    pose.headYaw += degrees(2.5 * Math.sin(grooveBeat));
    pose.headRoll += degrees(1.5 * Math.cos(grooveBeat));
  } else {
    pose.bodySway += 0.028 * transfer;
    pose.bodyRoll += -0.055 * transfer;
    pose.leftStep += -0.065 - 0.065 * Math.max(0, transfer);
    pose.rightStep += -0.065 - 0.065 * Math.max(0, -transfer);
    pose.leftKnee += 0.12 + 0.13 * Math.max(0, -transfer);
    pose.rightKnee += 0.12 + 0.13 * Math.max(0, transfer);
  }
  if (style !== 'idol-pop' && style !== 'douyin-mix') {
    const microSway = Math.sin(raw * Math.PI * 2) * 0.025;
    pose.bodyYaw += microSway;
    pose.headRoll -= microSway * 0.55;
  }
  return pose;
}

function clampDanceSignal(value: number) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
