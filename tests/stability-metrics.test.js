import { describe, expect, it } from 'vitest';
import { soakOptions, summarizeMemory } from '../scripts/stability-metrics.mjs';

describe('stability measurement boundaries', () => {
  it('defaults to one real hour and accepts explicit short preflights', () => {
    expect(soakOptions([]).minutes).toBe(60);
    expect(soakOptions(['--minutes', '1', '--switch-seconds', '3']).minutes).toBe(1);
  });
  it.each([['--minutes', 'NaN'], ['--minutes'], ['--minutes', '-1'], ['--other', '1'], ['--sample-seconds', '0.1']])('rejects unusable arguments %j', (...args) => {
    expect(() => soakOptions(args)).toThrow();
  });
  it('keeps missing measurements unavailable and separates reused process IDs', () => {
    expect(summarizeMemory([{ elapsedSeconds: 400, processes: [{ pid: 1, memory: {} }] }])).toEqual([]);
    const rows = [1, 2].map(creationTime => ({ elapsedSeconds: 400, processes: [{ pid: 1, creationTime, type: 'Tab', memory: { privateBytes: 1024 } }] }));
    const result = summarizeMemory(rows);
    expect(result).toHaveLength(2); expect(result[0].slopeMiBPerMinute).toBeNull();
  });
  it('excludes warmup and reports sustained large growth without calling it a leak', () => {
    const samples = Array.from({ length: 10 }, (_, index) => ({ elapsedSeconds: index * 60, processes: [{ pid: 1, type: 'Tab', memory: { privateBytes: (100 + index * 30) * 1024 } }] }));
    const [result] = summarizeMemory(samples, 300);
    expect(result.samples).toBe(5); expect(result.slopeMiBPerMinute).toBeCloseTo(30);
    expect(result.deltaPrivateMiB).toBe(120); expect(result.needsReview).toBe(true);
  });
  it('compares VRM and sprite memory under matching workloads', () => {
    const samples = Array.from({ length: 12 }, (_, index) => {
      const kind = index % 2 ? 'vrm' : 'sprite';
      const cycle = Math.floor(index / 2);
      const base = kind === 'vrm' ? 500 : 200;
      return { elapsedSeconds: index * 60, kind, processes: [{ pid: 1, creationTime: 1, type: 'GPU', memory: { privateBytes: (base + cycle * 5) * 1024 } }] };
    });
    const result = summarizeMemory(samples, 0);
    expect(result).toHaveLength(2);
    expect(result.find(row => row.kind === 'vrm')).toMatchObject({ samples: 6, firstPrivateMiB: 500, lastPrivateMiB: 525, deltaPrivateMiB: 25, needsReview: false });
    expect(result.find(row => row.kind === 'sprite')).toMatchObject({ samples: 6, firstPrivateMiB: 200, lastPrivateMiB: 225, deltaPrivateMiB: 25, needsReview: false });
  });
});
