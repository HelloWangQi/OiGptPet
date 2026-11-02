import assert from 'node:assert/strict';

// Run against the packaged UI and real BrowserWindow. Inject only global cursor
// positions because Playwright's page.mouse does not move the Windows hardware cursor.
export async function checkPetBodyDrag(desktop, page) {
  const findBodyPixel = async () => {
    // A committed character clears the replacement canvas before its next
    // animation frame. Wait for that first visible frame instead of mistaking
    // the intentional blank interval for a broken or empty sprite.
    try {
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#character-canvas');
        if (!canvas?.width || !canvas.height) return false;
        const image = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height);
        if (!image) return false;
        for (let y = Math.floor(canvas.height * 0.2); y < canvas.height * 0.75; y++) {
          for (let x = 0; x < canvas.width; x++) {
            if (image.data[(y * canvas.width + x) * 4 + 3] >= 240) return true;
          }
        }
        return false;
      }, undefined, { timeout: 10000, polling: 100 });
    } catch (error) {
      const state = await page.evaluate(() => {
        const canvas = document.querySelector('#character-canvas');
        return { hidden: document.hidden, kind: document.body.dataset.characterKind, id: document.body.dataset.characterId,
          canvas: canvas && { width: canvas.width, height: canvas.height, rect: canvas.getBoundingClientRect().toJSON(),
            hasContext: Boolean(canvas.getContext('2d')) } };
      }).catch(() => null);
      throw new Error(`${error.message}; waiting for a rendered pet body frame timed out: ${JSON.stringify(state)}`);
    }
    return page.evaluate(() => {
      const canvas = document.querySelector('#character-canvas');
      const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const rect = canvas.getBoundingClientRect();
      let best; let distance = Infinity;
      for (let y = Math.floor(canvas.height * 0.2); y < canvas.height * 0.75; y++) {
        for (let x = 0; x < canvas.width; x++) {
          if (image.data[(y * canvas.width + x) * 4 + 3] < 240) continue;
          const score = (x - canvas.width / 2) ** 2 + (y - canvas.height / 2) ** 2;
          if (score < distance) { distance = score; best = { x: rect.left + (x + 0.5) * rect.width / canvas.width, y: rect.top + (y + 0.5) * rect.height / canvas.height }; }
        }
      }
      if (!best) throw new Error('No opaque pet body pixel after a rendered frame');
      return best;
    });
  };
  let point = await findBodyPixel();
  const start = await desktop.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find(w => !w.isResizable());
    const bounds = win.getBounds();
    globalThis.__dragOriginalCursor = screen.getCursorScreenPoint;
    globalThis.__dragCursor = { x: bounds.x + 150, y: bounds.y + 200 };
    screen.getCursorScreenPoint = () => globalThis.__dragCursor;
    return bounds;
  });
  const dx = start.x > 50 ? -30 : 30;
  const dy = start.y > 50 ? -20 : 20;
  let hitSample;
  try {
    await page.evaluate(() => {
      window.__dragPointerTrace = [];
      window.__dragPointerHandler = event => window.__dragPointerTrace.push({
        type: event.type,
        target: event.target?.id || event.target?.className || event.target?.tagName,
        x: event.clientX,
        y: event.clientY,
        buttons: event.buttons,
        pointerId: event.pointerId,
      });
      for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) {
        window.addEventListener(type, window.__dragPointerHandler, true);
      }
      window.__bodyClickCount = 0;
      window.__bodyClickListener = event => {
        if (event.target.id === 'character-canvas') window.__bodyClickCount++;
      };
      document.querySelector('.pet-shell').addEventListener('click', window.__bodyClickListener);
    });
    // Moving onto the canvas changes the gaze frame. Recheck the same backing
    // pixel after that frame has rendered so the test presses a visible body
    // pixel in the frame the app's alpha hit-test is actually using.
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.mouse.move(point.x, point.y);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      hitSample = await page.evaluate(({ x, y }) => {
        const canvas = document.querySelector('#character-canvas');
        const rect = canvas.getBoundingClientRect();
        const pixelX = Math.max(0, Math.min(canvas.width - 1, Math.floor((x - rect.left) * canvas.width / rect.width)));
        const pixelY = Math.max(0, Math.min(canvas.height - 1, Math.floor((y - rect.top) * canvas.height / rect.height)));
        return { alpha: canvas.getContext('2d').getImageData(pixelX, pixelY, 1, 1).data[3], pixelX, pixelY };
      }, point);
      if (hitSample.alpha >= 8) break;
      point = await findBodyPixel();
    }
    if (hitSample?.alpha < 8) throw new Error(`Body pixel became transparent after hover: ${JSON.stringify({ point, hitSample })}`);
    await desktop.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => !w.isResizable());
      const original = win.setIgnoreMouseEvents;
      globalThis.__dragStartHook = { win, original };
      globalThis.__dragStartObserved = false;
      win.setIgnoreMouseEvents = function (...args) {
        if (args[0] === false) globalThis.__dragStartObserved = true;
        return original.apply(this, args);
      };
    });
    await page.mouse.down();
    try {
      await page.waitForFunction(() => document.body.classList.contains('pet-body-dragging'), undefined, { timeout: 3000, polling: 50 });
    } catch (error) {
      const trace = await page.evaluate(() => ({ events: window.__dragPointerTrace, dragging: document.body.classList.contains('pet-body-dragging'), target: document.elementFromPoint(window.__dragPointerTrace.at(-1)?.x ?? 0, window.__dragPointerTrace.at(-1)?.y ?? 0)?.id }));
      throw new Error(`${error.message}; body-drag diagnostic=${JSON.stringify({ point, hitSample, trace })}`);
    }
    const startDeadline = Date.now() + 3000;
    let startObserved = await desktop.evaluate(() => globalThis.__dragStartObserved);
    while (!startObserved && Date.now() < startDeadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
      startObserved = await desktop.evaluate(() => globalThis.__dragStartObserved);
    }
    if (!startObserved) throw new Error(`Native drag did not start: ${JSON.stringify(await page.evaluate(() => window.__dragPointerTrace))}`);
    // The Electron handler creates its polling session immediately after this
    // signal; let that synchronous IPC handler finish before moving the test cursor.
    await new Promise(resolve => setTimeout(resolve, 25));
    await page.mouse.move(point.x + 8, point.y + 8);
    await desktop.evaluate(({ BrowserWindow }, { dx, dy }) => {
      globalThis.__dragCursor = { x: globalThis.__dragCursor.x + dx, y: globalThis.__dragCursor.y + dy };
    }, { dx, dy });
    const expected = { x: start.x + dx, y: start.y + dy };
    const deadline = Date.now() + 2000;
    let moved = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isResizable()).getBounds());
    while ((moved.x !== expected.x || moved.y !== expected.y) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
      moved = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isResizable()).getBounds());
    }
    if (moved.x !== expected.x || moved.y !== expected.y) {
      const state = await desktop.evaluate(({ BrowserWindow, screen }) => ({
        bounds: BrowserWindow.getAllWindows().find(w => !w.isResizable()).getBounds(),
        cursor: screen.getCursorScreenPoint(), injectedCursor: globalThis.__dragCursor,
      }));
      const renderer = await page.evaluate(() => ({ dragging: document.body.classList.contains('pet-body-dragging'),
        pointerTrace: window.__dragPointerTrace }));
      throw new Error(`Native drag did not reach target: ${JSON.stringify({ expected, state, renderer })}`);
    }
    assert.equal(moved.x, start.x + dx); assert.equal(moved.y, start.y + dy);
    await page.mouse.up();
    await page.waitForFunction(() => !document.body.classList.contains('pet-body-dragging'));
    assert.equal(await page.evaluate(() => window.__bodyClickCount), 0, 'drag must not trigger the wave click handler');
    const stopped = await desktop.evaluate(async ({ BrowserWindow }) => {
      await new Promise(resolve => setTimeout(resolve, 100));
      const win = BrowserWindow.getAllWindows().find(w => !w.isResizable());
      const before = win.getBounds();
      globalThis.__dragCursor.x += 100;
      await new Promise(resolve => setTimeout(resolve, 80));
      return { before, after: win.getBounds() };
    });
    assert.deepEqual(stopped.after, stopped.before, 'release stops native movement');
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.evaluate(() => window.__bodyClickCount), 1, 'ordinary body clicks still work');
    await page.locator('#pet-wave').click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('pet-body-dragging')), false, 'buttons are not drag handles');
    return { bodyPixel: point, start, dragged: moved, released: stopped.after, injectedCursor: true };
  } finally {
    await page.mouse.up().catch(() => {});
    await page.evaluate(() => {
      for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) {
        window.removeEventListener(type, window.__dragPointerHandler, true);
      }
      delete window.__dragPointerHandler;
      document.querySelector('.pet-shell').removeEventListener('click', window.__bodyClickListener);
      delete window.__bodyClickListener;
      delete window.__dragPointerTrace;
    });
    await desktop.evaluate(({ screen }) => {
      const hook = globalThis.__dragStartHook;
      if (hook) hook.win.setIgnoreMouseEvents = hook.original;
      delete globalThis.__dragStartHook;
      delete globalThis.__dragStartObserved;
      screen.getCursorScreenPoint = globalThis.__dragOriginalCursor;
      delete globalThis.__dragOriginalCursor;
      delete globalThis.__dragCursor;
    });
  }
}
