import type { MotionCapabilities, MotionBone } from '../packages/character-core/motion-capabilities';

export function motionCapabilityRows(value: MotionCapabilities) {
  const labels: Record<MotionBone, string> = { leftUpperArm: '左上臂', rightUpperArm: '右上臂', leftLowerArm: '左前臂', rightLowerArm: '右前臂', leftUpperLeg: '左大腿', rightUpperLeg: '右大腿', spine: '脊柱', chest: '胸部', neck: '颈部', head: '头部' };
  const emotions = value.expressions.missing.filter(name => name !== 'blink');
  const group = (label: string, bones: MotionBone[]) => {
    const missing = bones.filter(name => value.bones.missing.includes(name));
    return { label, warning: missing.length > 0, text: missing.length ? `缺少${missing.map(name => labels[name]).join('、')}骨骼，相应动作幅度可能不完整。` : '当前动作所用骨骼已加载，效果请在动作预览中确认。' };
  };
  return [
    group('手臂 / 挥手', ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm']),
    group('腿部 / 奔跑', ['leftUpperLeg', 'rightUpperLeg']),
    group('躯干 / 思考与失落', ['spine', 'chest', 'neck']),
    group('头部 / 视线方向', ['head']),
    { label: '眨眼', warning: value.expressions.missing.includes('blink'), text: value.expressions.present.includes('blink') ? '已加载眨眼表情。' : '缺少通用眨眼表情，当前动作不会驱动眨眼。' },
    { label: '开心 / 失落表情', warning: emotions.length > 0, text: emotions.length ? `缺少${emotions.map(name => name === 'happy' ? '开心' : '失落').join('、')}表情，对应状态仍播放骨骼动作。` : '已加载开心和失落表情。' },
    { label: '视线控制', warning: !value.lookAtController, text: value.lookAtController ? '已加载视线控制器，眼睛跟随效果与范围请预览确认。' : '未加载视线控制器，仍尝试通过头部转动表现视线。' },
  ];
}
