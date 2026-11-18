export type CodexUsageSnapshot = {
  status: 'ok';
  checkedAt: number;
  fiveHourResetAt: number | null;
  weeklyResetAt: number | null;
  lifetimeTokens: number | null;
  latestDay: { date: string; tokens: number } | null;
} | { status: 'missing' | 'unavailable'; checkedAt: number };

const REFRESH_MS = 60_000;
const integer = new Intl.NumberFormat('zh-CN');

function countdown(resetAt: number | null, now: number): string {
  if (resetAt === null) return '暂无数据';
  const seconds = Math.ceil((resetAt - now) / 1000);
  if (seconds <= 0) return '等待服务更新';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor(seconds / 60) % 60;
  return `${days ? `${days} 天 ` : ''}${hours} 小时 ${minutes} 分 ${seconds % 60} 秒`;
}

export function setupCodexUsagePanel(panel: HTMLDetailsElement, getUsage: () => Promise<CodexUsageSnapshot>) {
  const fiveHour = panel.querySelector<HTMLElement>('#codex-usage-five-hour')!;
  const weekly = panel.querySelector<HTMLElement>('#codex-usage-weekly')!;
  const dayLabel = panel.querySelector<HTMLElement>('#codex-usage-day-label')!;
  const day = panel.querySelector<HTMLElement>('#codex-usage-day')!;
  const lifetime = panel.querySelector<HTMLElement>('#codex-usage-lifetime')!;
  const status = panel.querySelector<HTMLElement>('#codex-usage-status')!;
  let snapshot: CodexUsageSnapshot | undefined;
  let timer: number | undefined;
  let visible = false;
  let pending = false;

  function render() {
    const data = snapshot?.status === 'ok' ? snapshot : null;
    const now = Date.now();
    fiveHour.textContent = countdown(data?.fiveHourResetAt ?? null, now);
    weekly.textContent = countdown(data?.weeklyResetAt ?? null, now);
    dayLabel.textContent = data?.latestDay ? `日用量 · ${data.latestDay.date}` : '最近日用量';
    day.textContent = data?.latestDay ? `${integer.format(data.latestDay.tokens)} tokens` : '暂无数据';
    const total = data?.lifetimeTokens;
    lifetime.textContent = total == null ? '暂无数据' : `${integer.format(total)} tokens`;
    let note = '正在读取 Codex 用量…';
    if (snapshot?.status === 'missing') note = '未找到本机 Codex。安装 Codex 并用 ChatGPT 账号登录后可读取。';
    else if (snapshot?.status === 'unavailable') note = '暂时读不到用量，请检查 Codex 登录和网络。';
    else if (data) note = `最近查询 ${new Date(data.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })} · 每分钟刷新`;
    if (status.textContent !== note) status.textContent = note;
  }

  async function tick() {
    render();
    if (pending || (snapshot && Date.now() - snapshot.checkedAt < REFRESH_MS)) return;
    pending = true;
    try { snapshot = await getUsage(); }
    catch { snapshot = { status: 'unavailable', checkedAt: Date.now() }; }
    finally { pending = false; }
    if (timer !== undefined) render();
  }

  function sync() {
    if (visible && panel.open) {
      if (timer !== undefined) return;
      timer = window.setInterval(() => void tick(), 1000);
      void tick();
    } else {
      window.clearInterval(timer);
      timer = undefined;
    }
  }
  panel.addEventListener('toggle', sync);
  return {
    setVisible(value: boolean) { visible = value; sync(); },
    dispose() {
      visible = false;
      sync();
      panel.removeEventListener('toggle', sync);
    },
  };
}
