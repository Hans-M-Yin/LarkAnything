import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLarkAnything } from '../src/index.mjs';

const message = (id, role = 'user', text = id, extra = {}) => ({ id, role, content: [{ type: 'text', format: 'markdown', text }], ...extra });

async function setup(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'larkanything-sync-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const model = { version: 1, kind: 'conversation', id: 'session-1', title: 'Conversation', source: { channel: 'sync-fixture' },
    messages: [message('question'), message('answer', 'assistant')] };
  const writes = [], reads = [];
  let writeError = false, readError = false, mismatch = false, nextDocument = 0;
  const backend = { id: 'sync-backend', version: 1, scope: 'user',
    capabilities: { formats: ['markdown'], operations: ['create', 'append'], kinds: ['document'] },
    async publish(plan) {
      writes.push(plan);
      if (writeError) throw new Error('unknown write result');
      const documentId = plan.target.documentId || `doc-${++nextDocument}`;
      return { documentId, url: `https://example.com/docx/${documentId}` };
    },
    async verify(remote, plan) {
      reads.push({ remote, plan });
      if (readError) throw new Error('readback unavailable');
      return { passed: !mismatch, method: 'fixture', visualVerified: false };
    } };
  const adapter = { id: 'sync-fixture', version: 1, async load() { return structuredClone(model); } };
  const engine = () => createLarkAnything({ config: { stateDir, defaults: { target: { backend: backend.id } } }, adapters: [adapter], backends: [backend] });
  const request = { channel: adapter.id, input: 'fixture' };
  return { stateDir, model, writes, reads, backend, engine, request,
    failWrite(value) { writeError = value; }, failRead(value) { readError = value; }, mismatch(value) { mismatch = value; } };
}

test('Default sync survives a restart, reuses the document and appends only new messages', async t => {
  const c = await setup(t);
  const firstPlan = await c.engine().plan(c.request);
  assert.equal(firstPlan.target.operation, 'create');
  const first = await c.engine().publish(firstPlan);
  c.model.messages.push(message('next question'), message('next answer', 'assistant'));
  const next = await c.engine().plan(c.request);
  assert.equal(next.target.operation, 'append');
  assert.equal(next.target.documentId, first.remote.documentId);
  assert.equal(next.document.coverage.publishedMessages, 2);
  assert.doesNotMatch(next.artifact.body, /对话实录|会话:|01 ·|02 ·/);
  assert.match(next.artifact.body, /03 · 用户/);
  assert.match(next.artifact.body, /04 · 助手/);
  assert.match(next.artifact.body, /next question/);
  assert.match(next.artifact.body, /next answer/);
  assert.equal((await c.engine().publish(next)).remote.url, first.remote.url);
  assert.equal(c.writes.length, 2);
  assert.deepEqual(c.writes.map(plan => plan.sync.messages.length), [2, 4]);
  const unchanged = await c.engine().plan(c.request);
  assert.equal(unchanged.sync.unchanged, true);
  assert.equal(unchanged.artifact.body, '');
  assert.equal((await c.engine().publish(unchanged)).reused, true);
  const again = await c.engine().plan(c.request);
  assert.equal(again.exportKey, unchanged.exportKey);
  assert.equal((await c.engine().publish(again)).remote.documentId, first.remote.documentId);
  assert.equal(c.writes.length, 2);
  assert.equal(c.reads.length, 2);
  // No-op receipts must not move the checkpoint used by a later append.
  c.model.messages.push(message('third question'));
  const third = await c.engine().plan(c.request);
  assert.equal(third.sync.previousExportKey, next.exportKey);
  assert.equal(third.document.coverage.publishedMessages, 1);
  assert.match(third.artifact.body, /05 · 用户/);
  await c.engine().publish(third);
});

test('Conversation ids, channels, namespaces, identities and parent destinations have separate bindings', async t => {
  const c = await setup(t);
  const first = await c.engine().plan(c.request);
  await c.engine().publish(first);
  c.model.id = 'different-session';
  assert.equal((await c.engine().plan(c.request)).target.operation, 'create');
  c.model.id = 'session-1';
  for (const target of [{ namespace: 'team' }, { parentToken: 'folder' }]) {
    const plan = await c.engine().plan({ ...c.request, overrides: { target } });
    assert.equal(plan.target.operation, 'create');
    assert.notEqual(plan.sync.key, first.sync.key);
  }
  c.backend.scope = 'bot';
  assert.equal((await c.engine().plan(c.request)).target.operation, 'create');
  c.backend.scope = 'user';
  const engine = c.engine();
  engine.adapters.add({ id: 'other-channel', version: 1, async load() { return c.model; } });
  assert.equal((await engine.plan({ ...c.request, channel: 'other-channel' })).target.operation, 'create');
});

test('Changed, truncated or reordered published history is rejected without a write', async t => {
  const c = await setup(t);
  await c.engine().publish(await c.engine().plan(c.request));
  const original = structuredClone(c.model.messages);
  for (const messages of [
    [message('question', 'user', 'edited'), original[1]],
    original.slice(1), [...original].reverse(),
    [original[0], message('inserted'), original[1]],
  ]) {
    c.model.messages = messages;
    await assert.rejects(c.engine().plan(c.request), { code: 'SYNC_HISTORY_CHANGED' });
  }
  assert.equal(c.writes.length, 1);
});

test('Moved source references and excluded tools do not resend published text', async t => {
  const c = await setup(t);
  c.model.messages[0].sourceRefs = [{ uri: '/old/log', line: 2 }];
  await c.engine().publish(await c.engine().plan(c.request));
  c.model.messages[0].sourceRefs = [{ uri: '/new/log', line: 200 }];
  c.model.messages.push({ id: 'tool-1', role: 'tool', content: [{ type: 'tool', text: 'excluded secret' }] });
  const plan = await c.engine().plan(c.request);
  assert.equal(plan.sync.unchanged, true);
  await c.engine().publish(plan);
  assert.equal(c.writes.length, 1);
  const tools = await c.engine().plan({ ...c.request, overrides: { format: { includeTools: true } } });
  assert.equal(tools.document.coverage.publishedMessages, 1);
  assert.match(tools.artifact.body, /excluded secret/);
  assert.doesNotMatch(tools.artifact.body, /question|answer/);
});

test('New messages in an already published assistant turn are appended without repeating earlier steps', async t => {
  const c = await setup(t);
  c.model.messages[1] = message('progress', 'assistant', 'old progress', { phase: 'commentary', turnId: 'turn-1' });
  await c.engine().publish(await c.engine().plan(c.request));
  c.model.messages.push(message('final', 'assistant', 'new final', { phase: 'final', turnId: 'turn-1' }));
  const plan = await c.engine().plan(c.request);
  assert.doesNotMatch(plan.artifact.body, /old progress|question/);
  assert.match(plan.artifact.body, /new final/);
  await c.engine().publish(plan);
});

test('A stale frozen plan cannot append content already published by another plan', async t => {
  const c = await setup(t);
  await c.engine().publish(await c.engine().plan(c.request));
  c.model.messages.push(message('second'));
  const second = await c.engine().plan(c.request);
  c.model.messages.push(message('third'));
  const stale = await c.engine().plan(c.request);
  await c.engine().publish(second);
  await assert.rejects(c.engine().publish(stale), { code: 'SYNC_STALE_PLAN' });
  assert.equal(c.writes.length, 2);
  const refreshed = await c.engine().plan(c.request);
  assert.equal(refreshed.document.coverage.publishedMessages, 1);
  assert.match(refreshed.artifact.body, /third/);
  assert.doesNotMatch(refreshed.artifact.body, /second/);
  await c.engine().publish(refreshed);
  assert.equal((await c.engine().publish(second)).reused, true);
  assert.equal(c.writes.length, 3);
});

test('A failed append readback blocks new exports and retries the frozen delta without another write', async t => {
  const c = await setup(t);
  await c.engine().publish(await c.engine().plan(c.request));
  c.model.messages.push(message('second'));
  const second = JSON.parse(JSON.stringify(await c.engine().plan(c.request)));
  c.failRead(true);
  await assert.rejects(c.engine().publish(second), { code: 'READBACK_ERROR' });
  c.model.messages.push(message('third'));
  await assert.rejects(c.engine().plan(c.request), { code: 'SYNC_PENDING' });
  c.failRead(false);
  await c.engine().publish(second);
  assert.equal(c.writes.length, 2);
  assert.equal(c.reads.length, 3);
  const third = await c.engine().plan(c.request);
  assert.equal(third.document.coverage.publishedMessages, 1);
  assert.match(third.artifact.body, /third/);
});

test('An uncertain write blocks new keys and changed content for the same conversation', async t => {
  const c = await setup(t);
  const first = await c.engine().plan(c.request);
  c.failWrite(true);
  await assert.rejects(c.engine().publish(first), { code: 'WRITE_UNCERTAIN' });
  c.failWrite(false);
  c.model.messages.push(message('second'));
  await assert.rejects(c.engine().plan({ ...c.request, key: 'another-key' }), { code: 'WRITE_UNCERTAIN' });
  await assert.rejects(c.engine().publish(first), { code: 'WRITE_UNCERTAIN' });
  assert.equal(c.writes.length, 1);
});

test('Conversation lock prevents concurrent publishes with different export keys', async t => {
  const c = await setup(t);
  const plan = await c.engine().plan(c.request);
  await c.engine().store.withLock(plan.sync.key, async () => {
    await assert.rejects(c.engine().publish(plan), { code: 'EXPORT_LOCKED' });
  });
  assert.equal(c.writes.length, 0);
});

test('Session state persists ids and hashes without retaining conversation bodies', async t => {
  const c = await setup(t);
  c.model.messages[0].content[0].text = 'PRIVATE_CONVERSATION_TEXT';
  const plan = await c.engine().plan(c.request);
  await c.engine().publish(plan);
  for (const name of await readdir(c.stateDir)) {
    const text = await readFile(join(c.stateDir, name), 'utf8');
    assert.doesNotMatch(text, /PRIVATE_CONVERSATION_TEXT/);
    assert.match(JSON.parse(text).sync.messages[0].hash, /^[a-f0-9]{64}$/);
  }
});

test('Explicit create and append preserve their original whole-export behavior', async t => {
  const c = await setup(t);
  const create = { ...c.request, overrides: { target: { operation: 'create' } } };
  const first = await c.engine().publish(await c.engine().plan(create));
  c.model.messages.push(message('second'));
  const second = await c.engine().publish(await c.engine().plan(create));
  assert.notEqual(first.remote.documentId, second.remote.documentId);
  const append = await c.engine().plan({ ...c.request, overrides: { target: { operation: 'append', documentId: first.remote.documentId } } });
  assert.equal(append.sync, undefined);
  assert.equal(append.document.coverage.publishedMessages, 3);
  assert.match(append.artifact.body, /question/);
});
