const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  getDocument: () => ipcRenderer.invoke('document:get'),
  update: content => ipcRenderer.invoke('document:update', content),
  action: name => ipcRenderer.invoke('document:action', name),
  openExternal: url => ipcRenderer.invoke('link:open', url),
  onDocument: callback => {
    const handler = (_, document) => callback(document);
    ipcRenderer.on('document:loaded', handler);
    return () => ipcRenderer.removeListener('document:loaded', handler);
  },
  onCommand: callback => {
    const handler = (_, name) => callback(name);
    ipcRenderer.on('command', handler);
    return () => ipcRenderer.removeListener('command', handler);
  },
});
