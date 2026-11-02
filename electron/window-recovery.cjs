const { fitBounds } = require('./geometry.cjs');

// Electron bounds and work areas are already in DIP; do not multiply by DPI.
function createWindowRecovery({ screen, powerMonitor, getWindow, getScale }) {
  let timer;
  let disposed = false;
  function boundsFor(saved) {
    const scale = getScale();
    const size = { width: Math.round(320 * scale), height: Math.round(420 * scale) };
    const target = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? screen.getDisplayMatching({ x: saved.x, y: saved.y, ...size })
      : screen.getPrimaryDisplay();
    return fitBounds({ ...saved, ...size }, target.workArea, size);
  }
  function reconcile() {
    if (disposed) return;
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const current = win.getBounds();
    const next = boundsFor(current);
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
    boundsFor, reconcile,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.removeListener(event, displayChanged);
      powerMonitor.removeListener('resume', resumed);
    },
  };
}

module.exports = { createWindowRecovery };
