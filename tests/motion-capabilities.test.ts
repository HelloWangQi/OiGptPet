import { describe, expect, it } from 'vitest';
import { inspectMotionCapabilities, MOTION_BONES, MOTION_EXPRESSIONS } from '../packages/character-core/motion-capabilities';
import { motionCapabilityRows } from '../src/motion-capabilities-view';

describe('loaded procedural motion capabilities', () => {
  it('reports loaded features without claiming visual or platform acceptance', () => {
    const report = inspectMotionCapabilities({ hasBone: () => true, hasExpression: () => true, lookAtController: true });
    expect(report.bones).toEqual({ present: [...MOTION_BONES], missing: [] });
    expect(report.expressions).toEqual({ present: [...MOTION_EXPRESSIONS], missing: [] });
    expect(report.visualReview).toBe('not-reviewed');
    expect(motionCapabilityRows(report).every(row => !row.warning)).toBe(true);
    expect(motionCapabilityRows(report).map(row => row.text).join('')).toContain('预览');
  });
  it('describes absent optional bones, expressions and gaze without rejecting the model', () => {
    const report = inspectMotionCapabilities({ hasBone: name => !['chest', 'neck'].includes(name), hasExpression: () => false, lookAtController: false });
    expect(report.bones.missing).toEqual(['chest', 'neck']);
    expect(report.bones.present).not.toContain('chest');
    const rows = motionCapabilityRows(report);
    expect(rows.filter(row => row.warning)).toHaveLength(4);
    expect(rows.find(row => row.label.startsWith('躯干'))?.text).toContain('胸部、颈部');
    expect(rows.find(row => row.label === '眨眼')?.text).toContain('不会驱动');
    expect(rows.find(row => row.label === '开心 / 失落表情')?.text).toContain('仍播放骨骼动作');
    expect(rows.find(row => row.label === '视线控制')?.text).toContain('头部');
  });
  it('keeps independent model reports and warns for missing head and limbs', () => {
    const absent = inspectMotionCapabilities({ hasBone: () => false, hasExpression: () => false, lookAtController: false });
    const full = inspectMotionCapabilities({ hasBone: () => true, hasExpression: () => true, lookAtController: true });
    absent.bones.missing.splice(0); absent.expressions.missing.splice(0);
    expect(full.bones.present).toHaveLength(10); expect(full.expressions.present).toHaveLength(3);
    const rows = motionCapabilityRows(inspectMotionCapabilities({ hasBone: () => false, hasExpression: () => false, lookAtController: false }));
    expect(rows.filter(row => row.warning)).toHaveLength(7);
    expect(rows.find(row => row.label.startsWith('头部'))?.text).toContain('缺少头部');
  });
});
