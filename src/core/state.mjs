import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash } from './model.mjs';
import { LarkAnythingError } from './errors.mjs';

export class FileReceiptStore {
  constructor(directory) { this.directory = resolve(directory); }
  file(key) { return join(this.directory, `${hash(key)}.json`); }
  async get(key) {
    try { return JSON.parse(await readFile(this.file(key), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }
  async put(key, receipt) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = `${this.file(key)}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temp, this.file(key));
    } finally { await rm(temp, { force: true }); }
  }
  async withLock(key, action) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = `${this.file(key)}.lock`;
    let lock;
    try { lock = await open(path, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new LarkAnythingError('EXPORT_LOCKED', `Another publisher holds this export key. After a crashed process, inspect the receipt and remove the stale lock manually: ${path}`);
      throw error;
    }
    try { await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); return await action(); }
    finally { await lock.close(); await rm(path, { force: true }); }
  }
}
