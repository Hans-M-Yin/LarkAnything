const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (name, ...args) => { const result = await ipcRenderer.invoke(name, ...args); if (!result.ok) throw new Error(result.error); return result.value; };
contextBridge.exposeInMainWorld('larkAnything', {
  settings: () => invoke('settings'), saveSettings: value => invoke('save-settings', value), list: channel => invoke('list', channel),
  preview: id => invoke('preview', id), publish: token => invoke('publish', token), chooseDirectory: () => invoke('choose-directory'),
  chooseExecutable: () => invoke('choose-executable'), openResult: url => invoke('open-result', url),
});
