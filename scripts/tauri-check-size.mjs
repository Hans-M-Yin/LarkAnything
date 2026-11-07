import { stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const directory=resolve(process.argv[2] || 'src-tauri/target/release');
const app=join(directory,process.platform==='win32'?'larkanything-desktop.exe':'larkanything-desktop');
const size=(await stat(app)).size;
console.log(JSON.stringify({app,bytes:size,MB:Number((size/1e6).toFixed(2)),MiB:Number((size/1048576).toFixed(2)),under50MB:size<50000000,excludes:['external Feishu CLI','system WebView','user data and cache']},null,2));
if(size>=50000000)process.exitCode=1;
const installers=join(directory,'bundle',process.platform==='win32'?'nsis':'dmg');
for(const name of await readdir(installers).catch(()=>[]))if(/\.(exe|dmg)$/.test(name))console.log(JSON.stringify({installer:join(installers,name),MB:Number(((await stat(join(installers,name))).size/1e6).toFixed(2))}));
