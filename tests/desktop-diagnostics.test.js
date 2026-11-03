import { describe, expect, it, vi } from 'vitest';
import diagnostics from '../electron/desktop-diagnostics.cjs';
const bounds = { x: -900, y: 20, width: 320, height: 420 };
const owner = { isDestroyed: () => false };
function fixture() {
  const display = { id: 2, bounds, workArea: bounds, scaleFactor: 1.5, rotation: 0, label: 'secret monitor' };
  return { app: { getVersion: () => '0.5.0', isPackaged: true, getAppMetrics: () => [{ type: 'GPU', memory: { privateBytes: 1024 }, name: 'secret process' }] },
    screen: { getPrimaryDisplay: () => display, getAllDisplays: () => [display], getDisplayMatching: () => display },
    os: { platform: () => 'win32', release: () => 'test', arch: () => 'x64', cpus: () => [], totalmem: () => 100 },
    versions: { electron: '45', chrome: 'test', extra: 'secret version' }, preferences: { scale: 1.2, performance: 'battery', path: 'secret path' },
    windows: { workshop: null, pet: { isDestroyed: () => false, getBounds: () => bounds, isVisible: () => false, isFocused: () => false } } };
}
describe('desktop diagnostics', () => {
  it('copies DIP coordinates and hidden state, and only includes permitted fields', () => {
    const result = diagnostics.collectDesktopDiagnostics(fixture());
    expect(result.windows[1]).toMatchObject({ bounds, visible: false, displayId: 2 });
    expect(result.displays[0].scaleFactor).toBe(1.5);
    expect(result.system.cpu).toBeNull();
    expect(result.processes[0]).toEqual({ type: 'GPU', cpuPercent: null, privateKiB: 1024, workingSetKiB: null });
    expect(JSON.stringify(result)).not.toContain('secret');
    result.windows[1].bounds.x = 123; expect(bounds.x).toBe(-900);
  });
  it('records destroyed windows as absent', () => {
    const input = fixture(); input.windows.pet = { isDestroyed: () => true };
    expect(diagnostics.collectDesktopDiagnostics(input).windows[1]).toEqual({ role: 'pet', exists: false });
  });
  it('attaches separate rendering samples to each live window without collecting missing windows', () => {
    const input = fixture(); const renderMetrics = vi.fn(() => ({ status: 'hidden', sample: null }));
    const result = diagnostics.collectDesktopDiagnostics({ ...input, renderMetrics });
    expect(renderMetrics).toHaveBeenCalledTimes(1); expect(renderMetrics).toHaveBeenCalledWith(input.windows.pet);
    expect(result.windows[1].rendering).toEqual({ status: 'hidden', sample: null });
    expect(result.windows[0]).not.toHaveProperty('rendering');
  });
  it('cancel and closed owners do not collect or write', async () => {
    const collect = vi.fn(); const writeFile = vi.fn();
    const chooseFile = vi.fn().mockResolvedValueOnce({ canceled: true }).mockResolvedValueOnce({ filePath: 'test.json' });
    const save = diagnostics.createDiagnosticsExporter({ chooseFile, collect, writeFile });
    expect(await save(owner)).toBe(false); expect(await save({ isDestroyed: () => true })).toBe(false);
    expect(collect).not.toHaveBeenCalled(); expect(writeFile).not.toHaveBeenCalled();
  });
  it('captures at save time and permits retry after disk failure', async () => {
    let value = 'before';
    const writeFile = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce();
    const save = diagnostics.createDiagnosticsExporter({ chooseFile: async () => { value = 'after'; return { filePath: 'report.json' }; }, collect: () => ({ value }), writeFile });
    await expect(save(owner)).rejects.toThrow('disk full'); expect(await save(owner)).toBe(true);
    expect(writeFile).toHaveBeenLastCalledWith('report.json', JSON.stringify({ value: 'after' }, null, 2) + '\n', 'utf8');
  });
  it('prevents duplicate dialogs', async () => {
    let resolve; const choice = new Promise(done => { resolve = done; });
    const save = diagnostics.createDiagnosticsExporter({ chooseFile: () => choice, collect: vi.fn(), writeFile: vi.fn() });
    const pending = save(owner); await expect(save(owner)).rejects.toThrow('already open');
    resolve({ canceled: true }); await pending; expect(await save(owner)).toBe(false);
  });
});
