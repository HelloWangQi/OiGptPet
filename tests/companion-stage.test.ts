import { beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({ instances: [] as any[], load: undefined as undefined | (() => Promise<void>) }));
vi.mock('../packages/renderer-vrm', () => ({ VrmStage: class {
  loaded = false;
  disposed = false;
  render = vi.fn(); resize = vi.fn(); hitTest = vi.fn(() => true);
  constructor(public canvas: any) { probe.instances.push(this); }
  async load() {
    await probe.load?.(); this.loaded = true;
    return { name: 'test', authors: [], version: '1.0', expressions: [], licenseUrl: '', avatarPermission: '', allowRedistribution: false };
  }
  dispose() { this.disposed = true; this.loaded = false; }
} }));
vi.mock('../packages/renderer-sprite', () => ({ SPRITE_MAX_CANVAS_DIMENSION: 4096, SpriteStage: class {
  loaded = false;
  disposed = false;
  render = vi.fn(); resize = vi.fn(); hitTest = vi.fn(() => false);
  constructor(public canvas: any) { probe.instances.push(this); }
  async load() { await probe.load?.(); this.loaded = true; }
  dispose() { this.disposed = true; this.loaded = false; }
} }));
import { CompanionStage } from '../src/companion-stage';

function fixture() {
  const host = { visible: null as any };
  const canvas = (style = { width: '', height: '' }): any => ({ style, cloneNode() { return canvas({ ...style }); }, replaceWith(next: any) { host.visible = next; } });
  host.visible = canvas();
  return { host, stage: new CompanionStage(host.visible) };
}
const vrm = () => ({ kind: 'vrm' as const, blob: new Blob(['vrm']) });
const sprite = () => ({ kind: 'sprite' as const, blob: new Blob(['sprite']), profile: 'v2' as const });

beforeEach(() => { probe.instances = []; probe.load = undefined; });
describe('transactional visible companion replacement', () => {
  it('keeps the visible renderer until a candidate commits; rollback disposes only candidate', async () => {
    const { stage, host } = fixture();
    (await stage.prepare(vrm())).commit();
    const visible = host.visible; const first = probe.instances[0];
    const candidate = await stage.prepare(sprite());
    expect(host.visible).toBe(visible); expect(first.disposed).toBe(false);
    candidate.dispose();
    expect(host.visible).toBe(visible); expect(first.disposed).toBe(false);
    expect(probe.instances[1].disposed).toBe(true);
  });
  it('replaces the canvas between context types and releases the old renderer once committed', async () => {
    const { stage, host } = fixture();
    (await stage.prepare(vrm())).commit(); const old = host.visible;
    const next = await stage.prepare(sprite()); next.commit(); next.dispose();
    expect(host.visible).not.toBe(old); expect(stage.sourceKind).toBe('sprite');
    expect(probe.instances[0].disposed).toBe(true); expect(probe.instances[1].disposed).toBe(false);
    expect(() => next.commit()).toThrow();
  });
  it('preserves a working renderer after a real loading rejection', async () => {
    const { stage, host } = fixture(); (await stage.prepare(vrm())).commit(); const old = host.visible;
    probe.load = async () => { throw new Error('decode failed'); };
    await expect(stage.prepare(sprite())).rejects.toThrow('decode failed');
    expect(host.visible).toBe(old); expect(stage.loaded).toBe(true);
    expect(probe.instances[1].disposed).toBe(true);
  });
  it('late results from superseded preparation cannot commit', async () => {
    const { stage } = fixture(); let resolve!: () => void;
    probe.load = () => new Promise<void>((done) => { resolve = done; });
    const old = stage.prepare(sprite()); const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    probe.load = undefined; const latest = await stage.prepare(vrm()); latest.commit();
    resolve(); await rejected;
    expect(probe.instances[0].disposed).toBe(true); expect(stage.sourceKind).toBe('vrm');
  });
  it('cancellation after loading but before persistence commit preserves visible state', async () => {
    const { stage } = fixture(); (await stage.prepare(vrm())).commit();
    const controller = new AbortController(); const next = await stage.prepare(sprite(), controller.signal);
    controller.abort(); expect(() => next.commit()).toThrow(); expect(stage.sourceKind).toBe('vrm');
    expect(probe.instances[1].disposed).toBe(true);
  });
  it('uses the latest size on commit and forwards source-specific playback units', async () => {
    const { stage } = fixture(); stage.resize(300, 400, 1.5);
    const next = await stage.prepare(sprite()); stage.resize(500, 600, 2); next.commit();
    const instance = probe.instances[0]; expect(instance.resize).toHaveBeenLastCalledWith(500, 600, 2);
    stage.render('waving', 1.25, 0.02, { yaw: 0, pitch: 0, angle: 90 });
    expect(instance.render).toHaveBeenCalledWith('waving', 1.25, 90);
    (await stage.prepare(vrm())).commit(); stage.render('jumping', 1.25, 0.02);
    expect(probe.instances[1].render).toHaveBeenCalledWith('jumping', 0.625, 0.02, undefined);
  });
  it('dispose invalidates prepared work and cannot resurrect a canvas', async () => {
    const { stage } = fixture(); const next = await stage.prepare(sprite());
    stage.dispose(); stage.dispose(); expect(() => next.commit()).toThrow();
    await expect(stage.prepare(vrm())).rejects.toThrow('关闭'); expect(stage.loaded).toBe(false);
  });
  it('VRM replacement drops sprite pixel CSS so later window resizing follows the host', async () => {
    const { stage, host } = fixture(); (await stage.prepare(sprite())).commit();
    host.visible.style.width = '763px'; host.visible.style.height = '425px';
    (await stage.prepare(vrm())).commit();
    expect(host.visible.style).toEqual({ width: '', height: '' });
    stage.resize(541, 400, 1);
    expect(probe.instances[1].resize).toHaveBeenLastCalledWith(541, 400, 1);
  });
});
