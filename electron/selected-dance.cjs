const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createSelectedDanceStore(file, io = fs) {
  let pending = Promise.resolve();
  const enqueue = operation => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  return {
    async get() {
      await pending;
      try { return await io.readFile(file); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    set(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.length < 28 || bytes.length > 64 * 1024 * 1024
        || Buffer.from(bytes.subarray(0, 4)).toString() !== 'glTF') throw new Error('无效的 VRMA 动作文件。');
      const snapshot = Buffer.from(bytes);
      return enqueue(async () => {
        const temp = `${file}.${randomUUID()}.tmp`;
        try {
          await io.mkdir(path.dirname(file), { recursive: true });
          await io.writeFile(temp, snapshot, { flag: 'wx' });
          await io.rename(temp, file);
        } finally { await io.unlink(temp).catch(() => {}); }
      });
    },
    clear() { return enqueue(async () => { try { await io.unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } }); },
  };
}
module.exports = { createSelectedDanceStore };
