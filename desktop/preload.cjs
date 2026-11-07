const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (name, ...args) => { const result = await ipcRenderer.invoke(name, ...args); if (!result.ok) throw new Error(result.error); return result.value; };
contextBridge.exposeInMainWorld('larkAnything', {
  setupStatus: () => invoke('setup-status'), useBundledCli: () => invoke('use-bundled-cli'), startAppSetup: value => invoke('start-app-setup', value),
  appSetupProgress: () => invoke('app-setup-progress'), cancelAppSetup: () => invoke('cancel-app-setup'), openAppSetup: () => invoke('open-app-setup'),
  setExpanded: value => invoke('set-expanded', value),
  settings: () => invoke('settings'), saveSettings: value => invoke('save-settings', value), list: channel => invoke('list', channel),
  checkConnection: () => invoke('check-connection'),
  beginConnection: () => invoke('begin-connection'), finishConnection: () => invoke('finish-connection'), openAuthorization: () => invoke('open-authorization'),
  preview: id => invoke('preview', id), publish: token => invoke('publish', token), chooseDirectory: () => invoke('choose-directory'),
  chooseExecutable: () => invoke('choose-executable'), openResult: url => invoke('open-result', url),
});
