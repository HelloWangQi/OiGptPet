import assert from 'node:assert/strict';
import path from 'node:path';

export async function checkWorkshopLayout(desktop, page, output) {
  const original = await desktop.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.isResizable());
    if (win.isMaximized()) win.unmaximize();
    return win.getContentSize();
  });
  const results = [];
  const actualViewports = new Set();
  try {
    // Windows clamps requested content sizes to the active display work area.
    // Sample the resulting viewport instead of waiting for an impossible exact size.
    for (const [requestedWidth, requestedHeight] of [[1220, 850], [980, 700], [1120, 800]]) {
      const nativeSize = await desktop.evaluate(({ BrowserWindow }, [width, height]) => {
        const win = BrowserWindow.getAllWindows().find(win => win.isResizable());
        win.setContentSize(width, height);
        return win.getContentSize();
      }, [requestedWidth, requestedHeight]);
      await page.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height, nativeSize);
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      const { width, height } = viewport;
      assert.ok(width >= 980 && height >= 700, 'Workshop viewport fell below the supported window minimum');
      actualViewports.add(`${width}x${height}`);
      const sidebar = page.locator('.detail-column');
      await sidebar.evaluate(el => { el.scrollTop = 0; });
      const before = await page.locator('.preview-stage').boundingBox();
      const geometry = await sidebar.evaluate(el => { const rect = el.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height, viewportHeight: innerHeight, contentHeight: el.scrollHeight, clientHeight: el.clientHeight }; });
      assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.viewportHeight + 1, 'Settings panel exceeds viewport');
      assert.ok(geometry.height > 250 && geometry.contentHeight > geometry.clientHeight, 'Settings must have their own scrolling area');
      await sidebar.evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.ok(await sidebar.evaluate(el => el.scrollTop > 0));
      const after = await page.locator('.preview-stage').boundingBox();
      assert.ok(Math.abs(before.y - after.y) < 1 && Math.abs(before.height - after.height) < 1, 'Settings scroll moved the preview');
      assert.ok(after.y >= 0 && after.y + after.height <= height, 'Preview left the viewport');
      const document = await page.evaluate(() => ({ scrollY, height: document.scrollingElement.scrollHeight, viewport: innerHeight }));
      assert.equal(document.scrollY, 0); assert.ok(document.height <= document.viewport + 1, 'Whole workshop should not scroll vertically');
      const box = await sidebar.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 700);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => scrollY), 0, 'Wheel at panel end leaked to the page');
      await page.screenshot({ path: path.join(output, `workshop-sidebar-${requestedWidth}x${requestedHeight}.png`) });
      results.push({ requestedWidth, requestedHeight, actualWidth: width, actualHeight: height, geometry, previewFixed: true, documentScrollY: 0 });
    }
    assert.ok(actualViewports.size >= 2, 'Smoke must exercise at least two distinct actual viewports');
  } finally {
    await desktop.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows().find(win => win.isResizable()).setContentSize(width, height), original);
    await page.locator('.detail-column').evaluate(el => { el.scrollTop = 0; });
  }
  return results;
}
