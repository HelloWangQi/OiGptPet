import assert from 'node:assert/strict';

// Run against the packaged UI and real BrowserWindow. Inject only global cursor
// positions because Playwright's page.mouse does not move the Windows hardware cursor.
export async function checkPetBodyDrag(desktop, page) {
  const point = await page.evaluate(() => {
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
    if (!best) throw new Error('No opaque pet body pixel');
    return best;
  });
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
  try {
    await page.evaluate(() => {
      window.__bodyClickCount = 0;
      window.__bodyClickListener = event => {
        if (event.target.id === 'character-canvas') window.__bodyClickCount++;
      };
      document.querySelector('.pet-shell').addEventListener('click', window.__bodyClickListener);
    });
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.waitForFunction(() => document.body.classList.contains('pet-body-dragging'));
    await page.mouse.move(point.x + 8, point.y + 8);
    await desktop.evaluate(async ({ BrowserWindow }, { dx, dy }) => {
      globalThis.__dragCursor = { x: globalThis.__dragCursor.x + dx, y: globalThis.__dragCursor.y + dy };
      await new Promise(resolve => setTimeout(resolve, 80));
    }, { dx, dy });
    let moved = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isResizable()).getBounds());
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
      document.querySelector('.pet-shell').removeEventListener('click', window.__bodyClickListener);
      delete window.__bodyClickListener;
    });
    await desktop.evaluate(({ screen }) => { screen.getCursorScreenPoint = globalThis.__dragOriginalCursor; });
  }
}
