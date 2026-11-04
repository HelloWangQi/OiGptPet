import { describe, it, expect } from 'vitest';
import { applyBlink } from '../packages/character-core/blink';
import { inspectMotionCapabilities } from '../packages/character-core/motion-capabilities';
import { motionCapabilityRows } from '../src/motion-capabilities-view';
function manager(names: string[]) {
  const values = new Map(names.map(name => [name, 0.8]));
  return { values, getExpression: (name: string) => values.has(name) ? {} : null,
    setValue(name: string, value: number) { expect(values.has(name)).toBe(true); values.set(name, value); } };
}
describe('model-specific blink routing', () => {
  it('uses combined blink without stacking independent eye weights', () => {
    const model = manager(['blink', 'blinkLeft', 'blinkRight']); applyBlink(model, 0.6);
    expect(Object.fromEntries(model.values)).toEqual({ blink: 0.6, blinkLeft: 0, blinkRight: 0 });
    applyBlink(model, 0); expect([...model.values.values()]).toEqual([0, 0, 0]);
  });
  it('closes both independent eyes and clears them on the next open pose', () => {
    const model = manager(['blinkLeft', 'blinkRight']); applyBlink(model, 1);
    expect([...model.values.values()]).toEqual([1, 1]);
    applyBlink(model, 0); expect([...model.values.values()]).toEqual([0, 0]);
  });
  it.each([{ names: [] }, { names: ['blinkLeft'] }, { names: ['blinkRight'] }])('does not create a one-sided blink with $names', ({ names }) => {
    const model = manager(names); applyBlink(model, 1);
    expect([...model.values.values()].every(value => value === 0)).toBe(true);
  });
  it('isolates successive models and bounds invalid weights', () => {
    const first = manager(['blink']); const next = manager(['blinkLeft', 'blinkRight']);
    applyBlink(first, 2); applyBlink(next, NaN);
    expect(first.values.get('blink')).toBe(1); expect([...next.values.values()]).toEqual([0, 0]);
    applyBlink(first, -1); expect(first.values.get('blink')).toBe(0); applyBlink(undefined, 1);
  });
  it('reports paired support without pretending the combined preset exists', () => {
    const report = inspectMotionCapabilities({ hasBone: () => true, hasExpression: name => ['blinkLeft', 'blinkRight', 'happy', 'sad'].includes(name), lookAtController: true });
    expect(report.blinkMode).toBe('paired'); expect(report.expressions.missing).toEqual(['blink']);
    const row = motionCapabilityRows(report).find(row => row.label === '眨眼');
    expect(row?.warning).toBe(false); expect(row?.text).toContain('左右眼');
    delete report.blinkMode; expect(motionCapabilityRows(report).find(row => row.label === '眨眼')?.warning).toBe(true);
  });
});
