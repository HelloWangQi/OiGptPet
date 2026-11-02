import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import chatModule from '../electron/chat-service.cjs';
const folders = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => fs.rm(folder, { recursive: true, force: true }))); });
const answer = text => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
async function fixture(options = {}) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'oigptpet-chat-')); folders.push(folder);
  const file = path.join(folder, 'chat.json'); const states = [];
  const safeStorage = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async text => Buffer.from('cipher:' + text), decryptStringAsync: async bytes => bytes.toString().slice(7) };
  const fetch = vi.fn(async () => answer('你好'));
  const config = { file, fs, safeStorage, fetch, onState: state => states.push(state), ...options };
  const service = chatModule.createChatService(config); await service.load();
  return { service, file, states, fetch, config };
}
async function configured(options) { const f = await fixture(options); await f.service.save({ model: 'test-model', apiKey: 'not-a-real-api-key' }); return f; }
describe('text companion service', () => {
  it('requires explicit configuration and bounds user messages', async () => {
    const f = await fixture();
    await expect(f.service.send('hello')).rejects.toThrow('请先保存');
    for (const text of ['', ' ', 'x'.repeat(2001), {}]) await expect(f.service.send(text)).rejects.toThrow('消息长度');
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('returns no key to the renderer, preserves blank keys and supports removal and restart', async () => {
    const f = await configured(); const data = JSON.parse(await fs.readFile(f.file, 'utf8'));
    expect(data.key).not.toBe('not-a-real-api-key');
    expect(await f.service.get()).toEqual({ model: 'test-model', hasKey: true, encryptionAvailable: true });
    await f.service.save({ model: 'new-model', apiKey: '' });
    expect(JSON.parse(await fs.readFile(f.file, 'utf8')).key).toBe(data.key);
    const restarted = chatModule.createChatService(f.config); await restarted.load(); expect((await restarted.get()).hasKey).toBe(true);
    await restarted.save({ model: 'new-model', forgetKey: true }); expect((await restarted.get()).hasKey).toBe(false);
  });
  it('rejects unavailable encryption without writing plaintext', async () => {
    const f = await fixture({ safeStorage: { isAsyncEncryptionAvailable: async () => false } });
    await expect(f.service.save({ model: 'test', apiKey: 'secret' })).rejects.toThrow('系统安全存储');
    await expect(fs.readFile(f.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retains previous settings after replacement failure', async () => {
    const f = await configured(); const before = await fs.readFile(f.file, 'utf8');
    const service = chatModule.createChatService({ ...f.config, fs: { ...fs, rename: async () => { throw new Error('disk full'); } } }); await service.load();
    await expect(service.save({ model: 'other' })).rejects.toThrow('原设置已保留');
    expect(await fs.readFile(f.file, 'utf8')).toBe(before); expect((await service.get()).model).toBe('test-model');
  });
  it('sends bounded successful history only to the fixed official endpoint with store false', async () => {
    const f = await configured();
    for (let i = 0; i < 6; i++) expect(await f.service.send('问题' + i)).toEqual({ text: '你好' });
    const [url, request] = f.fetch.mock.calls.at(-1); const body = JSON.parse(request.body);
    expect(url).toBe('https://api.openai.com/v1/responses'); expect(request.redirect).toBe('error');
    expect(body.store).toBe(false); expect(body.input).toHaveLength(9); expect(body.max_output_tokens).toBe(600);
    expect(f.states.at(-1)).toEqual({ status: 'reply', text: '你好' });
  });
  it('does not show or remember a late reply after clear and permits a new request', async () => {
    let resolve; const f = await configured({ fetch: vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockImplementation(async () => answer('新回复')) });
    const pending = f.service.send('旧消息');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    await expect(f.service.send('重复')).rejects.toThrow('等待');
    f.service.clear(); expect(await f.service.send('新消息')).toEqual({ text: '新回复' });
    resolve(answer('迟到回复')); expect(await pending).toEqual({ cancelled: true });
    expect(f.states.some(state => state.text === '迟到回复')).toBe(false);
  });
  it('sanitizes service errors and allows retry without failed history', async () => {
    const f = await configured({ fetch: vi.fn().mockResolvedValueOnce(new Response('private-token-error', { status: 401 })).mockImplementation(async () => answer('成功')) });
    const failure = await f.service.send('失败'); expect(failure.error).toContain('HTTP 401'); expect(JSON.stringify(f.states)).not.toContain('private-token');
    await f.service.send('重试'); expect(JSON.parse(f.config.fetch.mock.calls.at(-1)[1].body).input).toHaveLength(1);
  });
  it('handles timeout and cancellation', async () => {
    const network = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('abort'))));
    const f = await configured({ fetch: network, timeoutMs: 20 });
    expect((await f.service.send('超时')).error).toContain('超时');
    const pending = f.service.send('取消'); await new Promise(resolve => setTimeout(resolve, 5)); f.service.cancel();
    expect(await pending).toEqual({ cancelled: true });
  });
  it.each([
    { status: 'incomplete', output: [] },
    { status: 'completed', output: [] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'x'.repeat(8001) }] }] },
  ])('rejects unusable output', async data => {
    const f = await configured({ fetch: async () => new Response(JSON.stringify(data)) }); expect((await f.service.send('hi')).error).toBeTruthy();
  });
  it('bounds encoded response bytes', async () => {
    const f = await configured({ fetch: async () => new Response('x'.repeat(256 * 1024 + 1)) });
    expect((await f.service.send('hi')).error).toContain('大小限制');
  });
});
