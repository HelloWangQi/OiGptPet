import { packager } from '@electron/packager';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertClientDistribution, assertAppDistribution } from './distribution.mjs';
import { retainPackages } from './package-retention.mjs';
import { DEFAULT_ASSETS, checkDefaultAssets } from './default-assets.mjs';

const root = new URL('../', import.meta.url);
const runId = Date.now();
const stage = new URL(`.cache/package-${runId}/`, root);
await assertClientDistribution(fileURLToPath(new URL('dist/', root)));
await checkDefaultAssets(fileURLToPath(root));
await mkdir(stage, { recursive: true });
for (const folder of ['dist', 'electron']) await cp(new URL(`${folder}/`, root), new URL(`${folder}/`, stage), { recursive: true });
await mkdir(new URL('defaults/', stage), { recursive: true });
for (const { source, name } of DEFAULT_ASSETS) {
  try { await cp(new URL(source, root), new URL(`defaults/${name}`, stage)); }
  catch (error) { throw new Error(`打包缺少默认素材 ${source}：${error.message}`); }
}
const metadata = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
await writeFile(new URL('package.json', stage), JSON.stringify({ name: metadata.name, productName: 'OiGptPet', version: metadata.version, main: metadata.main, private: true }));
await cp(new URL('public/models/README.md', root), new URL('THIRD_PARTY_MODEL_NOTICE.md', stage));
await assertAppDistribution(fileURLToPath(stage));
if (process.argv.includes('--stage-only')) {
  console.log(fileURLToPath(stage));
  process.exit(0);
}
const electronVersion = JSON.parse(await readFile(new URL('node_modules/electron/package.json', root), 'utf8')).version;
let electronZipDir;
try {
  const cache = fileURLToPath(new URL('.cache/electron-downloads/', root));
  const zip = (await readdir(cache, { recursive: true })).find((name) => path.basename(name) === `electron-v${electronVersion}-win32-x64.zip`);
  if (zip) electronZipDir = path.dirname(path.join(cache, zip));
} catch { /* Packager can fetch its official distribution when no local cache exists. */ }
const output = await packager({
  dir: fileURLToPath(stage), out: fileURLToPath(new URL(`release/v${metadata.version}-${runId}/`, root)),
  name: 'OiGptPet', platform: 'win32', arch: 'x64', asar: false,
  electronVersion, electronZipDir,
  prune: false, overwrite: false,
});
for (const folder of output) await assertAppDistribution(path.join(folder, 'resources', 'app'));
await writeFile(new URL('release/latest.json', root), JSON.stringify({
  version: metadata.version, createdAt: new Date().toISOString(),
  directory: path.relative(fileURLToPath(new URL('release/', root)), output[0]).split(path.sep).join('/'),
}, null, 2));
console.log(output.join('\n'));
const retention = await retainPackages(fileURLToPath(new URL('release/', root)), { apply: true });
console.log(JSON.stringify(retention));
if (retention.deferred.length) console.warn(`正在运行或被占用的旧包暂时保留：${retention.deferred.join(', ')}。关闭旧版后，下次打包会重试清理。`);
