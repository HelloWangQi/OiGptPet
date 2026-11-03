const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { readResponseText } = require('./response-stream.cjs');
const { describeHttpError } = require('./chat-errors.cjs');

// Race every awaited step, including native decryption and response reads.
// Some providers/adapters can ignore AbortSignal; they must not lock the UI.
function abortable(action, signal, disposeLate = () => {}) {
  return new Promise((resolve, reject) => {
    let aborted = false;
    const abort = () => { aborted = true; reject(new Error('Request aborted')); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw new Error('Request aborted'); return action(); }).then(value => {
      signal.removeEventListener('abort', abort);
      if (aborted) { try { disposeLate(value); } catch { /* Best-effort late resource cleanup. */ } } else resolve(value);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

function createChatService({ file, fs, safeStorage, fetch, onState = () => {}, timeoutMs = 60000, checkTimeoutMs = 5000 }) {
  let config = { model: '', key: '' }; let history = []; let active; let saving = false; let attempt; let checking;
  let sequence = 0; let state = { status: 'idle', sequence: 0 };
  const available = () => safeStorage.isAsyncEncryptionAvailable();
  const publicConfig = async () => ({ model: config.model, hasKey: Boolean(config.key), encryptionAvailable: await available() });
  const emit = value => {
    state = { ...value, sequence: ++sequence };
    if (attempt && value.requestId === attempt.requestId) {
      attempt.status = value.status;
      if (value.status === 'streaming') attempt.partial = value.text;
      if (value.status === 'error') attempt.error = value.text;
    }
    try { onState({ ...state }); } catch { /* A closing view must not invalidate committed settings or replies. */ }
  };
  const cancel = () => {
    checking?.controller.abort();
    if (!active) return;
    const previous = active; active = undefined;
    if (attempt?.requestId === previous.id) attempt.partial = previous.partial;
    previous.controller.abort(); clearTimeout(previous.progressTimer); emit({ status: 'cancelled', requestId: previous.id });
  };
  return {
    async load() {
      try {
        const value = JSON.parse(await fs.readFile(file, 'utf8'));
        if (value.version !== 1 || typeof value.model !== 'string' || value.model.length > 120 || typeof value.key !== 'string' || value.key.length > 16384) throw new Error('Invalid chat settings');
        config = { model: value.model, key: value.key };
      } catch (error) { if (error.code !== 'ENOENT') throw new Error('对话设置读取失败，请重新保存设置。'); }
    },
    get: publicConfig,
    async check() {
      if (active || saving || checking) return { ready: false, code: 'busy' };
      const probe = { controller: new AbortController() }; checking = probe;
      let timedOut = false; let stage = 'availability';
      const timer = setTimeout(() => { timedOut = true; probe.controller.abort(); }, checkTimeoutMs);
      const result = code => ({ ready: code === 'ready', code });
      try {
        if (!config.model) return result('missing_model');
        if (!/^[a-zA-Z0-9._:/-]{1,120}$/.test(config.model)) return result('invalid_model');
        if (!config.key) return result('missing_key');
        const signal = probe.controller.signal;
        if (!await abortable(available, signal)) return result('unavailable');
        stage = 'decryption';
        const decrypted = await abortable(() => safeStorage.decryptStringAsync(Buffer.from(config.key, 'base64')), signal);
        const key = decrypted?.result;
        return result(typeof key === 'string' && key.length > 0 && key.length <= 512 && !/[^\x21-\x7e]/.test(key) ? 'ready' : 'unreadable_key');
      } catch {
        return result(probe.controller.signal.aborted ? timedOut ? 'timeout' : 'cancelled' : stage === 'decryption' ? 'unreadable_key' : 'unavailable');
      } finally { clearTimeout(timer); if (checking === probe) checking = undefined; }
    },
    getState: () => ({ ...state }),
    snapshot: () => ({ sequence, state: { ...state }, history: history.map(message => ({ ...message })),
      attempt: attempt ? { ...attempt, ...(active?.id === attempt.requestId ? { partial: active.partial } : {}) } : null }),
    async save(value) {
      if (active || saving || checking) throw new Error('请先结束当前对话、设置保存或本地检查。');
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['model', 'apiKey', 'forgetKey'].includes(key))
        || typeof value.model !== 'string' || (!value.forgetKey && !/^[a-zA-Z0-9._:/-]{1,120}$/.test(value.model.trim()))
        || (!value.forgetKey && value.apiKey !== undefined && (typeof value.apiKey !== 'string' || value.apiKey.length > 512 || /[^\x21-\x7e]/.test(value.apiKey)))
        || (value.forgetKey !== undefined && typeof value.forgetKey !== 'boolean')) throw new Error('请输入有效的模型 ID 和 API Key。');
      saving = true; const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        // Resolve availability before committing. A post-rename native failure
        // must not report that the old settings were retained.
        const encryptionAvailable = value.forgetKey ? await Promise.resolve().then(available).catch(() => false) : await available();
        let key = config.key;
        if (value.forgetKey) key = '';
        else if (value.apiKey) {
          if (!encryptionAvailable) throw new Error('系统安全存储不可用，未保存密钥。');
          key = (await safeStorage.encryptStringAsync(value.apiKey)).toString('base64');
        }
        const next = { model: value.forgetKey ? config.model : value.model.trim(), key };
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(temporary, JSON.stringify({ version: 1, ...next }), { encoding: 'utf8', flag: 'wx' });
        await fs.rename(temporary, file);
        config = next; history = []; attempt = undefined; emit({ status: 'cleared' });
        return { model: next.model, hasKey: Boolean(next.key), encryptionAvailable };
      } catch (error) {
        if (error.message === '系统安全存储不可用，未保存密钥。') throw error;
        throw new Error('对话设置保存失败，原设置已保留。');
      } finally { await fs.unlink(temporary).catch(() => {}); saving = false; }
    },
    cancel,
    clear() { cancel(); history = []; attempt = undefined; emit({ status: 'cleared' }); },
    async send(text, requestId) {
      if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('消息长度需为 1–2000 字。');
      if (requestId !== undefined && (typeof requestId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId))) throw new Error('对话请求标识无效。');
      if (active || saving || checking) throw new Error('请等待当前操作完成。');
      if (!config.model || !config.key) throw new Error('请先保存模型 ID 和 API Key。');
      const session = { controller: new AbortController(), id: requestId ?? randomUUID(), lastProgress: 0, partial: '' }; active = session;
      attempt = { requestId: session.id, text, status: 'thinking', partial: '' };
      const progress = text => {
        if (active !== session || session.controller.signal.aborted) return;
        session.partial = text;
        const publish = () => {
          session.progressTimer = undefined;
          if (active !== session || session.controller.signal.aborted) return;
          session.lastProgress = Date.now(); emit({ status: 'streaming', text: session.partial, requestId: session.id });
        };
        if (Date.now() - session.lastProgress >= 50) { clearTimeout(session.progressTimer); publish(); }
        else if (!session.progressTimer) session.progressTimer = setTimeout(publish, 50);
      };
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; session.controller.abort(); }, timeoutMs);
      emit({ status: 'thinking', requestId: session.id });
      try {
        const signal = session.controller.signal;
        if (!await abortable(available, signal)) throw new Error('系统安全存储不可用。');
        let key;
        try {
          const decrypted = await abortable(() => safeStorage.decryptStringAsync(Buffer.from(config.key, 'base64')), signal);
          key = decrypted?.result;
          if (typeof key !== 'string' || !key || key.length > 512 || /[^\x21-\x7e]/.test(key)) throw new Error('Invalid decrypted key');
        }
        catch (error) { if (signal.aborted) throw error; throw new Error('系统安全存储无法解密已保存密钥，请在本机重新保存 API Key。'); }
        if (active !== session) return { cancelled: true };
        const response = await abortable(() => fetch('https://api.openai.com/v1/responses', {
          method: 'POST', redirect: 'error', signal: session.controller.signal,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: config.model, store: false, stream: true, max_output_tokens: 600,
            instructions: '你是一位友善的桌面动漫伙伴。用用户的语言简短自然地交流。不要声称能操作电脑或读取文件。',
            input: [...history, { role: 'user', content: text.trim() }] }),
        }), signal, late => { void late.body?.cancel().catch(() => {}); });
        if (!response.ok) throw new Error(await describeHttpError(response, { signal, wait: abortable }));
        const reply = await readResponseText(response, { signal, wait: abortable, onText: progress });
        if (active !== session || session.controller.signal.aborted) return { cancelled: true };
        history = [...history, { role: 'user', content: text.trim() }, { role: 'assistant', content: reply }].slice(-8);
        attempt = undefined;
        clearTimeout(session.progressTimer); emit({ status: 'reply', text: reply, requestId: session.id }); return { text: reply };
      } catch (error) {
        if (active !== session) return { cancelled: true };
        const message = timedOut ? '请求已超时，请重试。' : session.controller.signal.aborted ? '已取消。'
          : /^服务|^系统安全/.test(error.message) ? error.message : '连接或回复处理失败，请检查网络和配置。';
        if (attempt?.requestId === session.id) attempt.partial = session.partial;
        clearTimeout(session.progressTimer); emit({ status: 'error', text: message, requestId: session.id }); return { error: message };
      } finally { clearTimeout(timer); clearTimeout(session.progressTimer); if (active === session) active = undefined; }
    },
  };
}
module.exports = { createChatService };
