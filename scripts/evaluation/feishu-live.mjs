// Opt-in real-account acceptance using synthetic documents only. Never run in CI.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { homedir } from 'node:os';
import { createLarkAnything, loadConfig } from '../../src/index.mjs';
import { DesktopService } from '../../desktop/service.mjs';
import { createSources } from '../../desktop/tauri/sources.mjs';
const execute=process.argv.includes('--execute');
const wordArg=process.argv.find(v=>v.startsWith('--word='));
const root=resolve('.larkanything/evaluation',new Date().toISOString().replace(/[:.]/g,'-')+'-feishu-live');
await mkdir(root,{recursive:true});
const config=await loadConfig(join(homedir(),'.larkanything/config.json'));
config.stateDir=join(root,'state');
const backend=config.backends?.['lark-cli']||{};
config.backends={...config.backends,'lark-cli':{...backend,executable:backend.executable&&backend.executable!=='lark-cli'?backend.executable:resolve('.larkanything/desktop-cli',process.platform==='win32'?'lark-cli.exe':'lark-cli')}};
const service=new DesktopService({root,engineFactory:options=>createLarkAnything({...options,config})});
service.sources=createSources({transport:async(op,{path})=>{
 assert.ok(resolve(path).startsWith(root+sep),'Only this run’s synthetic input files may be read');
 if(op==='stat'){const s=await stat(path);return {size:s.size,mtimeMs:s.mtimeMs};}
 if(op==='read')return readFile(path,'utf8');
 if(op==='read_bytes')return [...await readFile(path)];
 throw new Error('Unexpected filesystem operation');
}});
const marker='LARKANYTHING-QA-20261107';
const markdown=join(root,'LarkAnything QA Markdown 2026-11-07.md');
await writeFile(markdown,`# LarkAnything 自动验收\n\n${marker}\n\n中文与 emoji 🙂\n\n- 第一项\n- 第二项\n\n| 项目 | 数值 |\n| --- | --- |\n| Alpha | 42 |\n\n\`\`\`js\nconst answer = 42;\n\`\`\`\n`);
const inputs=[{channel:'markdown',path:markdown,marker}];
if(wordArg){
 const bytes=await readFile(resolve(wordArg.slice(7)));
 // Explicitly supplied Word sample must carry our known synthetic marker.
 const {docxSource}=await import('../../src/adapters/desktop-sources.mjs');
 assert.match(docxSource(bytes,'qa.docx').body,/QA-WORD-NATIVE-20261107/);
 const path=join(root,'LarkAnything QA Word 2026-11-07.docx');await writeFile(path,bytes);
 inputs.push({channel:'docx',path,marker:'QA-WORD-NATIVE-20261107'});
}
const report={createdAt:new Date().toISOString(),scope:'Real Feishu CLI + Core publication/readback; synthetic content. Not the Tauri GUI publishing button.',execute,results:[]};
try{
 for(const input of inputs){
  const item=await service.sources.importFile(input.channel,input.path);await service.list(input.channel);
  const preview=await service.preview(item.id);assert.ok(preview.html.includes(input.marker));
  const started=Date.now();
  const result=execute?await service.publish(preview.token):{status:'preview-only'};
  report.results.push({source:input.channel,status:result.status,url:result.remote?.url,durationMs:Date.now()-started});
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));
  if(execute)assert.equal(result.status,'verified');
 }
}catch(e){report.error={code:e.code,message:e.message};process.exitCode=1;}
finally{await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({root,...report},null,2));}
