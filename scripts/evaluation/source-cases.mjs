import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { docxSource, openCodeSource } from '../../src/adapters/desktop-sources.mjs';
import { createSources } from '../../desktop/tauri/sources.mjs';
import { mkdtemp, writeFile, readFile, stat, utimes, unlink, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const doc = (body, other = {}) => zipSync({ 'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`), ...Object.fromEntries(Object.entries(other).map(([k,v]) => [k,strToU8(v)])) });
const paragraph = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const exported = (parts, created = 1780000000000) => ({ info:{id:'ses_qa',title:'Synthetic QA'},messages:[{info:{id:'m1',role:'user',time:{created}},parts}] });
export const cases = [
 {id:'DOCX-007',source:'docx',level:'sanitized fixture from actual Microsoft Word UI save',title:'Word-generated localized heading and Unicode survive extraction',async run(){
  const bytes=await readFile(new URL('../../test/fixtures/word-native-ui.docx',import.meta.url));
  assert.equal(docxSource(bytes,'word-native-ui.docx').body,'# LarkAnything Word 验收标题\n\nQA-WORD-NATIVE-20261107 中文正文，数字 42，emoji 🙂。仅用于本地功能验收。');
 }},
 {id:'FILE-001',source:'markdown',level:'real local filesystem, synthetic content',title:'Refresh updates metadata and isolates missing files, then recovers',async run(){
  const root=await mkdtemp(join(tmpdir(),'la-source-eval-'));
  try{
   const path=join(root,'中文 空格.MD'),other=join(root,'other.md');
   await writeFile(path,'# First');await utimes(path,1,1);await writeFile(other,'# Other');
   const source=createSources({transport:async(op,{path})=>{
    if(op==='stat'){const s=await stat(path);return {size:s.size,mtimeMs:s.mtimeMs};}
    assert.equal(op,'read');return readFile(path,'utf8');
   }});
   const item=await source.importFile('markdown',path);await source.importFile('markdown',other);
   await writeFile(path,'# Updated body');await utimes(path,2000000000,2000000000);
   const refreshed=(await source.list('markdown'))[0];assert.equal(refreshed.id,item.id);assert.match(refreshed.excerpt,/Updated body/);assert.ok(refreshed.modified>item.modified);
   await unlink(path);const missing=await source.list('markdown');assert.equal(missing.length,2);assert.ok(missing.find(x=>x.id===item.id).error);assert.ok(!missing.find(x=>x.id!==item.id).error);
   await assert.rejects(source.load('markdown',item));
   await writeFile(path,'# Restored');const restored=(await source.list('markdown')).find(x=>x.id===item.id);assert.ok(!restored.error);assert.match(restored.excerpt,/Restored/);
  }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'la-source-eval-'));await rm(root,{recursive:true,force:true});}
 }},
 {id:'DOCX-001',source:'docx',level:'synthetic OOXML',title:'Localized/custom heading style resolves through styles.xml',run(){
  const model=docxSource(doc('<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>QA heading</w:t></w:r></w:p>',{'word/styles.xml':'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>'}),'qa.docx');
  assert.match(model.body,/^# QA heading$/m);
 }},
 {id:'DOCX-002',source:'docx',level:'synthetic OOXML',title:'Paragraphs inside a table cell retain a separator',run(){
  const model=docxSource(doc('<w:tbl><w:tr><w:tc>'+paragraph('First')+paragraph('Second')+'</w:tc></w:tr></w:tbl>'),'qa.docx');
  assert.match(model.body,/First\s+Second/);assert.ok(!model.body.includes('FirstSecond'));
 }},
 {id:'DOCX-003',source:'docx',level:'synthetic OOXML',title:'Malformed XML cannot become a silently partial document',run(){
  assert.throws(()=>docxSource(zipSync({'word/document.xml':strToU8('<w:document><w:body><w:p><w:r><w:t>Partial</w:t></w:r>')}),'qa.docx'),/XML|有效|损坏/);
 }},
 {id:'DOCX-004',source:'docx',level:'synthetic OOXML',title:'Lost hyperlink destination is explicitly disclosed',run(){
  const model=docxSource(doc('<w:p><w:hyperlink r:id="rId1"><w:r><w:t>Reference</w:t></w:r></w:hyperlink></w:p>'),'qa.docx');
  assert.ok(model.body.includes('https:') || model.warnings.some(w=>/链接|hyperlink/i.test(w.message)), 'Hyperlink target disappeared without a specific warning');
 }},
 {id:'DOCX-005',source:'docx',level:'synthetic OOXML',title:'Inherited headings, explicit body outline and cyclic styles are handled',run(){
  const styles='<w:styles><w:style w:styleId="base"><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style><w:style w:styleId="custom"><w:basedOn w:val="base"/></w:style><w:style w:styleId="cycle"><w:basedOn w:val="cycle"/></w:style></w:styles>';
  const body='<w:p><w:pPr><w:pStyle w:val="custom"/></w:pPr><w:r><w:t>Inherited</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="custom"/><w:outlineLvl w:val="9"/></w:pPr><w:r><w:t>Ordinary</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="cycle"/></w:pPr><w:r><w:t>Cycle</w:t></w:r></w:p>';
  assert.equal(docxSource(doc(body,{'word/styles.xml':styles}),'qa.docx').body,'## Inherited\n\nOrdinary\n\nCycle');
 }},
 {id:'DOCX-006',source:'docx',level:'synthetic OOXML',title:'Auxiliary XML and aggregate expansion obey the same validation limits',run(){
  assert.throws(()=>docxSource(doc(paragraph('Body'),{'word/styles.xml':'<!DOCTYPE w:styles><w:styles/>'}),'qa.docx'),/实体/);
  assert.throws(()=>docxSource(doc(paragraph('Body'),{'word/styles.xml':'<w:styles>'}),'qa.docx'),/XML/);
  assert.throws(()=>docxSource(doc(paragraph('Body'),{'word/styles.xml':' '.repeat(21*1024*1024)}),'qa.docx'),/解压/);
 }},
 {id:'OC-001',source:'opencode',level:'synthetic CLI output',title:'Millisecond epoch is preserved as the correct calendar time',run(){
  const model=openCodeSource(exported([{type:'text',text:'Hello'}]));
  assert.equal(model.messages[0].timestamp,new Date(1780000000000).toISOString());
 }},
 {id:'OC-002',source:'opencode',level:'synthetic CLI output',title:'Unknown content parts cannot be silently discarded',run(){
  const model=openCodeSource(exported([{type:'text',text:'Hello'},{type:'future-content',text:'Must be reported'}]));
  assert.ok(model.messages[0].content.some(p=>p.type==='unsupported') || model.warnings.length>0);
 }},
 {id:'OC-003',source:'opencode',level:'synthetic CLI output',title:'Internal reasoning stays excluded',run(){
  const model=openCodeSource(exported([{type:'reasoning',text:'PRIVATE_QA_SENTINEL'},{type:'text',text:'Public'}]));
  assert.ok(!JSON.stringify(model).includes('PRIVATE_QA_SENTINEL'));assert.equal(model.messages[0].content[0].text,'Public');
 }},
 {id:'OC-004',source:'opencode',level:'official CLI version string, synthetic export',title:'Real V2 version prefix selects the V2 export command',async run(){
  const source=createSources({command:async args=>{
   if(args[0]==='--version')return 'opencode v2.2.6\n';
   assert.deepEqual(args,['session','export','ses_qa']);return JSON.stringify(exported([{type:'text',text:'Public'}]));
  }});
  await source.load('opencode',{id:'opencode:ses_qa'});
 }},
 {id:'OC-005',source:'opencode',level:'V2 schema, synthetic transcript',title:'V2 tagged messages preserve public text, tools, files, and time',run(){
  const created=1780000000000;
  const model=openCodeSource({info:{id:'ses_qa'},messages:[
   {id:'u',type:'user',text:'Question 中文',files:[{name:'image.png'}],time:{created}},
   {id:'a',type:'assistant',time:{created},content:[{type:'reasoning',text:'PRIVATE_QA_SENTINEL'},{type:'text',text:'Public answer'},{type:'tool',name:'read',state:{status:'completed',content:[{type:'text',text:'Tool result'}]}}]},
   {id:'s',type:'shell',command:'echo QA',output:{output:'QA'},time:{created}},
   {id:'sys',type:'system',text:'PRIVATE_QA_SENTINEL',time:{created}},
  ]});
  assert.equal(model.messages.length,3);assert.equal(model.messages[0].timestamp,new Date(created).toISOString());
  assert.equal(model.messages[0].content[0].text,'Question 中文');assert.equal(model.messages[0].content[1].label,'image.png');
  assert.equal(model.messages[1].content[0].text,'Public answer');assert.match(model.messages[1].content[1].text,/Tool result/);
  assert.equal(model.messages[2].role,'tool');assert.ok(!JSON.stringify(model).includes('PRIVATE_QA_SENTINEL'));assert.equal(model.source.completeness,'partial');
 }},
 {id:'NOTION-001',source:'notion',level:'mock API',title:'Repeated pagination cursor stops with an explicit error',async run(){
  let calls=0;const source=createSources({transport:async()=>{if(++calls>4)throw new Error('QA_NETWORK_GUARD: repeated requests');return {results:[],has_more:true,next_cursor:'same'};}});
  await source.connectNotion('synthetic-token');
  await assert.rejects(source.list('notion'),/分页.*重复|重复.*分页/);assert.ok(calls<=3);
 }},
 {id:'NOTION-002',source:'notion',level:'mock API',title:'Invalid search response is not reported as an empty workspace',async run(){
  const source=createSources({transport:async()=>({unexpected:true})});
  await assert.rejects(async()=>{await source.connectNotion('synthetic-token');await source.list('notion');},/格式|返回/);
 }},
 {id:'NOTION-003',source:'notion',level:'mock API',title:'Truncated content blocks publication',async run(){
  const source=createSources({transport:async()=>({markdown:'# Partial',truncated:true})});
  await assert.rejects(source.load('notion',{id:'notion:qa',title:'QA'}),/完整/);
 }},
 {id:'NOTION-004',source:'notion',level:'mock API',title:'Invalid replacement token response rolls back the active connection',async run(){
  const source=createSources({transport:async(op,args)=>args.token==='valid'?{results:[],has_more:false}:{results:[],has_more:true,next_cursor:null}});
  await source.connectNotion('valid');await assert.rejects(source.connectNotion('bad-response'),/分页/);
  assert.deepEqual(await source.list('notion'),[]);
 }},
 {id:'MD-001',source:'markdown',level:'mock filesystem',title:'Preview rereads selected files without corrupting Unicode or code',async run(){
  let body='# first';const source=createSources({transport:async op=>op==='stat'?{size:100,mtimeMs:1}:body});
  const item=await source.importFile('markdown','C:/QA space/中文.MD');body='# 中文🙂\n\n```js\nconst x = "<&>";\n```';
  assert.equal((await source.load('markdown',item)).body,body);
 }},
 {id:'MD-002',source:'markdown',level:'mock filesystem',title:'Oversized input is rejected before reading content',async run(){
  const source=createSources({transport:async op=>{assert.equal(op,'stat');return {size:21*1024*1024};}});
  await assert.rejects(source.importFile('markdown','large.md'),/20 MB/);
 }},
];
