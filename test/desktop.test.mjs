import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopService } from '../desktop/service.mjs';
import { createLarkAnything } from '../src/index.mjs';

test('desktop settings preserve existing profiles and normalize destination links', async t => {
  const root = await mkdtemp(join(tmpdir(), 'la-desktop-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'config.json'), JSON.stringify({ version: 1, profiles: { work: { target: { namespace: 'work' } } } }));
  const service = new DesktopService({ root });
  await service.saveSettings({ parentToken: 'https://example.feishu.cn/drive/folder/abc123', includeTools: false, executable: 'lark-cli' });
  const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
  assert.equal(config.defaults.target.parentToken, 'abc123'); assert.equal(config.profiles.work.target.namespace, 'work');
  await assert.rejects(service.saveSettings({ parentToken: 'https://evil.test/folder/x', includeTools: false, executable: 'lark-cli' }));
});

test('vault discovery, frozen preview and persisted plan use Core without uploading', async t => {
  const root = await mkdtemp(join(tmpdir(), 'la-vault-')); t.after(() => rm(root, { recursive: true, force: true }));
  const vault = join(root, 'vault'); await mkdir(vault); await mkdir(join(vault, '.private'));
  await writeFile(join(vault, 'Idea.md'), '# First\n\nAn idea and [[link]].'); await writeFile(join(vault, '.private', 'hidden.md'), 'hidden');
  const service = new DesktopService({ root });
  await service.saveSettings({ parentToken: '', includeTools: false, executable: 'lark-cli', vault });
  const items = await service.list('obsidian'); assert.equal(items.length, 1); assert.equal(items[0].title, 'Idea');
  const preview = await service.preview(items[0].id); assert.equal(preview.operation, 'create'); assert.match(preview.html, /An idea/);
  await writeFile(join(vault, 'Idea.md'), 'Changed');
  const frozen = service.plans.get(preview.token).plan; assert.match(frozen.artifact.body, /An idea/); assert.equal(frozen.artifact.warnings[0].code, 'OBSIDIAN_REFERENCES');
  const persisted = JSON.parse(await readFile(join(root, 'desktop-previews', frozen.fingerprint, 'plan.json'), 'utf8')); assert.equal(persisted.fingerprint, frozen.fingerprint);
  assert.equal((await service.list('obsidian'))[0].excerpt, 'Changed');
  await assert.rejects(service.preview('unlisted-file')); await assert.rejects(service.publish('invalid-token'));
});

test('desktop publish uses frozen Core plan and repeat upload reuses verified receipt', async t => {
  const root = await mkdtemp(join(tmpdir(), 'la-publish-')); t.after(() => rm(root, { recursive: true, force: true }));
  const vault = join(root, 'vault'); await mkdir(vault); await writeFile(join(vault, 'note.md'), 'Original snapshot');
  const writes = [];
  const backend = { id: 'desktop-test', version: 1, capabilities: { formats: ['markdown'], operations: ['create'], kinds: ['document'] },
    async publish(plan) { writes.push(plan.artifact.body); return { documentId: 'test-doc' }; },
    async verify() { return { passed: true, method: 'test', visualVerified: false }; } };
  const service = new DesktopService({ root, engineFactory: options => {
    options.config.defaults = { ...options.config.defaults, target: { backend: backend.id } };
    return createLarkAnything({ ...options, backends: [backend] });
  } });
  await service.saveSettings({ parentToken: '', includeTools: false, executable: 'lark-cli', vault });
  const item = (await service.list('obsidian'))[0]; const preview = await service.preview(item.id);
  await writeFile(join(vault, 'note.md'), 'New edit after preview');
  assert.equal((await service.publish(preview.token)).status, 'verified');
  assert.equal((await service.publish(preview.token)).reused, true);
  assert.equal(writes.length, 1); assert.match(writes[0], /Original snapshot/); assert.doesNotMatch(writes[0], /New edit/);
});
