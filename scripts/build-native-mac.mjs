import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildNativeMac({ dmg = false } = {}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('请在 Apple Silicon Mac 上使用 ARM64 Node.js 运行此命令。');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或更新版本。');
  const project = fileURLToPath(new URL('../', import.meta.url));
  const run = (command, args, cwd = project) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')}\n${result.error?.message || result.stderr || result.stdout}`);
    return result.stdout.trim();
  };
  const node = await realpath(process.execPath);
  const linkage = run('/usr/bin/otool', ['-L', node]);
  const thirdParty = linkage.split('\n').slice(1).map(line => line.trim().split(' ')[0]).filter(path => path && !path.startsWith('/usr/lib/') && !path.startsWith('/System/Library/'));
  if (thirdParty.length) throw new Error(`当前 Node 依赖外部库，不能直接随 App 分发：${thirdParty.join(', ')}。请改用 nodejs.org 的独立 macOS ARM64 发行版。`);
  const args = ['build', '--package-path', 'native/macos', '--configuration', 'release', '--arch', 'arm64'];
  console.log('Compiling native SwiftUI app…');
  run('/usr/bin/xcrun', ['swift', ...args]);
  const bin = run('/usr/bin/xcrun', ['swift', ...args, '--show-bin-path']);
  const releases = join(project, '.larkanything/releases'); await mkdir(releases, { recursive: true });
  const staging = await mkdtemp(join(releases, 'native-'));
  const bundle = join(staging, 'LarkAnything.app'), contents = join(bundle, 'Contents');
  const resources = join(contents, 'Resources'), core = join(resources, 'core');
  await mkdir(join(contents, 'MacOS'), { recursive: true }); await mkdir(join(resources, 'runtime'), { recursive: true });
  await mkdir(join(core, 'desktop'), { recursive: true }); await mkdir(join(core, 'native'), { recursive: true });
  await cp(join(bin, 'LarkAnything'), join(contents, 'MacOS/LarkAnything'));
  await cp(node, join(resources, 'runtime/node'));
  await cp(join(project, 'src'), join(core, 'src'), { recursive: true });
  for (const file of ['desktop/service.mjs', 'native/bridge.mjs', 'package.json', 'package-lock.json', 'LICENSE']) await cp(join(project, file), join(core, file));
  console.log('Installing locked production dependencies in app bundle…');
  // No Electron or React dependency is shipped in the native app.
  run(process.execPath, [process.env.npm_execpath || '/usr/local/lib/node_modules/npm/bin/npm-cli.js', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], core);
  const pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>LarkAnything</string>
<key>CFBundleIdentifier</key><string>com.larkanything.native</string>
<key>CFBundleName</key><string>LarkAnything</string>
<key>CFBundleDisplayName</key><string>LarkAnything</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${pkg.version}</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>\n`);
  const sdk = run('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-version']);
  console.log(`Built with macOS SDK ${sdk}. Liquid Glass requires a supporting SDK and macOS version.`);
  // Local ad-hoc signing only. Public distribution needs Developer ID + notarization.
  run('/usr/bin/codesign', ['--force', '--sign', '-', join(resources, 'runtime/node')]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', bundle]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
  console.log(`App: ${bundle}`);
  if (dmg) {
    const { symlink } = await import('node:fs/promises');
    await symlink('/Applications', join(staging, 'Applications'));
    const target = join(releases, `LarkAnything-Native-${pkg.version}-arm64.dmg`);
    run('/usr/bin/hdiutil', ['create', '-volname', 'LarkAnything', '-srcfolder', staging, '-ov', '-format', 'UDZO', target]);
    console.log(`DMG: ${target}`);
  }
  return bundle;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await buildNativeMac({ dmg: process.argv.includes('--dmg') }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
