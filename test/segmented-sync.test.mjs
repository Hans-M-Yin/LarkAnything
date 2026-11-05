import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLarkAnything } from '../src/index.mjs';
import { verifyMarkdownReadback } from '../src/backends/readback.mjs';

const time = n => `2026-11-05T00:00:0${n}Z`;
const header = n => ({ type: 'session_meta', payload: { id: 'segmented-sync', timestamp: time(n) } });
const message = (id, role, text, n) => ({ type: 'response_item', timestamp: time(n), payload: { type: 'message', id, role, content: [{ type: 'text', text }] } });
const save = (path, records) => writeFile(path, records.map(JSON.stringify).join('\n') + '\n');

test('Segment assembly stays stable through rename, overlap and incremental synchronization', async t => {
  const root = await mkdtemp(join(tmpdir(), 'larkanything-segment-sync-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexHome = join(root, 'codex'), sessions = join(codexHome, 'sessions');
  await mkdir(sessions, { recursive: true });
  const original = join(sessions, 'original.jsonl');
  const user = message(undefined, 'user', 'first question', 2);
  const answer = message('a1', 'assistant', 'first answer', 3);
  await save(original, [header(1), user, answer]);
  let body = '';
  const writes = [];
  const backend = { id: 'segmented-fixture', version: 1, capabilities: { formats: ['markdown'], operations: ['create', 'append'], kinds: ['document'] },
    async publish(plan) {
      writes.push(plan.target.operation);
      body += `${body ? '\n\n' : ''}${plan.artifact.body}`;
      return { documentId: 'same-document' };
    },
    async verify(remote, plan) {
      assert.equal(remote.documentId, 'same-document');
      return verifyMarkdownReadback(plan.artifact.body, body);
    } };
  const engine = createLarkAnything({ config: { stateDir: join(root, 'state'), defaults: { target: { backend: backend.id } } }, backends: [backend] });
  const request = { channel: 'codex', session: 'segmented-sync', sourceOptions: { codexHome } };
  const first = await engine.plan(request);
  assert.equal(first.target.operation, 'create');
  await engine.publish(first);
  await rename(original, join(sessions, 'renamed.jsonl'));
  await save(join(sessions, 'continuation.jsonl'), [header(4), user, answer,
    message('u2', 'user', 'new question', 5), message('a2', 'assistant', 'new answer', 6)]);
  const second = await engine.plan(request);
  assert.equal(second.target.operation, 'append');
  assert.equal(second.target.documentId, 'same-document');
  assert.equal(second.document.coverage.publishedMessages, 2);
  assert.match(second.artifact.body, /new answer/);
  assert.doesNotMatch(second.artifact.body, /first answer/);
  assert.equal((await engine.publish(second)).status, 'verified');
  const unchanged = await engine.plan(request);
  assert.equal(unchanged.sync.unchanged, true);
  assert.equal((await engine.publish(unchanged)).reused, true);
  assert.deepEqual(writes, ['create', 'append']);
});
