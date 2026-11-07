import test from 'node:test';
import assert from 'node:assert/strict';
import { macSigningEnvironment } from '../scripts/macos-signing.mjs';

test('ad-hoc packaging does not accidentally use partial Apple credentials', () => {
  const input = { PATH: 'preserved', APPLE_CERTIFICATE: 'private-fixture', APPLE_PASSWORD: 'private-fixture', APPLE_API_KEY: 'key' };
  const env = macSigningEnvironment(input);
  assert.equal(env.APPLE_SIGNING_IDENTITY, '-');
  assert.equal(env.PATH, 'preserved');
  assert.equal(env.APPLE_CERTIFICATE, undefined);
  assert.equal(env.APPLE_PASSWORD, undefined);
  assert.equal(env.APPLE_API_KEY, undefined);
  assert.equal(input.APPLE_PASSWORD, 'private-fixture');
});
test('Developer ID packaging refuses incomplete or wrong signing identities', () => {
  assert.throws(() => macSigningEnvironment({MACOS_SIGNING_MODE:'typo'}), /must be/);
  assert.throws(() => macSigningEnvironment({MACOS_SIGNING_MODE:'developer-id',APPLE_PASSWORD:'private-fixture'}), error => /requires/.test(error.message) && !error.message.includes('private-fixture'));
  const env={MACOS_SIGNING_MODE:'developer-id',APPLE_SIGNING_IDENTITY:'Developer ID Application: QA (TEST)',APPLE_CERTIFICATE:'fixture',APPLE_CERTIFICATE_PASSWORD:'fixture',APPLE_ID:'fixture',APPLE_PASSWORD:'fixture',APPLE_TEAM_ID:'fixture'};
  assert.equal(macSigningEnvironment(env).MACOS_SIGNING_MODE,'developer-id');
  assert.throws(()=>macSigningEnvironment({...env,APPLE_SIGNING_IDENTITY:'-'}),/Developer ID Application/);
});
