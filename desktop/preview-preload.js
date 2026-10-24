// window.VoraxPreview for the "what the report holds" window only (main.js previewReport).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('VoraxPreview', {
  send: () => ipcRenderer.invoke('preview:send'),
  close: () => ipcRenderer.send('preview:close'),
});
