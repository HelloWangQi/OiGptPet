import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = 'https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';
const expectedHash = '12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2';
// A content hash prevents silently replacing the licensed, inspected sample if upstream changes.
let bytes;
if (process.argv.includes('--cached')) {
  bytes = await readFile(new URL('../.cache/official-sample.vrm', import.meta.url));
} else {
  const response = await fetch(source, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Demo download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== expectedHash) throw new Error('Official sample changed; review its metadata and license before updating the pinned hash.');
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8').trim());
const meta = json.extensions.VRMC_vrm.meta;
if (!meta.allowRedistribution || meta.avatarPermission !== 'everyone') throw new Error('Sample permissions do not match the reviewed model.');
const destination = new URL('../public/models/', import.meta.url);
await mkdir(destination, { recursive: true });
await writeFile(new URL('demo.vrm', destination), bytes);
await writeFile(new URL('demo-source.json', destination), JSON.stringify({ source, sha256, meta }, null, 2));
console.log(`Official sample ready: ${(bytes.length / 1024 / 1024).toFixed(1)} MiB. Source and original metadata saved alongside the model.`);
