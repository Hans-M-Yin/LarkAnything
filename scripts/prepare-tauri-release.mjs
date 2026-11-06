// Prepare native resources on the build machine, never on the user's machine.
import { readFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { runCommand } from './install.mjs';

const platform = { win32: 'windows', darwin: 'darwin' }[process.platform];
const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
if (!platform || !arch) throw new Error('Desktop release packaging supports Windows/macOS x64 or ARM64 hosts.');
if ((process.env.TAURI_ENV_PLATFORM && process.env.TAURI_ENV_PLATFORM !== platform)
  || (process.env.TAURI_ENV_ARCH && process.env.TAURI_ENV_ARCH !== arch)) {
  throw new Error('Build the desktop installer on a host matching its target platform and CPU; the bundled CLI is native.');
}
const directory = resolve('.larkanything/desktop-cli');
const name = process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli';
async function verify() {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== '1.0.98' || manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('Bundled CLI target mismatch.');
  if (createHash('sha256').update(await readFile(join(directory, name))).digest('hex') !== manifest.sha256) throw new Error('Bundled CLI checksum mismatch.');
  await readFile(join(directory, 'LICENSE'));
  await chmod(join(directory, name), 0o755);
}
try { await verify(); }
catch {
  const prepared = await runCommand(process.execPath, ['scripts/prepare-desktop-cli.mjs']);
  process.stdout.write(prepared.stdout);
  await verify();
}
const built = await runCommand(process.execPath, ['desktop/tauri/build.mjs']);
process.stdout.write(built.stdout);
console.log('Release resources ready: official native Feishu CLI with license and checksum manifest.');
