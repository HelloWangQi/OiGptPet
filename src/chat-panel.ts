type Desktop = NonNullable<Window['petDesktop']>;
type ChatState = { status: string; text?: string; requestId?: string };
export function setupChat(api: Desktop | undefined, petMode: boolean, onState: (state: ChatState) => void) {
  if (!api) return () => {};
  let receive = onState;
  const unsubscribe = api.onChatState(value => receive(value));
  if (petMode) return unsubscribe;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const model = $<HTMLInputElement>('chat-model'); const key = $<HTMLInputElement>('chat-key');
  const input = $<HTMLTextAreaElement>('chat-input'); const send = $<HTMLButtonElement>('chat-send');
  const cancel = $<HTMLButtonElement>('chat-cancel'); const save = $<HTMLButtonElement>('chat-save');
  const forget = $<HTMLButtonElement>('chat-forget'); const retry = $<HTMLButtonElement>('chat-retry');
  const clear = $<HTMLButtonElement>('chat-clear'); const status = $('chat-status'); const log = $('chat-log');
  let busy = false; let saving = false; let initializing = true; let configured = false; let revision = 0; let closed = false;
  let failed: { text: string; row: HTMLElement; partial?: HTMLElement } | undefined;
  let pending: { run: number; requestId: string; partial?: HTMLElement } | undefined;
  const append = (role: string, text: string) => {
    const row = document.createElement('p'); row.textContent = `${role}：${text}`; log.append(row);
    while (log.children.length > 12) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight; return row;
  };
  receive = value => {
    onState(value);
    if (closed || !busy || saving || !pending || pending.run !== revision || value.requestId !== pending.requestId) return;
    if (value.status === 'streaming' && value.text) {
      pending.partial ??= append('伙伴', '');
      pending.partial.textContent = `伙伴：${value.text}`; pending.partial.dataset.replyState = 'partial';
      status.textContent = '正在回复…'; log.scrollTop = log.scrollHeight;
    }
  };
  const controls = () => {
    send.disabled = busy || initializing || !configured;
    save.disabled = forget.disabled = model.disabled = key.disabled = busy || initializing;
    clear.disabled = saving || initializing; cancel.hidden = !busy || saving;
    retry.hidden = !failed; retry.disabled = busy || initializing || !configured;
  };
  const configure = (value: { model: string; hasKey: boolean; encryptionAvailable: boolean }) => {
    model.value = value.model; key.value = ''; configured = Boolean(value.model && value.hasKey && value.encryptionAvailable);
    key.placeholder = value.hasKey ? '已保存；留空保留原密钥' : '输入 API Key';
    status.textContent = !value.encryptionAvailable ? '系统安全存储不可用。' : value.hasKey ? '配置已保存，可以开始对话。' : '请设置模型 ID 和 API Key。';
  };
  controls();
  void api.getChatSettings().then(value => { if (!closed) configure(value); })
    .catch(() => { if (!closed) status.textContent = '配置读取失败，请重试保存。'; })
    .finally(() => { if (!closed) { initializing = false; controls(); } });
  const saveSettings = async (forgetKey = false) => {
    if (busy || initializing) return; busy = true; saving = true; controls();
    const apiKey = key.value; key.value = '';
    try { const value = await api.saveChatSettings({ model: model.value, ...(apiKey ? { apiKey } : {}), forgetKey });
      if (!closed) { configure(value); log.replaceChildren(); failed = undefined; }
    } catch { if (!closed) status.textContent = '设置保存失败，请检查模型 ID、密钥和系统安全存储。'; }
    finally { if (!closed) { busy = false; saving = false; controls(); } }
  };
  save.onclick = () => void saveSettings(); forget.onclick = () => void saveSettings(true);
  const submit = async (text: string, previous?: HTMLElement) => {
    if (busy || initializing || !configured || !text.trim()) return;
    const run = ++revision; const requestId = crypto.randomUUID();
    if (previous && failed?.partial) failed.partial.remove();
    busy = true; failed = undefined; pending = { run, requestId }; controls();
    // Only clear the draft being sent. A newer draft remains available while retrying.
    if (input.value === text) input.value = '';
    const row = previous ?? append('你', text); row.dataset.delivery = 'pending'; status.textContent = '正在思考…';
    const restore = (message: string, delivery: string) => {
      row.dataset.delivery = delivery;
      const partial = pending?.partial; if (partial) partial.dataset.replyState = 'incomplete';
      failed = { text, row, partial };
      if (!input.value) input.value = text;
      status.textContent = message;
    };
    try {
      const result = await api.sendChat(text, requestId);
      if (run !== revision || closed) return;
      if (result.text) {
        row.dataset.delivery = 'sent';
        const reply = pending?.partial ?? append('伙伴', ''); reply.textContent = `伙伴：${result.text}`; delete reply.dataset.replyState;
        status.textContent = '回复完成。';
      }
      else restore(result.error ?? '已取消，可修改原消息或重试。', result.cancelled ? 'cancelled' : 'failed');
    } catch { if (run === revision && !closed) restore('请求失败，原消息已保留，可以重试。', 'failed'); }
    finally { if (run === revision && !closed) { busy = false; pending = undefined; controls(); } }
  };
  $('chat-form').onsubmit = event => { event.preventDefault(); void submit(input.value); };
  input.onkeydown = event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && !event.repeat) {
      event.preventDefault(); void submit(input.value);
    }
  };
  retry.onclick = () => { if (failed) void submit(failed.text, failed.row); };
  cancel.onclick = () => { void api.cancelChat().catch(() => { if (!closed) status.textContent = '取消失败，请重试。'; }); };
  clear.onclick = async () => {
    if (saving || initializing) return;
    try { await api.clearChat(); if (!closed) { ++revision; busy = false; pending = undefined; failed = undefined; log.replaceChildren(); controls(); status.textContent = '本次对话已清空。'; } }
    catch { if (!closed) status.textContent = '清空失败，请重试。'; }
  };
  return () => { closed = true; ++revision; unsubscribe(); };
}
