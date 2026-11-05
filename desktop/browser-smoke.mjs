// Exercises the real service and UI while the Electron runtime is unavailable.
import { chromium } from 'playwright';
import { DesktopService } from './service.mjs';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = resolve('.larkanything/browser-smoke');
const vault = join(root, 'vault'), codexHome = join(root, 'codex'), claudeHome = join(root, 'claude');
await mkdir(vault, { recursive: true }); await mkdir(join(codexHome, 'sessions'), { recursive: true }); await mkdir(join(claudeHome, 'projects'), { recursive: true });
await copyFile('examples/codex.jsonl', join(codexHome, 'sessions/sample.jsonl'));
await writeFile(join(vault, '灵感收集.md'), '# 灵感收集\n\n把值得留下的想法，整理到同一个地方。\n\n- 一段有价值的对话\n- 一篇正在完善的笔记\n\n```js\nconst idea = "Keep it simple";\n```');
await writeFile(join(root, 'desktop.json'), JSON.stringify({ vault, codexHome, claudeHome }));
await writeFile(join(root, 'config.json'), JSON.stringify({ version: 1, stateDir: 'state' }));
const service = new DesktopService({ root });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 760 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.exposeBinding('serviceCall', async (_source, method, args) => {
    assert.ok(['settings', 'saveSettings', 'list', 'preview'].includes(method));
    return service[method](...args);
  });
  await page.addInitScript(() => {
    window.larkAnything = Object.fromEntries(['settings', 'saveSettings', 'list', 'preview'].map(method => [method, (...args) => window.serviceCall(method, args)]));
  });
  await page.goto(pathToFileURL(resolve('desktop/dist/index.html')).href);
  await page.locator('.item').first().waitFor();
  await page.screenshot({ path: join(root, 'home.png') });
  await page.locator('.item').first().click(); await page.locator('iframe').waitFor();
  assert.match(await page.frameLocator('iframe').locator('body').innerText(), /用户|Codex/);
  await page.getByRole('button', { name: 'Obsidian', exact: true }).click();
  await page.getByRole('button').filter({ hasText: '灵感收集' }).click(); await page.locator('iframe').waitFor();
  assert.match(await page.frameLocator('iframe').locator('body').innerText(), /Keep it simple/);
  await page.screenshot({ path: join(root, 'preview.png') });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('飞书保存位置').fill('https://example.feishu.cn/drive/folder/demo123');
  await page.screenshot({ path: join(root, 'settings.png') });
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByRole('button').filter({ hasText: '灵感收集' }).click();
  await page.locator('footer strong').filter({ hasText: 'demo123' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Browser UI + real Core smoke passed. No Electron/native integration or remote writes tested.');
} finally { await browser.close(); }
