function responseText(data) {
  if (data?.status !== 'completed' || !Array.isArray(data.output)) throw new Error('服务未完成回复，请重试。');
  const text = data.output.filter(item => item?.type === 'message').flatMap(item => Array.isArray(item.content) ? item.content : [])
    .filter(item => item?.type === 'output_text' && typeof item.text === 'string').map(item => item.text).join('\n').trim();
  if (!text || text.length > 8000) throw new Error('服务未返回有效文本。');
  return text;
}

function createResponseStream(onText = () => {}) {
  let buffer = ''; let data = []; let completed = false; let finalText; const parts = new Map();
  const dispatch = () => {
    if (!data.length) return;
    const json = data.join('\n'); data = [];
    if (json === '[DONE]') return;
    let event;
    try { event = JSON.parse(json); } catch { throw new Error('服务流式回复格式无效。'); }
    if (!event || typeof event.type !== 'string') throw new Error('服务流式回复事件无效。');
    if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) throw new Error('服务未完成流式回复，请重试。');
    if (event.type === 'response.completed') { finalText = responseText(event.response); completed = true; return; }
    if (event.type !== 'response.output_text.delta') return;
    if (typeof event.delta !== 'string' || !Number.isInteger(event.output_index) || !Number.isInteger(event.content_index)
      || event.output_index < 0 || event.content_index < 0 || event.output_index > 128 || event.content_index > 128) throw new Error('服务流式文本事件无效。');
    const key = `${event.output_index}:${event.content_index}`;
    if (!parts.has(key) && parts.size >= 64) throw new Error('服务流式文本段数过多。');
    parts.set(key, { output: event.output_index, content: event.content_index, text: (parts.get(key)?.text ?? '') + event.delta });
    const text = [...parts.values()].sort((a, b) => a.output - b.output || a.content - b.content).map(part => part.text).join('\n');
    if (text.length > 8000) throw new Error('服务回复超过文本限制。');
    if (text) onText(text);
  };
  const drain = final => {
    while (!completed) {
      const index = buffer.search(/[\r\n]/); if (index < 0) return;
      if (!final && buffer[index] === '\r' && index === buffer.length - 1) return;
      const line = buffer.slice(0, index);
      const count = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
      buffer = buffer.slice(index + count);
      if (!line) dispatch();
      else if (line === 'data') data.push('');
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      // Comments and other SSE fields (event/id/retry) do not contain output.
    }
    buffer = ''; data = [];
  };
  return {
    push(text) { if (!completed) { buffer += text; drain(false); } },
    finish() { drain(true); if (!completed) throw new Error('服务连接在回复完成前中断，请重试。'); return finalText; },
    get completed() { return completed; },
    get text() { return finalText; },
  };
}

async function readResponseText(response, { signal, wait, onText }) {
  const reader = response.body.getReader(); let size = 0;
  const streaming = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === 'text/event-stream';
  const parser = streaming ? createResponseStream(onText) : null;
  const decoder = new TextDecoder('utf-8', { fatal: true }); const chunks = [];
  const cancelReader = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancelReader, { once: true });
  try {
    while (true) {
      const { done, value } = await wait(() => reader.read(), signal);
      if (done) break;
      size += value.length;
      if (size > 256 * 1024) throw new Error('服务回复超过大小限制。');
      const text = decoder.decode(value, { stream: true });
      if (parser) { parser.push(text); if (parser.completed) return parser.text; }
      else chunks.push(text);
    }
    const tail = decoder.decode();
    if (parser) { parser.push(tail); return parser.finish(); }
    chunks.push(tail); return responseText(JSON.parse(chunks.join('')));
  } finally { signal.removeEventListener('abort', cancelReader); cancelReader(); reader.releaseLock(); }
}
module.exports = { createResponseStream, readResponseText };
