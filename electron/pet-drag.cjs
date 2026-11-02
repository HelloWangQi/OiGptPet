// Use global DIP cursor coordinates: renderer client coordinates change as the window moves.
function createPetDrag({ getWindow, getCursor }) {
  let session;
  let timer;
  function update() {
    if (!session) return;
    const { win, cursor, bounds } = session;
    if (win !== getWindow() || win.isDestroyed() || !win.isVisible()) { stop(false); return; }
    const point = getCursor();
    const dx = point.x - cursor.x; const dy = point.y - cursor.y;
    if (!session.moved && Math.hypot(dx, dy) < 4) return;
    session.moved = true;
    const x = Math.round(bounds.x + dx); const y = Math.round(bounds.y + dy);
    const current = win.getBounds();
    if (current.x !== x || current.y !== y) win.setPosition(x, y, false);
  }
  function stop(sample = true) {
    if (sample) update();
    const moved = Boolean(session?.moved);
    clearInterval(timer); timer = undefined; session = undefined;
    return moved;
  }
  return {
    start() {
      stop(false);
      const win = getWindow();
      if (!win || win.isDestroyed() || !win.isVisible()) return false;
      win.setIgnoreMouseEvents(false);
      session = { win, cursor: { ...getCursor() }, bounds: win.getBounds(), moved: false };
      timer = setInterval(update, 16); timer.unref?.();
      return true;
    },
    stop,
    get active() { return Boolean(session); },
  };
}
module.exports = { createPetDrag };
