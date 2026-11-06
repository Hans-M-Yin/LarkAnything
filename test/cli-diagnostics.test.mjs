import test from 'node:test';
import assert from 'node:assert/strict';
import { runLarkCli } from '../src/backends/lark-cli.mjs';
import { createLarkAnything, LarkCliBackend } from '../src/index.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLI failures retain structured codes without raw output or credentials', async () => {
  await assert.rejects(runLarkCli(process.execPath, ['-e', 'console.error(JSON.stringify({ok:false,error:{type:"authorization",subtype:"missing_scope",code:"AUTH_EXPIRED",missing_scopes:["docx:document:create"],message:"private-content access_token=secret"}}));process.exit(7)']), error => {
    assert.equal(error.details.exitCode, 7);
    assert.equal(error.details.cliCode, 'AUTH_EXPIRED');
    assert.equal(error.details.type, 'authorization');
    assert.deepEqual(error.details.missingScopes, ['docx:document:create']);
    assert.ok(!JSON.stringify(error).includes('secret'));
    return true;
  });
});

test('missing application secret is classified without retaining raw authorization output', async () => {
  await assert.rejects(runLarkCli(process.execPath, ['-e', 'console.error(JSON.stringify({ok:false,error:{type:"authentication",subtype:"unknown",message:"Device authorization failed: The request is missing a required parameter: client_secret.",private:"secret"}}));process.exit(3)']), error => {
    assert.equal(error.details.appSecretMissing, true);
    assert.equal(error.details.subtype, 'unknown');
    assert.doesNotMatch(JSON.stringify(error.details), /"secret"|Device authorization/);
    return true;
  });
});

test('Unknown writes retain diagnostic codes across retries without replay', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'la-diagnostics-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let writes = 0;
  const backend = new LarkCliBackend({}, async () => {
    writes++;
    throw Object.assign(new Error('private-content'), { code: 'LARK_CLI_ERROR', details: { exitCode: 7, cliCode: 'AUTH_EXPIRED', stderr: 'secret' } });
  });
  const engine = createLarkAnything({ config: { stateDir: dir } });
  engine.backends.get('lark-cli').runner = backend.runner;
  const plan = await engine.plan({ channel: 'codex', input: 'examples/codex.jsonl' });
  for (let n = 0; n < 2; n++) await assert.rejects(engine.publish(plan), error => {
    assert.equal(error.code, 'WRITE_UNCERTAIN');
    assert.equal(error.details.diagnostic.cliCode, 'AUTH_EXPIRED');
    return true;
  });
  assert.equal(writes, 1);
  const receipt = await engine.store.get(plan.exportKey);
  assert.equal(receipt.status, 'uncertain');
  assert.ok(!JSON.stringify(receipt).includes('secret'));
});
