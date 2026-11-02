import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPetDrag } from '../electron/pet-drag.cjs';

const controllers = [];
afterEach(() => { controllers.splice(0).forEach(c => c.stop(false)); vi.useRealTimers(); });
function fixture() {
  vi.useFakeTimers();
  let point = { x: -500, y: 200 };
  let bounds = { x: -600, y: 100, width: 320, height: 420 };
  let visible = true; let destroyed = false;
  const win = {
    isVisible: () => visible, isDestroyed: () => destroyed,
    getBounds: () => ({ ...bounds }), setIgnoreMouseEvents: vi.fn(),
    setPosition: vi.fn((x, y) => { bounds = { ...bounds, x, y }; }),
  };
  let current = win;
  const drag = createPetDrag({ getWindow: () => current, getCursor: () => point }); controllers.push(drag);
  return { drag, win, cursor: value => { point = value; }, hide: () => { visible = false; }, destroy: () => { destroyed = true; }, replace: () => { current = null; } };
}
describe('dragging the pet body', () => {
  it('preserves clicks and ignores tiny mouse jitter', () => {
    const f = fixture(); expect(f.drag.start()).toBe(true);
    f.cursor({ x: -498, y: 202 }); vi.advanceTimersByTime(32);
    expect(f.win.setPosition).not.toHaveBeenCalled(); expect(f.drag.stop()).toBe(false);
    expect(f.win.setIgnoreMouseEvents).toHaveBeenCalledWith(false);
  });
  it('moves by global cursor delta without accumulating client-coordinate feedback', () => {
    const f = fixture(); f.drag.start(); f.cursor({ x: -470, y: 180 }); vi.advanceTimersByTime(16);
    expect(f.win.getBounds()).toEqual({ x: -570, y: 80, width: 320, height: 420 });
    vi.advanceTimersByTime(100); expect(f.win.setPosition).toHaveBeenCalledTimes(1);
    f.cursor({ x: 200, y: 300 }); vi.advanceTimersByTime(16);
    expect(f.win.getBounds()).toEqual({ x: 100, y: 200, width: 320, height: 420 });
    expect(f.drag.stop()).toBe(true); f.cursor({ x: 1000, y: 1000 }); vi.advanceTimersByTime(32);
    expect(f.win.getBounds().x).toBe(100);
  });
  it('captures the final movement on release before the next polling tick', () => {
    const f = fixture(); f.drag.start(); f.cursor({ x: -480, y: 220 });
    expect(f.drag.stop()).toBe(true); expect(f.win.getBounds().x).toBe(-580);
    expect(f.drag.active).toBe(false);
  });
  it.each(['hide', 'destroy', 'replace'])('stops polling when the pet is no longer usable: %s', action => {
    const f = fixture(); f.drag.start(); f[action](); vi.advanceTimersByTime(16);
    expect(f.drag.active).toBe(false); expect(f.win.setPosition).not.toHaveBeenCalled();
    expect(f.drag.start()).toBe(false);
  });
});
