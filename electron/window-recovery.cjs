const { fitBounds } = require('./geometry.cjs');

// Electron bounds and work areas are already in DIP; do not multiply by DPI.
function createWindowRecovery({ screen, powerMonitor, getWindow, getScale, topInset = 0 }) {
  let timer;
  let disposed = false;
  // Saved coordinates describe the character area, including older saves.
  function contentBounds(bounds) {
    return { ...bounds, y: bounds.y + topInset, height: Math.max(1, bounds.height - topInset) };
  }
  function boundsFor(saved) {
    const scale = getScale();
    const size = { width: Math.round(320 * scale), height: Math.round(420 * scale) };
    const hasPosition = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y);
    const target = hasPosition
      ? screen.getDisplayMatching({ x: saved.x, y: saved.y, ...size })
      : screen.getPrimaryDisplay();
    const nativeSize = { ...size, height: size.height + topInset };
    const y = Number.isFinite(saved?.y) ? saved.y - topInset : undefined;
    return fitBounds({ x: saved?.x, y, ...nativeSize }, target.workArea, nativeSize);
  }
  function reconcile() {
    if (disposed) return;
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const current = win.getBounds();
    const next = boundsFor(contentBounds(current));
    if (['x', 'y', 'width', 'height'].some(key => current[key] !== next[key])) win.setBounds(next);
  }
  function schedule(delay = 100) {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(reconcile, delay);
  }
  const displayChanged = () => schedule();
  const resumed = () => schedule(300);
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, displayChanged);
  powerMonitor.on('resume', resumed);
  return {
    boundsFor, contentBounds, reconcile,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.removeListener(event, displayChanged);
      powerMonitor.removeListener('resume', resumed);
    },
  };
}

module.exports = { createWindowRecovery };
