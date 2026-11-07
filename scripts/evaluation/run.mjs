import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cases } from './source-cases.mjs';
const label=process.argv[2]||'run';
if(!/^[a-z0-9-]+$/i.test(label))throw new Error('Use an alphanumeric run label');
const directory=resolve('.larkanything/evaluation',new Date().toISOString().replace(/[:.]/g,'-')+'-'+label);
await mkdir(directory,{recursive:true});
let commit='unknown';try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();}catch{}
const fileHashes={};
for(const file of ['src/adapters/desktop-sources.mjs','desktop/tauri/sources.mjs','scripts/evaluation/source-cases.mjs']) fileHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const results=[];
for(const item of cases){const start=Date.now();try{await item.run();results.push({...item,run:undefined,status:'passed',durationMs:Date.now()-start});}catch(e){results.push({...item,run:undefined,status:'failed',durationMs:Date.now()-start,error:e.message});}}
const report={createdAt:new Date().toISOString(),commit,fileHashes,node:process.version,platform:process.platform,label,scope:'Offline synthetic source contract tests; not live app/account acceptance.',passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,results};
await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({directory,passed:report.passed,failed:report.failed,results:results.map(({id,status})=>({id,status}))},null,2));
process.exitCode=report.failed?1:0;
