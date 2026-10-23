// window.VoraxDesktop for the helper's analyzer page only (web/js/analyze.js is the other side).
const { contextBridge, ipcRenderer } = require('electron');

if (/\/analyze\.html$/.test(location.pathname)) {
  contextBridge.exposeInMainWorld('VoraxDesktop', {
    logSize: () => ipcRenderer.invoke('log:size'),
    readLog: (start, end) => ipcRenderer.invoke('log:read', start, end).then((u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)),
    onGame: (cb) => {
      ipcRenderer.on('game', (e, g) => cb({ running: !!g.running }));
      ipcRenderer.invoke('game:get').then((g) => g && cb({ running: !!g.running }));
    },
    onSnap: (cb) => ipcRenderer.on('snap', (e, kind) => cb(kind === 'after-click' ? kind : 'manual')),
    onWatchScreen: (cb) => ipcRenderer.on('watchScreen', (e, on) => cb(!!on)),
    onSpeed: (cb) => ipcRenderer.on('speed', (e, v) => cb(String(v))),
    logDetail: (on) => ipcRenderer.send('log:detail', !!on),
    onDebugFlag: (cb) => ipcRenderer.on('debugFlag', () => cb()),
    showAdvice: (card) => ipcRenderer.send('advice', card),
    gameWindow: () => ipcRenderer.invoke('game:window'),
    // (Vorax Helper) card names by Windows' own text reader: grey pixels in, text out (null: not available)
    ocrReady: () => ipcRenderer.invoke('ocr:ready'),
    ocr: (w, h, grey) => ipcRenderer.invoke('ocr:read', w, h, grey),
    // a PNG (as an ArrayBuffer), or raw BGRA pixels { raw, width, height, data } from PrintWindow
    probeWindow: () => ipcRenderer.invoke('capture:probe').then((u8) => (!u8 ? null : u8.raw ? u8 : u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength))),
    grabWindow: () => ipcRenderer.invoke('capture:grab').then((u8) => (!u8 ? null : u8.raw ? u8 : u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength))),
    printable: () => ipcRenderer.invoke('capture:printable'),
    plan: (p) => ipcRenderer.send('plan', p),
    settings: {
      get: () => ipcRenderer.invoke('settings:get'),
      set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
      do: (what) => ipcRenderer.invoke('settings:do', what),
      onOpen: (cb) => ipcRenderer.on('openSettings', (e, tab) => cb(typeof tab === 'string' ? tab : undefined)),
      sendReport: (said, agreed) => ipcRenderer.invoke('settings:sendReport', String(said || '').slice(0, 300), agreed === true),
    },
    record: (e) => ipcRenderer.send('debug:event', e),
    recordFrame: (name, bytes) => ipcRenderer.send('debug:frame', name, new Uint8Array(bytes)),
    appLog: () => ipcRenderer.invoke('debug:appLog'),
    useScreen: () => ipcRenderer.invoke('capture:useScreen'),
    useWindow: () => ipcRenderer.invoke('capture:useWindow'),
    gameOnScreen: () => ipcRenderer.invoke('game:onScreen'),
  });
}
