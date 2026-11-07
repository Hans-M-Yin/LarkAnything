import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
await mkdir('desktop/tauri-dist/assets', { recursive: true });
const base = { bundle: true, platform: 'browser', target: ['chrome110', 'safari16.4'], minify: true, format: 'esm', define: { 'process.env.NODE_ENV': '"production"' } };
await build({ ...base, entryPoints: ['desktop/tauri/entry.ts'], outfile: 'desktop/tauri-dist/app.js', tsconfig: 'desktop/tsconfig.json' });
await build({ ...base, entryPoints: ['desktop/tauri/worker.mjs'], outfile: 'desktop/tauri-dist/worker.js', inject: ['desktop/tauri/runtime.mjs'], alias: Object.fromEntries(Object.entries({
  'fs/promises': 'fs', fs: 'fs', readline: 'fs', path: 'path', os: 'os', crypto: 'crypto', child_process: 'child-process'
}).map(([key, value]) => [`node:${key}`, `./desktop/tauri/${value}.mjs`])) });
let html = await readFile('desktop/index.html', 'utf8');
// Tauri injects its IPC-aware CSP; do not leave the Electron-specific meta CSP.
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '').replace('<script src=', '<script type="module" src=');
await writeFile('desktop/tauri-dist/index.html', html);
for (const name of ['codex.svg','claudecode-color.svg','obsidian-color.svg','opencode.svg','notion.svg']) await copyFile(require.resolve(`@lobehub/icons-static-svg/icons/${name}`), `desktop/tauri-dist/assets/${name}`);
let notices = await readFile('desktop/THIRD-PARTY-NOTICES.md','utf8');
for (const name of ['fflate','fast-xml-parser','@noble/hashes','react','react-dom','markdown-it','katex']) {
  let directory = dirname(require.resolve(name));
  // Package exports may hide LICENSE; locate it relative to the resolved module.
  for (let depth=0;depth<4;depth++,directory=dirname(directory)) {
    const license = await readFile(join(directory,'LICENSE'),'utf8').catch(()=>null);
    if (license) { notices += `\n\n## ${name}\n\n${license}`; break; }
  }
}
const pathSource=await readFile('desktop/tauri/path.mjs','utf8');
notices += '\n\n## Node.js path implementation\n\n' + pathSource.slice(0,pathSource.indexOf("import { process }")).replace(/^\/\/ ?/gm,'');
for (const name of ['Inter-LICENSE.txt','NotoSansSC-LICENSE.txt']) notices += '\n\n## '+name+'\n\n'+await readFile('desktop/assets/fonts/'+name,'utf8');
await writeFile('desktop/tauri-dist/THIRD-PARTY-NOTICES.md',notices);
console.log('Tauri UI and Core worker built; no Node runtime.');

for (const name of ['markdown.svg','word.svg','larkanything.png']) await copyFile('desktop/assets/'+name,'desktop/tauri-dist/assets/'+name);

await mkdir('desktop/tauri-dist/assets/fonts',{recursive:true});
for(const name of ['fonts.css','InterVariable.woff2','LarkUICJK.woff2','Inter-LICENSE.txt','NotoSansSC-LICENSE.txt']) await copyFile('desktop/assets/fonts/'+name,'desktop/tauri-dist/assets/fonts/'+name);
const entry=await readFile('desktop/tauri-dist/index.html','utf8');
await writeFile('desktop/tauri-dist/index.html',entry.replace('</head>','<link rel="stylesheet" href="./assets/fonts/fonts.css"></head>'));
