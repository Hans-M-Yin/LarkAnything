import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve('.larkanything/source-switcher-smoke');
await mkdir(root, { recursive: true });
await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SourceSwitcher} from './desktop/ui/SourceSwitcher';
import './desktop/ui/style.css';
const sources=Array.from({length:8},(_,i)=>({id:'source-'+i,label:'测试来源 '+(i+1),icon:'codex.svg'}));
function Fixture(){const [selected,setSelected]=useState('source-0');return <div className="app compact"><SourceSwitcher sources={sources} selected={selected} disabled={false} onSelect={setSelected}/><button id="outside">外部区域</button></div>}
createRoot(document.getElementById('root')).render(<Fixture/>);` }, bundle: true, outfile: join(root, 'test.js'), platform: 'browser' });
await writeFile(join(root, 'index.html'), `<html><head><base href="${pathToFileURL(resolve('desktop/tauri-dist')).href}/"><link rel="stylesheet" href="${pathToFileURL(join(root,'test.css')).href}"></head><body><div id="root"></div><script src="${pathToFileURL(join(root,'test.js')).href}"></script></body></html>`);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 380, height: 480 } });
  await page.goto(pathToFileURL(join(root, 'index.html')).href);
  assert.equal(await page.locator('.source:not([aria-hidden=true])').count(), 3);
  assert.equal(await page.locator('.source:not([aria-hidden=true]):not(.active) .source-label').first().evaluate(el => el.getBoundingClientRect().width), 0);
  const initialX=await page.getByRole('button',{name:'测试来源 2',exact:true}).evaluate(el=>el.getBoundingClientRect().x);
  await page.getByRole('button',{name:'测试来源 3',exact:true}).click();
  await page.waitForTimeout(160);
  const middleX=await page.getByRole('button',{name:'测试来源 2',exact:true}).evaluate(el=>el.getBoundingClientRect().x);
  assert.ok(middleX<initialX,'Existing buttons move left during the transition');
  await page.waitForTimeout(280);
  assert.deepEqual(await page.locator('.source:not([aria-hidden=true])').evaluateAll(ns=>ns.map(n=>n.getAttribute('aria-label'))),['测试来源 2','测试来源 3','测试来源 4']);
  const finalX=await page.getByRole('button',{name:'测试来源 2',exact:true}).evaluate(el=>el.getBoundingClientRect().x);
  assert.ok(finalX<middleX,'Movement is animated rather than replaced');
  await page.getByRole('button', { name: '更多来源' }).click();
  await page.locator('.source-picker').getByRole('button', { name: '测试来源 8' }).click();
  assert.equal(await page.locator('.source.active:not([aria-hidden=true])').getAttribute('aria-label'), '测试来源 8');
  assert.equal(await page.locator('.source-picker').count(), 0);
  await page.waitForTimeout(450);
  // Finish the animation before checking final geometry.
  await page.locator('.source.active:not([aria-hidden=true])').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  assert.ok(Math.abs((await page.locator('.source.active:not([aria-hidden=true])').boundingBox()).width - (await page.locator('.source:not([aria-hidden=true]):not(.active)').first().boundingBox()).width) < 1);
  assert.equal(Math.round((await page.locator('.sources').boundingBox()).width), 348);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: '更多来源' }).click();
  const box = await page.locator('.source-picker').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 380);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.source-picker').count(), 0);
  assert.equal(await page.getByRole('button', { name: '更多来源' }).evaluate(el => el === document.activeElement), true);
  await page.getByRole('button', { name: '更多来源' }).click();
  await page.mouse.click(12, 450);
  assert.equal(await page.locator('.source-picker').count(), 0);
  await page.getByRole('button',{name:'测试来源 1',exact:true}).click();
  await page.waitForTimeout(450);
  assert.deepEqual(await page.locator('.source:not([aria-hidden=true])').evaluateAll(ns=>ns.map(n=>n.getAttribute('aria-label'))),['测试来源 8','测试来源 1','测试来源 2']);
  await page.getByRole('button',{name:'测试来源 8',exact:true}).click();
  await page.waitForTimeout(450);
  assert.deepEqual(await page.locator('.source:not([aria-hidden=true])').evaluateAll(ns=>ns.map(n=>n.getAttribute('aria-label'))),['测试来源 7','测试来源 8','测试来源 1']);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.source.active:not([aria-hidden=true])').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  await page.screenshot({path:join(root,'carousel.png')});
  console.log('Source switcher passed: collapsed labels, selected expansion, eight-source overflow, selection promotion, narrow layout, dismissal and reduced motion.');
} finally { await browser.close(); }
