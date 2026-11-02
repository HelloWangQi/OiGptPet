const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function normalizeBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))
    || value.width <= 0 || value.height <= 0) return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function createWindowStateStore(file, { io = fs, onError = console.error } = {}) {
  let timer;
  let latest;
  let revision = 0;
  let savedRevision = 0;
  let writes = Promise.resolve();

  function flush() {
    clearTimeout(timer);
    const target = latest;
    const result = writes.then(async () => {
      if (!target || target.revision <= savedRevision) return;
      // A unique sibling avoids overwriting an unrelated file or another writer's temp.
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await io.mkdir(path.dirname(file), { recursive: true });
        await io.writeFile(temporary, JSON.stringify(target.bounds), { encoding: 'utf8', flag: 'wx' });
        await io.rename(temporary, file);
        savedRevision = target.revision;
      } finally {
        await io.unlink(temporary).catch(() => {});
      }
    });
    // A failed attempt stays retryable through flush(), without poisoning the queue.
    writes = result.catch(() => {});
    return result;
  }

  return {
    async load() {
      await writes;
      try { return normalizeBounds(JSON.parse(await io.readFile(file, 'utf8'))); }
      catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
        throw error;
      }
    },
    schedule(value) {
      const bounds = normalizeBounds(value);
      if (!bounds) throw new TypeError('Invalid window bounds');
      latest = { bounds, revision: ++revision };
      clearTimeout(timer);
      timer = setTimeout(() => {
        flush().catch(error => {
          // Even a broken observer must not produce an unhandled rejection.
          try { onError(error); } catch { /* Error reporting is best effort. */ }
        });
      }, 300);
      timer.unref?.();
    },
    flush,
  };
}

module.exports = { createWindowStateStore };
