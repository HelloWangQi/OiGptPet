import packager from '@electron/packager';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const stage = new URL(`.cache/package-${Date.now()}/`, root);
await mkdir(stage, { recursive: true });
for (const folder of ['dist', 'electron']) await cp(new URL(`${folder}/`, root), new URL(`${folder}/`, stage), { recursive: true });
const metadata = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
await writeFile(new URL('package.json', stage), JSON.stringify({ name: metadata.name, productName: 'OiGptPet', version: metadata.version, main: metadata.main, private: true }));
await cp(new URL('public/models/README.md', root), new URL('THIRD_PARTY_MODEL_NOTICE.md', stage));
const output = await packager({
  dir: fileURLToPath(stage), out: fileURLToPath(new URL('release/', root)),
  name: 'OiGptPet', platform: 'win32', arch: 'x64', asar: false,
  electronVersion: JSON.parse(await readFile(new URL('node_modules/electron/package.json', root), 'utf8')).version,
  prune: false, overwrite: false,
});
console.log(output.join('\n'));
