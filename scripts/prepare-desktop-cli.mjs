// Build-time only: users of the packaged App do not need Node.js or npm.
import { mkdir, copyFile, chmod, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runCommand, findNpm } from './install.mjs';
import { parseArgs } from 'node:util';

const version = '1.0.98';
const cache = resolve('.larkanything', 'desktop-cli-build', `${process.platform}-${process.arch}`);
const output = resolve('.larkanything', 'desktop-cli');
const { values } = parseArgs({ options: { 'from-package': { type: 'string' } } });
const pkg = values['from-package'] ? resolve(values['from-package']) : join(cache, 'node_modules', '@larksuite', 'cli');
if (!values['from-package']) {
  const npm = await findNpm();
  await mkdir(cache, { recursive: true });
  await runCommand(process.execPath, [npm, 'install', '--prefix', cache, '--ignore-scripts', '--no-audit', '--no-fund', `@larksuite/cli@${version}`]);
  // The official installer verifies the release archive checksum before extraction.
  await runCommand(process.execPath, [join(pkg, 'scripts/install.js')]);
}
const info = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));
if (info.name !== '@larksuite/cli' || info.version !== version) throw new Error('Expected the pinned official CLI package.');
const name = process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli';
const executable = join(pkg, 'bin', name);
const result = await runCommand(executable, ['--version']);
if (!result.stdout.includes(version)) throw new Error('CLI binary version does not match package.');
await mkdir(output, { recursive: true });
await copyFile(executable, join(output, name));
await chmod(join(output, name), 0o755);
await copyFile(join(pkg, 'LICENSE'), join(output, 'LICENSE'));
await writeFile(join(output, 'manifest.json'), JSON.stringify({ version, platform: process.platform, arch: process.arch, sha256: createHash('sha256').update(await readFile(executable)).digest('hex') }, null, 2));
console.log(`Prepared official Lark CLI ${version} for ${process.platform}-${process.arch}. No credentials are bundled.`);
