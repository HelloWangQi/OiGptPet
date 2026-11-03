import assert from 'node:assert/strict';

export async function checkChatRestore(desktop, page, pet, errors) {
  await desktop.evaluate(() => {
    globalThis.__restoreOriginalFetch = globalThis.fetch; globalThis.__restoreRequestCount = 0;
    globalThis.fetch = async () => { globalThis.__restoreRequestCount++; return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '保留的完整回复' }] }] })); };
  });
  const attach = target => target.on('pageerror', error => errors.push(error.message));
  const waitReady = target => target.waitForFunction(() => document.body.dataset.characterKind === 'sprite' && !document.querySelector('#chat-model').disabled);
  try {
    await page.locator('#chat-input').fill('保留的消息'); await page.locator('#chat-send').click();
    await page.waitForFunction(() => document.querySelector('#chat-log').textContent.includes('保留的完整回复'));
    await page.locator('#chat-input').fill('未发送草稿');
    await page.reload(); await waitReady(page);
    assert.equal(await page.locator('#chat-log p').count(), 2);
    assert.match(await page.locator('#chat-log').textContent(), /保留的消息/);
    assert.equal(await page.locator('#chat-input').inputValue(), '');
    const closing = page.waitForEvent('close');
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.isResizable()).close()); await closing;
    const opening = desktop.waitForEvent('window'); await pet.evaluate(() => window.petDesktop.openWorkshop()); page = await opening; attach(page);
    await waitReady(page); assert.equal(await page.locator('#chat-log p').count(), 2);
    assert.equal(await desktop.evaluate(() => globalThis.__restoreRequestCount), 1, 'reopening must not issue another paid request');
    await assert.rejects(pet.evaluate(() => window.petDesktop.getChatSnapshot()), /Only the workshop/);
    const state = await pet.evaluate(() => window.petDesktop.getChatState());
    assert.equal('history' in state, false); assert.equal('attempt' in state, false); assert.equal('key' in state, false);
    const petClosing = pet.waitForEvent('close');
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.isResizable()).close()); await petClosing;
    await desktop.evaluate(() => {
      globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
        globalThis.__restoreStream = controller;
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"逐步恢复","output_index":0,"content_index":0}\n\n'));
      } }), { headers: { 'content-type': 'text/event-stream' } });
    });
    await page.locator('#chat-input').fill('打开桌宠时恢复'); await page.locator('#chat-send').click();
    await page.waitForFunction(() => document.querySelector('#chat-log [data-reply-state="partial"]')?.textContent.includes('逐步恢复'));
    const petOpening = desktop.waitForEvent('window'); await page.locator('#open-pet').click(); pet = await petOpening; attach(pet);
    await pet.waitForFunction(() => document.body.dataset.characterKind === 'sprite' && document.querySelector('#pet-message').textContent === '逐步恢复');
    await pet.reload();
    await pet.waitForFunction(() => document.body.dataset.characterKind === 'sprite' && document.querySelector('#pet-message').textContent === '逐步恢复');
    await desktop.evaluate(() => {
      const response = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '逐步恢复完成' }] }] };
      globalThis.__restoreStream.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ type: 'response.completed', response }) + '\n\n'));
      globalThis.__restoreStream.close(); delete globalThis.__restoreStream;
    });
    await page.waitForFunction(() => document.querySelector('#chat-status').textContent.includes('回复完成'));
    await pet.waitForFunction(() => document.querySelector('#pet-message').textContent === '逐步恢复完成');
    assert.equal(await page.locator('#chat-log p').count(), 4);
    const snapshot = await page.evaluate(() => window.petDesktop.getChatSnapshot());
    await desktop.evaluate(({ BrowserWindow }, sequence) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('chat:state', { sequence: sequence - 1, status: 'streaming', text: '过期文本', requestId: 'obsolete' });
    }, snapshot.sequence);
    await page.waitForTimeout(100);
    assert.equal((await page.locator('#chat-log').textContent()).includes('过期文本'), false);
    assert.equal(await pet.locator('#pet-message').textContent(), '逐步恢复完成');
    await desktop.evaluate(() => { globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
      globalThis.__restoreStream = controller;
      controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"关闭前片段","output_index":0,"content_index":0}\n\n'));
    } }), { headers: { 'content-type': 'text/event-stream' } }); });
    await page.locator('#chat-input').fill('取消恢复消息'); await page.locator('#chat-send').click();
    await page.waitForFunction(() => document.querySelector('#chat-log [data-reply-state="partial"]')?.textContent.includes('关闭前片段'));
    await page.reload(); await waitReady(page);
    assert.equal(await page.locator('#chat-input').inputValue(), '取消恢复消息');
    assert.equal(await page.locator('#chat-log [data-reply-state="incomplete"]').count(), 1);
    assert.equal(await page.locator('#chat-retry').isEnabled(), true);
    assert.equal((await page.evaluate(() => window.petDesktop.getChatSnapshot())).history.length, 4);
    await desktop.evaluate(() => {
      globalThis.__restoreStream.error(new Error('late after reload')); delete globalThis.__restoreStream;
      globalThis.fetch = async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '重新打开后重试成功' }] }] }));
    });
    await page.locator('#chat-input').fill('另一个草稿'); await page.locator('#chat-retry').click();
    await page.waitForFunction(() => document.querySelector('#chat-log').textContent.includes('重新打开后重试成功'));
    assert.equal(await page.locator('#chat-log [data-reply-state="incomplete"]').count(), 0);
    assert.equal(await page.locator('#chat-input').inputValue(), '另一个草稿');
    await page.locator('#chat-clear').click(); await page.reload(); await waitReady(page);
    assert.equal(await page.locator('#chat-log p').count(), 0);
    assert.equal((await page.evaluate(() => window.petDesktop.getChatSnapshot())).attempt, null);
    await page.locator('#chat-input').fill('退出后不应恢复'); await page.locator('#chat-send').click();
    await page.waitForFunction(() => document.querySelector('#chat-status').textContent.includes('回复完成'));
    return { page, pet };
  } finally {
    await desktop.evaluate(() => { try { globalThis.__restoreStream?.error(new Error('cleanup')); } catch {} delete globalThis.__restoreStream;
      globalThis.fetch = globalThis.__restoreOriginalFetch; delete globalThis.__restoreOriginalFetch; delete globalThis.__restoreRequestCount; });
  }
}
