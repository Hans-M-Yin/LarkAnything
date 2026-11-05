import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

test('native stdio bridge lists and previews through Core, rejects unknown methods and survives errors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'la-native-'));
  const vault = join(root, 'vault'); await mkdir(vault); await writeFile(join(vault, 'Native.md'), '# 原生界面\n\nShared Core');
  const child = spawn(process.execPath, ['native/bridge.mjs', '--root', root], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  t.after(async () => { child.kill(); await rm(root, { recursive: true, force: true }); });
  let id = 0;
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { const response = JSON.parse(line); pending.get(response.id)?.(response); pending.delete(response.id); });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timeout = setTimeout(() => { pending.delete(key); reject(new Error('Bridge response timeout')); }, 10000);
    pending.set(key, value => { clearTimeout(timeout); resolve(value); });
    child.stdin.write(JSON.stringify({ version: 1, id: key, method, params }) + '\n');
  });
  assert.equal((await request('settings')).value.executable, 'lark-cli');
  assert.equal((await request('constructor')).ok, false);
  assert.equal((await request('publish', { token: 'missing' })).ok, false);
  const settings = { parentToken: '', includeTools: false, executable: 'lark-cli', vault };
  assert.equal((await request('saveSettings', { settings })).ok, true);
  const listed = await request('list', { channel: 'obsidian' });
  assert.equal(listed.value.length, 1);
  const preview = await request('preview', { id: listed.value[0].id });
  assert.equal(preview.ok, true); assert.match(preview.value.html, /Shared Core/); assert.equal(preview.value.operation, 'create');
  // Ordered requests preserve settings mutations; stdout remains pure JSON.
  const [updated, read] = await Promise.all([request('saveSettings', { settings: { ...settings, parentToken: 'newFolder' } }), request('settings')]);
  assert.equal(updated.ok, true); assert.equal(read.value.parentToken, 'newFolder');
  child.stdin.end();
  await new Promise((resolve, reject) => { child.once('exit', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`))); });
});
