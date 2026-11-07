import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { codexAdapter, claudeCodeAdapter, chatgptAdapter, genericAdapter, discoverSessions, resolveSession } from '../src/index.mjs';

async function fixture(t, data, jsonl = true) {
  const dir = await mkdtemp(join(tmpdir(), 'larkanything-adapter-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, jsonl ? 'input.jsonl' : 'input.json');
  await writeFile(input, jsonl ? data.map(r => JSON.stringify(r)).join('\n') : JSON.stringify(data));
  return input;
}

test('Codex Desktop example deduplicates mirror events, keeps tools and order', async () => {
  const model = await codexAdapter.load({ input: resolve('examples/codex.jsonl') });
  assert.equal(model.messages.length, 6);
  assert.deepEqual(model.messages.map(m => m.role), ['user', 'assistant', 'tool', 'tool', 'user', 'assistant']);
  assert.equal(model.id, 'demo-codex-session');
});

test('Codex preserves repeated user questions and unmatched events, excludes injected instructions', async t => {
  const message = (role, text, id) => ({ type: 'response_item', payload: { type: 'message', role, id, content: [{ type: 'input_text', text }] } });
  const event = message => ({ type: 'event_msg', payload: { type: 'user_message', message } });
  const input = await fixture(t, [message('system', 'SECRET', 's'), message('user', '<environment_context>injected</environment_context>', 'e'), message('user', 'Repeat?', '1'), event('Repeat?'), message('user', 'Repeat?', '2'), event('Repeat?'), event('A distinct event-only message')]);
  const result = await codexAdapter.load({ input });
  assert.deepEqual(result.messages.map(m => m.content[0].text), ['Repeat?', 'Repeat?', 'A distinct event-only message']);
});

test('Codex filters complete ambient browser envelopes from messages and events, preserving real text', async t => {
  const browser = '<external_browser_tabs>\n<in-app-browser-context source="ambient-ui-state">\n# In app browser:\n- Current URL: https://example.com/private\n</in-app-browser-context>\n</external_browser_tabs>';
  const message = (id, role, texts) => ({ type: 'response_item', payload: { type: 'message', id, role, content: texts.map(text => ({ type: 'input_text', text })) } });
  const literals = [
    'Explain <external_browser_tabs> please.',
    '```xml\n' + browser + '\n```',
    browser + '\nPlease explain this example.',
    '<external_browser_tabs>user-authored example</external_browser_tabs>',
  ];
  const input = await fixture(t, [
    message('context', 'user', [' \n' + browser + '\n']),
    { type: 'event_msg', payload: { type: 'user_message', message: browser } },
    message('mixed', 'user', [browser, '已完成授权']),
    ...literals.map((text, i) => message(`literal-${i}`, 'user', [text])),
    message('assistant', 'assistant', [browser]),
  ]);
  const model = await codexAdapter.load({ input });
  assert.deepEqual(model.messages.map(m => m.content.map(p => p.text)), [
    ['已完成授权'], ...literals.map(text => [text]), [browser],
  ]);
  assert.equal(model.source.manifest.excludedContextRecords, 3);
});

test('Codex fork is visibly partial and malformed logs fail without silently dropping lines', async t => {
  const input = await fixture(t, [{ type: 'session_meta', payload: { id: 'f', forked_from_id: 'parent' } }, { type: 'event_msg', payload: { type: 'user_message', message: 'test' } }]);
  const result = await codexAdapter.load({ input });
  assert.equal(result.source.completeness, 'partial');
  assert.equal(result.warnings[0].code, 'FORK_PREFIX_NOT_LOADED');
  await writeFile(input, '{}\n{"broken":');
  await assert.rejects(codexAdapter.load({ input }), error => error.code === 'INVALID_JSONL' && /line 2/.test(error.message));
});

test('Claude Code chooses the active parent chain, skips sibling and sidechain messages', async t => {
  const record = (uuid, parentUuid, text, extra = {}) => ({ type: 'assistant', uuid, parentUuid, message: { content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text }] }, ...extra });
  const input = await fixture(t, [record('u', null, 'root', { type: 'user' }), record('old', 'u', 'discarded branch'), record('side', 'u', 'sidechain', { isSidechain: true }), record('new', 'u', 'active branch')]);
  const result = await claudeCodeAdapter.load({ input });
  assert.deepEqual(result.messages.map(m => m.content[0].text), ['root', 'active branch']);
});

test('Claude Code keeps mixed tool/text content as distinct parts', async () => {
  const model = await claudeCodeAdapter.load({ input: resolve('examples/claude-code.jsonl') });
  assert.equal(model.messages[1].content[1].type, 'tool');
  assert.equal(model.messages[2].role, 'tool');
});

test('ChatGPT follows current_node and excludes regenerated sibling responses', async t => {
  const input = await fixture(t, { id: 'g', title: 'Branch', current_node: 'new', mapping: {
    root: { parent: null, message: { id: 'system', author: { role: 'system' }, content: { parts: ['private'] } } },
    user: { parent: 'root', message: { id: 'u', author: { role: 'user' }, content: { parts: ['question'] } } },
    old: { parent: 'user', message: { id: 'o', author: { role: 'assistant' }, content: { parts: ['discarded'] } } },
    new: { parent: 'user', message: { id: 'n', author: { role: 'assistant' }, content: { parts: ['selected'] } } },
  } }, false);
  const model = await chatgptAdapter.load({ input });
  assert.deepEqual(model.messages.map(m => m.id), ['u', 'n']);
});

test('ChatGPT multi-export requires explicit selection', async t => {
  const sample = JSON.parse(await (await import('node:fs/promises')).readFile('examples/chatgpt.json', 'utf8'));
  const input = await fixture(t, [sample, { ...sample, id: 'other' }], false);
  await assert.rejects(chatgptAdapter.load({ input }), { code: 'SELECT_CONVERSATION' });
  assert.equal((await chatgptAdapter.load({ input, session: 'other' })).id, 'other');
});

test('Generic input rejects unknown content and duplicate message ids', async t => {
  const model = JSON.parse(await (await import('node:fs/promises')).readFile('examples/conversation.json', 'utf8'));
  model.messages[1].id = model.messages[0].id;
  const input = await fixture(t, model, false);
  await assert.rejects(genericAdapter.load({ input }), { code: 'MESSAGE_ID' });
});

test('Discovery does not follow directory symlinks or require existing roots', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'larkanything-discovery-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.deepEqual(await discoverSessions('codex', { codexHome: dir }), []);
  await assert.rejects(discoverSessions('chatgpt'), { code: 'DISCOVERY_CHANNEL' });
});

test('Session resolution matches a selected filename and rejects missing sessions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'larkanything-selection-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(dir, 'sessions'));
  const path = join(dir, 'sessions', 'rollout-2026-11-04-abc-123.jsonl');
  await writeFile(path, '{}');
  assert.equal(await resolveSession('codex', 'abc-123', { codexHome: dir }), path);
  await assert.rejects(resolveSession('codex', 'other', { codexHome: dir }), { code: 'SESSION_SELECTION' });
});

test('Codex records per-step turn, phase and model without carrying models into a new turn', async t => {
  const msg = (id, text, extra = {}) => ({ type: 'response_item', timestamp: '2026-11-04T13:18:35.562Z', payload: { type: 'message', role: 'assistant', id, content: [{ type: 'output_text', text }], ...extra } });
  const input = await fixture(t, [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
    { type: 'turn_context', payload: { turn_id: 't1', model: 'model-A' } },
    msg('progress', 'checking', { phase: 'commentary' }),
    msg('hidden', 'private reasoning', { channel: 'analysis' }),
    { type: 'turn_context', payload: { turn_id: 't1', model: 'model-B' } },
    msg('final', 'done', { phase: 'final_answer' }),
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1' } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 't2' } },
    msg('unknown', 'new turn'),
    msg('explicit', 'actual', { model: 'model-C' }),
  ]);
  const { messages } = await codexAdapter.load({ input });
  assert.deepEqual(messages.map(m => [m.id, m.turnId, m.model, m.phase]), [
    ['progress', 't1', 'model-A', 'commentary'], ['final', 't1', 'model-B', 'final'],
    ['unknown', 't2', undefined, undefined], ['explicit', 't2', 'model-C', undefined],
  ]);
  assert.equal(messages[0].timestamp, '2026-11-04T13:18:35.562Z');
  assert.equal(messages[0].modelSource, 'turn_context');
  assert.equal(messages[3].modelSource, 'message');
});

test('Claude Code and ChatGPT preserve models from the selected message, not a later global setting', async t => {
  const claude = await fixture(t, [
    { uuid: 'a', type: 'assistant', parentUuid: null, message: { model: 'claude-example', content: 'first' } },
    { uuid: 'b', type: 'assistant', parentUuid: 'a', message: { content: 'unknown' } },
  ]);
  const cm = (await claudeCodeAdapter.load({ input: claude })).messages;
  assert.equal(cm[0].model, 'claude-example');
  assert.equal(cm[1].model, undefined);
  const chatgpt = await fixture(t, { id: 'g', current_node: 'a', mapping: {
    a: { parent: null, message: { id: 'a', author: { role: 'assistant' }, metadata: { model_slug: 'gpt-example' }, create_time: 1700000000, content: { parts: ['answer'] } } },
  } }, false);
  const gm = (await chatgptAdapter.load({ input: chatgpt })).messages[0];
  assert.equal(gm.model, 'gpt-example');
  assert.equal(gm.modelSource, 'message');
  assert.equal(gm.timestamp, '2023-11-14T22:13:20.000Z');
});
