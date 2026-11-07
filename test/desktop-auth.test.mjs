import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopService } from '../desktop/service.mjs';

const missing = { ok: false, diagnostic: { type: 'authentication', subtype: 'token_missing' } };
const ready = { ok: true, message: 'connected' };
const authorization = { verification_url: 'https://accounts.feishu.cn/oauth/device?user_code=example', device_code: 'private-device-code', expires_in: 240 };
const engineFactory = () => ({ backends: new Map([['lark-cli', { options: { executable: 'configured-cli' } }]]) });
function service(runner, check = async () => missing) {
  const value = new DesktopService({ engineFactory, authRunner: runner });
  value.engine = async () => engineFactory();
  value.checkConnection = check;
  return value;
}

test('desktop login reuses valid authorization without starting OAuth', async () => {
  const s = service(() => assert.fail('must not log in again'), async () => ready);
  assert.deepEqual(await s.beginConnection(), { connected: true, message: 'connected' });
});

test('desktop login keeps device code in memory, deduplicates calls, and verifies in same service', async () => {
  const calls = []; let checks = 0;
  const s = service(async (exe, args) => {
    calls.push({ exe, args });
    return args.includes('--no-wait') ? authorization : { event: 'authorization_complete', access_token: 'never-expose' };
  }, async () => ++checks === 1 ? missing : ready);
  const starts = await Promise.all([s.beginConnection(), s.beginConnection()]);
  assert.deepEqual(starts, [{ url: authorization.verification_url }, { url: authorization.verification_url }]);
  assert.deepEqual(await s.beginConnection(), starts[0]);
  const results = await Promise.all([s.finishConnection(), s.finishConnection()]);
  assert.deepEqual(results, [ready, ready]);
  assert.equal(checks, 2);
  assert.deepEqual(calls, [
    { exe: 'configured-cli', args: ['login', '--domain', 'docs,drive', '--no-wait', '--json'] },
    { exe: 'configured-cli', args: ['login', '--device-code', 'private-device-code', '--json'] },
  ]);
  assert.equal(s.pendingAuth, undefined);
  assert.doesNotMatch(JSON.stringify(results), /private-device-code|never-expose/);
});

test('desktop login rejects unsafe URLs, expired flows and non-authentication failures', async () => {
  for (const url of ['http://accounts.feishu.cn/x', 'https://feishu.cn.evil.test/x', 'file:///x', 'https://user:password@feishu.cn/x']) {
    const s = service(async () => ({ ...authorization, verification_url: url }));
    await assert.rejects(s.beginConnection(), /无效的授权信息/);
    assert.equal(s.pendingAuth, undefined);
  }
  const s = service(async () => authorization);
  await s.beginConnection(); s.pendingAuth.expiresAt = 0;
  assert.throws(() => s.finishConnection(), /过期/);
  assert.equal(s.pendingAuth, undefined);
  const denied = service(() => assert.fail('must not request new authorization'), async () => ({ ok: false, message: 'network unavailable' }));
  await assert.rejects(denied.beginConnection(), /network unavailable/);
});

test('failed completion never returns credentials or claims connection', async () => {
  const s = service(async (_exe, args) => {
    if (args.includes('--no-wait')) return authorization;
    throw Object.assign(new Error('access_token=secret'), { details: { type: 'authentication', subtype: 'access_denied' } });
  });
  await s.beginConnection();
  await assert.rejects(s.finishConnection(), error => {
    assert.match(error.message, /access_denied/);
    assert.doesNotMatch(error.message, /secret|private-device-code/);
    return true;
  });
  assert.equal(s.pendingAuth, undefined);
});
