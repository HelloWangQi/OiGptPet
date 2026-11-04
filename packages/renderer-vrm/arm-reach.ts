import { Object3D, Quaternion, Vector3 } from 'three';

/** Deterministic CCD from the supplied pose; no state is carried between frames. */
export function reachArm(upper: Object3D, lower: Object3D, hand: Object3D, target: Vector3) {
  const tip = new Vector3(); const pivot = new Vector3();
  const from = new Vector3(); const to = new Vector3();
  const delta = new Quaternion(); const parent = new Quaternion(); const identity = new Quaternion();
  if (!target.toArray().every(Number.isFinite)) return;
  for (let step = 0; step < 12; step++) {
    for (const joint of [lower, upper]) {
      hand.updateWorldMatrix(true, false); hand.getWorldPosition(tip);
      joint.getWorldPosition(pivot); from.subVectors(tip, pivot); to.subVectors(target, pivot);
      if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) continue;
      delta.setFromUnitVectors(from.normalize(), to.normalize());
      const angle = identity.angleTo(delta);
      if (angle > 0.4) delta.slerp(identity, 1 - 0.4 / angle);
      joint.parent?.getWorldQuaternion(parent) ?? parent.identity();
      delta.premultiply(parent.clone().invert()).multiply(parent);
      joint.quaternion.premultiply(delta).normalize();
    }
  }
}

type Bone = 'head' | 'neck' | 'leftUpperArm' | 'leftLowerArm' | 'leftHand' | 'rightUpperArm' | 'rightLowerArm' | 'rightHand';
/** Only face-related poses use IK; existing procedural poses remain the fallback. */
export function adaptFaceArms(get: (name: Bone) => Object3D | null, state: string) {
  if (state !== 'failed' && state !== 'running') return;
  const head = get('head'); const neck = get('neck');
  if (!head || !neck) return;
  head.updateWorldMatrix(true, false); neck.updateWorldMatrix(true, false);
  const origin = head.getWorldPosition(new Vector3());
  const unit = origin.distanceTo(neck.getWorldPosition(new Vector3()));
  if (!Number.isFinite(unit) || unit < 1e-5) return;
  const rotation = head.getWorldQuaternion(new Quaternion());
  for (const side of state === 'failed' ? ['left', 'right'] as const : ['right'] as const) {
    const upper = get(`${side}UpperArm`); const lower = get(`${side}LowerArm`); const hand = get(`${side}Hand`);
    if (!upper || !lower || !hand) continue;
    const target = new Vector3(state === 'failed' ? side === 'left' ? 0.55 : -0.55 : -0.8, state === 'failed' ? 0.55 : -0.35, state === 'failed' ? 1.15 : 0.85)
      .multiplyScalar(unit).applyQuaternion(rotation).add(origin);
    reachArm(upper, lower, hand, target);
  }
}
