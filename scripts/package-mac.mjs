import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  console.error('请在 Apple Silicon Mac 上执行 npm run desktop:package:mac。'); process.exit(1);
}
const require = createRequire(import.meta.url);
for (const args of [['scripts/prepare-desktop-cli.mjs'], ['desktop/build.mjs'], [require.resolve('electron-builder/cli.js'), '--mac', '--arm64', '--publish', 'never']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
