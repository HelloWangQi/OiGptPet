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
  const safeStorage = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async text => Buffer.from('cipher:' + text), decryptStringAsync: async bytes => ({ result: bytes.toString().slice(7), shouldReEncrypt: false }) };
  const fetch = vi.fn(async () => answer('你好'));
  const config = { file, fs, safeStorage, fetch, onState: state => states.push(state), ...options };
  const service = chatModule.createChatService(config); await service.load();
  return { service, file, states, fetch, config };
}
async function configured(options) { const f = await fixture(options); await f.service.save({ model: 'test-model', apiKey: 'not-a-real-api-key' }); return f; }
describe('text companion service', () => {
  it('checks saved configuration locally without requests, state changes or secret return values', async () => {
    const empty = await fixture(); expect(await empty.service.check()).toEqual({ ready: false, code: 'missing_model' });
    const f = await configured(); await f.service.send('保留的会话'); f.fetch.mockClear();
    const before = f.service.snapshot(); const disk = await fs.readFile(f.file, 'utf8');
    expect(await f.service.check()).toEqual({ ready: true, code: 'ready' });
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.service.snapshot()).toEqual(before); expect(await fs.readFile(f.file, 'utf8')).toBe(disk);
    await f.service.save({ model: 'test-model', forgetKey: true });
    expect(await f.service.check()).toEqual({ ready: false, code: 'missing_key' });
  });
  it('separates unavailable storage and unreadable keys, and does not disclose native errors', async () => {
    const f = await configured(); f.config.safeStorage.isAsyncEncryptionAvailable = async () => false;
    expect((await f.service.check()).code).toBe('unavailable');
    f.config.safeStorage.isAsyncEncryptionAvailable = async () => true;
    f.config.safeStorage.decryptStringAsync = async () => { throw new Error('private native details'); };
    expect(await f.service.check()).toEqual({ ready: false, code: 'unreadable_key' });
    expect((await f.service.send('hello')).error).toContain('无法解密');
    expect(JSON.stringify(f.service.snapshot())).not.toContain('private native'); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('does not pass a malformed saved model just because its ciphertext can be read', async () => {
    const f = await configured(); const data = JSON.parse(await fs.readFile(f.file, 'utf8')); data.model = 'invalid model!';
    await fs.writeFile(f.file, JSON.stringify(data)); await f.service.load();
    expect((await f.service.check()).code).toBe('invalid_model'); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('bounds a stalled local check, excludes concurrent mutations and supports cancellation', async () => {
    const f = await configured({ checkTimeoutMs: 20 });
    f.config.safeStorage.decryptStringAsync = () => new Promise(() => {});
    const pending = f.service.check();
    expect((await f.service.check()).code).toBe('busy');
    await expect(f.service.save({ model: 'other' })).rejects.toThrow('本地检查');
    await expect(f.service.send('hello')).rejects.toThrow('等待');
    expect((await pending).code).toBe('timeout');
    const cancelled = f.service.check(); f.service.cancel(); expect((await cancelled).code).toBe('cancelled');
    f.config.safeStorage.decryptStringAsync = async () => ({ result: 'restored-test-key', shouldReEncrypt: false });
    expect((await f.service.check()).ready).toBe(true); expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([
    [401, {}, '认证失败'], [403, {}, '拒绝访问'], [404, {}, '模型或资源'],
    [429, { code: 'credit_balance_exhausted' }, '额度或限额不足'],
    [429, { code: 'project_spend_limit_exceeded', type: 'insufficient_quota' }, '额度或限额不足'],
    [429, { code: 'slow_down', type: 'rate_limit_error' }, '过于频繁'],
    [429, { code: 'unknown' }, '请求受限'], [503, {}, '暂时异常'],
    [400, { code: 'model_not_found' }, '模型或资源'], [400, {}, '未接受请求'],
  ])('classifies HTTP %i safely without automatic retry', async (status, error, hint) => {
    const f = await configured({ fetch: vi.fn(async () => new Response(JSON.stringify({ error: { ...error, message: 'secret-upstream-body' } }), { status })) });
    const result = await f.service.send('test'); expect(result.error).toContain(hint); expect(result.error).toContain('HTTP ' + status);
    expect(f.config.fetch).toHaveBeenCalledTimes(1); expect(f.service.snapshot().history).toEqual([]);
    expect(JSON.stringify(f.service.snapshot())).not.toContain('secret-upstream');
  });
  it('caps error bodies and disposes oversized upstream data instead of copying it to the UI', async () => {
    const cancel = vi.fn();
    const f = await configured({ fetch: async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: { code: 'insufficient_quota', message: 'private'.repeat(2000) } })));
    }, cancel }), { status: 429 }) });
    expect((await f.service.send('hi')).error).toContain('请求受限'); expect(cancel).toHaveBeenCalled();
    expect(JSON.stringify(f.service.snapshot())).not.toContain('private');
  });
  it('can cancel waiting for a stalled HTTP error body without retaining failure context', async () => {
    const cancel = vi.fn(); const f = await configured({ fetch: vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 429 })) });
    const pending = f.service.send('cancel error body'); await vi.waitFor(() => expect(f.config.fetch).toHaveBeenCalled());
    f.service.cancel(); expect(await pending).toEqual({ cancelled: true });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled()); expect(f.service.snapshot().history).toEqual([]);
  });
  it('requires explicit configuration and bounds user messages', async () => {
    const f = await fixture();
    await expect(f.service.send('hello')).rejects.toThrow('请先保存');
    for (const text of ['', ' ', 'x'.repeat(2001), {}]) await expect(f.service.send(text)).rejects.toThrow('消息长度');
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([false, true])('uses the native decryption result for Authorization (rotation hint %s)', async shouldReEncrypt => {
    const f = await configured();
    f.config.safeStorage.decryptStringAsync = async () => ({ result: 'native-test-key', shouldReEncrypt });
    await f.service.send('hello');
    expect(f.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer native-test-key');
    expect(JSON.stringify(f.service.snapshot())).not.toContain('native-test-key');
  });
  it.each([undefined, 'old-return-shape', { result: '' }, { result: 'invalid key' }, { result: 'x'.repeat(513) }])('rejects an unusable native decryption return value', async value => {
    const f = await configured(); f.config.safeStorage.decryptStringAsync = async () => value;
    expect((await f.service.check()).code).toBe('unreadable_key');
    expect((await f.service.send('hello')).error).toContain('无法解密'); expect(f.fetch).not.toHaveBeenCalled();
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
    expect(body.stream).toBe(true);
    expect(f.states.at(-1)).toMatchObject({ status: 'reply', text: '你好' });
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
  it('settles cancellation even when a network adapter ignores AbortSignal, and closes its late body', async () => {
    let resolve; const fetch = vi.fn(() => new Promise(done => { resolve = done; }));
    const f = await configured({ fetch }); const pending = f.service.send('cancel');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    f.service.cancel();
    expect(await pending).toEqual({ cancelled: true });
    const close = vi.fn(); const response = new Response(new ReadableStream({ cancel: close }));
    resolve(response); await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(f.states.some(state => state.status === 'reply')).toBe(false);
  });
  it('times out stalled native decryption without making a request', async () => {
    const f = await configured({ timeoutMs: 20 });
    f.config.safeStorage.decryptStringAsync = () => new Promise(() => {});
    expect((await f.service.send('timeout')).error).toContain('超时');
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('can cancel a response stream and allow another request', async () => {
    const cancel = vi.fn();
    const f = await configured({ fetch: vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ cancel }))).mockImplementation(async () => answer('新回复')) });
    const pending = f.service.send('waiting');
    await vi.waitFor(() => expect(f.config.fetch).toHaveBeenCalled());
    f.service.cancel(); expect(await pending).toEqual({ cancelled: true });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
    expect(await f.service.send('new')).toEqual({ text: '新回复' });
  });
  it('removes an existing key even with invalid unsaved fields and unavailable encryption', async () => {
    const f = await configured(); f.config.safeStorage.isAsyncEncryptionAvailable = () => { throw new Error('unavailable'); };
    expect(await f.service.save({ model: 'invalid model!', apiKey: 'invalid key\n', forgetKey: true }))
      .toEqual({ model: 'test-model', hasKey: false, encryptionAvailable: false });
    expect(JSON.parse(await fs.readFile(f.file, 'utf8')).key).toBe('');
  });
  it('does not query native encryption availability again after committing settings', async () => {
    const f = await fixture();
    f.config.safeStorage.isAsyncEncryptionAvailable = vi.fn().mockResolvedValueOnce(true).mockRejectedValue(new Error('native closed'));
    expect(await f.service.save({ model: 'test-model', apiKey: 'test-key' })).toEqual({ model: 'test-model', hasKey: true, encryptionAvailable: true });
    expect(f.config.safeStorage.isAsyncEncryptionAvailable).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fs.readFile(f.file, 'utf8')).model).toBe('test-model');
  });
  it('a destroyed event consumer cannot turn a committed save into a reported failure', async () => {
    const f = await fixture({ onState: () => { throw new Error('window closed'); } });
    expect((await f.service.save({ model: 'test-model', apiKey: 'test-key' })).hasKey).toBe(true);
    expect(await f.service.send('hi')).toEqual({ text: '你好' });
  });
  it('streams correlated partial text but only stores the completed response', async () => {
    const frame = value => 'data: ' + JSON.stringify(value) + '\n\n';
    const source = frame({ type: 'response.output_text.delta', delta: '草稿', output_index: 0, content_index: 0 })
      + frame({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '最终回复' }] }] } });
    const f = await configured({ fetch: vi.fn().mockResolvedValueOnce(new Response(source, { headers: { 'content-type': 'text/event-stream' } })).mockImplementation(async () => answer('next')) });
    const requestId = '12345678-1234-1234-1234-123456789abc';
    expect(await f.service.send('hi', requestId)).toEqual({ text: '最终回复' });
    expect(f.states).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'streaming', text: '草稿', requestId })]));
    expect(f.states.at(-1)).toMatchObject({ status: 'reply', text: '最终回复', requestId });
    await f.service.send('next'); const input = JSON.parse(f.config.fetch.mock.calls[1][1].body).input;
    expect(input[1].content).toBe('最终回复'); expect(JSON.stringify(input)).not.toContain('草稿');
    await expect(f.service.send('bad id', 'not-a-valid-id')).rejects.toThrow('标识');
  });
  it('cancels pending progress notifications and never stores an interrupted partial', async () => {
    let controller;
    const f = await configured({ fetch: vi.fn().mockImplementationOnce(async () => new Response(new ReadableStream({ start(value) { controller = value; } }), { headers: { 'content-type': 'text/event-stream' } })).mockImplementation(async () => answer('new reply')) });
    const pending = f.service.send('cancel me');
    await vi.waitFor(() => expect(controller).toBeTruthy());
    controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"first","output_index":0,"content_index":0}\n\n'));
    await vi.waitFor(() => expect(f.states.some(state => state.status === 'streaming')).toBe(true));
    controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":" second","output_index":0,"content_index":0}\n\n'));
    f.service.clear(); expect(await pending).toEqual({ cancelled: true });
    const count = f.states.length; await new Promise(resolve => setTimeout(resolve, 70)); expect(f.states).toHaveLength(count);
    await f.service.send('new'); expect(JSON.parse(f.config.fetch.mock.calls[1][1].body).input).toHaveLength(1);
  });
  it('returns bounded copies of session history without key configuration', async () => {
    const f = await configured(); for (let i = 0; i < 6; i++) await f.service.send('私密问题' + i);
    const snapshot = f.service.snapshot(); expect(snapshot.history).toHaveLength(8); expect(snapshot.attempt).toBeNull();
    expect(snapshot.history[0].content).toBe('私密问题2');
    expect(JSON.stringify(snapshot)).not.toContain('not-a-real-api-key'); expect('config' in snapshot).toBe(false);
    snapshot.history[0].content = 'mutated'; snapshot.state.text = 'mutated';
    expect(f.service.snapshot().history[0].content).toBe('私密问题2'); expect(f.service.getState().text).toBe('你好');
    expect(JSON.stringify(f.service.getState())).not.toContain('私密问题');
    expect(await fs.readFile(f.file, 'utf8')).not.toContain('私密问题');
  });
  it('keeps successful history and a cancelled partial available for window reopening', async () => {
    const f = await configured(); await f.service.send('成功消息');
    let controller;
    f.config.fetch.mockImplementationOnce(async () => new Response(new ReadableStream({ start(value) { controller = value; } }), { headers: { 'content-type': 'text/event-stream' } }));
    const pending = f.service.send('待恢复消息'); await vi.waitFor(() => expect(controller).toBeTruthy());
    controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"可见片段","output_index":0,"content_index":0}\n\n'));
    await vi.waitFor(() => expect(f.service.snapshot().attempt.partial).toBe('可见片段'));
    f.service.cancel(); expect(await pending).toEqual({ cancelled: true });
    const restored = f.service.snapshot(); expect(restored.history).toHaveLength(2);
    expect(restored.attempt).toMatchObject({ text: '待恢复消息', partial: '可见片段', status: 'cancelled' });
    restored.attempt.text = 'mutated'; expect(f.service.snapshot().attempt.text).toBe('待恢复消息');
    await f.service.send('重试消息');
    const input = JSON.parse(f.fetch.mock.calls.at(-1)[1].body).input;
    expect(input).toHaveLength(3); expect(JSON.stringify(input)).not.toContain('待恢复消息');
  });
  it('clears history, retry state and displayed text explicitly, and after settings save', async () => {
    const f = await configured(); await f.service.send('旧消息');
    f.service.clear(); expect(f.service.snapshot()).toMatchObject({ history: [], attempt: null, state: { status: 'cleared' } });
    expect(f.service.getState().text).toBeUndefined();
    await f.service.send('新消息'); await f.service.save({ model: 'new-model' });
    expect(f.service.snapshot().history).toEqual([]); expect(f.service.snapshot().attempt).toBeNull();
  });
  it('retains retryable failures with increasing event sequences', async () => {
    const f = await configured({ fetch: async () => new Response('secret server content', { status: 429 }) });
    await f.service.send('失败消息'); const snapshot = f.service.snapshot();
    expect(snapshot.attempt).toMatchObject({ text: '失败消息', status: 'error' });
    expect(snapshot.attempt.error).toContain('HTTP 429'); expect(snapshot.history).toEqual([]);
    expect(snapshot.sequence).toBe(snapshot.state.sequence);
    expect(f.states.map(state => state.sequence)).toEqual(f.states.map((_state, i) => i + 1));
    expect(JSON.stringify(snapshot)).not.toContain('secret server');
  });
  it('does not restore in-memory conversations from the settings file after process restart', async () => {
    const f = await configured(); await f.service.send('内存记录');
    const restarted = chatModule.createChatService(f.config); await restarted.load();
    expect((await restarted.get()).hasKey).toBe(true);
    expect(restarted.snapshot()).toMatchObject({ sequence: 0, history: [], attempt: null, state: { status: 'idle' } });
  });
  it('cannot mutate authoritative state through an event consumer', async () => {
    const f = await configured({ onState: state => { state.text = 'mutated'; state.sequence = -1; } });
    await f.service.send('hello'); expect(f.service.getState()).toMatchObject({ text: '你好', status: 'reply' });
    expect(f.service.getState().sequence).toBeGreaterThan(0);
  });
});
