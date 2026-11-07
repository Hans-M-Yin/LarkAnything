// Renderer-only platform regression; native traffic lights are never simulated.
import './build-test-ui.mjs';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const output=resolve('.larkanything/window-chrome-smoke');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true});
try {
  for(const platform of ['darwin','win32']) {
    const page=await browser.newPage({viewport:{width:420,height:560}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(platform=>{
      window.captionCalls=[];window.themeCalls=[];
      const config={parentToken:'',includeTools:false,executable:'lark-cli'};
      window.larkAnything={platform,settings:async()=>config,list:async()=>[],
        setupStatus:async()=>({stage:'ready'}),notionConnection:async()=>({saved:false}),
        setTheme:async theme=>{window.themeCalls.push(theme);},
        windowAction:async action=>{window.captionCalls.push(action);},setExpanded:async()=>{}};
    },platform);
    await page.goto(pathToFileURL(resolve('.larkanything/test-ui/index.html')).href);
    await page.getByRole('button',{name:'设置',exact:true}).waitFor();
    await page.waitForFunction(()=>window.themeCalls.length>0);
    assert.equal(await page.locator('.titlebar').count(),platform==='darwin'?0:1);
    assert.equal(await page.locator('.window-controls button').count(),platform==='darwin'?0:3);
    const initial=await page.evaluate(()=>window.themeCalls.at(-1));
    await page.getByRole('button',{name:initial==='light'?'切换深色模式':'切换浅色模式',exact:true}).click();
    await page.waitForFunction(initial=>window.themeCalls.at(-1)!==initial,initial);
    await page.keyboard.press(platform==='darwin'?'Meta+f':'Control+f');
    assert.equal(await page.getByRole('textbox',{name:'搜索内容'}).evaluate(el=>el===document.activeElement),true);
    if(platform==='win32') {
      for(const name of ['最小化窗口','最大化或还原窗口','关闭窗口']) await page.getByRole('button',{name,exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>window.captionCalls),['minimize','maximize','close']);
    } else assert.deepEqual(await page.evaluate(()=>window.captionCalls),[]);
    await page.screenshot({path:join(output,`${platform}-content.png`),animations:'disabled'});
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Platform content regression passed: macOS has no web caption buttons; Windows actions, native theme calls and Cmd/Ctrl shortcuts work. Native AppKit controls require Mac testing.');
} finally {await browser.close();}
