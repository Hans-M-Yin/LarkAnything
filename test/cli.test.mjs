import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createLarkAnything } from '../src/index.mjs';
const run = promisify(execFile);
const cli = resolve('bin/larkanything.mjs');

test('CLI previews all four channels offline without an installed backend executable', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'larkanything-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = join(dir, 'config.json');
  await writeFile(config, JSON.stringify({ version: 1, backends: { 'lark-cli': { executable: 'not-installed-for-this-test' } } }));
  for (const [channel, file] of [['codex', 'codex.jsonl'], ['claude-code', 'claude-code.jsonl'], ['chatgpt', 'chatgpt.json'], ['generic', 'conversation.json']]) {
    const { stdout } = await run(process.execPath, [cli, 'preview', '--channel', channel, '--input', resolve('examples', file), '--config', config, '--out', join(dir, channel)]);
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    assert.ok((await readFile(result.output.artifact, 'utf8')).length > 0);
    assert.ok((await readFile(result.output.html, 'utf8')).startsWith('<!doctype html>'));
  }
});

test('CLI publishes through a real child process, then reuses its receipt', { skip: process.platform === 'win32' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'larkanything-process-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, 'fake-lark-cli'), writes = join(dir, 'writes.jsonl'), bodyFile = join(dir, 'body.md');
  await writeFile(executable, `#!/usr/bin/env node\nimport fs from 'node:fs';\nconst args=process.argv.slice(2);\nlet body='';for await(const chunk of process.stdin)body+=chunk;\nif(args.includes('+create')){fs.appendFileSync(${JSON.stringify(writes)},JSON.stringify(args)+'\\n');fs.writeFileSync(${JSON.stringify(bodyFile)},body);}\nconsole.log(JSON.stringify({ok:true,data:{document:{document_id:'fixture-doc',url:'https://example.com/docx/fixture-doc',content:fs.readFileSync(${JSON.stringify(bodyFile)},'utf8')}}}));\n`);
  await chmod(executable, 0o700);
  const config = join(dir, 'config.json');
  await writeFile(config, JSON.stringify({ version: 1, stateDir: 'state', backends: { 'lark-cli': { executable } } }));
  const args = [cli, 'publish', '--channel', 'codex', '--input', resolve('examples/codex.jsonl'), '--config', config, '--out', join(dir, 'preview'), '--title', 'Literal $(not-executed) `text`'];
  const first = JSON.parse((await run(process.execPath, args)).stdout);
  const second = JSON.parse((await run(process.execPath, args)).stdout);
  assert.equal(first.receipt.status, 'verified');
  assert.equal(second.receipt.reused, true);
  assert.equal((await readFile(writes, 'utf8')).trim().split('\n').length, 1);
  assert.ok((await readFile(writes, 'utf8')).includes('$(not-executed)'));
});

test('CLI sync matches a growing conversation id across separate processes and appends only its delta', { skip: process.platform === 'win32' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'larkanything-cli-sync-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, 'fake-lark-cli'), writes = join(dir, 'writes.jsonl'), bodyFile = join(dir, 'body.md');
  await writeFile(executable, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
let body = ''; for await (const chunk of process.stdin) body += chunk;
if (args.includes('+create') || args.includes('+update')) {
  fs.appendFileSync(${JSON.stringify(writes)}, JSON.stringify({ args, body }) + '\\n');
  if (args.includes('+create')) fs.writeFileSync(${JSON.stringify(bodyFile)}, body);
  else fs.appendFileSync(${JSON.stringify(bodyFile)}, '\\n\\n' + body);
}
console.log(JSON.stringify({ ok: true, data: { document: { document_id: 'same-doc', url: 'https://example.com/docx/same-doc', content: fs.readFileSync(${JSON.stringify(bodyFile)}, 'utf8') } } }));
`);
  await chmod(executable, 0o700);
  const config = join(dir, 'config.json'), input = join(dir, 'conversation.json');
  await writeFile(config, JSON.stringify({ version: 1, stateDir: 'state', backends: { 'lark-cli': { executable } } }));
  const message = (id, text) => ({ id, role: 'user', content: [{ type: 'text', format: 'plain', text }] });
  const model = { version: 1, kind: 'conversation', id: 'stable-session', title: 'Conversation', source: { channel: 'generic' },
    messages: [message('old', 'FIRST UNIQUE MESSAGE')] };
  await writeFile(input, JSON.stringify(model));
  const args = [cli, 'publish', '--channel', 'generic', '--input', input, '--config', config, '--out', join(dir, 'preview')];
  const first = JSON.parse((await run(process.execPath, args)).stdout);
  model.messages.push(message('new', 'SECOND UNIQUE MESSAGE'));
  await writeFile(input, JSON.stringify(model));
  const second = JSON.parse((await run(process.execPath, args)).stdout);
  const third = JSON.parse((await run(process.execPath, args)).stdout);
  assert.equal(first.target.operation, 'create');
  assert.equal(second.target.operation, 'append');
  assert.equal(second.coverage.publishedMessages, 1);
  assert.equal(second.receipt.remote.documentId, first.receipt.remote.documentId);
  assert.equal(third.sync.unchanged, true);
  assert.equal(third.receipt.reused, true);
  const calls = (await readFile(writes, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].args.includes('+update'));
  assert.ok(calls[1].args.includes('append'));
  assert.equal(calls[1].args[calls[1].args.indexOf('--doc') + 1], 'same-doc');
  assert.doesNotMatch(calls[1].body, /FIRST UNIQUE MESSAGE/);
  assert.match(calls[1].body, /SECOND UNIQUE MESSAGE/);
  const remoteBody = await readFile(bodyFile, 'utf8');
  assert.equal((remoteBody.match(/FIRST UNIQUE MESSAGE/g) || []).length, 1);
  assert.equal((remoteBody.match(/SECOND UNIQUE MESSAGE/g) || []).length, 1);
});

test('New source kind, protocol and backend operation plug in without changing the engine', async () => {
  const engine = createLarkAnything({
    adapters: [{ id: 'notes', version: 1, async load() { return { version: 1, kind: 'note', id: 'n1', title: 'Notes', source: { channel: 'notes' }, text: 'SDK extension' }; } }],
    protocols: [{ id: 'note-document', version: 1, inputKinds: ['note'], format(source) { return { version: 1, kind: 'document', title: source.title, source: source.source, nodes: [{ type: 'paragraph', text: source.text }], warnings: [], coverage: { sourceMessages: 0, publishedMessages: 0, excludedToolItems: 0 }, unsupported: 'warn' }; } }],
    backends: [{ id: 'other-lark-api', version: 1, capabilities: { formats: ['markdown'], operations: ['upsert-note'], kinds: ['document'] }, async publish() { throw new Error('unused'); }, async verify() { throw new Error('unused'); } }],
  });
  const plan = await engine.plan({ channel: 'notes', input: 'unused', overrides: { protocol: 'note-document', target: { backend: 'other-lark-api', operation: 'upsert-note', params: { noteKey: 'example' } } } });
  assert.equal(plan.artifact.verificationText, 'SDK extension');
  assert.equal(plan.target.params.noteKey, 'example');
  assert.equal(plan.source.artifactId, 'n1');
});

test('CLI owns segmented export and frozen-plan readback recovery without rereading a growing session', { skip: process.platform === 'win32' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'larkanything-frozen-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const codexHome = join(dir, 'codex'), sessions = join(codexHome, 'sessions');
  await mkdir(sessions, { recursive: true });
  const record = (id, role, text) => ({ type: 'response_item', payload: { id, type: 'message', role, content: [{ type: 'text', text }] } });
  const first = join(sessions, 'renamed.jsonl'), second = join(sessions, 'rollout-selected_continuation.jsonl');
  const header = n => ({ type: 'session_meta', payload: { id: 'selected', timestamp: `2026-11-05T00:00:0${n}Z` } });
  await writeFile(first, [header(1), record('u', 'user', 'question')].map(JSON.stringify).join('\n') + '\n');
  await writeFile(second, [header(2), record('a', 'assistant', 'initial answer')].map(JSON.stringify).join('\n') + '\n');
  const executable = join(dir, 'fake-lark-cli'), writes = join(dir, 'writes'), bodyFile = join(dir, 'body.md'), failFile = join(dir, 'fail');
  await writeFile(failFile, 'fail');
  await writeFile(executable, `#!/usr/bin/env node\nimport fs from 'node:fs';\nconst args=process.argv.slice(2);let body='';for await(const chunk of process.stdin)body+=chunk;\nif(args.includes('+create')){fs.appendFileSync(${JSON.stringify(writes)},'write\\n');fs.writeFileSync(${JSON.stringify(bodyFile)},body);}\nbody=fs.readFileSync(${JSON.stringify(bodyFile)},'utf8');\nif(fs.existsSync(${JSON.stringify(failFile)}))body=body.replace('initial answer','changed answer');\nconsole.log(JSON.stringify({ok:true,data:{document:{document_id:'frozen-doc',url:'https://example.com/docx/frozen-doc',content:body}}}));\n`);
  await chmod(executable, 0o700);
  const config = join(dir, 'config.json');
  await writeFile(config, JSON.stringify({ version: 1, stateDir: join(dir, 'state'), backends: { 'lark-cli': { executable } } }));
  const env = { ...process.env, CODEX_HOME: codexHome };
  const listed = JSON.parse((await run(process.execPath, [cli, 'list', '--channel', 'codex'], { env })).stdout);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].segments, 2);
  const preview = JSON.parse((await run(process.execPath, [cli, 'preview', '--channel', 'codex', '--session', 'selected', '--config', config, '--out', join(dir, 'preview')], { env })).stdout);
  assert.equal(preview.source.manifest.files.length, 2);
  assert.equal(preview.coverage.publishedMessages, 2);
  // Simulate another user turn after preview. Publishing must use the snapshot.
  await writeFile(second, [header(2), record('a', 'assistant', 'initial answer'), record('later', 'user', 'new text after preview')].map(JSON.stringify).join('\n') + '\n');
  const args = [cli, 'publish', '--plan', preview.output.plan, '--config', config];
  await assert.rejects(run(process.execPath, args, { env }), error => {
    const result = JSON.parse(error.stderr);
    assert.equal(result.code, 'READBACK_MISMATCH');
    assert.equal(result.details.documentId, 'frozen-doc');
    assert.equal(result.details.verification.difference.kind, 'text');
    assert.equal(result.retry.plan, preview.output.plan);
    assert.equal(result.exportKey, preview.exportKey);
    return true;
  });
  await rm(failFile);
  await rm(codexHome, { recursive: true }); // Retry needs no access to source logs.
  const retry = JSON.parse((await run(process.execPath, args, { env })).stdout);
  assert.equal(retry.receipt.status, 'verified');
  assert.equal(retry.exportKey, preview.exportKey);
  assert.equal((await readFile(writes, 'utf8')).trim().split('\n').length, 1);
  assert.doesNotMatch(await readFile(bodyFile, 'utf8'), /new text after preview/);
});
