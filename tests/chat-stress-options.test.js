import { describe, expect, it } from 'vitest';
import { chatStressOptions, SwitchSchedule, soakDuration, sampleCoverage } from '../scripts/chat-stress-options.mjs';

describe('mixed soak measurement boundaries', () => {
  it('preserves bounded modes and makes timed runs fixed and mixed', () => {
    expect(chatStressOptions(['--cycles', '4'])).toMatchObject({ cycles: 4, mixed: false, minutes: null });
    expect(chatStressOptions(['--mixed', '--fixed-windows', '--cycles', '8', '--settle-seconds', '5'])).toMatchObject({ fixedWindows: true, settleSeconds: 5 });
    expect(chatStressOptions(['--minutes', '60'])).toMatchObject({ fixedWindows: true, mixed: true, warmupSeconds: 300, switchSeconds: 60, sampleSeconds: 15 });
  });
  it.each([
    ['--minutes', 'NaN'], ['--minutes'], ['--minutes', '0'], ['--minutes', '181'], ['--cycles', '3'], ['--cycles', '201'],
    ['--minutes', '60', '--cycles', '4'], ['--sample-seconds', '15'], ['--minutes', '1', '--sample-seconds', '0.1'],
    ['--minutes', '1', '--warmup-seconds', '-1'], ['--minutes', '1', '--switch-seconds', '0'],
    ['--fixed-windows'], ['--mixed', '--mixed'], ['--minutes', '1', '--minutes', '2'], ['--other'],
  ])('rejects ambiguous or invalid measurement options %j', (...args) => { expect(() => chatStressOptions(args)).toThrow(); });
  it('does not count warmup, short runs or a shortened warmup as a full hour', () => {
    const options = chatStressOptions(['--minutes', '60']);
    expect(soakDuration(options, 3899.99).completeHour).toBe(false);
    expect(soakDuration(options, 3900)).toEqual({ observationSeconds: 3600, completeHour: true });
    expect(soakDuration({ ...options, minutes: 1 }, 4000).completeHour).toBe(false);
    expect(soakDuration({ ...options, warmupSeconds: 0 }, 4000).completeHour).toBe(false);
  });
  it('anchors switch slots and records delay without replaying every missed slot', () => {
    const schedule = new SwitchSchedule(60, 300);
    expect(schedule.reserve(0)).toEqual({ atSeconds: 0, skippedSlots: 0 });
    expect(schedule.reserve(10)).toEqual({ atSeconds: 60, skippedSlots: 0 });
    expect(schedule.reserve(245)).toEqual({ atSeconds: 240, skippedSlots: 2 });
    expect(schedule.reserve(250)).toBeNull();
  });
  it('rejects a sampling gap from sleep/suspension or a reversed clock', () => {
    expect(sampleCoverage([0, 15, 30, 45].map(collectedSeconds => ({ collectedSeconds })), 15)).toEqual({ maximumGapSeconds: 15, continuous: true });
    for (const times of [[0], [0, 15, 200], [15, 0]]) expect(sampleCoverage(times.map(collectedSeconds => ({ collectedSeconds })), 15).continuous).toBe(false);
  });
});
