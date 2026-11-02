const { randomUUID } = require('node:crypto');
const path = require('node:path');

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

function createChatService({ file, fs, safeStorage, fetch, onState = () => {}, timeoutMs = 60000 }) {
  let config = { model: '', key: '' }; let history = []; let active; let saving = false;
  const available = () => safeStorage.isAsyncEncryptionAvailable();
  const publicConfig = async () => ({ model: config.model, hasKey: Boolean(config.key), encryptionAvailable: await available() });
  const emit = state => { try { onState(state); } catch { /* A closing view must not invalidate committed settings or replies. */ } };
  const cancel = () => {
    if (!active) return;
    const previous = active; active = undefined; previous.controller.abort(); emit({ status: 'cancelled' });
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
    async save(value) {
      if (active || saving) throw new Error('请先结束当前对话或设置保存。');
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
        config = next; history = []; emit({ status: 'cleared' });
        return { model: next.model, hasKey: Boolean(next.key), encryptionAvailable };
      } catch (error) {
        if (error.message === '系统安全存储不可用，未保存密钥。') throw error;
        throw new Error('对话设置保存失败，原设置已保留。');
      } finally { await fs.unlink(temporary).catch(() => {}); saving = false; }
    },
    cancel,
    clear() { cancel(); history = []; emit({ status: 'cleared' }); },
    async send(text) {
      if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('消息长度需为 1–2000 字。');
      if (active || saving) throw new Error('请等待当前操作完成。');
      if (!config.model || !config.key) throw new Error('请先保存模型 ID 和 API Key。');
      const session = { controller: new AbortController() }; active = session;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; session.controller.abort(); }, timeoutMs);
      emit({ status: 'thinking' });
      try {
        const signal = session.controller.signal;
        if (!await abortable(available, signal)) throw new Error('系统安全存储不可用。');
        const key = await abortable(() => safeStorage.decryptStringAsync(Buffer.from(config.key, 'base64')), signal);
        if (active !== session) return { cancelled: true };
        const response = await abortable(() => fetch('https://api.openai.com/v1/responses', {
          method: 'POST', redirect: 'error', signal: session.controller.signal,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: config.model, store: false, max_output_tokens: 600,
            instructions: '你是一位友善的桌面动漫伙伴。用用户的语言简短自然地交流。不要声称能操作电脑或读取文件。',
            input: [...history, { role: 'user', content: text.trim() }] }),
        }), signal, late => { void late.body?.cancel().catch(() => {}); });
        if (!response.ok) throw new Error(`服务请求失败（HTTP ${response.status}）。请检查密钥、模型权限或余额。`);
        const reader = response.body.getReader(); const chunks = []; let size = 0;
        const cancelReader = () => { void reader.cancel().catch(() => {}); };
        signal.addEventListener('abort', cancelReader, { once: true });
        try {
          while (true) {
            const { done, value } = await abortable(() => reader.read(), signal); if (done) break;
            size += value.length; if (size > 256 * 1024) { cancelReader(); throw new Error('服务回复超过大小限制。'); }
            chunks.push(Buffer.from(value));
          }
        } finally { signal.removeEventListener('abort', cancelReader); reader.releaseLock(); }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (data.status !== 'completed') throw new Error('服务未完成回复，请重试。');
        const reply = (data.output ?? []).filter(item => item.type === 'message').flatMap(item => item.content ?? [])
          .filter(item => item.type === 'output_text' && typeof item.text === 'string').map(item => item.text).join('\n').trim();
        if (!reply || reply.length > 8000) throw new Error('服务未返回有效文本。');
        if (active !== session || session.controller.signal.aborted) return { cancelled: true };
        history = [...history, { role: 'user', content: text.trim() }, { role: 'assistant', content: reply }].slice(-8);
        emit({ status: 'reply', text: reply }); return { text: reply };
      } catch (error) {
        if (active !== session) return { cancelled: true };
        const message = timedOut ? '请求已超时，请重试。' : session.controller.signal.aborted ? '已取消。'
          : /^服务|^系统安全/.test(error.message) ? error.message : '连接或回复处理失败，请检查网络和配置。';
        emit({ status: 'error', text: message }); return { error: message };
      } finally { clearTimeout(timer); if (active === session) active = undefined; }
    },
  };
}
module.exports = { createChatService };
