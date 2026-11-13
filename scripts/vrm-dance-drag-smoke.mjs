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
  let hitPoint;
  try {
    await pet.evaluate(() => {
      window.__vrmBodyClicks = 0;
      window.__vrmBodyListener = event => { if (event.target.id === 'character-canvas') window.__vrmBodyClicks++; };
      document.querySelector('.pet-shell').addEventListener('click', window.__vrmBodyListener);
      return window.petDesktop.setClickThrough(false);
    });
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
        if (await pet.evaluate(() => document.body.classList.contains('pet-body-dragging'))) { found = true; hitPoint = point; break; }
        await pet.mouse.up();
      }
      if (found) break;
    }
    assert.ok(found, 'A visible animated VRM body should be draggable');
    await pet.evaluate(() => { window.__vrmBodyClicks = 0; });
    await new Promise(resolve => setTimeout(resolve, 100));
    await pet.mouse.move(hitPoint.x + 8, hitPoint.y + 8);
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
    assert.equal(await pet.evaluate(() => window.__vrmBodyClicks), 0, 'Dragging must not trigger a body click');
    const frame = await pet.locator('#character-canvas').screenshot();
    await pet.waitForTimeout(700);
    assert.notDeepEqual(await pet.locator('#character-canvas').screenshot(), frame, 'Dance resumes after the drag');
    const scaleBefore = await pet.evaluate(async () => (await window.petDesktop.getPreferences()).scale);
    const sizeBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.isResizable()).getBounds());
    const changedScale = scaleBefore === 0.8 ? 1.2 : 0.8;
    try {
      await pet.evaluate(scale => window.petDesktop.setScale(scale), changedScale);
      const scaleDeadline = Date.now() + 5000;
      let resized;
      do {
        await new Promise(resolve => setTimeout(resolve, 50));
        resized = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.isResizable()).getBounds());
      } while (Date.now() < scaleDeadline && resized.width === sizeBefore.width && resized.height === sizeBefore.height);
      assert.ok(resized.width !== sizeBefore.width || resized.height !== sizeBefore.height, 'Changing pet scale resizes the window');
      const resizedFrame = await pet.locator('#character-canvas').screenshot();
      await pet.waitForTimeout(700);
      assert.notDeepEqual(await pet.locator('#character-canvas').screenshot(), resizedFrame, 'Dance continues after resizing');
    } finally {
      await pet.evaluate(scale => window.petDesktop.setScale(scale), scaleBefore);
      const restoreDeadline = Date.now() + 5000;
      let restored;
      do {
        await new Promise(resolve => setTimeout(resolve, 50));
        restored = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.isResizable()).getBounds());
      } while (Date.now() < restoreDeadline && (restored.width !== sizeBefore.width || restored.height !== sizeBefore.height));
      assert.equal(restored.width, sizeBefore.width); assert.equal(restored.height, sizeBefore.height);
    }
    await pet.evaluate(() => window.petDesktop.hidePet());
    const visibilityDeadline = Date.now() + 5000;
    let visible = true;
    do {
      visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.isResizable()).isVisible());
      if (visible) await new Promise(resolve => setTimeout(resolve, 50));
    } while (visible && Date.now() < visibilityDeadline);
    assert.equal(visible, false, 'Pet window is hidden');
    await pet.evaluate(() => window.petDesktop.openPet());
    const showDeadline = Date.now() + 5000;
    do {
      visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.isResizable()).isVisible());
      if (!visible) await new Promise(resolve => setTimeout(resolve, 50));
    } while (!visible && Date.now() < showDeadline);
    assert.equal(visible, true, 'Pet window is restored');
    const restoredFrame = await pet.locator('#character-canvas').screenshot();
    await pet.waitForTimeout(700);
    assert.notDeepEqual(await pet.locator('#character-canvas').screenshot(), restoredFrame, 'Dance resumes after restoring the pet');
    return { vrmBodyHit: true, movedDuringDance: true, released: true, danceResumed: true, scaleDuringDance: true, hideAndRestore: true };
  } finally {
    await pet.mouse.up().catch(() => {});
    await pet.evaluate(() => { document.querySelector('.pet-shell')?.removeEventListener('click', window.__vrmBodyListener); delete window.__vrmBodyListener; delete window.__vrmBodyClicks; }).catch(() => {});
    await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = globalThis.__vrmDragOriginalCursor; delete globalThis.__vrmDragOriginalCursor; delete globalThis.__vrmDragCursor; });
  }
}
