import { describe, it, expect, vi } from 'vitest';
import { ExportSession, createExportReport, type CheckedAtlas, type PreviewController } from '../src/export-session';

const provenance = { source: 'local-import' as const, model: { name: 'Character', authors: ['Artist'], version: '1.0', expressions: [], licenseUrl: 'https://example.org/license', avatarPermission: 'everyone', allowRedistribution: false } };
function result(blob: Blob, valid = true): CheckedAtlas {
  return { blob, profile: 'v2', encodedBytes: blob.size, sha256: 'a'.repeat(64), inspection: { profile: 'v2', valid, requiredFrames: 73, warnings: [], errors: valid ? [] : [{ code: 'empty-frame', message: 'empty', row: 0, frame: 1 }] } };
}
function preview(valid = true): PreviewController {
  return { load: async (blob) => result(blob, valid), dispose: vi.fn() };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const blob = () => new Blob(['encoded test bytes'], { type: 'image/png' });

describe('checked export lifetime', () => {
  it('retains the exact encoded Blob and snapshots model metadata', async () => {
    const session = new ExportSession();
    const source = blob();
    const model = structuredClone(provenance);
    const pending = deferred<Blob>();
    const job = session.run('v2', model, () => pending.promise, () => preview());
    model.model.name = 'Changed later';
    expect(session.canSave).toBe(false);
    pending.resolve(source);
    const record = await job;
    expect(record.checked.blob).toBe(source);
    expect(record.report.model.name).toBe('Character');
    expect(record.report.file.encodedBytes).toBe(source.size);
    expect(record.report.platformPreflight.status).toBe('not-run');
    expect(record.report.platformInstallation.status).toBe('not-run');
    expect(session.canSave).toBe(true);
  });
  it('keeps diagnostic errors but blocks saving a failed structure', async () => {
    const session = new ExportSession();
    const record = await session.run('v2', provenance, async () => blob(), () => preview(false));
    expect(session.canSave).toBe(false);
    expect(record.report.localInspection.errors[0]).toMatchObject({ row: 0, frame: 1 });
  });
  it('clears a previous pass on decode failure and disposes its preview', async () => {
    const session = new ExportSession();
    const first = preview();
    await session.run('v2', provenance, async () => blob(), () => first);
    const broken = { load: async () => { throw new Error('corrupt PNG'); }, dispose: vi.fn() };
    await expect(session.run('v2', provenance, async () => blob(), () => broken)).rejects.toThrow('corrupt');
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(broken.dispose).toHaveBeenCalledOnce();
    expect(session.record).toBeUndefined();
    expect(session.canSave).toBe(false);
  });
  it('ignores a cancelled render even if the renderer does not honour abort', async () => {
    const session = new ExportSession();
    const slow = deferred<Blob>();
    const mount = vi.fn(() => preview());
    const first = session.run('v2', provenance, () => slow.promise, mount);
    const outcome = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const newest = await session.run('v2', provenance, async () => blob(), () => preview());
    slow.resolve(blob()); await outcome;
    expect(session.record).toBe(newest);
    expect(mount).not.toHaveBeenCalled();
  });
  it('does not let stale preview completion overwrite a newer result', async () => {
    const session = new ExportSession();
    const slow = deferred<CheckedAtlas>();
    const oldBlob = blob();
    const firstPreview = { load: () => slow.promise, dispose: vi.fn() };
    const first = session.run('v2', provenance, async () => oldBlob, () => firstPreview);
    await Promise.resolve(); await Promise.resolve();
    const outcome = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const newest = await session.run('v2', provenance, async () => blob(), () => preview());
    slow.resolve(result(oldBlob)); await outcome;
    expect(firstPreview.dispose).toHaveBeenCalledOnce();
    expect(session.record).toBe(newest);
  });
  it('reset is idempotent and removes the save capability', async () => {
    const session = new ExportSession();
    const view = preview();
    await session.run('v2', provenance, async () => blob(), () => view);
    session.reset(); session.reset();
    expect(view.dispose).toHaveBeenCalledOnce();
    expect(session.canSave).toBe(false);
  });
  it('rejects substituted files and mismatched byte counts or hashes', async () => {
    const session = new ExportSession();
    await expect(session.run('v2', provenance, async () => blob(), () => ({ load: async () => result(blob()), dispose() {} }))).rejects.toThrow('不一致');
    expect(() => createExportReport({ ...result(blob()), encodedBytes: 1 }, provenance)).toThrow('不一致');
    expect(() => createExportReport({ ...result(blob()), sha256: '' }, provenance)).toThrow('不一致');
  });
  it('omits local file URLs and never includes a local input path', () => {
    const report = createExportReport(result(blob()), { ...provenance, sourceUrl: 'file:///C:/private/model.vrm', model: { ...provenance.model, licenseUrl: 'file:///C:/private/license.txt' } });
    expect(JSON.stringify(report)).not.toContain('C:/private');
  });
});
