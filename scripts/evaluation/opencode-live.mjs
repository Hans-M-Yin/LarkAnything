// Uses official CLI binaries with synthetic data in isolated XDG directories.
// No model prompts, provider credentials, or user sessions are used.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createSources } from '../../desktop/tauri/sources.mjs';
const exec=promisify(execFile);
const binaries=process.argv.slice(2).map(p=>resolve(p));
if(!binaries.length)throw new Error('Pass one or more official OpenCode executable paths.');
const root=resolve('.larkanything/evaluation',new Date().toISOString().replace(/[:.]/g,'-')+'-opencode-live');
await mkdir(root,{recursive:true});
const results=[];
for(const [index,binary] of binaries.entries()){
 const directory=join(root,String(index));await mkdir(directory,{recursive:true});
 // Allow only OS runtime variables; no inherited provider keys or user CLI settings.
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['systemroot','windir','path','pathext','temp','tmp','comspec','localappdata','appdata','userprofile'].includes(key.toLowerCase())));
 Object.assign(env,{XDG_DATA_HOME:join(directory,'data'),XDG_CONFIG_HOME:join(directory,'config'),XDG_CACHE_HOME:join(directory,'cache'),XDG_STATE_HOME:join(directory,'state'),OPENCODE_CONFIG_CONTENT:JSON.stringify({autoupdate:false,enabled_providers:[],plugin:[]})});
 let version,stage='version';
 const command=async args=>(await exec(binary,args,{cwd:directory,env,windowsHide:true,timeout:45000,maxBuffer:32*1024*1024})).stdout;
 try{
  version=(await command(['--version'])).trim();const v2=/^(?:opencode\s+)?v?2\./i.test(version);
  const now=Date.now(),id='ses_qa'+now;
  const fixture={info:{id,slug:'synthetic-qa',projectID:'global',directory,title:'LarkAnything isolated QA',version,time:{created:now,updated:now}},messages:[{info:{id:'msg_qa'+now,sessionID:id,role:'user',time:{created:now},agent:'build',model:{providerID:'unused',modelID:'unused'}},parts:[{id:'prt_qa'+now,sessionID:id,messageID:'msg_qa'+now,type:'text',text:'OpenCode real CLI roundtrip 中文🙂'}]}]};
  const expectedText=fixture.messages[0].parts[0].text;
  if(v2){
   fixture.info.location={directory};fixture.info.cost=0;fixture.info.tokens={input:0,output:0,reasoning:0,cache:{read:0,write:0}};
   fixture.messages=[{id:'msg_qa'+now,type:'user',text:expectedText,time:{created:now}}];
  }
  const file=join(directory,'fixture.json');await writeFile(file,JSON.stringify(fixture));
  stage='import';await command(v2?['session','import',file,'--standalone']:['import',file]);
  const source=createSources({command:args=>command(v2&&args[0]!=='--version'?[...args,'--standalone']:args)});
  stage='list';const rows=await source.list('opencode');const item=rows.find(r=>r.title===fixture.info.title);assert.ok(item,'Imported session must appear in actual CLI list');
  stage='export';const raw=await command(v2?['session','export',item.id.slice(9),'--standalone']:['export',item.id.slice(9)]);
  await writeFile(join(directory,'actual-export.json'),raw);
  const model=await source.load('opencode',item);
  assert.equal(model.messages[0].timestamp,new Date(now).toISOString());
  assert.equal(model.messages[0].content[0].text,expectedText);
  assert.ok(item.modified>=now,'List must expose a usable modification time');
  results.push({version,status:'passed',stage:'list-export-adapter',binarySha256:createHash('sha256').update(await readFile(binary)).digest('hex')});
 }catch(e){results.push({version,status:'failed',stage,error:e.message});}
}
await writeFile(join(root,'report.json'),JSON.stringify({createdAt:new Date().toISOString(),scope:'Real OpenCode CLI import/list/export with synthetic sessions; not model generation, GUI, or Feishu publication.',results},null,2));
console.log(JSON.stringify({root,results},null,2));process.exitCode=results.some(r=>r.status==='failed')?1:0;
