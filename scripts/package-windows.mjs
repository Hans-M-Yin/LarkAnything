import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.error('请在 Windows x64 上执行 npm run desktop:package:win。'); process.exit(1);
}
const require = createRequire(import.meta.url);
// Reuse npm's verified Electron runtime; no second runtime download is needed.
for (const args of [['scripts/prepare-desktop-cli.mjs'], ['desktop/build.mjs'], [require.resolve('electron-builder/cli.js'), '--win', '--x64', '--dir', '--publish', 'never', `--config.electronDist=${dirname(require('electron'))}`]]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('打开 .larkanything/releases/win-unpacked/LarkAnything.exe 即可测试。请保留整个 win-unpacked 文件夹。');
