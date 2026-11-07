import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppSetupProcess, trustedLarkUrl } from '../desktop/setup.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { runLarkCli } from '../src/backends/lark-cli.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fakeProcess() {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.end = value => { child.input = value; }; child.kill = () => { child.killed = true; child.emit('close', null); };
  return child;
}
test('app setup streams only a trusted URL, keeps secret off argv, and awaits completion', async () => {
  const child = fakeProcess(); let invocation, completed = false;
  const setup = new AppSetupProcess({ spawnProcess: (...args) => { invocation = args; return child; } });
  setup.start({ executable: 'cli', configDir: '/isolated', mode: 'existing', appId: 'cli_example', secret: 'sensitive-value', brand: 'feishu', onComplete: async () => { completed = true; } });
  assert.equal(child.input, 'sensitive-value\n');
  assert.ok(!JSON.stringify(invocation).includes('sensitive-value'));
  assert.equal(invocation[2].env.LARKSUITE_CLI_CONFIG_DIR, '/isolated');
  child.stderr.emit('data', Buffer.from('https://feishu.cn.evil.test/authorize\n'));
  assert.equal(setup.snapshot().canOpen, false);
  child.stderr.emit('data', Buffer.from('  https://accounts.feishu.cn/'));
  child.stderr.emit('data', Buffer.from('setup?code=public-user-code\n'));
  assert.equal(setup.snapshot().phase, 'browser');
  child.stdout.emit('data', Buffer.from('secret content must never reach renderer'));
  assert.ok(!JSON.stringify(setup.snapshot()).includes('secret'));
  child.emit('close', 0); await tick();
  assert.equal(completed, true); assert.equal(setup.snapshot().phase, 'complete'); assert.equal(setup.url, undefined);
});
test('failed and cancelled setup never activates config or leaks CLI output', async () => {
  for (const cancel of [false, true]) {
    const child = fakeProcess(), setup = new AppSetupProcess({ spawnProcess: () => child });
    setup.start({ executable: 'cli', configDir: '/isolated', mode: 'create', brand: 'feishu', onComplete: () => assert.fail('must not activate') });
    child.stderr.emit('data', Buffer.from(JSON.stringify({ error: { type: 'config', subtype: 'invalid_client', message: 'private secret' } })));
    if (cancel) setup.cancel(); else child.emit('close', 3);
    await tick(); assert.equal(setup.phase, cancel ? 'cancelled' : 'failed');
    assert.ok(!JSON.stringify(setup.snapshot()).includes('private secret'));
  }
  assert.equal(trustedLarkUrl('https://accounts.larksuite.com/setup'), true);
  assert.equal(trustedLarkUrl('https://secret@feishu.cn/setup'), false);
});
test('setup status separates missing binary, missing app, unreadable secret and user login', async () => {
  for (const [auth, stage] of [
    [{ exitCode: 'ENOENT' }, 'cli'], [{ status: 'unavailable', type: 'config', subtype: 'not_configured' }, 'app'],
    [{ appId: 'cli_a', botAvailable: false }, 'app'], [{ appId: 'cli_a', botAvailable: true }, 'login'],
    [{ appId: 'cli_a', userAvailable: true }, 'ready'], [{ status: 'unavailable', type: 'internal', subtype: 'storage' }, 'error'],
  ]) {
    const service = new DesktopService({ authInspector: async () => auth });
    service.engine = async () => ({ backends: new Map([['lark-cli', { options: { executable: 'fixture' } }]]) });
    assert.equal((await service.setupStatus()).stage, stage);
  }
});
test('desktop stages configuration and activates only checked app credentials, preserving existing settings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'la-setup-')); t.after(() => rm(root, { recursive: true, force: true }));
  const original = { version: 1, stateDir: 'state', profiles: { work: { target: { namespace: 'work' } } }, defaults: { target: { parentToken: 'folder' } } };
  await writeFile(join(root, 'config.json'), JSON.stringify(original));
  let pending;
  const s = new DesktopService({ root, bundledExecutable: 'bundled-cli', authInspector: async (_exe, dir) => dir ? { appId: 'cli_new', botAvailable: true } : { type: 'config', status: 'unavailable' }, setupProcess: { phase: 'idle', start: request => { pending = request; return { phase: 'starting' }; } } });
  await s.startAppSetup({ mode: 'create', brand: 'feishu' });
  assert.deepEqual(JSON.parse(await readFile(join(root, 'config.json'), 'utf8')), original);
  assert.equal(pending.executable, 'bundled-cli');
  assert.ok(pending.configDir.startsWith(join(root, 'connections')));
  await pending.onComplete();
  const saved = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
  assert.deepEqual(saved.profiles, original.profiles); assert.deepEqual(saved.defaults, original.defaults); assert.equal(saved.stateDir, 'state');
  assert.equal(saved.backends['lark-cli'].configDir, pending.configDir);
  assert.ok(!JSON.stringify(saved).includes('secret'));
});
test('desktop refuses to replace a known app or reconfigure a healthy connection', async () => {
  const s = new DesktopService({ setupProcess: { phase: 'idle', start: () => assert.fail('must not create an app') } });
  s.setupStatus = async () => ({ stage: 'app', appId: 'cli_existing' });
  await assert.rejects(s.startAppSetup({ mode: 'create', brand: 'feishu' }), /当前应用/);
  await assert.rejects(s.startAppSetup({ mode: 'existing', appId: 'cli_other', brand: 'feishu', secret: 'value' }), /当前应用/);
  s.setupStatus = async () => ({ stage: 'ready' });
  await assert.rejects(s.startAppSetup({ mode: 'create', brand: 'feishu' }), /已有可用/);
});
test('Core CLI calls use the same explicit config directory as desktop authorization', async () => {
  const result = await runLarkCli(process.execPath, ['-e', 'console.log(JSON.stringify({ok:true,data:{config:process.env.LARKSUITE_CLI_CONFIG_DIR}}))'], { configDir: '/fixture/config' });
  assert.equal(result.data.config, '/fixture/config');
});

test('packaged CLI works on first launch and repairs a missing custom path only when selected', async t => {
  const root = await mkdtemp(join(tmpdir(), 'la-bundled-')); t.after(() => rm(root, { recursive: true, force: true }));
  const bundledExecutable = join(root, 'component', 'lark-cli');
  const custom = join(root, 'missing-cli');
  const s = new DesktopService({ root, bundledExecutable, authInspector: async executable => executable === bundledExecutable ? { status: 'unavailable', type: 'config' } : { exitCode: 'ENOENT' } });
  assert.equal((await s.setupStatus()).stage, 'app');
  const original = { version: 1, defaults: { target: { parentToken: 'saved-folder' } }, backends: { 'lark-cli': { executable: custom, configDir: join(root, 'existing-profile') } } };
  await writeFile(join(root, 'config.json'), JSON.stringify(original));
  const status = await s.setupStatus();
  assert.equal(status.stage, 'cli'); assert.equal(status.bundled, true);
  assert.equal((await s.engine()).backends.get('lark-cli').options.executable, custom);
  assert.equal((await s.useBundledCli()).stage, 'app');
  const saved = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
  assert.equal(saved.backends['lark-cli'].executable, 'lark-cli');
  assert.equal(saved.backends['lark-cli'].configDir, original.backends['lark-cli'].configDir);
  assert.deepEqual(saved.defaults, original.defaults);
});
