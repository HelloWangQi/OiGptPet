import { describe, expect, it } from 'vitest';
import { sampleLook, sampleMotion } from '../packages/character-core';
import { inspectVrmFile } from '../packages/character-core/vrm-file';
import { ANIMATION_ROWS, atlasDimensions } from '../packages/target-chatgpt/contract';

function glb(document: unknown): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const length = Math.ceil(json.length / 4) * 4;
  const buffer = new ArrayBuffer(20 + length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true); view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20).fill(32); new Uint8Array(buffer, 20, json.length).set(json);
  return buffer;
}
const document = { extensions: { VRMC_vrm: { specVersion: '1.0', meta: { name: '<script>not HTML</script>', authors: ['Artist'] } } } };

describe('local model boundary', () => {
  it('retains literal metadata without interpreting HTML', () => expect(inspectVrmFile(glb(document)).name).toBe('<script>not HTML</script>'));
  it('rejects network and local file references before loading', () => {
    for (const uri of ['https://example.com/image.png', 'file:///C:/secret', 'data:image/png;base64,']) {
      expect(() => inspectVrmFile(glb({ ...document, images: [{ uri }] }))).toThrow('外部');
    }
  });
  it('rejects truncated, malformed and unsupported files', () => {
    expect(() => inspectVrmFile(new ArrayBuffer(4))).toThrow();
    const truncated = glb(document).slice(0, -4);
    expect(() => inspectVrmFile(truncated)).toThrow('长度');
    expect(() => inspectVrmFile(glb({ extensions: { VRM: {} } }))).toThrow('VRM 1.0');
  });
});

describe('shared animation semantics', () => {
  it('jump departs and returns to a shared baseline', () => {
    expect(sampleMotion('jumping', 0).rootY).toBe(0);
    expect(sampleMotion('jumping', 0.5).rootY).toBeGreaterThan(0.2);
    expect(sampleMotion('jumping', 1).rootY).toBe(0);
  });
  it('work does not move the legs and directional running alternates', () => {
    expect(sampleMotion('running', 0.25).leftLeg).toBe(0);
    expect(sampleMotion('running-right', 0.25).leftLeg).toBeGreaterThan(0);
    expect(sampleMotion('running-right', 0.75).leftLeg).toBeLessThan(0);
    expect(sampleMotion('running-left', 0).rootYaw).toBeLessThan(0);
  });
  it('gaze uses screen-up clockwise directions', () => {
    expect(sampleLook(0).pitch).toBeLessThan(0);
    expect(sampleLook(90).yaw).toBeGreaterThan(0);
    expect(sampleLook(180).pitch).toBeGreaterThan(0);
    expect(sampleLook(270).yaw).toBeLessThan(0);
  });
  it('matches the target row totals and dimensions', () => {
    expect(ANIMATION_ROWS.reduce((total, row) => total + row.frames, 0)).toBe(57);
    expect(atlasDimensions('v1')).toEqual({ width: 1536, height: 1872 });
    expect(atlasDimensions('v2')).toEqual({ width: 1536, height: 2288 });
  });
});
