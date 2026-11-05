import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
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
