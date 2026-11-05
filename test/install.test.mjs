import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { install } from '../scripts/install.mjs';
const exec = promisify(execFile);
const root = resolve('.');

async function context(t, options = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), 'larkanything-home-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const calls = [];
  let nativeReady = false;
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const run = async (command, args, settings = {}) => {
    calls.push({ command, args, settings });
    if (args.includes('ci')) {
      if (options.npmError) throw new Error('fixture network failure');
      for (const [path, entry] of Object.entries(lock.packages)) {
        if (path.startsWith('node_modules/') && !entry.dev) await cp(join(root, path), join(settings.cwd, path), { recursive: true });
      }
      return { stdout: '' };
    }
    if (args.includes('install') && args.includes('--prefix')) {
      const tools = args[args.indexOf('--prefix') + 1];
      await mkdir(join(tools, 'node_modules/@larksuite/cli/scripts'), { recursive: true });
      return { stdout: '' };
    }
    if (args[0]?.endsWith(join('scripts', 'install.js'))) { nativeReady = true; return { stdout: '' }; }
    if (args[0] === '--version') {
      if (options.missingLark && (command === 'lark-cli' || !nativeReady)) throw new Error('not installed');
      return { stdout: 'fixture-version' };
    }
    if (args[0] === 'docs' && args.includes('--help')) return { stdout: '--doc-format xml|markdown' };
    return exec(command, args, settings);
  };
  return { homeDir, calls, run, npmCli: '/fixture/npm-cli.js' };
}

test('One install prepares both agents, shared defaults and working launchers', async t => {
  const setup = await context(t);
  const result = await install(setup);
  assert.equal(result.ok, true);
  assert.deepEqual(result.skills.map(s => s.agent), ['codex', 'claude']);
  assert.equal(result.larkCli.status, 'ready');
  assert.ok(setup.calls.some(c => c.args.includes('--omit=dev') && c.args.includes('--ignore-scripts')));
  const config = JSON.parse(await readFile(result.configPath, 'utf8'));
  assert.ok(config.profiles.readable);
  for (const skill of result.skills) {
    assert.ok((await readFile(join(skill.path, 'SKILL.md'), 'utf8')).includes('scripts/run.mjs'));
    const paths = JSON.parse((await exec(process.execPath, [join(skill.path, 'scripts/run.mjs'), 'paths'])).stdout);
    assert.equal(paths.runtimeRoot, result.runtimeRoot);
    const out = join(setup.homeDir, `preview-${skill.agent}`);
    const response = JSON.parse((await exec(process.execPath, [join(skill.path, 'scripts/run.mjs'), 'preview', '--channel', 'codex', '--input', join(root, 'examples/codex.jsonl'), '--out', out], { cwd: tmpdir() })).stdout);
    assert.equal(response.ok, true);
    assert.ok((await readFile(response.output.artifact, 'utf8')).includes('Codex'));
  }
});

test('Installed program continues working after the downloaded source is removed', async t => {
  const setup = await context(t);
  const checkout = join(setup.homeDir, 'downloaded-source');
  await mkdir(checkout);
  for (const name of ['package.json', 'package-lock.json', 'README.md', 'README.zh-CN.md', 'INSTALL.md', 'LICENSE', 'bin', 'src', 'skills', 'docs', 'examples']) await cp(join(root, name), join(checkout, name), { recursive: true });
  const result = await install({ ...setup, source: checkout, agent: 'codex' });
  await rm(checkout, { recursive: true });
  const response = JSON.parse((await exec(process.execPath, [join(result.skills[0].path, 'scripts/run.mjs'), 'preview', '--channel', 'generic', '--input', join(result.runtimeRoot, 'examples/conversation.json'), '--out', join(setup.homeDir, 'offline')])).stdout);
  assert.equal(response.ok, true);
});

test('Reinstall preserves configuration and receipts while replacing managed code', async t => {
  const setup = await context(t);
  const first = await install({ ...setup, agent: 'claude' });
  const config = JSON.parse(await readFile(first.configPath, 'utf8'));
  config.defaults = { format: { locale: 'en' }, target: { namespace: 'my-team' } };
  await writeFile(first.configPath, JSON.stringify(config));
  await mkdir(join(first.prefix, 'state'));
  await writeFile(join(first.prefix, 'state/receipt.json'), '{"test":true}');
  await writeFile(join(first.runtimeRoot, 'old-file.txt'), 'old version');
  const second = await install({ ...setup, agent: 'claude' });
  assert.deepEqual(JSON.parse(await readFile(second.configPath, 'utf8')), config);
  assert.equal(await readFile(join(first.prefix, 'state/receipt.json'), 'utf8'), '{"test":true}');
  assert.ok(!(await readdir(second.runtimeRoot)).includes('old-file.txt'));
  assert.ok(!(await readdir(first.prefix)).some(name => /backup|stage|lock/.test(name)));
});

test('Dependency failure during update leaves the previous runtime usable', async t => {
  const setup = await context(t);
  const first = await install({ ...setup, agent: 'codex' });
  await writeFile(join(first.runtimeRoot, 'keep.txt'), 'working version');
  await assert.rejects(install({ ...setup, agent: 'codex', run: async () => { throw new Error('network unavailable'); } }), /network unavailable/);
  assert.equal(await readFile(join(first.runtimeRoot, 'keep.txt'), 'utf8'), 'working version');
  const help = await exec(process.execPath, [join(first.skills[0].path, 'scripts/run.mjs'), '--help']);
  assert.match(help.stdout, /LarkAnything/);
});

test('Unrelated skills are never overwritten and the install stops before dependencies', async t => {
  const setup = await context(t);
  const skill = join(setup.homeDir, '.agents/skills/larkanything-export');
  await mkdir(skill, { recursive: true });
  await writeFile(join(skill, 'SKILL.md'), 'my own skill');
  await assert.rejects(install(setup), /unrelated installation/);
  assert.equal(await readFile(join(skill, 'SKILL.md'), 'utf8'), 'my own skill');
  assert.equal(setup.calls.length, 0);
});

test('Missing Lark CLI is installed privately from the official package', async t => {
  const setup = await context(t, { missingLark: true });
  const result = await install({ ...setup, agent: 'codex' });
  assert.equal(result.larkCli.status, 'ready');
  assert.ok(result.larkCli.executable.startsWith(join(result.prefix, 'tools')));
  assert.ok(setup.calls.some(c => c.args.includes('@larksuite/cli@1.0.98') && !c.args.includes('--global')));
  assert.ok(setup.calls.some(c => c.args[0]?.endsWith(join('scripts', 'install.js'))));
});

test('Preview-only installation skips Lark CLI and agent selection is explicit', async t => {
  const setup = await context(t);
  const result = await install({ ...setup, agent: 'claude', skipLark: true });
  assert.equal(result.larkCli.status, 'skipped');
  assert.deepEqual(result.skills.map(s => s.agent), ['claude']);
  assert.ok(!setup.calls.some(c => c.args[0] === '--version'));
  await assert.rejects(install({ ...setup, agent: 'unknown' }), /--agent must/);
});
