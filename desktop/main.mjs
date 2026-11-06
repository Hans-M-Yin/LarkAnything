import { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { DesktopService } from './service.mjs';
const here = dirname(fileURLToPath(import.meta.url));
let window;
const service = new DesktopService({
  ...(!app.isPackaged && process.env.LARKANYTHING_DESKTOP_HOME ? { root: process.env.LARKANYTHING_DESKTOP_HOME } : {}),
  ...(app.isPackaged ? { bundledExecutable: join(process.resourcesPath, 'lark-cli', process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli') } : {}),
});
app.on('before-quit', () => { if (service.setupProcess.child) service.setupProcess.child.kill(); });
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  // Do not await readiness at the ESM entry point: Electron waits for entry
  // evaluation to finish before it can emit ready.
  app.whenReady().then(() => {
  app.setName('LarkAnything');
  const create = () => {
    window = new BrowserWindow({ width: 420, height: 560, minWidth: 380, minHeight: 480, backgroundColor: '#202020', title: 'LarkAnything',
      titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#888888', height: 36 }, autoHideMenuBar: true,
      webPreferences: { preload: join(here, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', e => e.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_w, _p, cb) => cb(false));
    window.loadFile(join(here, 'dist/index.html'));
  };
  const handle = (name, fn) => ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid sender');
    try { return { ok: true, value: await fn(...args) }; } catch (e) { return { ok: false, error: `${e.code ? e.code + ': ' : ''}${e.message}`, details: e.details }; }
  });
  handle('settings', () => service.settings());
  handle('setup-status', () => service.setupStatus());
  handle('use-bundled-cli', () => service.useBundledCli());
  handle('start-app-setup', value => service.startAppSetup(value));
  handle('app-setup-progress', () => service.setupProcess.snapshot());
  handle('cancel-app-setup', () => service.setupProcess.cancel());
  handle('open-app-setup', async () => {
    if (service.setupProcess.phase !== 'browser' || !service.setupProcess.url) throw new Error('配置链接不可用，请重新检测。');
    await shell.openExternal(service.setupProcess.url);
  });
  let compactBounds;
  handle('set-expanded', expanded => {
    if (typeof expanded !== 'boolean') throw new Error('Invalid window mode');
    if (expanded && !compactBounds) {
      compactBounds = window.getBounds();
      const area = screen.getDisplayMatching(compactBounds).workArea;
      const width = Math.min(860, area.width);
      window.setBounds({ ...compactBounds, width, x: Math.max(area.x, Math.min(compactBounds.x, area.x + area.width - width)) });
    } else if (!expanded && compactBounds) {
      window.setBounds(compactBounds); compactBounds = undefined;
    }
  });
  handle('save-settings', value => service.saveSettings(value));
  handle('list', channel => service.list(channel));
  handle('preview', id => service.preview(id));
  handle('publish', token => service.publish(token));
  handle('check-connection', () => service.checkConnection());
  handle('begin-connection', () => service.beginConnection());
  handle('finish-connection', () => service.finishConnection());
  handle('open-authorization', async () => {
    const pending = service.pendingAuth;
    if (!pending || pending.expiresAt <= Date.now()) throw new Error('授权链接已过期，请重新连接。');
    await shell.openExternal(pending.url);
  });
  handle('choose-directory', async () => (await dialog.showOpenDialog(window, { properties: ['openDirectory'] })).filePaths[0] || null);
  handle('choose-executable', async () => (await dialog.showOpenDialog(window, { properties: ['openFile'] })).filePaths[0] || null);
  handle('open-result', async url => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !/(^|\.)(feishu\.cn|larksuite\.com)$/.test(parsed.hostname)) throw new Error('仅支持飞书 / Lark 文档链接。');
    await shell.openExternal(parsed.href);
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'LarkAnything', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ]));
  create();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) create(); else window.show(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  }).catch(error => { console.error(error); app.quit(); });
}
