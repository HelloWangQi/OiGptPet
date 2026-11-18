const { spawn } = require('node:child_process');
const { readdir, stat } = require('node:fs/promises');
const path = require('node:path');

const REFRESH_MS = 60_000;
const REQUEST_TIMEOUT_MS = 12_000;

async function findCodexExecutable() {
  if (process.platform !== 'win32') return null;
  if (process.env.LOCALAPPDATA && path.isAbsolute(process.env.LOCALAPPDATA)) {
    const bin = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    const dirs = await readdir(bin, { withFileTypes: true }).catch(() => []);
    const installed = await Promise.all(dirs.filter(dir => dir.isDirectory()).map(async dir => {
      const file = path.join(bin, dir.name, 'codex.exe');
      const info = await stat(file).catch(() => null);
      return info?.isFile() ? { file, modified: info.mtimeMs } : null;
    }));
    const latest = installed.filter(Boolean).sort((a, b) => b.modified - a.modified)[0];
    if (latest) return latest.file;
  }
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    const dir = entry.trim().replace(/^"|"$/g, '');
    if (!path.isAbsolute(dir)) continue;
    const file = path.join(dir, 'codex.exe');
    if ((await stat(file).catch(() => null))?.isFile()) return file;
  }
  return null;
}

function readAccount(executable, cwd, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve({}); return; }
    const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      cwd, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    });
    const replies = {};
    let buffer = '';
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      child.stdin.destroy();
      child.kill();
      resolve(replies);
    };
    const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
    const timeout = setTimeout(finish, REQUEST_TIMEOUT_MS);
    signal.addEventListener('abort', finish, { once: true });
    child.on('error', finish);
    child.on('close', finish);
    child.stdin.on('error', finish);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) { finish(); return; }
      let newline;
      while (!finished && (newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message?.id === 0) {
          if (!message.result || message.error) { finish(); return; }
          send({ method: 'initialized' });
          send({ id: 1, method: 'account/rateLimits/read' });
          send({ id: 2, method: 'account/usage/read' });
        }
        if (message?.id === 1) replies.limits = message.result ?? null;
        if (message?.id === 2) replies.usage = message.result ?? null;
        if ('limits' in replies && 'usage' in replies) finish();
      }
    });
    send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'oigptpet', title: 'OiGptPet', version: '1' } } });
  });
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function toSnapshot({ limits, usage }, checkedAt) {
  const bucket = limits?.rateLimitsByLimitId?.codex ?? limits?.rateLimits;
  const windows = bucket?.limitId === 'codex' ? [bucket.primary, bucket.secondary] : [];
  const reset = minutes => {
    const seconds = nonnegativeInteger(windows.find(window => window?.windowDurationMins === minutes)?.resetsAt);
    return seconds > 0 && seconds <= 8_640_000_000_000 ? seconds * 1000 : null;
  };
  let latestDay = null;
  if (Array.isArray(usage?.dailyUsageBuckets)) {
    for (const day of usage.dailyUsageBuckets) {
      const date = day?.startDate;
      const tokens = nonnegativeInteger(day?.tokens);
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || tokens === null) continue;
      if (!latestDay || date > latestDay.date) latestDay = { date, tokens };
    }
  }
  return {
    status: limits || usage ? 'ok' : 'unavailable',
    checkedAt, fiveHourResetAt: reset(300), weeklyResetAt: reset(10_080),
    lifetimeTokens: nonnegativeInteger(usage?.summary?.lifetimeTokens), latestDay,
  };
}

function createCodexUsageReader({ cwd, locate = findCodexExecutable, request = readAccount, now = Date.now }) {
  const controller = new AbortController();
  let pending;
  let last;
  async function refresh() {
    try {
      const executable = await locate();
      if (!executable) return { status: 'missing', checkedAt: now() };
      const replies = await request(executable, cwd, controller.signal);
      return toSnapshot(replies, now());
    } catch {
      return { status: 'unavailable', checkedAt: now() };
    }
  }
  return {
    read() {
      if (pending) return pending;
      if (last && now() - last.checkedAt < REFRESH_MS) return Promise.resolve(last);
      pending = refresh().then(result => { last = result; return result; }).finally(() => { pending = null; });
      return pending;
    },
    dispose() { controller.abort(); },
  };
}

module.exports = { createCodexUsageReader };
