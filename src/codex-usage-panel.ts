export type CodexUsageSnapshot = {
  status: 'ok';
  checkedAt: number;
  fiveHourResetAt: number | null;
  weeklyResetAt: number | null;
  lifetimeTokens: number | null;
  latestDay: { date: string; tokens: number } | null;
} | { status: 'missing' | 'unavailable'; checkedAt: number };

const REFRESH_MS = 120_000;
const STARTUP_DELAY_MS = 10_000;
const COUNTDOWN_TICK_MS = 15_000;
const integer = new Intl.NumberFormat('zh-CN');

function countdown(resetAt: number | null, now: number): string {
  if (resetAt === null) return '暂无数据';
  const minutes = Math.ceil((resetAt - now) / 60_000);
  if (minutes <= 0) return '等待更新';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  return `${days ? `${days} 天 ` : ''}${days || hours ? `${hours} 小时 ` : ''}${minutes % 60} 分`;
}

export function setupCodexUsagePanel(panel: HTMLElement, getUsage: () => Promise<CodexUsageSnapshot>) {
  const fiveHour = panel.querySelector<HTMLElement>('#codex-usage-five-hour')!;
  const weekly = panel.querySelector<HTMLElement>('#codex-usage-weekly')!;
  const dayLabel = panel.querySelector<HTMLElement>('#codex-usage-day-label')!;
  const day = panel.querySelector<HTMLElement>('#codex-usage-day')!;
  const lifetime = panel.querySelector<HTMLElement>('#codex-usage-lifetime')!;
  const status = panel.querySelector<HTMLElement>('#codex-usage-status')!;
  let snapshot: CodexUsageSnapshot | undefined;
  let countdownTimer: number | undefined;
  let refreshTimer: number | undefined;
  let nextRefreshAt: number | undefined;
  let visible = false;
  let pending = false;

  function renderCountdown() {
    const data = snapshot?.status === 'ok' ? snapshot : null;
    const now = Date.now();
    const fiveHourText = countdown(data?.fiveHourResetAt ?? null, now);
    const weeklyText = countdown(data?.weeklyResetAt ?? null, now);
    if (fiveHour.textContent !== fiveHourText) fiveHour.textContent = fiveHourText;
    if (weekly.textContent !== weeklyText) weekly.textContent = weeklyText;
  }

  function renderUsage() {
    const data = snapshot?.status === 'ok' ? snapshot : null;
    renderCountdown();
    dayLabel.textContent = data?.latestDay ? `日用量 · ${data.latestDay.date}` : '最近日用量';
    day.textContent = data?.latestDay ? `${integer.format(data.latestDay.tokens)} tokens` : '暂无数据';
    const total = data?.lifetimeTokens;
    lifetime.textContent = total == null ? '暂无数据' : `${integer.format(total)} tokens`;
    status.hidden = Boolean(data);
    status.textContent = snapshot?.status === 'missing' ? '未找到本机 Codex' : '暂时读不到用量';
  }

  async function refresh() {
    refreshTimer = undefined;
    if (!visible || pending) return;
    pending = true;
    if (!snapshot) status.textContent = '正在读取…';
    try { snapshot = await getUsage(); }
    catch { snapshot = { status: 'unavailable', checkedAt: Date.now() }; }
    pending = false;
    nextRefreshAt = Date.now() + REFRESH_MS;
    if (visible) {
      renderUsage();
      scheduleRefresh();
    }
  }

  function scheduleRefresh() {
    if (pending || refreshTimer !== undefined) return;
    nextRefreshAt ??= Date.now() + STARTUP_DELAY_MS;
    refreshTimer = window.setTimeout(() => void refresh(), Math.max(0, nextRefreshAt - Date.now()));
  }

  function setVisible(value: boolean) {
    if (visible === value) return;
    visible = value;
    if (visible) {
      if (snapshot) renderUsage();
      countdownTimer = window.setInterval(() => { if (snapshot) renderCountdown(); }, COUNTDOWN_TICK_MS);
      scheduleRefresh();
    } else {
      window.clearInterval(countdownTimer);
      window.clearTimeout(refreshTimer);
      countdownTimer = undefined;
      refreshTimer = undefined;
    }
  }
  return { setVisible, dispose: () => setVisible(false) };
}
