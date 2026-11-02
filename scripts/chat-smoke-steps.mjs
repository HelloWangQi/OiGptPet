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
    await desktop.evaluate(() => { globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))); });
    await page.locator('#chat-input').fill('待取消'); await page.locator('#chat-send').click();
    await page.locator('#chat-cancel').click();
    await page.waitForFunction(() => document.querySelector('#chat-status').textContent.includes('已取消'));
    await page.locator('#chat-clear').click(); await page.waitForFunction(() => document.querySelector('#chat-log').children.length === 0);
  } finally { await desktop.evaluate(() => { globalThis.fetch = globalThis.__chatOriginalFetch; delete globalThis.__chatOriginalFetch; }); }
}
