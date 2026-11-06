import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
export default async function verifyDesktopCli(context) {
  const root = resolve(context.packager.projectDir, '.larkanything/desktop-cli');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  // electron-builder uses builder-util's Arch enum: x64=1, arm64=3.
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch];
  if (manifest.version !== '1.0.98' || manifest.platform !== context.electronPlatformName || manifest.arch !== arch) throw new Error('Bundled CLI target mismatch. Run the platform packaging script first.');
  const file = join(root, context.electronPlatformName === 'win32' ? 'lark-cli.exe' : 'lark-cli');
  if (createHash('sha256').update(await readFile(file)).digest('hex') !== manifest.sha256) throw new Error('Bundled CLI checksum changed. Prepare the official CLI again.');
}
