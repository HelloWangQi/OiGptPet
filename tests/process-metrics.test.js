import { describe, expect, it } from 'vitest';
import { labelProcessRoles } from '../scripts/process-metrics.mjs';

describe('process role attribution', () => {
  it('labels the native renderer PID, preserves process creation identity, and keeps unowned processes unknown', () => {
    const processes = [{ pid: 1, creationTime: 50 }, { pid: 2, creationTime: 60 }, { pid: 3, creationTime: 70 }];
    const rows = labelProcessRoles(processes, [{ pid: 2, role: 'pet' }, { pid: 1, role: 'workshop' }]);
    expect(rows).toEqual([{ ...processes[0], roles: ['workshop'] }, { ...processes[1], roles: ['pet'] }, { ...processes[2], roles: [] }]);
    expect(processes[0]).not.toHaveProperty('roles');
  });
  it('does not invent separate measurements if windows share a process or have no native PID yet', () => {
    expect(labelProcessRoles([{ pid: 1 }, { pid: 0 }], [{ pid: 1, role: 'pet' }, { pid: 1, role: 'workshop' }, { pid: 1, role: 'pet' }, { pid: 0, role: 'pet' }])).toEqual([{ pid: 1, roles: ['pet', 'workshop'] }, { pid: 0, roles: [] }]);
  });
});
