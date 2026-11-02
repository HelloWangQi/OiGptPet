import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
export async function checkChat(desktop, page, pet) {
  const file = await desktop.evaluate(({ app }) => {
    globalThis.__chatOriginalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (url !== 'https://api.openai.com/v1/responses' || JSON.parse(options.body).store !== false) throw new Error('Unexpected request');
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '你好，桌宠！<img src=x>' }] }] }));
    };
    return app.getPath('userData') + '/chat-settings.json';
  });
  try {
    await page.locator('.chat-panel details summary').click();
    assert.equal(await page.locator('#chat-send').isDisabled(), true);
    await page.locator('#chat-model').fill('test-model'); await page.locator('#chat-key').fill('smoke-key-not-real');
    await page.locator('#chat-save').click();
    await page.waitForFunction(() => document.querySelector('#chat-status').textContent.includes('配置已保存'));
    assert.equal(await page.locator('#chat-key').inputValue(), '');
    assert.equal((await readFile(file, 'utf8')).includes('smoke-key-not-real'), false);
    const settings = await page.evaluate(() => window.petDesktop.getChatSettings()); assert.equal('apiKey' in settings, false); assert.equal('key' in settings, false);
    await page.locator('#chat-input').fill('你好'); await page.locator('#chat-send').click();
    await page.waitForFunction(() => document.querySelector('#chat-log').textContent.includes('你好，桌宠！'));
    assert.equal(await page.locator('#chat-log img').count(), 0);
    await pet.waitForFunction(() => document.querySelector('#pet-message').textContent.includes('你好，桌宠！'), undefined, { polling: 100 });
    await assert.rejects(pet.evaluate(() => window.petDesktop.sendChat('越权')), /Only the workshop/);
    const count = await page.locator('#chat-log p').count();
    await page.locator('#chat-input').fill('输入法草稿');
    await page.locator('#chat-input').evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true })));
    assert.equal(await page.locator('#chat-log p').count(), count);
    await desktop.evaluate(() => { globalThis.fetch = async () => new Response('private-error-body', { status: 429 }); });
    await page.locator('#chat-input').fill('失败草稿'); await page.locator('#chat-input').press('Control+Enter');
    await page.waitForFunction(() => document.querySelector('#chat-status').textContent.includes('HTTP 429'));
    assert.equal(await page.locator('#chat-input').inputValue(), '失败草稿');
    assert.equal(await page.locator('#chat-log [data-delivery="failed"]').count(), 1);
    await desktop.evaluate(() => { globalThis.fetch = async (_url, options) => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '重试成功：' + JSON.parse(options.body).input.at(-1).content }] }] })); });
    await page.locator('#chat-input').fill('后续草稿'); await page.locator('#chat-retry').click();
    await page.waitForFunction(() => document.querySelector('#chat-log').textContent.includes('重试成功：失败草稿'));
    assert.equal(await page.locator('#chat-input').inputValue(), '后续草稿');
    assert.equal(await page.locator('#chat-log [data-delivery="failed"]').count(), 0);
    assert.equal(await page.locator('#chat-log [data-delivery]').filter({ hasText: '失败草稿' }).count(), 1);
    await desktop.evaluate(() => { globalThis.fetch = () => new Promise(resolve => { globalThis.__chatLateReply = resolve; }); });
    await page.locator('#chat-input').fill('待取消'); await page.locator('#chat-send').click();
    await page.locator('#chat-input').fill('取消期间的新草稿');
    await page.locator('#chat-cancel').click();
    await page.waitForFunction(() => document.querySelector('#chat-status').textContent.includes('已取消'));
    assert.equal(await page.locator('#chat-input').inputValue(), '取消期间的新草稿');
    await page.locator('#chat-clear').click(); await page.waitForFunction(() => document.querySelector('#chat-log').children.length === 0);
    assert.equal(await page.locator('#chat-retry').isHidden(), true);
    await desktop.evaluate(() => { globalThis.__chatLateReply?.(new Response('late ignored response')); delete globalThis.__chatLateReply; });
    await page.locator('#chat-model').fill('invalid model!'); await page.locator('#chat-forget').click();
    await page.waitForFunction(() => document.querySelector('#chat-status').textContent.includes('请设置'));
    assert.equal(await page.locator('#chat-model').inputValue(), 'test-model');
    assert.equal(await page.locator('#chat-send').isDisabled(), true);
    assert.equal((await page.evaluate(() => window.petDesktop.getChatSettings())).hasKey, false);
    await page.locator('#chat-key').fill('smoke-key-not-real'); await page.locator('#chat-save').click();
    await page.waitForFunction(() => document.querySelector('#chat-status').textContent.includes('配置已保存'));
  } finally { await desktop.evaluate(() => { globalThis.fetch = globalThis.__chatOriginalFetch; delete globalThis.__chatOriginalFetch; }); }
}
