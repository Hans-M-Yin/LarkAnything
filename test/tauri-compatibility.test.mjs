import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash as nodeHash } from 'node:crypto';
import { initialize } from '../desktop/tauri/runtime.mjs';
import { createHash } from '../desktop/tauri/crypto.mjs';
initialize({ platform: process.platform, cwd: process.cwd(), env: process.env, pid: process.pid });
const compat = await import('../desktop/tauri/path.mjs');
test('Tauri preserves Windows and POSIX source paths, including Unicode and UNC', () => {
  const inputs = ['C:\\Users\\张三\\.codex\\sessions\\..\\sessions\\a.jsonl', '\\\\server\\share\\笔记\\a.md', '/Users/张三/.claude/projects/a.jsonl', './relative/../笔记.md', 'C:relative', '/', '', 'a\\b/../c'];
  for (const kind of ['win32', 'posix']) for (const input of inputs) {
    for (const method of ['resolve','dirname','basename','normalize','extname','parse']) assert.deepEqual(compat[kind][method](input), path[kind][method](input), `${kind}.${method}(${input})`);
    assert.equal(compat[kind].join(input,'nested','..','文档.md'),path[kind].join(input,'nested','..','文档.md'));
  }
});
test('Tauri SHA-256 preserves export fingerprints and incremental source hashes', () => {
  for (const chunks of [[],[''],['中文🙂\r\n'],['first','\n','第二条'],['x'.repeat(1000000)]]) {
    const old=nodeHash('sha256'), migrated=createHash('sha256');
    for(const chunk of chunks) {old.update(chunk);migrated.update(chunk);}
    assert.equal(migrated.digest('hex'),old.digest('hex'));
  }
});
