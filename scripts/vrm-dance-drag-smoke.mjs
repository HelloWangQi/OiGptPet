import assert from 'node:assert/strict';

// Playwright cannot move the hardware cursor; only the native cursor is injected.
// The pointer events, VRM hit-test, drag IPC and BrowserWindow movement are real.
export async function checkDancingVrmDrag(app, pet) {
  const original = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find(candidate => !candidate.isResizable());
    globalThis.__vrmDragOriginalCursor = screen.getCursorScreenPoint;
    const bounds = win.getBounds();
    globalThis.__vrmDragCursor = { x: bounds.x, y: bounds.y };
    screen.getCursorScreenPoint = () => globalThis.__vrmDragCursor;
    return bounds;
  });
  let found = false;
  try {
    await pet.evaluate(() => window.petDesktop.setClickThrough(false));
    const canvas = await pet.locator('#character-canvas').boundingBox();
    assert.ok(canvas);
    for (const y of [0.48, 0.4, 0.56, 0.32, 0.64]) {
      for (const x of [0.5, 0.43, 0.57, 0.36, 0.64]) {
        const point = { x: canvas.x + canvas.width * x, y: canvas.y + canvas.height * y };
        await app.evaluate(({ BrowserWindow }, point) => {
          const win = BrowserWindow.getAllWindows().find(candidate => !candidate.isResizable());
          const bounds = win.getBounds();
          globalThis.__vrmDragCursor = { x: Math.round(bounds.x + point.x), y: Math.round(bounds.y + point.y) };
        }, point);
        await pet.mouse.move(point.x, point.y);
        await pet.mouse.down();
        if (await pet.evaluate(() => document.body.classList.contains('pet-body-dragging'))) { found = true; break; }
        await pet.mouse.up();
      }
      if (found) break;
    }
    assert.ok(found, 'A visible animated VRM body should be draggable');
    await new Promise(resolve => setTimeout(resolve, 100));
    const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.isResizable()).getBounds());
    await app.evaluate(() => { globalThis.__vrmDragCursor.x -= 24; globalThis.__vrmDragCursor.y -= 16; });
    const deadline = Date.now() + 3000;
    let after;
    do {
      await new Promise(resolve => setTimeout(resolve, 30));
      after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.isResizable()).getBounds());
    } while (Date.now() < deadline && (after.x !== before.x - 24 || after.y !== before.y - 16));
    assert.equal(after.x, before.x - 24); assert.equal(after.y, before.y - 16);
    await pet.mouse.up();
    await pet.waitForFunction(() => !document.body.classList.contains('pet-body-dragging'));
    await new Promise(resolve => setTimeout(resolve, 100));
    const stopped = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(candidate => !candidate.isResizable());
      const before = win.getBounds();
      globalThis.__vrmDragCursor.x += 60;
      await new Promise(resolve => setTimeout(resolve, 100));
      return { before, after: win.getBounds() };
    });
    assert.deepEqual(stopped.after, stopped.before, 'Releasing the body stops native window movement');
    const frame = await pet.locator('#character-canvas').screenshot();
    await pet.waitForTimeout(700);
    assert.notDeepEqual(await pet.locator('#character-canvas').screenshot(), frame, 'Dance resumes after the drag');
    return { vrmBodyHit: true, movedDuringDance: true, released: true, danceResumed: true };
  } finally {
    await pet.mouse.up().catch(() => {});
    await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = globalThis.__vrmDragOriginalCursor; delete globalThis.__vrmDragOriginalCursor; delete globalThis.__vrmDragCursor; });
  }
}
