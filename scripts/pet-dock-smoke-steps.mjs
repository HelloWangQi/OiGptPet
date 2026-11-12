import assert from 'node:assert/strict';

const petWindowBounds = desktop => desktop.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().find(win => !win.isResizable()).getBounds());

async function waitForMain(desktop, predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await desktop.evaluate(predicate)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(await desktop.evaluate(predicate), true, 'Expected Electron main-process state did not arrive in time');
}

export async function checkPetDock(desktop, page, pet) {
  const dockRect = await pet.locator('#pet-controls').evaluate(element => element.getBoundingClientRect().toJSON());
  await pet.mouse.move(dockRect.left + dockRect.width / 2, dockRect.top + dockRect.height / 2);
  await pet.locator('#pet-controls').waitFor({ state: 'visible' });
  await pet.evaluate(() => {
    globalThis.__dockClicks = [];
    globalThis.__dockCaptureListeners = [];
    for (const id of ['pet-wave', 'pet-chat-toggle', 'pet-tools-toggle', 'workshop-button', 'click-through', 'hide-pet', 'pet-quit']) {
      const button = document.getElementById(id);
      if (!button) continue;
      const listener = () => globalThis.__dockClicks.push(id);
      button.addEventListener('click', listener, true);
      globalThis.__dockCaptureListeners.push([button, listener]);
    }
  });
  const initialBounds = await petWindowBounds(desktop);

  await pet.locator('#pet-wave').click();
  assert.equal(await pet.evaluate(() => globalThis.__dockClicks.includes('pet-wave')), true, 'Wave button receives clicks');
  assert.equal(await pet.evaluate(() => document.body.classList.contains('pet-body-dragging')), false, 'Dock clicks do not start a pet drag');

  await pet.locator('#pet-chat-toggle').click();
  await pet.locator('#pet-chat-composer').waitFor({ state: 'visible' });
  await pet.locator('#pet-chat-close').click();
  await pet.locator('#pet-chat-composer').waitFor({ state: 'hidden' });

  await pet.locator('#pet-tools-toggle').click();
  await pet.locator('#pet-tools-panel').waitFor({ state: 'visible' });
  const expandedBounds = await petWindowBounds(desktop);
  assert.ok(expandedBounds.width > initialBounds.width, 'Opening tools expands the native window');
  await pet.locator('#workshop-button').click();
  await pet.locator('#pet-tools-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.petDesktop !== undefined), true, 'Workshop window remains usable');
  await pet.waitForFunction(() => document.querySelector('#pet-tools-panel').hidden);
  await desktop.evaluate(() => new Promise(resolve => setTimeout(resolve, 40)));
  const closedBounds = await petWindowBounds(desktop);
  assert.equal(closedBounds.width, initialBounds.width, 'Closing tools restores the original native window width');

  await desktop.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(candidate => !candidate.isResizable());
    const original = win.setIgnoreMouseEvents;
    globalThis.__dockIgnoreHook = { win, original, calls: [] };
    win.setIgnoreMouseEvents = function (ignore, ...rest) {
      globalThis.__dockIgnoreHook.calls.push(Boolean(ignore));
      return original.call(this, ignore, ...rest);
    };
  });
  await pet.locator('#pet-tools-toggle').click();
  await pet.locator('#click-through').click();
  await pet.waitForFunction(() => window.__dockClicks.includes('click-through'));
  await waitForMain(desktop, () => globalThis.__dockIgnoreHook.calls.includes(true));
  const waveBox = await pet.locator('#pet-wave').boundingBox();
  await pet.mouse.move(waveBox.x + waveBox.width / 2, waveBox.y + waveBox.height / 2);
  await waitForMain(desktop, () => globalThis.__dockIgnoreHook.calls.at(-1) === false);
  await pet.locator('#pet-wave').click();
  assert.equal(await pet.evaluate(() => document.body.classList.contains('pet-body-dragging')), false);

  await pet.locator('#pet-tools-toggle').click();
  await pet.locator('#pet-tools-panel').waitFor({ state: 'hidden' });
  await pet.locator('#pet-tools-toggle').click();
  await pet.locator('#pet-tools-panel').waitFor({ state: 'visible' });
  await pet.locator('#hide-pet').click();
  await waitForMain(desktop, ({ BrowserWindow }) =>
    !BrowserWindow.getAllWindows().find(win => !win.isResizable()).isVisible());
  await pet.evaluate(() => window.petDesktop.openPet());
  await waitForMain(desktop, ({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find(win => !win.isResizable()).isVisible());

  await desktop.evaluate(() => {
    const hook = globalThis.__dockIgnoreHook;
    if (hook) hook.win.setIgnoreMouseEvents = hook.original;
    delete globalThis.__dockIgnoreHook;
  });
  await pet.evaluate(() => {
    for (const [button, listener] of globalThis.__dockCaptureListeners) button.removeEventListener('click', listener, true);
    delete globalThis.__dockCaptureListeners;
    delete globalThis.__dockClicks;
  });
  return { waveClick: true, chatOpenClose: true, toolsExpandRestore: true, workshopButton: true,
    clickThroughReentry: true, hideAndRestore: true, noDragOnDockClick: true };
}

export async function checkPetQuickExit(desktop, pet) {
  const dockRect = await pet.locator('#pet-controls').evaluate(element => element.getBoundingClientRect().toJSON());
  await pet.mouse.move(dockRect.left + dockRect.width / 2, dockRect.top + dockRect.height / 2);
  await pet.locator('#pet-quit').waitFor({ state: 'visible' });
  const exited = new Promise(resolve => desktop.process().once('exit', (code, signal) => resolve({ code, signal })));
  await pet.locator('#pet-quit').click();
  let timer;
  const result = await Promise.race([exited, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Quick exit did not close the packaged application within 10 seconds')), 10000);
  })]).finally(() => clearTimeout(timer));
  assert.equal(result.code, 0, `Quick exit should close cleanly: ${JSON.stringify(result)}`);
  return { quickExit: true, exitCode: result.code };
}
