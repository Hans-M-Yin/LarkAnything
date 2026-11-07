// Real Tauri + WebView2 + Rust I/O/process integration. All content/CLI are fixtures.
import {zipSync,strToU8} from 'fflate';
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { DesktopService } from '../service.mjs';
if(process.platform!=='win32') throw new Error('This native smoke runner targets Windows WebView2.');
const root=resolve(`.larkanything/tauri-smoke-${Date.now()}`), vault=join(root,'vault'),codexHome=join(root,'codex'),claudeHome=join(root,'claude');
await Promise.all([mkdir(vault,{recursive:true}),mkdir(join(codexHome,'sessions'),{recursive:true}),mkdir(join(claudeHome,'projects'),{recursive:true})]);
await copyFile('examples/codex.jsonl',join(codexHome,'sessions/sample.jsonl'));
await writeFile(join(vault,'灵感收集.md'),'# 灵感收集\n\n中文🙂 Keep it simple\n\n- 一段对话\n- 一篇笔记\n');
await writeFile(join(vault,'未确认.md'),'# 未确认\n\n仅用于本地错误回执测试。\n');
const executable=join(root,'fixture-cli.exe');
const compilation=spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo',`/out:${executable}`,'/reference:System.Web.Extensions.dll',resolve('desktop/tauri/fixture-cli.cs')],{encoding:'utf8',windowsHide:true});
assert.equal(compilation.status,0,compilation.stdout+compilation.stderr);
await writeFile(join(root,'desktop.json'),JSON.stringify({vault,codexHome,claudeHome,opencodeExecutable:executable}));
await writeFile(join(root,'config.json'),JSON.stringify({version:1,stateDir:'state',backends:{'lark-cli':{executable}}}));
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const child=spawn(resolve(process.env.CARGO_TARGET_DIR||'src-tauri/target','debug/larkanything-desktop.exe'),[],{windowsHide:true,env:{...process.env,LARKANYTHING_DESKTOP_HOME:root,WEBVIEW2_USER_DATA_FOLDER:join(root,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`},stdio:'pipe'});
let startup='';child.on('error',e=>startup+=' spawn:'+e.message);child.on('exit',(code,signal)=>startup+=' exit:'+code+' signal:'+signal);child.stderr.on('data',v=>startup+=v);child.stdout.on('data',v=>startup+=v);
let browser;
try {
  const deadline=Date.now()+60000;
  for(;;){try{const res=await fetch(`http://127.0.0.1:${port}/json/version`);if(res.ok)break;}catch{}if(child.exitCode!==null || Date.now()>deadline)throw new Error('WebView did not start: '+startup);await new Promise(r=>setTimeout(r,200));}
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context=browser.contexts()[0];let page;
  for(let i=0;i<100;i++){page=context.pages().find(p=>!p.url().startsWith('devtools:'));if(page)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(page,'Native WebView page');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>!!window.larkAnything,{},{timeout:60000});
  await page.evaluate(()=>{localStorage.setItem('la-setup-dismissed','1');localStorage.setItem('la-theme','light');});await page.reload();
  await page.locator('.item').first().waitFor({timeout:60000});
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.evaluate(()=>document.fonts.check('13px Inter') && document.fonts.check('13px \"Lark UI CJK\"')),true);
  assert.equal(await page.evaluate(()=>innerWidth),420);
  assert.ok(await page.locator('.source img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0)));
  const widths=await page.locator('.source').evaluateAll(items=>items.map(el=>el.getBoundingClientRect().width));
  assert.ok(Math.max(...widths)-Math.min(...widths)<1,'Source buttons remain evenly distributed');
  await page.screenshot({path:join(root,'home.png'),scale:'css',animations:'disabled'});
  await page.keyboard.press('Control+f');
  assert.equal(await page.getByRole('textbox',{name:'搜索内容'}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.type('temporary query');
  await page.keyboard.press('Control+2');
  await page.getByText('这里还没有内容',{exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'搜索内容'}).inputValue(),'');
  await mkdir(join(claudeHome,'projects','qa'),{recursive:true});
  await copyFile('examples/claude-code.jsonl',join(claudeHome,'projects','qa','sample.jsonl'));
  await page.keyboard.press('Control+r');await page.locator('.item').first().waitFor();
  await page.locator('.item').first().click();await page.getByRole('button',{name:'预览',exact:true}).click();
  await page.frameLocator('iframe').locator('article').waitFor({state:'visible'});
  assert.match(await page.frameLocator('iframe').locator('body').innerText(),/Claude|assistant/i);
  await page.getByRole('button',{name:'收起预览',exact:true}).first().click();await page.waitForFunction(()=>innerWidth===420);
  await page.keyboard.press('Control+1');await page.locator('.item').first().waitFor();
  await page.evaluate(()=>window.__shortcutReloadGuard=true);
  await page.keyboard.press('Control+r');await page.locator('.item').first().waitFor();
  assert.equal(await page.evaluate(()=>window.__shortcutReloadGuard),true,'Refresh must not reload the WebView');
  await page.keyboard.press('Control+p');assert.equal(await page.locator('iframe').count(),0,'No preview before selecting content');
  const service=new DesktopService({root});const oldItems=await service.list('codex');
  const nativeItems=await page.evaluate(()=>window.larkAnything.list('codex'));
  assert.deepEqual(nativeItems.map(v=>[v.id,v.title,v.count]),oldItems.map(v=>[v.id,v.title,v.count]));
  const oldPreview=await service.preview(oldItems[0].id);
  const nativePreview=await page.evaluate(id=>window.larkAnything.preview(id),oldItems[0].id);
  assert.equal(nativePreview.html,oldPreview.html,'Core renders byte-identical preview');
  await page.locator('.item').first().click();await page.getByRole('button',{name:'预览',exact:true}).click();
  await page.waitForFunction(()=>innerWidth===860);
  await page.frameLocator('iframe').locator('article').waitFor({state:'visible'});
  assert.match(await page.frameLocator('iframe').locator('body').innerText(),/用户|Codex/);
  await page.frameLocator('iframe').locator('body').click();
  await page.keyboard.press('Control+p');await page.waitForFunction(()=>innerWidth===420 && !document.querySelector('.app.expanded')); await page.locator('iframe').waitFor({state:'detached'});
  await page.keyboard.press('Control+p');await page.waitForFunction(()=>innerWidth===860);
  await page.frameLocator('iframe').locator('article').waitFor({state:'visible'});
  if(!await page.getByRole('button',{name:'Obsidian',exact:true}).count()) await page.getByRole('button',{name:'更多来源',exact:true}).click();
  await page.getByRole('button',{name:'Obsidian',exact:true}).click();
  await page.getByRole('button').filter({hasText:'灵感收集'}).click();
  await page.frameLocator('iframe').getByText('中文🙂 Keep it simple',{exact:false}).waitFor();
  assert.equal(await page.frameLocator('iframe').locator('header h1').count(),0,'Repeated preview title removed');
  await page.screenshot({path:join(root,'preview.png'),scale:'css',animations:'disabled'});
  await page.getByRole('button',{name:'切换深色模式',exact:true}).click();
  assert.equal(await page.frameLocator('iframe').locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(32, 32, 32)');
  await page.frameLocator('iframe').locator('body').evaluate(()=>document.fonts.ready);
  await page.screenshot({path:join(root,'dark.png'),scale:'css',animations:'disabled'});
  await page.getByRole('button',{name:'收起预览',exact:true}).first().click();await page.waitForFunction(()=>innerWidth===420);
  await page.keyboard.press('Control+,');await page.getByLabel('飞书保存位置').fill('discard-me');
  await page.keyboard.press('Control+1');
  assert.equal(await page.getByRole('button',{name:'Obsidian',exact:true}).getAttribute('aria-pressed'),'true','Modal blocks source shortcuts');
  await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'hidden'});
  await page.keyboard.press('Control+,');await page.locator('dialog[open]').waitFor({state:'visible'});assert.equal(await page.getByLabel('飞书保存位置').inputValue(),'');
  await page.getByLabel('飞书保存位置').fill('https://fixture.feishu.cn/drive/folder/demo123');
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await page.locator('dialog[open]').waitFor({state:'hidden'});
  assert.equal(JSON.parse(await readFile(join(root,'config.json'),'utf8')).defaults.target.parentToken,'demo123');
  // Publish using the App's worker/Rust subprocess path, to a local fake CLI only.
  const published=await page.evaluate(async()=>{const items=await window.larkAnything.list('obsidian');const item=items.find(v=>v.title==='灵感收集');const p=await window.larkAnything.preview(item.id);return window.larkAnything.publish(p.token);});
  assert.equal(published.remote.documentId,'fixture_doc');
  await writeFile(join(root,'uncertain'),'1');
  const uncertain=await page.evaluate(async()=>{const items=await window.larkAnything.list('obsidian');const p=await window.larkAnything.preview(items.find(v=>v.title==='未确认').id);const errors=[];for(let i=0;i<2;i++){try{await window.larkAnything.publish(p.token);}catch(e){errors.push(e.message);}}return errors;});
  assert.equal(uncertain.length,2);assert.ok(uncertain.every(e=>e.includes('WRITE_UNCERTAIN')));
  const calls=(await readFile(join(root,'calls.jsonl'),'utf8')).replace(/^\uFEFF/,'').trim().split('\n').map(v=>JSON.parse(v));
  assert.equal(calls.filter(v=>v.args.includes('+create')&&!v.args.includes('--dry-run')).length,2,'No automatic replay after uncertain exit');
  // Native capability denial and exclusive lock behavior, through actual IPC.
  const guards=await page.evaluate(async root=>{
    const invoke=window.__TAURI__.core.invoke;const call=(op,args)=>invoke('native',{op,args});const lock=root+'/state/native.lock';
    const handle=await call('lock_open',{path:lock});let duplicate=false,escape=false;
    try{await call('lock_open',{path:lock});}catch(e){duplicate=e.code==='EEXIST';}finally{await call('lock_close',{handle});await call('remove',{path:lock});}
    try{await call('write',{path:root+'/../outside.txt',data:'blocked'});}catch(e){escape=e.code==='EACCES';}
    return {duplicate,escape};
  },root);
  assert.deepEqual(guards,{duplicate:true,escape:true});
  const cancelled=await page.evaluate(async executable=>{
    const call=(op,args)=>window.__TAURI__.core.invoke('native',{op,args});
    const handle=await call('process_start',{executable,args:['config','init','--new'],input:'',timeout:30000});
    let stderr='',result;
    for(let i=0;i<100;i++){result=await call('process_poll',{handle});stderr+=result.stderr;if(stderr.includes('https://fixture.feishu.cn/setup'))break;await new Promise(r=>setTimeout(r,40));}
    await call('process_kill',{handle});
    for(let i=0;i<100;i++){result=await call('process_poll',{handle});if(result.done)break;await new Promise(r=>setTimeout(r,40));}
    return {streamed:stderr.includes('https://fixture.feishu.cn/setup'),done:result.done,killed:result.killed};
  },executable);
  assert.deepEqual(cancelled,{streamed:true,done:true,killed:true});
  await writeFile(join(root,'delay'),'1');
  const timeout=await page.evaluate(async executable=>{
    const call=(op,args)=>window.__TAURI__.core.invoke('native',{op,args});
    const handle=await call('process_start',{executable,args:['docs','+search'],input:'',timeout:1000});
    for(let i=0;i<100;i++){const r=await call('process_poll',{handle});if(r.done)return r.killed;await new Promise(r=>setTimeout(r,40));}return false;
  },executable);
  assert.equal(timeout,true);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.source-label').first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  await writeFile(join(vault,'sample.docx'),zipSync({'word/document.xml':strToU8('<w:document><w:body><w:p><w:r><w:t>Word 中文正文</w:t></w:r></w:p></w:body></w:document>')}));
  const imports=await page.evaluate(async vault=>{
    const a=window.larkAnything;
    const results=[];
    for(const [kind,path] of [['markdown',vault+'/灵感收集.md'],['docx',vault+'/sample.docx']]){
      await a.importFile(kind,path);const list=await a.list(kind);const p=await a.preview(list[0].id);results.push({kind,html:p.html});
    }
    return results;
  },vault);
  const oc=await page.evaluate(async()=>{const a=window.larkAnything;const rows=await a.list('opencode');return a.preview(rows[0].id);});
  assert.match(oc.html,/OpenCode public message/);
  assert.match(imports[0].html,/Keep it simple/);assert.match(imports[1].html,/Word 中文正文/);
  await page.getByRole('button',{name:'更多来源',exact:true}).click();
  await page.getByRole('button',{name:'Word',exact:true}).click();
  await page.getByRole('heading',{name:'Word 文档',exact:true}).waitFor();
  await page.getByRole('button',{name:'选择文件',exact:true}).waitFor();
  await page.locator('.item').first().click();
  await page.screenshot({path:join(root,'word-source.png'),scale:'css',animations:'disabled'});
  const rejected=await page.evaluate(async()=>{
    try{await window.__TAURI__.core.invoke('native',{op:'process_start',args:{executable:'opencode',args:['session','delete','ses_test']}});return false;}catch{return true;}
  });assert.equal(rejected,true);
  assert.deepEqual(errors,[]);
  await writeFile(join(root,'result.json'),JSON.stringify({ok:true,scope:'Real Tauri/WebView2, synthetic source data and fake publish CLI; no live account acceptance or OS file-picker automation.',checks:['real-tauri-webview2','worker-core-parity','claude-fixture-discovery-preview','source-icons-layout','unicode-preview','theme','settings','native-cli-local-publish-readback','uncertain-no-replay','exclusive-lock','path-scope','keyboard-shortcuts','preview-keyboard-focus','modal-keyboard-guards','streaming-cancel','timeout','reduced-motion','markdown-import-preview','docx-import-preview','opencode-fake-cli-preview'],screenshots:['home.png','preview.png','dark.png','word-source.png']},null,2));
  console.log(`Tauri native smoke passed. Local fake CLI only. Results: ${root}`);
} finally {await browser?.close();child.kill();}
