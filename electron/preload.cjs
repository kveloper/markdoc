const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('markdoc', {
  initial: () => ipcRenderer.invoke('document:initial'),
  changed: text => ipcRenderer.send('document:changed', text),
  autosave: text => ipcRenderer.send('document:autosave', text),
  action: (name, payload) => ipcRenderer.invoke('document:action', name, payload),
  onDocument: callback => ipcRenderer.on('document:load', (_event, data) => callback(data)),
  onPreferences: callback => ipcRenderer.on('preferences:update', (_event, data) => callback(data)),
  onCommand: callback => ipcRenderer.on('editor:command', (_event, data) => callback(data)),
  onStatus: callback => ipcRenderer.on('status:update', (_event, data) => callback(data)),
});
