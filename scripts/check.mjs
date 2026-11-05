import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';

async function walk(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (['node_modules', '.larkanything', '.git', '.build', '.swiftpm'].includes(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await walk(child));
    else result.push(child);
  }
  return result;
}
const files = await walk('.');
for (const path of files.filter(p => p.endsWith('.mjs'))) execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
for (const path of files.filter(p => p.endsWith('.json'))) JSON.parse(await readFile(path, 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
for (const path of ['plugin.json', '.codex-plugin/plugin.json']) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(manifest.name, pkg.name);
  assert.equal(manifest.version, pkg.version);
}
const marketplace = JSON.parse(await readFile('.agents/plugins/marketplace.json', 'utf8'));
assert.equal(marketplace.plugins[0].source.path, './');
console.log(`Checked syntax, JSON, and package/plugin version consistency (${files.length} files).`);
