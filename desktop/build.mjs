import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('desktop/dist', { recursive: true });
await build({ entryPoints: ['./desktop/ui/app.tsx'], tsconfig: 'desktop/tsconfig.json', bundle: true, outfile: 'desktop/dist/app.js', platform: 'browser', target: 'chrome130', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
await copyFile('desktop/index.html', 'desktop/dist/index.html');
await mkdir('desktop/dist/assets', { recursive: true });
for (const name of ['codex.svg', 'claudecode-color.svg', 'obsidian-color.svg']) {
  await copyFile(`node_modules/@lobehub/icons-static-svg/icons/${name}`, `desktop/dist/assets/${name}`);
}
await copyFile('desktop/THIRD-PARTY-NOTICES.md', 'desktop/dist/THIRD-PARTY-NOTICES.md');
console.log('Desktop UI built.');
