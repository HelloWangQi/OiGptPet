type Desktop = NonNullable<Window['petDesktop']>;
export function setupChat(api: Desktop | undefined, petMode: boolean, onState: (state: { status: string; text?: string }) => void) {
  if (!api) return () => {};
  const unsubscribe = api.onChatState(onState);
  if (petMode) return unsubscribe;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const model = $<HTMLInputElement>('chat-model'); const key = $<HTMLInputElement>('chat-key');
  const input = $<HTMLTextAreaElement>('chat-input'); const send = $<HTMLButtonElement>('chat-send');
  const cancel = $<HTMLButtonElement>('chat-cancel'); const save = $<HTMLButtonElement>('chat-save');
  const forget = $<HTMLButtonElement>('chat-forget'); const status = $('chat-status'); const log = $('chat-log');
  let busy = false; let saving = false; let revision = 0; let closed = false;
  const append = (role: string, text: string) => {
    const row = document.createElement('p'); row.textContent = `${role}：${text}`; log.append(row);
    while (log.children.length > 12) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;
  };
  const controls = () => { send.disabled = busy; save.disabled = busy; forget.disabled = busy; model.disabled = busy; key.disabled = busy; cancel.hidden = !busy || saving; $<HTMLButtonElement>('chat-clear').disabled = saving; };
  const configure = (value: { model: string; hasKey: boolean; encryptionAvailable: boolean }) => {
    model.value = value.model; key.value = '';
    key.placeholder = value.hasKey ? '已保存；留空保留原密钥' : '输入 API Key';
    status.textContent = !value.encryptionAvailable ? '系统安全存储不可用。' : value.hasKey ? '配置已保存，可以开始对话。' : '请设置模型 ID 和 API Key。';
  };
  void api.getChatSettings().then(value => { if (!closed) configure(value); }).catch(() => { status.textContent = '配置读取失败，请重试保存。'; });
  const saveSettings = async (forgetKey = false) => {
    if (busy) return; busy = true; saving = true; controls();
    const apiKey = key.value; key.value = '';
    try { configure(await api.saveChatSettings({ model: model.value, ...(apiKey ? { apiKey } : {}), forgetKey })); log.replaceChildren(); }
    catch { status.textContent = '设置保存失败，请检查模型 ID、密钥和系统安全存储。'; }
    finally { busy = false; saving = false; controls(); }
  };
  save.onclick = () => void saveSettings(); forget.onclick = () => void saveSettings(true);
  $('chat-form').onsubmit = async event => {
    event.preventDefault(); if (busy || !input.value.trim()) return;
    const text = input.value; input.value = ''; const run = ++revision; busy = true; controls();
    append('你', text); status.textContent = '正在思考…';
    try {
      const result = await api.sendChat(text);
      if (run !== revision || closed) return;
      if (result.text) { append('伙伴', result.text); status.textContent = '回复完成。'; }
      else status.textContent = result.error ?? '已取消。';
    } catch { if (run === revision) status.textContent = '请求失败，请检查配置或等待当前请求结束。'; }
    finally { if (run === revision) { busy = false; controls(); } }
  };
  cancel.onclick = () => { void api.cancelChat().catch(() => { status.textContent = '取消失败，请重试。'; }); };
  $('chat-clear').onclick = async () => {
    try { await api.clearChat(); ++revision; busy = false; log.replaceChildren(); controls(); status.textContent = '本次对话已清空。'; }
    catch { status.textContent = '清空失败，请重试。'; }
  };
  return () => { closed = true; ++revision; unsubscribe(); };
}
