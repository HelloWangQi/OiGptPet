export type VrmMotionLoopMode = 'repeat' | 'once' | 'pingpong';

export function poseTimeToActionTime(seconds: number, duration: number, mode: VrmMotionLoopMode, loopCount: number): number {
  const poseTime = Math.max(0, Math.min(duration, seconds));
  return mode === 'pingpong' && loopCount >= 0 && loopCount % 2 === 1 ? duration - poseTime : poseTime;
}

export function actionTimeToPoseTime(actionTime: number, duration: number, mode: VrmMotionLoopMode, loopCount: number): number {
  return mode === 'pingpong' && loopCount >= 0 && loopCount % 2 === 1 ? duration - actionTime : actionTime;
}
