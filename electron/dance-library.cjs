const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

// Library files are private copies; IDs are content hashes, never user-supplied paths.
function createDanceLibrary(directory) {
  const manifest = path.join(directory, 'library.json');
  let pending = Promise.resolve();
  const queue = fn => { const result = pending.then(fn); pending = result.catch(() => {}); return result; };
  const validId = id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
  const cleanName = name => {
    if (typeof name !== 'string') throw new Error('请输入舞步名称。');
    const result = name.trim();
    if (!result || result.length > 80 || /[\x00-\x1f\x7f]/.test(result)) throw new Error('舞步名称须为 1–80 个字符。');
    return result;
  };
  const read = async () => {
    try {
      const data = JSON.parse(await fs.readFile(manifest, 'utf8'));
      if (!Array.isArray(data) || data.length > 100 || data.some(item => !validId(item.id) || typeof item.name !== 'string' || !Number.isSafeInteger(item.size) || item.size < 28 || item.size > 64 * 1024 * 1024)) throw new Error();
      return data;
    } catch (error) { if (error.code === 'ENOENT') return []; throw new Error('舞步库目录损坏，请先备份用户数据并修复。'); }
  };
  const atomicWrite = async (file, content) => {
    const temp = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temp, content, { flag: 'wx' }); await fs.rename(temp, file); }
    finally { await fs.unlink(temp).catch(() => {}); }
  };
  return {
    list: () => queue(read),
    add: (bytes, name) => queue(async () => {
      if (!(bytes instanceof Uint8Array) || bytes.length < 28 || bytes.length > 64 * 1024 * 1024 || Buffer.from(bytes.subarray(0, 4)).toString() !== 'glTF') throw new Error('无效的 VRMA 文件。');
      const title = cleanName(name); const buffer = Buffer.from(bytes); const id = createHash('sha256').update(buffer).digest('hex');
      const entries = await read(); const existing = entries.find(item => item.id === id);
      if (existing) return existing;
      if (entries.length >= 100 || entries.reduce((n, item) => n + item.size, 0) + buffer.length > 256 * 1024 * 1024) throw new Error('舞步库最多 100 个文件、合计 256 MiB。');
      await fs.mkdir(directory, { recursive: true });
      await atomicWrite(path.join(directory, `${id}.vrma`), buffer);
      const entry = { id, name: title, size: buffer.length }; entries.push(entry);
      await atomicWrite(manifest, JSON.stringify(entries)); return entry;
    }),
    get: id => queue(async () => {
      if (!validId(id)) throw new Error('无效的舞步编号。');
      const entries = await read(); if (!entries.some(item => item.id === id)) throw new Error('找不到舞步。');
      const bytes = await fs.readFile(path.join(directory, `${id}.vrma`));
      if (createHash('sha256').update(bytes).digest('hex') !== id) throw new Error('舞步文件已损坏。');
      return bytes;
    }),
    rename: (id, name) => queue(async () => {
      const entries = await read(); const item = entries.find(entry => entry.id === id); if (!item) throw new Error('找不到舞步。');
      item.name = cleanName(name); await atomicWrite(manifest, JSON.stringify(entries));
    }),
    remove: id => queue(async () => {
      if (!validId(id)) throw new Error('无效的舞步编号。');
      const entries = await read(); if (!entries.some(item => item.id === id)) throw new Error('找不到舞步。');
      await atomicWrite(manifest, JSON.stringify(entries.filter(item => item.id !== id)));
      await fs.unlink(path.join(directory, `${id}.vrma`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }),
  };
}
module.exports = { createDanceLibrary };
