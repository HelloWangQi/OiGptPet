import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { pointerLook } from '../src/pointer-look';
import { sampleLook } from '../packages/character-core';
import { VrmStage } from '../packages/renderer-vrm';

const bounds = { left: 100, top: 200, width: 320, height: 420 };

// Exercise the real pose method and Three.js rotations without creating a WebGL context.
function pose(look: { yaw: number; pitch: number }) {
  const head = new THREE.Object3D();
  const target = new THREE.Object3D();
  const stage = Object.create(VrmStage.prototype) as VrmStage;
  Object.assign(stage, {
    vrm: { meta: { metaVersion: '1' }, humanoid: { resetNormalizedPose() {}, getNormalizedBoneNode: (name: string) => name === 'head' ? head : undefined }, update: vi.fn() },
    root: new THREE.Group(), lookTarget: target,
    renderer: { render: vi.fn() }, scene: new THREE.Scene(), camera: new THREE.OrthographicCamera(),
  });
  stage.render('idle', 0, 0, look);
  return { forward: new THREE.Vector3(0, 0, 1).applyEuler(head.rotation), target: target.position };
}

describe('screen-space pointer and VRM gaze agree', () => {
  it.each([
    { x: 420, angle: 90, sign: 1 },
    { x: 100, angle: 270, sign: -1 },
  ])('turns head and eyes toward screen x=$x, matching atlas direction $angle', ({ x, angle, sign }) => {
    const look = pointerLook(x, 410, bounds);
    expect(look.angle).toBe(angle);
    const pointer = pose(look);
    const atlas = pose(sampleLook(angle));
    for (const result of [pointer, atlas]) {
      expect(result.forward.x * sign).toBeGreaterThan(0);
      expect(result.target.x * sign).toBeGreaterThan(0);
    }
  });
  it.each([{ y: 200, angle: 0, sign: 1 }, { y: 620, angle: 180, sign: -1 }])('preserves vertical tracking at y=$y', ({ y, angle, sign }) => {
    const look = pointerLook(260, y, bounds);
    expect(look.angle).toBe(angle);
    const result = pose(look);
    expect(result.forward.y * sign).toBeGreaterThan(0);
    expect((result.target.y - 1.65) * sign).toBeGreaterThan(0);
  });
  it('keeps centered and zero-size canvases neutral', () => {
    const result = pose(pointerLook(260, 410, bounds));
    expect(result.forward.x).toBeCloseTo(0); expect(result.forward.y).toBeCloseTo(0);
    expect(result.target.x).toBeCloseTo(0); expect(result.target.y).toBeCloseTo(1.65);
    expect(pointerLook(10, 10, { ...bounds, width: 0 })).toEqual({ yaw: 0, pitch: 0, angle: 0 });
  });
});
