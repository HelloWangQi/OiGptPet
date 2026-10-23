// Explicit publishing only; credentials stay in memory and go only to GitHub.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const repo = 'HelloWangQi/OiGptPet';
const artifactRoot = path.join(root, 'artifacts/github-release');
const versions = ['0.1.0', '0.2.0', '0.3.0'];
const historicalCommits = { '0.1.0': '7ea0cbc70f19a835610b80e8bbf714626d76fef9', '0.2.0': '402bbf8397b16cc3c11c1fa9a4cd39cf7ec29598' };
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const command = process.argv[2];
  if (!['--status', '--publish'].includes(command)) throw new Error('Use --status or --publish. Publishing requires a clean, pushed checkpoint and prepared archives.');
  if (git(['remote', 'get-url', 'origin']) !== `https://github.com/${repo}.git`) throw new Error('Unexpected repository remote');
  let credential;
  try {
    const output = execFileSync('git', ['-c', 'credential.interactive=false', 'credential', 'fill'], {
      cwd: root, encoding: 'utf8', input: 'protocol=https\nhost=github.com\n\n',
      env: { ...process.env, GCM_INTERACTIVE: 'never' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    credential = output.split(/\r?\n/).find((line) => line.startsWith('password='))?.slice(9);
  } catch { throw new Error('GitHub Git credential unavailable. Use the normal GitHub sign-in flow.'); }
  if (!credential) throw new Error('GitHub Git credential unavailable');
  const headers = { Authorization: `Bearer ${credential}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'OiGptPet-release' };
  async function request(endpoint, { method = 'GET', json, bytes, optional = false } = {}) {
    const upload = endpoint.startsWith('UPLOAD:');
    const url = upload ? `https://uploads.github.com/repos/${repo}/${endpoint.slice(7)}` : `https://api.github.com/repos/${repo}/${endpoint}`;
    const response = await fetch(url, {
      method, redirect: 'error', headers: { ...headers, ...(json ? { 'Content-Type': 'application/json' } : {}), ...(bytes ? { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) } : {}) },
      body: bytes ?? (json ? JSON.stringify(json) : undefined), signal: AbortSignal.timeout(bytes ? 600000 : 60000),
    });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${endpoint.split('?')[0]} failed (HTTP ${response.status}).`);
    return response.json();
  }
  if (command === '--status') {
    const releases = await request('releases?per_page=20');
    console.log(JSON.stringify(releases.map((release) => ({ tag: release.tag_name, draft: release.draft, url: release.html_url, assets: release.assets.map((asset) => ({ name: asset.name, bytes: asset.size })) })), null, 2));
    return;
  }
  if (git(['status', '--porcelain'])) throw new Error('Commit all checkpoint files before publishing');
  const head = git(['rev-parse', 'HEAD']);
  const branch = git(['branch', '--show-current']);
  if (branch !== 'codex/desktop-prototype') throw new Error('Unexpected checkpoint branch');
  if (git(['ls-remote', 'origin', `refs/heads/${branch}`]).split(/\s/)[0] !== head) throw new Error('Push the checkpoint branch before publishing');
  const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8'));
  if (manifest.length !== versions.length || versions.some((version, i) => manifest[i].version !== version)) throw new Error('Unexpected release manifest');
  // Validate every source, archive and checksum before creating the first release.
  for (const entry of manifest) {
    if (entry.commit !== (historicalCommits[entry.version] ?? head)) throw new Error('Release source commit mismatch');
    if (entry.assets.length !== 2) throw new Error('Expected ZIP and SHA-256 checksum per release');
    const expected = [`OiGptPet-v${entry.version}-win32-x64.zip`, `OiGptPet-v${entry.version}-SHA256SUMS.txt`];
    for (const [i, asset] of entry.assets.entries()) {
      if (asset.name !== expected[i]) throw new Error('Unexpected release asset name');
      const bytes = await readFile(path.join(artifactRoot, asset.name));
      if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) throw new Error(`Asset changed: ${asset.name}`);
    }
  }
  const published = [];
  for (const entry of manifest) {
    const tag = `v${entry.version}`;
    const existingTag = await request(`git/ref/tags/${tag}`, { optional: true });
    if (existingTag && (existingTag.object.type !== 'commit' || existingTag.object.sha !== entry.commit)) throw new Error(`Existing tag ${tag} differs; refusing to move it`);
    const body = `${await readFile(path.join(root, 'docs/releases', `${tag}.md`), 'utf8')}\n\n源码提交：\`${entry.commit}\`。`;
    let release = await request(`releases/tags/${tag}`, { optional: true });
    if (!release) release = await request('releases', { method: 'POST', json: { tag_name: tag, target_commitish: entry.commit, name: `OiGptPet ${tag}`, body, draft: true, prerelease: false } });
    for (const asset of entry.assets) {
      const existing = release.assets.find((item) => item.name === asset.name);
      if (existing) {
        if (existing.state !== 'uploaded' || existing.size !== asset.bytes || existing.digest !== `sha256:${asset.sha256}`) throw new Error(`Existing asset differs: ${asset.name}; no asset was deleted`);
        continue;
      }
      const uploaded = await request(`UPLOAD:releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`, { method: 'POST', bytes: await readFile(path.join(artifactRoot, asset.name)) });
      if (uploaded.state !== 'uploaded' || uploaded.size !== asset.bytes || uploaded.digest !== `sha256:${asset.sha256}`) throw new Error(`Upload checksum mismatch: ${asset.name}`);
      console.log(`Uploaded ${tag}: ${asset.name}`);
    }
    release = await request(`releases/${release.id}`, { method: 'PATCH', json: { name: `OiGptPet ${tag}`, body, draft: false, prerelease: false, make_latest: entry.version === '0.3.0' ? 'true' : 'false' } });
    const finalTag = await request(`git/ref/tags/${tag}`);
    if (finalTag.object.type !== 'commit' || finalTag.object.sha !== entry.commit) throw new Error(`Published tag ${tag} source mismatch`);
    for (const asset of entry.assets) {
      const actual = release.assets.find((item) => item.name === asset.name);
      if (!actual || actual.state !== 'uploaded' || actual.digest !== `sha256:${asset.sha256}`) throw new Error(`Final release asset verification failed: ${asset.name}`);
    }
    published.push({ version: entry.version, commit: entry.commit, url: release.html_url, assets: release.assets.map(({ name, size, digest, browser_download_url }) => ({ name, bytes: size, digest, url: browser_download_url })) });
    await writeFile(path.join(artifactRoot, 'published.json'), JSON.stringify(published, null, 2));
    console.log(`Published ${release.html_url}`);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
