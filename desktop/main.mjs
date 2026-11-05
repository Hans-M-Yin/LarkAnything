import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { DesktopService } from './service.mjs';
const here = dirname(fileURLToPath(import.meta.url));
let window;
const service = new DesktopService(!app.isPackaged && process.env.LARKANYTHING_DESKTOP_HOME ? { root: process.env.LARKANYTHING_DESKTOP_HOME } : {});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  await app.whenReady();
  app.setName('LarkAnything');
  const create = () => {
    window = new BrowserWindow({ width: 1080, height: 760, minWidth: 700, minHeight: 560, backgroundColor: '#f6f7f4', title: 'LarkAnything',
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
  handle('save-settings', value => service.saveSettings(value));
  handle('list', channel => service.list(channel));
  handle('preview', id => service.preview(id));
  handle('publish', token => service.publish(token));
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
}
