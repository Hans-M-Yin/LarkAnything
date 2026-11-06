// Renderer state-machine test: fake Feishu setup; no network or real credentials.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const output = resolve('.larkanything/onboarding-smoke');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 560 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    let stage = 'app', phase = 'idle';
    const config = { parentToken: '', includeTools: false, executable: 'lark-cli' };
    window.larkAnything = {
      settings: async () => config, list: async () => [], setExpanded: async () => {},
      setupStatus: async () => ({ stage, appId: stage === 'app' ? '' : 'cli_fixture', brand: 'feishu', bundled: true, message: '先创建或连接一个飞书应用，再授权你的账号。' }),
      appSetupProgress: async () => ({ phase, canOpen: phase === 'browser', message: phase === 'browser' ? '在浏览器完成飞书应用创建。' : '' }),
      startAppSetup: async value => {
        window.fixtureLastSetup = value; phase = 'browser';
        return { phase, canOpen: true, message: '请打开配置页面。' };
      },
      openAppSetup: async () => { phase = 'complete'; stage = 'login'; },
      cancelAppSetup: async () => { phase = 'cancelled'; return { phase, message: '已停止等待', canOpen: false }; },
      beginConnection: async () => stage === 'ready' ? { connected: true, message: '账号读取和创建预检通过。' } : { url: 'https://accounts.feishu.cn/fixture' },
      openAuthorization: async () => { window.fixtureOpened = true; },
      finishConnection: async () => { stage = 'ready'; return { ok: true, message: '账号读取和创建预检通过。' }; },
      checkConnection: async () => ({ ok: stage === 'ready', message: '账号读取和创建预检通过。' }),
    };
  });
  await page.goto(pathToFileURL(resolve('desktop/dist/index.html')).href);
  await page.getByRole('heading', { name: '连接飞书', exact: true }).waitFor();
  await page.getByRole('button', { name: '开始创建应用', exact: true }).waitFor();
  await page.screenshot({ animations: 'disabled', path: join(output, 'first-run.png') });
  await page.getByRole('button', { name: '开始创建应用', exact: true }).click();
  await page.getByRole('button', { name: '打开配置页面', exact: true }).click();
  await page.getByRole('button', { name: '授权飞书账号', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixtureOpened), true);
  await page.getByRole('button', { name: '我已完成授权', exact: true }).click();
  await page.getByRole('button', { name: '开始使用', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '配置飞书连接', exact: true }).click();
  await page.getByRole('button', { name: '验证连接', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '开始创建应用', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('First-run UI passed: create, browser handoff, login, verification and healthy-account reuse. Mocked CLI; no network or account creation.');
} finally { await browser.close(); }
