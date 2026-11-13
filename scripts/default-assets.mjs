import { open } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_ASSETS = [
  { source: 'artifacts/model-library/VRM/BREAK VENOM.vrm', name: 'BREAK VENOM.vrm' },
  { source: 'artifacts/model-library/VRMA/不是恶魔.vrma', name: '不是恶魔.vrma' },
];

export async function checkDefaultAssets(root) {
  const issues = [];
  for (const asset of DEFAULT_ASSETS) {
    let file;
    try {
      file = await open(path.join(root, asset.source), 'r');
      const stat = await file.stat();
      const header = Buffer.alloc(12);
      const result = await file.read(header, 0, header.length, 0);
      if (!stat.isFile() || stat.size < 28 || stat.size > 64 * 1024 * 1024 || result.bytesRead !== 12
        || header.toString('ascii', 0, 4) !== 'glTF' || header.readUInt32LE(4) !== 2 || header.readUInt32LE(8) !== stat.size) {
        issues.push(`${asset.source}：GLB 文件头或文件大小无效（上限 64 MiB）`);
      }
    } catch (error) {
      issues.push(`${asset.source}：${error.code === 'ENOENT' ? '文件不存在' : error.message}`);
    } finally { await file?.close(); }
  }
  if (issues.length) throw new Error(`默认素材检查失败，请在新电脑复制所需文件后重试：\n${issues.join('\n')}`);
}
