import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexAdapter, createLarkAnything, discoverSessions, resolveSession, resolveSessionSources } from '../src/index.mjs';

const time = n => `2026-11-05T00:00:${String(n).padStart(2, '0')}Z`;
const header = (id, n, extra = {}) => ({ type: 'session_meta', payload: { id, timestamp: time(n), ...extra } });
const message = (id, role, text, n) => ({ type: 'response_item', timestamp: time(n), payload: { id, type: 'message', role, content: [{ type: 'input_text', text }] } });
async function home(t) {
  const codexHome = await mkdtemp(join(tmpdir(), 'larkanything-segments-'));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  return { codexHome, async file(path, records) {
    const input = join(codexHome, path);
    await mkdir(join(input, '..'), { recursive: true });
    await writeFile(input, records.map(r => JSON.stringify(r)).join('\n') + '\n');
    return input;
  } };
}

test('Codex discovers session identity across renamed, archived and suffixed segments', async t => {
  const h = await home(t);
  const first = await h.file('sessions/2026/renamed.jsonl', [header('selected', 1), message('u', 'user', 'question', 2)]);
  const second = await h.file('archived_sessions/rollout-selected_continuation.jsonl', [header('selected', 3), message('a', 'assistant', 'answer', 4)]);
  await h.file('sessions/rollout-selected.jsonl', [header('different-session', 1), message('other', 'user', 'unrelated', 2)]);
  await h.file('sessions/subagents/rollout-child.jsonl', [header('selected', 1), message('child', 'assistant', 'private subagent', 2)]);
  const sessions = await discoverSessions('codex', h);
  const selected = sessions.find(s => s.session === 'selected');
  assert.equal(selected.segments, 2);
  assert.deepEqual(new Set(selected.inputs), new Set([first, second]));
  assert.deepEqual(new Set(await resolveSessionSources('codex', 'selected', h)), new Set([first, second]));
  await assert.rejects(resolveSession('codex', 'selected', h), { code: 'SESSION_SEGMENTS' });
  assert.equal(sessions.length, 2);
});

test('Session export assembles three segments, filters injected skill records and deduplicates copied messages', async t => {
  const h = await home(t);
  const question = message('u1', 'user', 'Read this paper', 2);
  const answer = message('a1', 'assistant', 'Paper explanation', 3);
  await h.file('sessions/a.jsonl', [header('selected', 1), question,
    message('skill', 'user', '<skill>\n<name>paper-read</name>\n<path>/skills/paper-read/SKILL.md</path>\ninjected instructions\n</skill>', 2), answer]);
  await h.file('sessions/b.jsonl', [header('selected', 4), question, answer, message('u2', 'user', 'Research related work', 5)]);
  await h.file('archived_sessions/c.jsonl', [header('selected', 6), message('a2', 'assistant', 'Related work results', 7)]);
  const model = await codexAdapter.load({ session: 'selected', sourceOptions: h });
  assert.deepEqual(model.messages.map(m => m.id), ['u1', 'a1', 'u2', 'a2']);
  assert.equal(model.messages[0].sourceRefs.length, 2);
  assert.equal(model.source.completeness, 'complete');
  assert.equal(model.source.manifest.files.length, 3);
  assert.equal(model.source.manifest.excludedContextRecords, 1);
  assert.equal(model.source.manifest.deduplicatedMessages, 2);
  assert.deepEqual(model.source.manifest.messageCounts, { user: 2, assistant: 2, tool: 0 });
  for (const file of model.source.manifest.files) assert.match(file.sha256, /^[a-f0-9]{64}$/);
  const plan = await createLarkAnything().plan({ channel: 'codex', session: 'selected', sourceOptions: h, overrides: { format: { unsupported: 'error' } } });
  assert.equal(plan.source.manifest.files.length, 3);
  assert.match(plan.artifact.body, /Related work results/);
  assert.doesNotMatch(plan.artifact.body, /injected instructions/);
});

test('Uncertain repeated questions and prefix edits are preserved with diagnostics', async t => {
  const h = await home(t);
  await h.file('sessions/a.jsonl', [header('s', 1), message('u1', 'user', 'Please research', 2)]);
  await h.file('sessions/b.jsonl', [header('s', 3), message('u2', 'user', 'Please research related work', 4), message('u3', 'user', 'Please research', 5)]);
  const model = await codexAdapter.load({ session: 's', sourceOptions: h });
  assert.deepEqual(model.messages.map(m => m.id), ['u1', 'u2', 'u3']);
  assert.ok(model.source.manifest.retainedAmbiguousMessages >= 1);
  assert.ok(model.warnings.some(w => w.code === 'AMBIGUOUS_MESSAGES_RETAINED'));
});

test('Conflicting message identities fail instead of selecting one version', async t => {
  const h = await home(t);
  await h.file('sessions/a.jsonl', [header('s', 1), message('u', 'user', 'original', 2)]);
  await h.file('sessions/b.jsonl', [header('s', 3), message('u', 'user', 'changed', 4)]);
  await assert.rejects(codexAdapter.load({ session: 's', sourceOptions: h }), error => error.code === 'SOURCE_MESSAGE_CONFLICT' && error.details.sources.length === 2);
});

test('File exports report unknown completeness and retain assistant text that discusses skills', async t => {
  const h = await home(t);
  const input = await h.file('sessions/a.jsonl', [header('s', 1), message('u', 'user', 'question', 2), message('a', 'assistant', '<skill> is an XML tag', 3)]);
  const model = await codexAdapter.load({ input });
  assert.equal(model.source.completeness, 'unknown');
  assert.equal(model.source.manifest.scope, 'file');
  assert.equal(model.messages.length, 2);
  await assert.rejects(codexAdapter.load({ input, session: 'different' }), { code: 'SOURCE_SESSION_CONFLICT' });
});

test('Malformed or unidentifiable possible continuation files cannot silently disappear', async t => {
  const h = await home(t);
  await h.file('sessions/rollout-s.jsonl', [header('s', 1), message('u', 'user', 'question', 2)]);
  const broken = await h.file('sessions/rollout-s_continuation.jsonl', [header('s', 3)]);
  await writeFile(broken, '{"type":"session_meta"');
  await assert.rejects(codexAdapter.load({ session: 's', sourceOptions: h }), { code: 'SOURCE_SESSION_UNCONFIRMED' });
  await assert.rejects(codexAdapter.load({ input: broken }), error => error.code === 'INVALID_JSONL' && error.details.input === broken && error.details.line === 1);
});

test('Fork snapshots remain partial even after all their local segments are discovered', async t => {
  const h = await home(t);
  await h.file('sessions/fork.jsonl', [header('fork', 1, { forked_from_id: 'parent' }), message('u', 'user', 'child question', 2)]);
  const model = await codexAdapter.load({ session: 'fork', sourceOptions: h });
  assert.equal(model.source.completeness, 'partial');
  assert.equal(model.warnings[0].code, 'FORK_PREFIX_NOT_LOADED');
});

test('Identical id-less records preserve their occurrence count when snapshots overlap', async t => {
  const h = await home(t);
  const repeated = message(undefined, 'user', 'Repeat?', 2);
  await h.file('sessions/a.jsonl', [header('s', 1), repeated, repeated]);
  await h.file('sessions/b.jsonl', [header('s', 3), repeated, repeated, repeated]);
  const model = await codexAdapter.load({ session: 's', sourceOptions: h });
  assert.equal(model.messages.length, 3);
  assert.equal(model.source.manifest.deduplicatedMessages, 2);
});

test('Private phases recorded only at item completion also suppress their mirror events', async t => {
  const h = await home(t);
  const input = await h.file('sessions/private.jsonl', [header('s', 1),
    message('private', 'assistant', 'PRIVATE_REASONING', 2),
    { type: 'event_msg', timestamp: time(2), payload: { type: 'agent_message', message: 'PRIVATE_REASONING' } },
    { type: 'event_msg', payload: { type: 'item_completed', turn_id: 'private-turn', item: { id: 'private', phase: 'analysis' } } },
    message('final', 'assistant', 'public answer', 3)]);
  const model = await codexAdapter.load({ input });
  assert.deepEqual(model.messages.map(m => m.id), ['final']);
});

test('Completion metadata in another segment supplies public phases and hides private mirrors', async t => {
  const h = await home(t);
  await h.file('sessions/a.jsonl', [header('s', 1), message('u', 'user', 'question', 2),
    message('private', 'assistant', 'PRIVATE_REASONING', 3), message('progress', 'assistant', 'public progress', 4)]);
  await h.file('sessions/b.jsonl', [header('s', 5),
    { type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn', item: { id: 'private', phase: 'analysis' } } },
    { type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn', item: { id: 'progress', phase: 'commentary' } } },
    { type: 'event_msg', timestamp: time(6), payload: { type: 'agent_message', message: 'PRIVATE_REASONING' } },
    message('final', 'assistant', 'public final', 7)]);
  const model = await codexAdapter.load({ session: 's', sourceOptions: h });
  assert.deepEqual(model.messages.map(m => m.id), ['u', 'progress', 'final']);
  assert.equal(model.messages[1].phase, 'commentary');
  assert.equal(model.messages[1].turnId, 'turn');
});
