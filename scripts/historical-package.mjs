// Build immutable historical source without switching the shared working tree.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
import { packager } from '@electron/packager';
import { assertAppDistribution } from './distribution.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sources = { '0.1.0': '7ea0cbc', '0.2.0': '402bbf8' };
const version = process.argv[2];
if (!Object.hasOwn(sources, version)) throw new Error('Usage: node scripts/historical-package.mjs 0.1.0|0.2.0');
const commit = execFileSync('git', ['rev-parse', `${sources[version]}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
const directory = path.join(root, '.cache', `historical-${version}-${Date.now()}`);
const source = path.join(directory, 'source');
const stage = path.join(directory, 'app');
const archive = path.join(directory, 'source.tar');
await mkdir(source, { recursive: true }); await mkdir(stage, { recursive: true });
execFileSync('git', ['archive', '--format=tar', '--output', archive, commit], { cwd: root });
execFileSync('tar', ['-xf', archive, '-C', source]);
const metadata = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
if (metadata.version !== version) throw new Error('Historical package version mismatch');
// Exclude all public model files. Historical sources and application behavior are otherwise unchanged.
await build({ root: source, publicDir: false, build: { outDir: 'dist', emptyOutDir: true } });
for (const folder of ['dist', 'electron']) await cp(path.join(source, folder), path.join(stage, folder), { recursive: true });
await writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: metadata.name, productName: 'OiGptPet', version, main: metadata.main, private: true }));
await cp(path.join(source, 'public/models/README.md'), path.join(stage, 'THIRD_PARTY_MODEL_NOTICE.md'));
await assertAppDistribution(stage);
const electronVersion = JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const cache = path.join(root, '.cache/electron-downloads');
const cached = (await readdir(cache, { recursive: true })).find((name) => path.basename(name) === `electron-v${electronVersion}-win32-x64.zip`);
const outputRoot = path.join(root, 'release', `historical-v${version}-${Date.now()}`);
const output = await packager({
  dir: stage, out: outputRoot, name: 'OiGptPet', platform: 'win32', arch: 'x64',
  asar: false, electronVersion, electronZipDir: cached ? path.dirname(path.join(cache, cached)) : undefined,
  prune: false, overwrite: false,
});
await assertAppDistribution(path.join(output[0], 'resources/app'));
const provenance = { version, commit, directory: path.relative(path.join(root, 'release'), output[0]).split(path.sep).join('/'), publicModelsIncluded: false, electronVersion };
await writeFile(path.join(outputRoot, 'source-info.json'), JSON.stringify(provenance, null, 2));
await mkdir(path.join(root, 'artifacts/github-release'), { recursive: true });
await writeFile(path.join(root, `artifacts/github-release/v${version}-build.json`), JSON.stringify(provenance, null, 2));
console.log(JSON.stringify(provenance));
