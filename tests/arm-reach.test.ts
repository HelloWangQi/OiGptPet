import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from 'three';
import { reachArm, adaptFaceArms } from '../packages/renderer-vrm/arm-reach';
function chain(scale = 1) {
  const root = new Object3D(); root.rotation.y = 0.4; root.scale.setScalar(scale);
  const upper = new Object3D(); const lower = new Object3D(); const hand = new Object3D();
  lower.position.x = 0.3; hand.position.x = 0.25; lower.rotation.z = 0.5;
  root.add(upper); upper.add(lower); lower.add(hand);
  return { root, upper, lower, hand };
}
describe('face pose arm reaching', () => {
  it.each([0.5, 1, 2])('reaches a nearby target under rotated and scaled parents (%s)', scale => {
    const c = chain(scale); c.root.updateMatrixWorld(true);
    const target = c.root.localToWorld(new Vector3(0.25, 0.3, 0.04));
    reachArm(c.upper, c.lower, c.hand, target);
    expect(c.hand.getWorldPosition(new Vector3()).distanceTo(target)).toBeLessThan(0.01 * scale);
  });
  it('keeps unreachable or invalid targets finite without changing bone lengths', () => {
    const c = chain(); const original = c.upper.quaternion.clone();
    reachArm(c.upper, c.lower, c.hand, new Vector3(NaN, 0, 0)); expect(c.upper.quaternion.equals(original)).toBe(true);
    reachArm(c.upper, c.lower, c.hand, new Vector3(20, 10, 0));
    expect(c.hand.getWorldPosition(new Vector3()).toArray().every(Number.isFinite)).toBe(true);
    expect(c.lower.position.length()).toBeCloseTo(0.3); expect(c.hand.position.length()).toBeCloseTo(0.25);
  });
  it('does not alter unrelated states or a model missing face anchors', () => {
    const c = chain(); const before = c.upper.quaternion.clone();
    adaptFaceArms(() => c.upper, 'waving'); adaptFaceArms(() => null, 'failed');
    expect(c.upper.quaternion.equals(before)).toBe(true);
  });
  it('uses face-relative targets for both failed hands and only the working right hand', () => {
    const root = new Object3D(); const bones = new Map<string, Object3D>();
    const head = new Object3D(); head.position.y = 1.4; root.add(head); bones.set('head', head);
    const neck = new Object3D(); neck.position.y = 1.32; root.add(neck); bones.set('neck', neck);
    for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
      const upper = new Object3D(); upper.position.set(sign * 0.12, 1.25, 0); upper.rotation.z = -sign * 0.6;
      const lower = new Object3D(); lower.position.x = sign * 0.28; lower.rotation.z = -sign * 2.4;
      const hand = new Object3D(); hand.position.x = sign * 0.25;
      root.add(upper); upper.add(lower); lower.add(hand);
      bones.set(side + 'UpperArm', upper); bones.set(side + 'LowerArm', lower); bones.set(side + 'Hand', hand);
    }
    const get = (name: string) => bones.get(name) ?? null;
    adaptFaceArms(get, 'failed');
    for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
      const target = new Vector3(sign * 0.044, 1.444, 0.092);
      expect(get(side + 'Hand')!.getWorldPosition(new Vector3()).distanceTo(target)).toBeLessThan(0.02);
    }
    const left = get('leftUpperArm')!.quaternion.clone();
    adaptFaceArms(get, 'running'); expect(get('leftUpperArm')!.quaternion.equals(left)).toBe(true);
    const workingWrist = get('rightHand')!.getWorldPosition(new Vector3());
    expect(workingWrist.distanceTo(new Vector3(-0.108, 1.348, 0.056))).toBeLessThan(0.02);
  });
});
