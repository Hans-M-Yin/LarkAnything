import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {docxSource,openCodeSource,markdownSource} from '../src/adapters/desktop-sources.mjs';
import {createSources} from '../desktop/tauri/sources.mjs';
const doc=body=>zipSync({'word/document.xml':strToU8('<w:document><w:body>'+body+'</w:body></w:document>')});
test('DOCX headings, Unicode, tables and invalid archives',()=>{
 const model=docxSource(doc('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>中文 &amp; test</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'),'test.docx');
 assert.match(model.body,/# 中文 & test/);assert.match(model.body,/\| Cell \|/);assert.equal(model.source.completeness,'partial');
 assert.throws(()=>docxSource(zipSync({'no.xml':strToU8('x')}),'test.docx'),/有效/);
 assert.throws(()=>docxSource(doc('<!DOCTYPE x><w:p/>'),'test.docx'),/实体/);
 assert.equal(docxSource(doc('<w:p><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:t>001</w:t></w:r></w:p>'),'test.docx').body,'Hello 001');
});
const exported={info:{id:'ses_test',title:'Test'},messages:[{info:{id:'m1',role:'user'},parts:[{type:'text',text:'Hello'}]},{info:{id:'m2',role:'assistant'},parts:[{type:'reasoning',text:'private'},{type:'text',text:'Answer'},{type:'tool',tool:'read',state:{output:'log'}}]}]};
test('OpenCode keeps public messages and tools without reasoning',()=>{
 const value=openCodeSource(exported);assert.equal(value.messages.length,2);assert.equal(value.messages[1].content.length,2);assert.ok(!JSON.stringify(value).includes('private'));
 assert.throws(()=>openCodeSource({}),/格式/);
});
test('file import validates extension and rereads selected file',async()=>{
 let body='# First';const source=createSources({transport:async op=>op==='stat'?{size:10,mtimeMs:1}:body});
 await assert.rejects(source.importFile('markdown','x.docx'),/类型/);
 const item=await source.importFile('markdown','x.md');body='# Changed';
 assert.equal((await source.load('markdown',item)).body,body);
 assert.equal((await source.list('markdown')).length,1);
});
test('Notion pagination, title, incomplete content and token rollback',async()=>{
 let pages=0;let truncated=false;
 const source=createSources({transport:async(op,args)=>{
  if(args.token==='bad')throw new Error('unauthorized');
  if(args.action==='read')return {markdown:'# page',truncated};
  pages++;return args.cursor?{results:[{object:'page',id:'b',properties:{},last_edited_time:'2026-01-01'}],has_more:false}:{results:[{object:'page',id:'a',properties:{Name:{type:'title',title:[{plain_text:'Title'}]}}}],has_more:true,next_cursor:'next'};
 }});
 await assert.rejects(source.list('notion'),/连接/);await source.connectNotion('good');
 await assert.rejects(source.connectNotion('bad'),/unauthorized/);
 const list=await source.list('notion');assert.equal(list.length,2);assert.equal(list[0].title,'Title');
 assert.equal((await source.load('notion',list[0])).body,'# page');
 truncated=true;await assert.rejects(source.load('notion',list[0]),/完整/);
});
test('OpenCode versions select read-only export commands',async()=>{
 for(const version of ['1.9.0','2.1.0']){
  const calls=[];const source=createSources({command:async args=>{calls.push(args);return args[0]==='--version'?version:JSON.stringify(exported);}});
  await source.load('opencode',{id:'opencode:ses_test'});
  assert.deepEqual(calls[1],version[0]==='2'?['session','export','ses_test']:['export','ses_test']);
 }
 assert.throws(()=>markdownSource('markdown','x','X','  '),/正文/);
});
