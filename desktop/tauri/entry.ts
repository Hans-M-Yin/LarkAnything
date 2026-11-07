const invoke = (window as any).__TAURI__.core.invoke;
const worker = new Worker('./worker.js', { type: 'module' });
let sequence = 0;
const requests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const request = (method: string, ...args: any[]) => new Promise((resolve, reject) => {
  const id = ++sequence; requests.set(id, { resolve, reject }); worker.postMessage({ id, method, args });
});
worker.onmessage = async ({ data }) => {
  if (data.native) {
    try { worker.postMessage({ nativeReply: true, id: data.id, value: await invoke('native', { op: data.op, args: data.args }) }); }
    catch (error) { worker.postMessage({ nativeReply: true, id: data.id, error: typeof error === 'object' ? error : { message: String(error) } }); }
    return;
  }
  const pending = requests.get(data.id); if (!pending) return; requests.delete(data.id);
  if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.value);
};
worker.onerror = () => { for (const task of requests.values()) task.reject(new Error('后台处理失败，请重新打开 App。')); requests.clear(); };
async function start() {
  await request('initialize', await invoke('bootstrap'));
  const methods = ['settings','saveSettings','list','preview','publish','checkConnection','beginConnection','finishConnection','setupStatus','useBundledCli','startAppSetup','appSetupProgress','cancelAppSetup','openAppSetup','openAuthorization'];
  (window as any).larkAnything = Object.fromEntries(methods.map(method => [method, (...args: any[]) => request(method, ...args)]));
  Object.assign((window as any).larkAnything, {
    windowAction: (action: string) => invoke('window_action', { action }),
    setExpanded: (expanded: boolean) => invoke('window_mode', { expanded }),
    chooseDirectory: () => invoke('choose', { directory: true }),
    chooseExecutable: () => invoke('choose', { directory: false }),
    chooseDocument: (kind: string) => invoke('choose', { directory: false, kind }),
    importFile: (kind: string, path: string) => request('importFile', kind, path),
    connectNotion: (token: string) => request('connectNotion', token),
    notionConnection: () => request('notionConnection'),
    disconnectNotion: () => request('disconnectNotion'),
    openResult: (url: string) => invoke('native', { op: 'open_url', args: { url } }),
  });
  await import('../ui/app');
}
start().catch(error => { document.getElementById('root')!.textContent = `无法启动 LarkAnything：${error.message || error}`; });
