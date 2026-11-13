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
const legacyDocument = { extensions: { VRM: { specVersion: '0.0', meta: { title: '旧角色', author: '作者', allowedUserName: 'OnlyAuthor', licenseName: 'Redistribution_Prohibited' }, blendShapeMaster: { blendShapeGroups: [{ presetName: 'blink' }, { presetName: 'unknown' }] } } } };

describe('local model boundary', () => {
  it('retains literal metadata without interpreting HTML', () => expect(inspectVrmFile(glb(document)).name).toBe('<script>not HTML</script>'));
  it('reads VRM 0.0 metadata without inventing redistribution permission', () => {
    expect(inspectVrmFile(glb(legacyDocument))).toMatchObject({ name: '旧角色', authors: ['作者'], version: '0.0', expressions: ['blink'], avatarPermission: 'OnlyAuthor', allowRedistribution: false });
    expect(() => inspectVrmFile(glb({ ...legacyDocument, buffers: [{ uri: 'file:///C:/secret' }] }))).toThrow('外部');
  });
  it('rejects network and local file references before loading', () => {
    for (const uri of ['https://example.com/image.png', 'file:///C:/secret', 'data:image/png;base64,']) {
      expect(() => inspectVrmFile(glb({ ...document, images: [{ uri }] }))).toThrow('外部');
    }
  });
  it('rejects truncated, malformed and unsupported files', () => {
    expect(() => inspectVrmFile(new ArrayBuffer(4))).toThrow();
    const truncated = glb(document).slice(0, -4);
    expect(() => inspectVrmFile(truncated)).toThrow('长度');
    expect(() => inspectVrmFile(glb({ extensions: { VRM: {} } }))).toThrow('VRM 0.0');
  });
});

describe('shared animation semantics', () => {
  it.each(ANIMATION_ROWS)('captures an open/closed/open blink in exported $state frames', row => {
    const frames = Array.from({ length: row.frames }, (_, i) => sampleMotion(row.state, row.state === 'jumping' ? i / (row.frames - 1) : i / row.frames).blink);
    expect(frames[0]).toBe(0); expect(sampleMotion(row.state, 1).blink).toBe(0);
    if (row.frames > 4) expect(frames.at(-1)).toBe(0);
    expect(Math.max(...frames)).toBeCloseTo(1, 10);
    expect(frames.filter(weight => weight > 0.5)).toHaveLength(1);
  });
  it('keeps six-frame blinks continuous around the captured peak', () => {
    const peak = 2 / 3;
    expect(sampleMotion('idle', peak - 0.025).blink).toBeGreaterThan(0);
    expect(sampleMotion('idle', peak + 0.025).blink).toBeGreaterThan(0);
    expect(sampleMotion('idle', -1 / 3).blink).toBeCloseTo(sampleMotion('idle', peak).blink);
    expect(sampleMotion('idle', 0).blink).toBe(sampleMotion('idle', 1).blink);
  });
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
