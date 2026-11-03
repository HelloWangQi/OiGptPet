import { describe, expect, it, vi } from 'vitest';
import streams from '../electron/response-stream.cjs';
const delta = (text, output_index = 0, content_index = 0) => ({ type: 'response.output_text.delta', delta: text, output_index, content_index });
const completed = text => ({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] } });
const event = (data, newline = '\n') => `data: ${JSON.stringify(data)}${newline}${newline}`;
const options = onText => ({ signal: new AbortController().signal, wait: action => action(), onText });
describe('Responses SSE boundaries', () => {
  it.each(['\n', '\r\n', '\r'])('handles fragmented line endings %j and ordered text parts', newline => {
    const seen = []; const parser = streams.createResponseStream(text => seen.push(text));
    const source = ': heartbeat' + newline + newline + event(delta('后', 1), newline) + event(delta('前', 0), newline) + event(completed('最终文本'), newline);
    for (const char of source) parser.push(char);
    expect(seen).toEqual(['后', '前\n后']); expect(parser.finish()).toBe('最终文本');
  });
  it('decodes Chinese and emoji across individual UTF-8 bytes and strips an initial BOM', async () => {
    const text = '\uFEFF' + event(delta('你好🙂')) + event(completed('你好🙂'));
    const bytes = new TextEncoder().encode(text); const seen = [];
    const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
    expect(await streams.readResponseText(response, options(text => seen.push(text)))).toBe('你好🙂');
    expect(seen).toEqual(['你好🙂']);
  });
  it('supports multi-line data and ignores metadata, comments and reasoning events', () => {
    const seen = vi.fn(); const parser = streams.createResponseStream(seen);
    parser.push(': comment\n\nevent: response.reasoning_text.delta\ndata: {"type":"response.reasoning_text.delta","delta":"private reasoning"}\n\n');
    parser.push(JSON.stringify(completed('ok'), null, 2).split('\n').map(line => 'data: ' + line).join('\n') + '\n\n');
    expect(parser.finish()).toBe('ok'); expect(seen).not.toHaveBeenCalled();
  });
  it.each([event(delta('partial')), event({ type: 'response.output_text.done', text: 'done text' }), 'data: [DONE]\n\n', 'data: ' + JSON.stringify(completed('unterminated'))])('requires a terminated completed event', source => {
    const parser = streams.createResponseStream(); parser.push(source); expect(() => parser.finish()).toThrow('完成前中断');
  });
  it.each(['error', 'response.failed', 'response.incomplete'])('does not expose raw %s errors', type => {
    const parser = streams.createResponseStream();
    expect(() => parser.push(event({ type, message: 'secret upstream body' }))).toThrow('服务未完成流式回复');
  });
  it.each([
    'data: private invalid JSON\n\n', event({ type: 'response.output_text.delta', delta: 'x', output_index: -1, content_index: 0 }),
    event({ type: 'response.output_text.delta', delta: 'x', output_index: 0 }), event(completed('')), event(delta('x'.repeat(8001))),
  ])('rejects malformed or excessive content', source => {
    expect(() => streams.createResponseStream().push(source)).toThrow(/^服务/);
  });
  it('stops on completion and cancels a transport that stays open', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(event(completed('ok')))); }, cancel }), { headers: { 'content-type': 'text/event-stream' } });
    expect(await streams.readResponseText(response, options())).toBe('ok'); expect(cancel).toHaveBeenCalled();
  });
  it('enforces a total encoded byte limit including comments', async () => {
    const response = new Response(': ' + 'x'.repeat(256 * 1024), { headers: { 'content-type': 'text/event-stream' } });
    await expect(streams.readResponseText(response, options())).rejects.toThrow('大小限制');
  });
  it('rejects invalid UTF-8 rather than displaying replacement characters', async () => {
    const response = new Response(Uint8Array.of(0xff), { headers: { 'content-type': 'text/event-stream' } });
    await expect(streams.readResponseText(response, options())).rejects.toThrow();
  });
});
