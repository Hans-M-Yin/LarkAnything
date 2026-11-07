import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { macSigningEnvironment } from './macos-signing.mjs';

if (process.platform !== 'darwin') throw new Error('Build the DMG on macOS.');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--target')) throw new Error('Usage: npm run desktop:package:mac -- --target aarch64-apple-darwin');
const target = args[1] || (process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin');
if (target !== (process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin')) throw new Error('Build on a Mac matching the target architecture.');
const env = macSigningEnvironment(process.env);
function run(command, params) {
  const result = spawnSync(command, params, { stdio: 'inherit', env });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status ?? 'startup'})`);
}
run('python3', ['-c', 'import dmgbuild, ds_store']);
// Tauri still signs/notarizes/staples the app. Only Finder-dependent DMG layout
// is replaced, with deterministic .DS_Store generation on headless runners.
run('tauri', ['build', '--bundles', 'app', '--target', target]);
const directory = resolve(process.env.CARGO_TARGET_DIR || 'src-tauri/target', target, 'release/bundle');
const app = join(directory, 'macos/LarkAnything.app');
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const arch = target.startsWith('aarch64') ? 'aarch64' : 'x64';
const output = join(directory, 'dmg', `LarkAnything_${config.version}_${arch}.dmg`);
run('python3', ['scripts/build-macos-dmg.py', app, output]);
