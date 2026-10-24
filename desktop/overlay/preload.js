// window.VoraxCard for the overlay card: text in, button presses out.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('VoraxCard', {
  on: (channel, cb) => ['card', 'folded', 'status', 'clicker', 'reportAsk'].includes(channel) && ipcRenderer.on(channel, (e, data) => cb(data)),
  height: (h) => ipcRenderer.send('overlay:height', h),
  fold: (folded) => ipcRenderer.send('overlay:fold', folded),
  openHelper: () => ipcRenderer.send('overlay:helper'),
  snap: () => ipcRenderer.send('overlay:snap'),
  report: (send) => ipcRenderer.send('overlay:report', send === 'look' ? 'look' : !!send),
  dragStart: () => ipcRenderer.send('overlay:dragStart'),
  dragEnd: () => ipcRenderer.send('overlay:dragEnd'),
});
