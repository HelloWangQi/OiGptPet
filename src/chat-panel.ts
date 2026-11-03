import { CHAT_READINESS_TEXT, chatSettingsIssue } from './chat-readiness';
type Desktop = NonNullable<Window['petDesktop']>;
export function setupChat(api: Desktop | undefined, petMode: boolean, onState: (state: CompanionChatState) => void) {
  const noop = { dispose() {}, async refresh() {} };
  if (!api) return noop;
  let closed = false; let lastSequence = -1; let latest: CompanionChatState | undefined;
  let receive = (value: CompanionChatState) => onState(value);
  const unsubscribe = api.onChatState(value => {
    if (closed || value.sequence <= lastSequence) return;
    lastSequence = value.sequence; latest = value; receive(value);
  });
  const dispose = () => { closed = true; unsubscribe(); };
  if (petMode) return { dispose, async refresh() {
    try {
      const value = await api.getChatState(); if (closed) return;
      if (value.sequence >= lastSequence) { lastSequence = value.sequence; latest = value; onState(value); }
      else if (latest) onState(latest);
    } catch { /* Existing rendering remains usable if a snapshot cannot be read. */ }
  } };
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const model = $<HTMLInputElement>('chat-model'); const key = $<HTMLInputElement>('chat-key');
  const input = $<HTMLTextAreaElement>('chat-input'); const send = $<HTMLButtonElement>('chat-send');
  const cancel = $<HTMLButtonElement>('chat-cancel'); const save = $<HTMLButtonElement>('chat-save');
  const forget = $<HTMLButtonElement>('chat-forget'); const retry = $<HTMLButtonElement>('chat-retry');
  const clear = $<HTMLButtonElement>('chat-clear'); const status = $('chat-status'); const log = $('chat-log');
  const check = $<HTMLButtonElement>('chat-check'); const checkStatus = $('chat-check-status');
  const settingsPanel = document.querySelector<HTMLDetailsElement>('.chat-panel details')!;
  let savedModel = '';
  let busy = false; let saving = false; let initializing = true; let configured = false; let ready = false; let revision = 0;
  let failed: { text: string; row: HTMLElement; partial?: HTMLElement } | undefined;
  let pending: { run: number; requestId: string; text: string; row: HTMLElement; partial?: HTMLElement } | undefined;
  const append = (role: string, text: string) => {
    const row = document.createElement('p'); row.textContent = `${role}：${text}`; log.append(row);
    while (log.children.length > 12) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight; return row;
  };
  const controls = () => {
    send.disabled = busy || initializing || !configured || !ready;
    save.disabled = forget.disabled = model.disabled = key.disabled = check.disabled = busy || initializing;
    clear.disabled = saving || initializing; cancel.hidden = !busy || saving;
    retry.hidden = !failed; retry.disabled = busy || initializing || !configured || !ready;
  };
  const configure = (value: { model: string; hasKey: boolean; encryptionAvailable: boolean }) => {
    model.value = value.model; key.value = ''; configured = Boolean(value.model && value.hasKey && value.encryptionAvailable);
    savedModel = value.model;
    if (!configured) settingsPanel.open = true;
    key.placeholder = value.hasKey ? '已保存；留空保留原密钥' : '输入 API Key';
    status.textContent = !value.encryptionAvailable ? '系统安全存储不可用。' : value.hasKey ? '配置已保存，可以开始对话。' : '请设置模型 ID 和 API Key。';
  };
  const complete = (text: string) => {
    if (!pending) return;
    pending.row.dataset.delivery = 'sent';
    const reply = pending.partial ?? append('伙伴', ''); reply.textContent = `伙伴：${text}`; delete reply.dataset.replyState;
    pending = undefined; busy = false; failed = undefined; status.textContent = '回复完成。'; log.scrollTop = log.scrollHeight; controls();
  };
  const fail = (message: string, delivery: string) => {
    if (!pending) return;
    const { text, row, partial } = pending; row.dataset.delivery = delivery;
    if (partial) partial.dataset.replyState = 'incomplete';
    failed = { text, row, partial }; if (!input.value) input.value = text;
    pending = undefined; busy = false; status.textContent = message; controls();
  };
  const apply = (value: CompanionChatState) => {
    onState(value);
    if (value.status === 'cleared') {
      ++revision; pending = undefined; failed = undefined; busy = saving; log.replaceChildren(); status.textContent = '本次对话已清空。'; controls(); return;
    }
    if (!pending || value.requestId !== pending.requestId || pending.run !== revision) return;
    if (value.status === 'streaming' && value.text) {
      pending.partial ??= append('伙伴', ''); pending.partial.textContent = `伙伴：${value.text}`;
      pending.partial.dataset.replyState = 'partial'; status.textContent = '正在回复…'; log.scrollTop = log.scrollHeight;
    } else if (value.status === 'reply' && value.text) complete(value.text);
    else if (value.status === 'error') fail(value.text ?? '回复失败，可以重试。', 'failed');
    else if (value.status === 'cancelled') fail('已取消，可修改原消息或重试。', 'cancelled');
  };
  receive = value => { if (ready && !initializing) apply(value); };
  const hydrate = (value: CompanionChatSnapshot) => {
    ++revision; log.replaceChildren(); pending = undefined; failed = undefined; busy = false;
    for (const message of value.history) {
      const row = append(message.role === 'user' ? '你' : '伙伴', message.content);
      if (message.role === 'user') row.dataset.delivery = 'sent';
    }
    if (value.history.length) status.textContent = '已恢复本次对话。';
    if (value.attempt) {
      const attempt = value.attempt; const row = append('你', attempt.text); row.dataset.delivery = 'pending';
      pending = { run: revision, requestId: attempt.requestId, text: attempt.text, row }; busy = true;
      if (attempt.partial) {
        pending.partial = append('伙伴', attempt.partial); pending.partial.dataset.replyState = 'partial';
      }
      if (attempt.status === 'cancelled') fail('已恢复取消的消息，可以修改或重试。', 'cancelled');
      else if (attempt.status === 'error') fail(attempt.error ?? '已恢复失败的消息，可以重试。', 'failed');
      else status.textContent = attempt.partial ? '正在回复…' : '正在思考…';
    }
  };
  controls();
  void (async () => {
    try {
      const settings = await api.getChatSettings(); if (closed) return; configure(settings);
      const snapshot = await api.getChatSnapshot(); if (closed) return;
      hydrate(snapshot); ready = true;
      if (latest && latest.sequence > snapshot.sequence) apply(latest);
      else { lastSequence = snapshot.sequence; latest = snapshot.state; }
    } catch { if (!closed) status.textContent = '配置或会话恢复失败，请重开工坊或重新保存设置。'; }
    finally { if (!closed) { initializing = false; controls(); } }
  })();
  const saveSettings = async (forgetKey = false) => {
    if (busy || initializing) return;
    const issue = forgetKey ? null : chatSettingsIssue(model.value, key.value);
    if (issue) { status.textContent = issue; settingsPanel.open = true; return; }
    busy = true; saving = true; controls(); checkStatus.textContent = '';
    const apiKey = key.value; key.value = '';
    try {
      const value = await api.saveChatSettings({ model: model.value, ...(apiKey ? { apiKey } : {}), forgetKey });
      if (!closed) { configure(value); ++revision; pending = undefined; ready = true; log.replaceChildren(); failed = undefined; }
    } catch { if (!closed) status.textContent = '设置保存失败，请检查模型 ID、密钥和系统安全存储。'; }
    finally { if (!closed) { busy = false; saving = false; controls(); } }
  };
  save.onclick = () => void saveSettings(); forget.onclick = () => void saveSettings(true);
  check.onclick = async () => {
    if (busy || initializing) return;
    if (model.value.trim() !== savedModel || key.value) { checkStatus.textContent = '请先保存更改，再检查已保存的配置。'; return; }
    busy = true; saving = true; controls(); checkStatus.textContent = '正在检查本机保存的配置…';
    try {
      const value = await api.checkChatSettings(); if (closed) return;
      checkStatus.textContent = CHAT_READINESS_TEXT[value.code];
      if (value.ready) configured = true;
      else if (['missing_model', 'invalid_model', 'missing_key', 'unavailable', 'unreadable_key'].includes(value.code)) { configured = false; settingsPanel.open = true; }
    } catch { if (!closed) checkStatus.textContent = '本地检查失败，请重试或重新保存配置。'; }
    finally { if (!closed) { busy = false; saving = false; controls(); } }
  };
  const submit = async (text: string, previous?: HTMLElement) => {
    if (busy || initializing || !configured || !ready || !text.trim()) return;
    const run = ++revision; const requestId = crypto.randomUUID();
    if (previous && failed?.partial) failed.partial.remove();
    busy = true; failed = undefined;
    if (input.value === text) input.value = '';
    const row = previous ?? append('你', text); row.dataset.delivery = 'pending';
    pending = { run, requestId, text, row }; controls(); status.textContent = '正在思考…';
    try {
      const result = await api.sendChat(text, requestId);
      if (closed || run !== revision || pending?.requestId !== requestId) return;
      if (result.text) complete(result.text);
      else fail(result.error ?? '已取消，可修改原消息或重试。', result.cancelled ? 'cancelled' : 'failed');
    } catch { if (!closed && run === revision && pending?.requestId === requestId) fail('请求失败，原消息已保留，可以重试。', 'failed'); }
  };
  $('chat-form').onsubmit = event => { event.preventDefault(); void submit(input.value); };
  input.onkeydown = event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && !event.repeat) { event.preventDefault(); void submit(input.value); }
  };
  retry.onclick = () => { if (failed) void submit(failed.text, failed.row); };
  cancel.onclick = () => { void api.cancelChat().catch(() => { if (!closed) status.textContent = '取消失败，请重试。'; }); };
  clear.onclick = async () => {
    if (saving || initializing) return;
    try { await api.clearChat(); if (!closed) { ++revision; busy = false; pending = undefined; failed = undefined; ready = true; log.replaceChildren(); controls(); status.textContent = '本次对话已清空。'; } }
    catch { if (!closed) status.textContent = '清空失败，请重试。'; }
  };
  return { dispose() { ++revision; dispose(); }, async refresh() {} };
}
