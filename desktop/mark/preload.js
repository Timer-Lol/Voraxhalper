const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('VoraxMark', { on: (cb) => ipcRenderer.on('mark', (e, m) => cb(m)) });
