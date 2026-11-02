import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import recovery from '../electron/window-recovery.cjs';

const controllers = [];
afterEach(() => { controllers.splice(0).forEach(c => c.dispose()); vi.useRealTimers(); });
function fixture() {
  vi.useFakeTimers();
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const screen = new EventEmitter();
  screen.getPrimaryDisplay = vi.fn(() => ({ workArea: area }));
  screen.getDisplayMatching = vi.fn(() => ({ workArea: area }));
  const powerMonitor = new EventEmitter();
  let bounds = { x: 100, y: 200, width: 320, height: 420 };
  let scale = 1;
  let destroyed = false;
  const win = {
    getBounds: () => ({ ...bounds }), isDestroyed: () => destroyed,
    setBounds: vi.fn(next => { bounds = next; }), show: vi.fn(), focus: vi.fn(),
  };
  let window = win;
  const controller = recovery.createWindowRecovery({ screen, powerMonitor, getWindow: () => window, getScale: () => scale });
  controllers.push(controller);
  return { area, screen, powerMonitor, win, controller, move: next => { bounds = next; }, scale: value => { scale = value; }, destroy: () => { destroyed = true; }, remove: () => { window = null; } };
}
describe('desktop display and resume recovery', () => {
  it('uses the selected size for display matching and leaves DPI conversion to Electron', () => {
    const f = fixture(); f.scale(1.2);
    Object.assign(f.area, { x: -1920, y: -200, width: 1920, height: 1080 });
    expect(f.controller.boundsFor({ x: -800, y: 50 })).toEqual({ x: -800, y: 50, width: 384, height: 504 });
    expect(f.screen.getDisplayMatching).toHaveBeenCalledWith({ x: -800, y: 50, width: 384, height: 504 });
  });
  it('falls back to the primary work area for a corrupt saved position', () => {
    const f = fixture();
    expect(f.controller.boundsFor({ x: Infinity, y: 0 })).toEqual({ x: 1570, y: 0, width: 320, height: 420 });
    expect(f.screen.getDisplayMatching).not.toHaveBeenCalled();
  });
  it('debounces monitor events and uses the live window position at execution time', () => {
    const f = fixture();
    f.screen.emit('display-removed'); f.screen.emit('display-added'); f.screen.emit('display-metrics-changed', {}, {}, ['workArea']);
    f.move({ x: 1900, y: 900, width: 320, height: 420 });
    vi.advanceTimersByTime(99); expect(f.win.setBounds).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(f.win.setBounds).toHaveBeenCalledExactlyOnceWith({ x: 1600, y: 620, width: 320, height: 420 });
    expect(f.win.show).not.toHaveBeenCalled(); expect(f.win.focus).not.toHaveBeenCalled();
  });
  it('recovers after resume without showing a hidden pet', () => {
    const f = fixture(); f.move({ x: -9000, y: 10000, width: 320, height: 420 });
    f.powerMonitor.emit('resume'); vi.advanceTimersByTime(299);
    expect(f.win.setBounds).not.toHaveBeenCalled(); vi.advanceTimersByTime(1);
    expect(f.win.getBounds()).toEqual({ x: 0, y: 620, width: 320, height: 420 });
    expect(f.win.show).not.toHaveBeenCalled();
  });
  it('fits scale changes and reduced work areas while avoiding redundant moves', () => {
    const f = fixture(); f.controller.reconcile(); expect(f.win.setBounds).not.toHaveBeenCalled();
    f.scale(1.2); f.controller.reconcile(); expect(f.win.getBounds().width).toBe(384);
    Object.assign(f.area, { width: 300, height: 400 }); f.controller.reconcile();
    expect(f.win.getBounds()).toEqual({ x: 0, y: 0, width: 300, height: 400 });
    f.controller.reconcile(); expect(f.win.setBounds).toHaveBeenCalledTimes(2);
  });
  it.each(['destroy', 'remove'])('ignores delayed recovery after window %s', action => {
    const f = fixture(); f.screen.emit('display-removed'); f[action](); vi.runAllTimers();
    expect(f.win.setBounds).not.toHaveBeenCalled();
  });
  it('releases listeners and pending recovery on shutdown', () => {
    const f = fixture(); f.powerMonitor.emit('resume'); f.controller.dispose(); vi.runAllTimers();
    expect(f.win.setBounds).not.toHaveBeenCalled(); expect(f.screen.listenerCount('display-removed')).toBe(0);
    expect(f.powerMonitor.listenerCount('resume')).toBe(0);
    f.controller.reconcile(); expect(f.win.setBounds).not.toHaveBeenCalled();
  });
});
