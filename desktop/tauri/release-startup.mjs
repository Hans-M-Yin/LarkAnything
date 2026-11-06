// Read-only startup check of the actual release binary with existing user settings.
// Does not select, publish, authorize, or save settings.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const root=resolve(`.larkanything/release-startup-${Date.now()}`);await mkdir(root,{recursive:true});
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const child=spawn(resolve('src-tauri/target/release/larkanything-desktop.exe'),[],{windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:join(root,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});
let browser;
try {
  for(let i=0;;i++){try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok)break;}catch{}if(i>200)throw new Error('Release WebView unavailable');await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page=browser.contexts()[0].pages()[0];
  await page.waitForFunction(()=>!!window.larkAnything,{},{timeout:30000});
  await page.locator('.animated-sources').waitFor();
  assert.ok(await page.locator('.source img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0)));
  assert.equal(await page.evaluate(()=>innerWidth),420);
  const result=await page.evaluate(async()=>{const settings=await window.larkAnything.settings();return {settingsLoaded:typeof settings.executable==='string',backendReady:typeof window.larkAnything.publish==='function'};});
  assert.deepEqual(result,{settingsLoaded:true,backendReady:true});
  console.log('Packaged release started; embedded UI/icons, native IPC and existing settings loaded. No publication or authorization requested.');
}finally{await browser?.close();child.kill();}
