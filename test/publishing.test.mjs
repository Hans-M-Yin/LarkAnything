import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLarkAnything, FileReceiptStore, LarkCliBackend } from '../src/index.mjs';

async function setup(t, changes = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'larkanything-publish-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let writes = 0, reads = 0;
  const backend = {
    id: 'test', version: 1, scope: 'fixture', capabilities: { formats: ['markdown'], operations: ['create', 'append'], kinds: ['document'] },
    async publish(plan) { writes++; if (changes.writeError) throw new Error('network timeout'); return { documentId: 'test-doc', url: 'https://example.com/docx/test-doc' }; },
    async verify() { reads++; if (changes.failReadOnce && reads === 1) throw new Error('temporary read error'); return { passed: changes.mismatch ? false : true, method: 'fixture', visualVerified: false }; },
  };
  const engine = createLarkAnything({ config: { stateDir: dir, defaults: { target: { backend: 'test' } } }, backends: [backend] });
  const plan = await engine.plan({ channel: 'codex', input: 'examples/codex.jsonl', key: 'example-key' });
  return { dir, engine, plan, counts: () => ({ writes, reads }) };
}

test('A verified export is reused without another remote write or read', async t => {
  const { engine, plan, counts } = await setup(t);
  assert.equal((await engine.publish(plan)).status, 'verified');
  assert.equal((await engine.publish(plan)).reused, true);
  assert.deepEqual(counts(), { writes: 1, reads: 1 });
});

test('Failed readback retries only verification and preserves the remote receipt', async t => {
  const { engine, plan, counts } = await setup(t, { failReadOnce: true });
  await assert.rejects(engine.publish(plan), { code: 'READBACK_ERROR' });
  assert.equal((await engine.store.get(plan.exportKey)).remote.documentId, 'test-doc');
  assert.equal((await engine.publish(plan)).status, 'verified');
  assert.deepEqual(counts(), { writes: 1, reads: 2 });
});

test('Unknown write results are not automatically replayed', async t => {
  const { engine, plan, counts } = await setup(t, { writeError: true });
  await assert.rejects(engine.publish(plan), { code: 'WRITE_UNCERTAIN' });
  await assert.rejects(engine.publish(plan), { code: 'WRITE_UNCERTAIN' });
  assert.deepEqual(counts(), { writes: 1, reads: 0 });
  assert.equal((await engine.store.get(plan.exportKey)).status, 'uncertain');
});

test('Readback mismatch is not reported as success', async t => {
  const { engine, plan, counts } = await setup(t, { mismatch: true });
  await assert.rejects(engine.publish(plan), { code: 'READBACK_MISMATCH' });
  await assert.rejects(engine.publish(plan), { code: 'READBACK_MISMATCH' });
  assert.deepEqual(counts(), { writes: 1, reads: 2 });
});

test('Reusing a key for changed content or destination is rejected', async t => {
  const { engine, plan } = await setup(t);
  await engine.publish(plan);
  const changed = await engine.plan({ channel: 'codex', input: 'examples/codex.jsonl', title: 'Different title', key: plan.exportKey });
  await assert.rejects(engine.publish(changed), { code: 'KEY_CONFLICT' });
});

test('Tampered plans are rejected before any backend mutation', async t => {
  const { engine, plan, counts } = await setup(t);
  plan.artifact.body += 'injected';
  await assert.rejects(engine.publish(plan), { code: 'PLAN_MODIFIED' });
  assert.equal(counts().writes, 0);
});

test('Concurrent publishers cannot hold the same export key lock', async t => {
  const { dir } = await setup(t), store = new FileReceiptStore(dir);
  await store.withLock('key', async () => assert.rejects(store.withLock('key', async () => {}), { code: 'EXPORT_LOCKED' }));
  await store.withLock('key', async () => {});
});

test('Receipts do not persist conversation bodies or tool contents', async t => {
  const { engine, plan } = await setup(t);
  await engine.publish(plan);
  const text = await readFile(engine.store.file(plan.exportKey), 'utf8');
  assert.ok(!text.includes('请帮我'));
  assert.ok(!text.includes('run_tests'));
});

test('Lark backend passes data via stdin and arguments without shell interpolation', async () => {
  const calls = [];
  const backend = new LarkCliBackend({}, async (executable, args, options) => {
    calls.push({ executable, args, options });
    return { ok: true, data: { document: { document_id: 'd', url: 'https://example.com/docx/d' }, warnings: ['service warning'] } };
  });
  const body = 'literal `$(do-not-execute)`';
  const receipt = await backend.publish({ target: { operation: 'create', parentToken: 'folder' }, document: { title: '$(not-a-command)' }, artifact: { body } });
  assert.equal(calls[0].options.input, body);
  assert.deepEqual(calls[0].args, ['docs', '+create', '--title', '$(not-a-command)', '--parent-token', 'folder', '--doc-format', 'markdown', '--content', '-', '--as', 'user']);
  assert.equal(receipt.warnings[0].code, 'LARK_WARNING');
});

test('Lark updates accept successful responses without a nested document', async () => {
  for (const operation of ['append', 'overwrite']) {
    const calls = [];
    const backend = new LarkCliBackend({}, async (_executable, args) => {
      calls.push(args);
      return { ok: true, data: { document: { revision_id: 2 } } };
    });
    const receipt = await backend.publish({ target: { operation, documentId: 'existing-doc' }, artifact: { body: 'text' } });
    assert.equal(receipt.documentId, 'existing-doc');
    assert.ok(calls[0].includes(operation));
  }
  const backend = new LarkCliBackend({}, async () => ({ ok: true, data: {} }));
  await assert.rejects(backend.publish({ target: { operation: 'create' }, document: { title: 'test' }, artifact: { body: 'text' } }), { code: 'LARK_RECEIPT' });
});

test('Lark append uses explicit destination and verifies normalized full text', async () => {
  const calls = [];
  const backend = new LarkCliBackend({}, async (_executable, args) => {
    calls.push(args);
    return { ok: true, data: { document: { document_id: 'd', content: '# Title\n\n**Full** text END' } } };
  });
  const plan = { target: { operation: 'append', documentId: 'd' }, artifact: { body: '**Full** text END', verificationText: 'Full text END' } };
  const receipt = await backend.publish(plan);
  assert.ok(calls[0].includes('append'));
  assert.equal((await backend.verify(receipt, plan)).passed, true);
  plan.artifact.body += ' MISSING';
  assert.equal((await backend.verify(receipt, plan)).passed, false);
});

test('Lark readback tolerates inline markup changes without inventing spaces', async () => {
  let content = '<title>Export</title>\n\n已经按这个思路实现了**首版**，放在独立的目录。\n\n写了：README.md。\n\n```js\nconst value = "a b";\n```';
  const backend = new LarkCliBackend({}, async () => ({ ok: true, data: { document: { document_id: 'd', content } } }));
  const plan = { artifact: { body: '已经按这个思路实现了**首版**，放在独立的[目录](/local/path)。\n\n写了：[README.md](/local/README.md)。\n\n```js\nconst value = "a b";\n```', verificationText: 'legacy text with extra token-boundary spaces' } };
  assert.equal((await backend.verify({ documentId: 'd' }, plan)).passed, true);
  content = content.replace('放在独立的目录', '放在目录');
  assert.equal((await backend.verify({ documentId: 'd' }, plan)).passed, false);
});

test('Lark readback preserves authored spaces and code text when matching', async () => {
  let content = 'Prefix **joined**word and a b\n\n```text\n<tag> literal\n```';
  const backend = new LarkCliBackend({}, async () => ({ ok: true, data: { document: { document_id: 'd', content } } }));
  const plan = { artifact: { body: '**joined**word and a b\n\n```text\n<tag> literal\n```' } };
  assert.equal((await backend.verify({ documentId: 'd' }, plan)).passed, true);
  content = content.replace('a b', 'ab');
  assert.equal((await backend.verify({ documentId: 'd' }, plan)).passed, false);
  plan.artifact.body = '';
  assert.equal((await backend.verify({ documentId: 'd' }, plan)).passed, false);
});

test('Readback tolerates only source link boundaries and reports the normalization', async () => {
  let content = '<title>Export</title>\n\n$paper-readhttps://example.com 读一下。';
  const backend = new LarkCliBackend({}, async () => ({ ok: true, data: { document: { document_id: 'd', content } } }));
  const plan = { artifact: { body: '[$paper-read](https://example.com/skill) [https://example.com](https://example.com) 读一下。' } };
  const verified = await backend.verify({ documentId: 'd' }, plan);
  assert.equal(verified.passed, true);
  assert.deepEqual(verified.normalizations, ['link-boundary-whitespace']);
  content = content.replace('读一下', '读');
  const mismatch = await backend.verify({ documentId: 'd' }, plan);
  assert.equal(mismatch.passed, false);
  assert.equal(mismatch.difference.kind, 'text');
});

test('Readback never ignores code whitespace, indentation or lost code structure', async () => {
  let content;
  const backend = new LarkCliBackend({}, async () => ({ ok: true, data: { document: { document_id: 'd', content } } }));
  for (const body of ['Use `a b` here.', '```python\nif ready:\n    run("a b")\n```']) {
    const plan = { artifact: { body } };
    content = body;
    assert.equal((await backend.verify({ documentId: 'd' }, plan)).passed, true);
    content = body.replace('a b', 'ab');
    const mismatch = await backend.verify({ documentId: 'd' }, plan);
    assert.equal(mismatch.passed, false);
    assert.equal(mismatch.difference.kind, 'code');
  }
  content = 'a b';
  assert.equal((await backend.verify({ documentId: 'd' }, { artifact: { body: '`a b`' } })).passed, false);
});

test('Saved plans reject a different configured backend identity before a write', async t => {
  const { engine, plan, counts } = await setup(t);
  engine.backends.get('test').scope = 'another-identity';
  await assert.rejects(engine.publish(plan), { code: 'PLAN_IDENTITY' });
  assert.equal(counts().writes, 0);
});

test('A fetched title cannot substitute for missing body text', async () => {
  const backend = new LarkCliBackend({}, async () => ({ ok: true, data: { document: { document_id: 'd', content: '<title>Expected body</title>\n\nDifferent body' } } }));
  const result = await backend.verify({ documentId: 'd' }, { artifact: { body: 'Expected body' } });
  assert.equal(result.passed, false);
});
