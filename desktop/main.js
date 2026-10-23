// Vorax Helper as a Windows app, with its advice in a small card over the game.
//
// It runs the helper's own pages from disk (web/, copied from ../web) and adds what a browser can't do:
//   - find the game's UE_game.log and read it for the page (no file to drag in),
//   - find the game window and answer the page's window share with it (no picker), and measure the window
//     so the reader can cut away its title bar and borders exactly,
//   - show the advice in an always-on-top card over the game.
// Nothing here
// touches the game: no clicks, no keys. Pictures and the log never leave the PC.

const { app, BrowserWindow, Menu, Tray, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, net, screen, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile, spawn } = require('child_process');
const os = require('os');
const { cleanCard } = require('./card');
const { createHighlighter } = require('./highlight');

if (!app.requestSingleInstanceLock()) app.quit();

const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const GAME_TITLE = new RegExp(arg('game-title') || '^Torchlight: Infinite\\s*$');
const LOG_OVERRIDE = arg('log');
const STEAM_APP = '1974050'; // Torchlight: Infinite on Steam
const HOTKEYS = { overlay: 'Control+Alt+V', helper: 'Control+Alt+H', snap: 'Control+Alt+X', report: 'Control+Alt+J' };
const ICON = path.join(__dirname, 'build', process.platform === 'win32' && fs.existsSync(path.join(__dirname, 'build', 'icon.ico')) ? 'icon.ico' : 'icon.png');
const PAGE = path.join(__dirname, 'web', 'analyze.html');
const PAGE_URL = pathToFileURL(PAGE).href;
const CARD_WIDTH = 340;

// ---------- Settings and a small debug log ----------

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const settings = Object.assign({ overlayOn: true, hideBehind: false, folded: false, logPath: null, overlay: null, helper: null,
  highlight: true, adviceSource: 'ahead', showInCaptures: true, hideFromRound: 11, watchScreen: true, speed: 'thorough' }, (() => { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) { return {}; } })());
// (Vorax Helper) the hand-over used to default to round 10, the last potion pick: it is round 11, where the protocols
// start. A saved 10 from before is moved on once; a player who picks 10 afterwards keeps it.
if (settings.hideFromRoundV !== 2) { if (settings.hideFromRound === 10) settings.hideFromRound = 11; settings.hideFromRoundV = 2; }
const saveSettings = () => { try { fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { /* not kept */ } };
const LOG_FILE = path.join(app.getPath('userData'), 'logs', 'helper.log');
function note(...parts) {
  try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${parts.join(' ')}\n`); } catch (e) { /* no debug log */ }
}
const statOf = (p) => { try { return fs.statSync(p); } catch (e) { return null; } };

// ---------- Finding the game's log ----------

function regQuery(key, value) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, out) => {
      const m = !err && new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`).exec(out);
      resolve(m ? m[1].trim() : null);
    });
  });
}
// a game under Program Files that can't write there has its log in Windows' VirtualStore copy
const virtualStore = (p) => (/^[a-z]:\\program files/i.test(p) && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'VirtualStore', p.slice(3)) : null);
const LOG_IN_GAME = ['UE_game', 'TorchLight', 'Saved', 'Logs', 'UE_game.log'];

/** The player's choice; beside the running game; each Steam library with the game; the launcher's folders. Newest wins. */
async function findLog() {
  if (LOG_OVERRIDE) return { file: path.resolve(LOG_OVERRIDE), by: 'given' };
  if (settings.logPath && statOf(path.dirname(settings.logPath))) return { file: settings.logPath, by: 'chosen' };
  const candidates = [];
  const program = game.running && win32 ? win32.programOf(game.hwnd) : null;
  if (program && /torchlight/i.test(program)) candidates.push(path.resolve(path.dirname(program), '..', '..', 'TorchLight', 'Saved', 'Logs', 'UE_game.log'));
  const roots = new Map();
  const addRoot = (p) => p && roots.set(path.resolve(p).toLowerCase(), path.resolve(p));
  for (const [key, value] of [['HKCU\\Software\\Valve\\Steam', 'SteamPath'], ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'], ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath']]) addRoot(await regQuery(key, value));
  addRoot('C:\\Program Files (x86)\\Steam');
  const libraries = new Map(roots);
  for (const root of roots.values()) {
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) { const lib = path.resolve(m[1].replace(/\\\\/g, '\\')); libraries.set(lib.toLowerCase(), lib); }
    } catch (e) { /* not a Steam folder */ }
  }
  for (const lib of libraries.values()) {
    try {
      const acf = fs.readFileSync(path.join(lib, 'steamapps', `appmanifest_${STEAM_APP}.acf`), 'utf8');
      const m = /"installdir"\s+"([^"]+)"/.exec(acf);
      if (m) candidates.push(path.join(lib, 'steamapps', 'common', m[1], ...LOG_IN_GAME));
    } catch (e) { /* not in this library */ }
  }
  for (const base of ['C:\\Program Files (x86)\\Torchlight Infinite', 'C:\\Program Files\\Torchlight Infinite']) candidates.push(path.join(base, 'Game', ...LOG_IN_GAME));
  for (const p of [...candidates]) if (virtualStore(p)) candidates.push(virtualStore(p));
  const there = candidates.map((p) => ({ p, st: statOf(p) })).filter((x) => x.st && x.st.isFile()).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  if (there.length) return { file: there[0].p, by: 'found' };
  const installed = candidates.find((p) => statOf(path.resolve(p, '..', '..', '..')));
  return { file: installed || null, by: installed ? 'where the game will write it' : 'not found' };
}
let logPath = null;
async function refreshLog() {
  const found = await findLog();
  if (found.file !== logPath) { logPath = found.file; note(`log (${found.by}):`, logPath || 'none'); rebuildMenu(); }
}
async function pickLog() {
  const res = await dialog.showOpenDialog({ title: 'Choose UE_game.log', defaultPath: logPath || undefined, properties: ['openFile'], filters: [{ name: 'Torchlight: Infinite log', extensions: ['log'] }] });
  if (res.canceled || !res.filePaths[0]) return;
  settings.logPath = res.filePaths[0]; saveSettings(); await refreshLog();
}

// ---------- The game window (from Windows itself through koffi when available) ----------

const win32 = (() => {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    const foreground = user32.func('__stdcall', 'GetForegroundWindow', 'intptr', []);
    const getRect = user32.func('__stdcall', 'GetWindowRect', 'bool', ['intptr', koffi.out(koffi.pointer(RECT))]);
    const getClientRect = user32.func('__stdcall', 'GetClientRect', 'bool', ['intptr', koffi.out(koffi.pointer(RECT))]);
    const iconic = user32.func('__stdcall', 'IsIconic', 'bool', ['intptr']);
    const visible = user32.func('__stdcall', 'IsWindowVisible', 'bool', ['intptr']);
    const nextWindow = user32.func('__stdcall', 'FindWindowExW', 'intptr', ['intptr', 'intptr', 'void *', 'void *']);
    const windowText = user32.func('__stdcall', 'GetWindowTextW', 'int', ['intptr', 'void *', 'int']);
    const windowPid = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['intptr', koffi.out(koffi.pointer('uint32'))]);
    const openProcess = kernel32.func('__stdcall', 'OpenProcess', 'intptr', ['uint32', 'bool', 'uint32']);
    const imageName = kernel32.func('__stdcall', 'QueryFullProcessImageNameW', 'bool', ['intptr', 'uint32', 'void *', koffi.inout(koffi.pointer('uint32'))]);
    const closeHandle = kernel32.func('__stdcall', 'CloseHandle', 'bool', ['intptr']);
    const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });
    const getCursor = user32.func('__stdcall', 'GetCursorPos', 'bool', [koffi.out(koffi.pointer(POINT))]);
    const keyState = user32.func('__stdcall', 'GetAsyncKeyState', 'int16', ['int']);
    const clientToScreen = user32.func('__stdcall', 'ClientToScreen', 'bool', ['intptr', koffi.inout(koffi.pointer(POINT))]);
    // whether a process runs as administrator (Tartarus Overlay's check): Windows cuts off the
    // window capture from a program that isn't one to a window of one that is
    let elevated = () => null, processes = () => new Map();
    try {
      const advapi32 = koffi.load('advapi32.dll');
      const openToken = advapi32.func('__stdcall', 'OpenProcessToken', 'bool', ['intptr', 'uint32', koffi.out(koffi.pointer('intptr'))]);
      const tokenInfo = advapi32.func('__stdcall', 'GetTokenInformation', 'bool', ['intptr', 'int', 'void *', 'uint32', koffi.out(koffi.pointer('uint32'))]);
      elevated = (h) => {
        const token = [0];
        if (!openToken(h, 0x0008, token) || !Number(token[0])) return null; // TOKEN_QUERY
        try { const flag = Buffer.alloc(4); return tokenInfo(token[0], 20, flag, 4, [0]) ? flag.readUInt32LE(0) !== 0 : null; } finally { closeHandle(token[0]); }
      };
      const ENTRY = koffi.struct('PROCESSENTRY32W', { dwSize: 'uint32', cntUsage: 'uint32', th32ProcessID: 'uint32', th32DefaultHeapID: 'uintptr_t', th32ModuleID: 'uint32', cntThreads: 'uint32', th32ParentProcessID: 'uint32', pcPriClassBase: 'int32', dwFlags: 'uint32', szExeFile: koffi.array('char16', 260, 'String') });
      const snapshot = kernel32.func('__stdcall', 'CreateToolhelp32Snapshot', 'intptr', ['uint32', 'uint32']);
      const firstProcess = kernel32.func('__stdcall', 'Process32FirstW', 'bool', ['intptr', koffi.inout(koffi.pointer(ENTRY))]);
      const nextProcess = kernel32.func('__stdcall', 'Process32NextW', 'bool', ['intptr', koffi.inout(koffi.pointer(ENTRY))]);
      processes = () => {
        const list = new Map();
        const snap = snapshot(2, 0);
        if (Number(snap) === -1 || !Number(snap)) return list;
        try { const e = { dwSize: koffi.sizeof(ENTRY) }; for (let ok = firstProcess(snap, e); ok; e.dwSize = koffi.sizeof(ENTRY), ok = nextProcess(snap, e)) list.set(e.th32ProcessID, { parent: e.th32ParentProcessID, name: e.szExeFile }); } finally { closeHandle(snap); }
        return list;
      };
    } catch (e) { /* no elevation check */ }
    // (Vorax Helper) the game window's own picture through Windows' PrintWindow (the window's content as DWM has it,
    // never what's drawn over it): when Windows refuses the page's window capture, the overlay card and the highlight
    // then needn't be hidden from captures (OBS records them), as they must be with the screen fallback
    let printClient = null;
    try {
      const gdi32 = koffi.load('gdi32.dll');
      const getDC = user32.func('__stdcall', 'GetDC', 'intptr', ['intptr']);
      const releaseDC = user32.func('__stdcall', 'ReleaseDC', 'int', ['intptr', 'intptr']);
      const printWindow = user32.func('__stdcall', 'PrintWindow', 'bool', ['intptr', 'intptr', 'uint32']);
      const createDC = gdi32.func('__stdcall', 'CreateCompatibleDC', 'intptr', ['intptr']);
      const createBitmap = gdi32.func('__stdcall', 'CreateCompatibleBitmap', 'intptr', ['intptr', 'int', 'int']);
      const select = gdi32.func('__stdcall', 'SelectObject', 'intptr', ['intptr', 'intptr']);
      const deleteObject = gdi32.func('__stdcall', 'DeleteObject', 'bool', ['intptr']);
      const deleteDC = gdi32.func('__stdcall', 'DeleteDC', 'bool', ['intptr']);
      const stretchMode = gdi32.func('__stdcall', 'SetStretchBltMode', 'int', ['intptr', 'int']);
      const stretch = gdi32.func('__stdcall', 'StretchBlt', 'bool', ['intptr', 'int', 'int', 'int', 'int', 'intptr', 'int', 'int', 'int', 'int', 'uint32']);
      const dibits = gdi32.func('__stdcall', 'GetDIBits', 'int', ['intptr', 'intptr', 'uint32', 'uint32', 'void *', 'void *', 'uint32']);
      /** BGRA rows, top first, of a bitmap (not selected into any DC) */
      const pixels = (dc, bmp, w, h) => {
        const info = Buffer.alloc(44); info.writeUInt32LE(40, 0); info.writeInt32LE(w, 4); info.writeInt32LE(-h, 8); info.writeUInt16LE(1, 12); info.writeUInt16LE(32, 14);
        const out = Buffer.alloc(w * h * 4);
        return dibits(dc, bmp, 0, h, out, info, 0) === h ? out : null;
      };
      /** The client area's picture, at its size or shrunk to `width` (a probe); null when Windows gives none (or only black). */
      printClient = (hwnd, width) => {
        const r = {}; if (!getClientRect(hwnd, r)) return null;
        const w = r.right - r.left, h = r.bottom - r.top;
        if (w < 100 || h < 100) return null;
        const tw = width ? Math.min(w, width) : w, th = width ? Math.max(1, Math.round((h * tw) / w)) : h;
        const wdc = getDC(hwnd); if (!wdc) return null;
        const mem = createDC(wdc), bmp = createBitmap(wdc, w, h);
        let small = 0, smallDC = 0;
        try {
          const old = select(mem, bmp);
          const ok = printWindow(hwnd, mem, 3); // PW_CLIENTONLY | PW_RENDERFULLCONTENT
          let data = null;
          if (ok && (tw !== w || th !== h)) {
            smallDC = createDC(wdc); small = createBitmap(wdc, tw, th);
            const old2 = select(smallDC, small);
            stretchMode(smallDC, 4); // HALFTONE: each pixel the mean of the ones it covers
            stretch(smallDC, 0, 0, tw, th, mem, 0, 0, w, h, 0x00cc0020); // SRCCOPY
            select(smallDC, old2);
            select(mem, old);
            data = pixels(wdc, small, tw, th);
          } else {
            select(mem, old);
            if (ok) data = pixels(wdc, bmp, w, h);
          }
          if (!data) return null;
          // a window Windows can't print comes back black: not a picture
          let lit = 0; for (let i = 0; i < data.length; i += 4 * 97) if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) lit++;
          return lit > 20 ? { width: tw, height: th, data } : null;
        } finally {
          if (small) deleteObject(small); if (smallDC) deleteDC(smallDC);
          deleteObject(bmp); deleteDC(mem); releaseDC(hwnd, wdc);
        }
      };
    } catch (e) { note('PrintWindow unavailable:', String(e)); }
    const elevatedPid = (pid) => { const h = pid ? openProcess(0x1000, false, pid) : 0; if (!h) return null; try { return elevated(h); } finally { closeHandle(h); } };
    return {
      /** { game: true|false|null, by: { name, admin } }: the game's process often won't say, so the program that started it is asked too */
      elevatedOf(hwnd) {
        const pid = [0]; windowPid(hwnd, pid);
        if (!pid[0]) return { game: null, by: null };
        const g = elevatedPid(pid[0]); const list = processes(); const me = list.get(pid[0]); const parent = me && list.get(me.parent);
        return { game: g, by: parent ? { name: parent.name, admin: elevatedPid(me.parent) } : null };
      },
      selfElevated: () => elevated(-1),
      cursor() { const p = {}; return getCursor(p) ? { x: p.x, y: p.y } : { x: 0, y: 0 }; },
      leftDown: () => (keyState(0x01) & 0x8000) !== 0,
      findWindow(re, known) {
        const buf = Buffer.alloc(1024);
        const fits = (h) => {
          if (!visible(h)) return null;
          const n = windowText(h, buf, 512);
          const title = n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
          if (!re.test(title)) return null;
          const pid = [0]; windowPid(h, pid);
          return pid[0] === process.pid ? null : { title, hwnd: h };
        };
        if (known) { const again = fits(known); if (again) return again; }
        for (let h = Number(nextWindow(0, 0, null, null)); h; h = Number(nextWindow(0, h, null, null))) { const f = fits(h); if (f) return f; }
        return null;
      },
      programOf(hwnd) {
        const pid = [0]; windowPid(hwnd, pid);
        if (!pid[0]) return null;
        const h = openProcess(0x1000, false, pid[0]);
        if (!h) return null;
        try { const buf = Buffer.alloc(4096); const size = [2048]; return imageName(h, 0, buf, size) ? buf.toString('utf16le', 0, size[0] * 2) : null; } finally { closeHandle(h); }
      },
      foreground: () => Number(foreground()),
      rect(hwnd) { const r = {}; return getRect(hwnd, r) ? { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top } : null; },
      client(hwnd) { const r = {}; return getClientRect(hwnd, r) ? { width: r.right - r.left, height: r.bottom - r.top } : null; },
      /** the game's own picture on screen (no title bar or borders), in screen pixels */
      clientRect(hwnd) { const r = {}; if (!getClientRect(hwnd, r)) return null; const p = { x: 0, y: 0 }; if (!clientToScreen(hwnd, p)) return null; return { x: p.x, y: p.y, width: r.right - r.left, height: r.bottom - r.top }; },
      minimized: (hwnd) => !!iconic(hwnd),
      printClient: (hwnd, width) => (printClient ? printClient(hwnd, width) : null),
    };
  } catch (e) {
    note('koffi unavailable, using the capture list:', String(e));
    return null;
  }
})();

let game = { running: false, title: '', hwnd: 0 };
let useScreen = false; // Windows refused the window capture: share the game's screen instead
let missing = 0; // closed only after three missed looks in a row: a loading screen doesn't end the session
async function findGameWindow() {
  if (win32) return win32.findWindow(GAME_TITLE, game.hwnd);
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  const s = sources.find((x) => GAME_TITLE.test(x.name));
  return s ? { title: s.name, hwnd: Number(s.id.split(':')[1]) || 0 } : null;
}
async function lookForGame() {
  let found = null, looked = false;
  try { found = await findGameWindow(); looked = true; } catch (e) { /* next time */ }
  missing = found ? 0 : missing + (looked ? 1 : 0);
  if (found || !game.running || missing >= 3) {
    const was = game.running;
    game = { running: !!found, title: found ? found.title.trim() : '', hwnd: found ? found.hwnd : 0, admin: found && found.hwnd === game.hwnd ? game.admin : null };
    if (game.running !== was) {
      note(game.running ? `game running: "${game.title}"` : 'game closed');
      if (game.running) {
        await refreshLog(); placeOverlay();
        try { game.admin = win32 ? win32.elevatedOf(game.hwnd) : null; } catch (e) { game.admin = null; }
        const self = win32 ? win32.selfElevated() : null;
        note(`game as administrator: ${game.admin ? game.admin.game : '?'}${game.admin && game.admin.by ? ` (started by ${game.admin.by.name}, as administrator: ${game.admin.by.admin})` : ''}; Vorax Helper as administrator: ${self}`);
        if (adminBlock()) note('the game runs as administrator and this app doesn’t: Windows may refuse its window capture');
      }
      send('helper', 'game', { running: game.running });
      send('overlay', 'status', game.running ? (logPath ? 'Game found' : 'Game found · log not found') : 'Waiting for the game');
      rebuildMenu();
    }
  }
  updateOverlay();
  setTimeout(lookForGame, game.running ? 500 : 2000);
}

// ---------- Windows ----------

const wins = { helper: null, overlay: null };
let quitting = false, tray = null;
const send = (name, channel, data) => wins[name] && !wins[name].isDestroyed() && wins[name].webContents.send(channel, data);
const isPage = (url) => { try { return new URL(url).href.split('#')[0].split('?')[0] === PAGE_URL; } catch (e) { return false; } };
const fromHelper = (e) => !!wins.helper && !wins.helper.isDestroyed() && e.sender === wins.helper.webContents && !!e.senderFrame && isPage(e.senderFrame.url);
const fromOverlay = (e) => !!wins.overlay && !wins.overlay.isDestroyed() && e.sender === wins.overlay.webContents;
const onScreen = (b) => screen.getAllDisplays().some((d) => { const a = d.workArea; return b.x + 60 > a.x && b.x < a.x + a.width - 60 && b.y >= a.y - 10 && b.y < a.y + a.height - 40; });

function makeHelper() {
  const b = settings.helper && onScreen(settings.helper) ? settings.helper : {};
  const win = new BrowserWindow(Object.assign({
    show: false, width: 1320, height: 920, title: 'Vorax Helper', backgroundColor: '#0c1119', icon: ICON, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, contextIsolation: true, sandbox: true, spellcheck: false },
  }, b));
  win.removeMenu();
  wins.helper = win;
  const wc = win.webContents;
  // the helper's own pages navigate between each other; anything else opens in the player's browser
  wc.on('will-navigate', (e, url) => { if (url.startsWith('file:') && url.startsWith(pathToFileURL(path.join(__dirname, 'web')).href)) return; e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); });
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F12') wc.toggleDevTools(); });
  wc.on('console-message', (e) => { if (e.level === 'error') note('page:', String(e.message || '').slice(0, 300)); });
  wc.on('render-process-gone', () => setTimeout(() => !win.isDestroyed() && win.loadFile(PAGE), 1000));
  const keep = () => { if (!win.isMaximized() && !win.isMinimized()) { settings.helper = win.getBounds(); saveSettings(); } };
  win.on('moved', keep); win.on('resized', keep);
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  // (Vorax Helper) the page's look-ahead fills every core but one: below normal priority, as tli-warden runs its
  // playouts, so the game keeps its frame rate while the helper thinks
  wc.on('did-finish-load', () => lowerPriority(wc));
  win.loadFile(PAGE);
  return win;
}
function lowerPriority(wc) {
  try {
    const pid = wc.getOSProcessId();
    // (Vorax Helper) the faster game speeds keep it at normal priority: its answers come sooner, the game may lose a few frames
    const fast = settings.speed === 'fast' || settings.speed === 'fastest';
    if (pid) { os.setPriority(pid, fast ? os.constants.priority.PRIORITY_NORMAL : os.constants.priority.PRIORITY_BELOW_NORMAL); note(`helper page at ${fast ? 'normal' : 'below-normal'} priority`); }
  } catch (err) { note('could not lower the helper page priority:', String((err && err.message) || err)); }
}
function showHelper() { const w = wins.helper; if (!w || w.isDestroyed()) return; if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
function toggleHelper() { const w = wins.helper; if (w && w.isVisible() && w.isFocused()) w.hide(); else showHelper(); }

// ---------- The card over the game ----------

let cardHeight = 170, overlayShown = false, lastRaise = 0, lastCard = null;
function placeOverlay() {
  const win = wins.overlay; if (!win) return;
  let at = settings.overlay && onScreen(settings.overlay) ? settings.overlay : null;
  if (!at) {
    // at first: the game window's left side, below its round panel, clear of the instrument icons top right
    let area = screen.getPrimaryDisplay().workArea;
    const r = game.running && win32 ? win32.rect(game.hwnd) : null;
    if (r && r.width > 200) area = screen.screenToDipRect(null, r);
    at = { x: Math.round(area.x + 24), y: Math.round(area.y + Math.min(140, area.height / 8)) };
  }
  win.setBounds({ x: at.x, y: at.y, width: CARD_WIDTH, height: cardHeight });
}
function makeOverlay() {
  const win = new BrowserWindow({
    width: CARD_WIDTH, height: cardHeight, show: false, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
    fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false, title: 'Vorax Helper card', icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'overlay', 'preload.js'), backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  wins.overlay = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'overlay', 'overlay.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  capturable(win);
  win.webContents.on('did-finish-load', () => { send('overlay', 'folded', settings.folded); if (lastCard) send('overlay', 'card', lastCard); send('overlay', 'clicker', clickLine()); });
  win.on('moved', () => { const b = win.getBounds(); settings.overlay = { x: b.x, y: b.y }; saveSettings(); });
  win.on('close', (e) => { if (!quitting) e.preventDefault(); });
  placeOverlay();
  return win;
}
const hwndOf = (win) => { const b = win.getNativeWindowHandle(); return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0); };
function overlayWanted() {
  if (!settings.overlayOn || !game.running) return false;
  if (!settings.hideBehind || !win32) return true;
  const front = win32.foreground();
  if (front === game.hwnd) return !win32.minimized(game.hwnd);
  return !!wins.overlay && front === hwndOf(wins.overlay);
}
function updateOverlay() {
  const win = wins.overlay; if (!win || win.isDestroyed()) return;
  const want = overlayWanted();
  // other overlays also ask to stay on top; while the card shows, it asks again every 2 s
  if (want && overlayShown && Date.now() - lastRaise > 2000) { lastRaise = Date.now(); win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); }
  if (want === overlayShown) return;
  overlayShown = want;
  if (want) { win.showInactive(); win.setAlwaysOnTop(true, 'screen-saver'); } else win.hide();
}
function setOverlayOn(on) { settings.overlayOn = !!on; saveSettings(); updateOverlay(); rebuildMenu(); }

// ---------- Between the page, the overlay and the game ----------

ipcMain.on('advice', (e, card) => { if (!fromHelper(e)) return; const c = cleanCard(card); if (!c) return; lastCard = c; send('overlay', 'card', c); });
ipcMain.handle('game:get', (e) => (fromHelper(e) ? { running: game.running } : null));
// the game window's outer size and the picture inside it: the reader cuts away the title bar and borders
ipcMain.handle('game:window', (e) => {
  if (!fromHelper(e) || !win32 || !game.running || !game.hwnd) return null;
  const outer = win32.rect(game.hwnd), client = win32.client(game.hwnd);
  if (!outer || !client) return null;
  const scale = screen.getDisplayMatching(screen.screenToDipRect(null, outer)).scaleFactor;
  return { outer: [outer.width, outer.height], client: [client.width, client.height], scale };
});
// the screen the game is on, and where the game window sits on it (as shares of the screen's size)
function gameDisplay() {
  const r = game.running && win32 ? win32.rect(game.hwnd) : null;
  return r ? screen.getDisplayMatching(screen.screenToDipRect(null, r)) : screen.getPrimaryDisplay();
}
ipcMain.handle('capture:useWindow', (e) => { if (!fromHelper(e) || !useScreen) return false; useScreen = false; applyCapturable(); note('trying the game window again'); return true; });
ipcMain.handle('capture:useScreen', (e) => { if (!fromHelper(e)) return false; useScreen = true; applyCapturable(); note('window capture refused: falling back to the screen; card and highlight hidden from captures'); return true; });
ipcMain.handle('game:onScreen', (e) => {
  if (!fromHelper(e) || !win32 || !game.running || !game.hwnd) return null;
  const r = win32.clientRect(game.hwnd) || win32.rect(game.hwnd); if (!r) return null;   // the game's own picture, not the window's frame (a maximised window's frame hangs off-screen and under the taskbar)
  const d = gameDisplay(); const b = screen.dipToScreenRect(null, d.bounds);
  return { x: (r.x - b.x) / b.width, y: (r.y - b.y) / b.height, w: r.width / b.width, h: r.height / b.height };
});
// A picture of the game window taken by the app itself: Snap and the live reads work even when the page's
// window share is refused. desktopCapturer's thumbnail at the window's full size, as JPEG.
ipcMain.handle('capture:grab', async (e) => {
  if (!fromHelper(e) || !game.running) return null;
  const printed = printGame();
  if (printed) return printed;
  try {
    const r = win32 && game.hwnd ? win32.rect(game.hwnd) : null;
    const size = r ? { width: r.width, height: r.height } : screen.getPrimaryDisplay().size;
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size, fetchWindowIcons: false });
    const src = sources.find((x) => GAME_TITLE.test(x.name)) || (game.hwnd && sources.find((x) => x.id.startsWith(`window:${game.hwnd}:`)));
    if (!src || src.thumbnail.isEmpty()) { note('app grab: no picture of the game window'); return null; }
    // cut to the game's own picture (no title bar or borders), lossless: JPEG blurs thin digits like the round
    let img = src.thumbnail;
    const c = win32 && game.hwnd ? win32.clientRect(game.hwnd) : null;
    if (r && c) {
      const sx = img.getSize().width / r.width, sy = img.getSize().height / r.height;
      const cut = { x: Math.max(0, Math.round((c.x - r.x) * sx)), y: Math.max(0, Math.round((c.y - r.y) * sy)), width: Math.round(c.width * sx), height: Math.round(c.height * sy) };
      if (cut.width > 100 && cut.height > 100) img = img.crop(cut);
    }
    const png = img.toPNG();
    return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
  } catch (err) { note('app grab failed:', String(err)); return null; }
});
// ---------- (Vorax Helper) card names by Windows' own text reader ----------
// tli-warden reads its text with Windows.Media.Ocr: built in, and much faster than the page's Tesseract. One
// PowerShell (Windows PowerShell 5.1, which can reach Windows' own APIs) is started the first time and kept running;
// the page falls back to Tesseract when it can't start (no English OCR language, PowerShell blocked).
const OCR_SCRIPT = path.join(__dirname, 'ocr', 'win-ocr.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
let ocr = null, ocrDead = false;
function ocrStart() {
  if (ocr) return ocr.ready;
  if (ocrDead || process.platform !== 'win32' || !fs.existsSync(OCR_SCRIPT)) return Promise.resolve(false);
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  let proc;
  try { proc = spawn(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', OCR_SCRIPT], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (err) { ocrDead = true; note('windows ocr: could not start PowerShell:', String(err)); return Promise.resolve(false); }
  const o = { proc, waiting: new Map(), next: 0, buf: '', errors: 0 };
  let settle;
  o.ready = new Promise((resolve) => { settle = resolve; });
  const timer = setTimeout(() => done(false, 'no answer in 20 s'), 20000);
  const done = (ok, why) => { if (!settle) return; clearTimeout(timer); const f = settle; settle = null; note(ok ? `windows ocr ready (${why})` : `windows ocr unavailable: ${why}`); if (!ok) { ocrDead = true; ocrStop(); } f(ok); };
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    o.buf += d;
    let i;
    while ((i = o.buf.indexOf('\n')) >= 0) {
      const line = o.buf.slice(0, i).replace(/\r$/, ''); o.buf = o.buf.slice(i + 1);
      if (line.startsWith('ready ')) { done(true, line.slice(6)); continue; }
      if (line.startsWith('fail ')) { done(false, line.slice(5)); continue; }
      const sp = line.indexOf(' '), id = Number(line.slice(0, sp)), rest = line.slice(sp + 1), f = o.waiting.get(id);
      if (!f) continue;
      o.waiting.delete(id);
      if (rest.startsWith('!')) { if (o.errors++ < 3) note('windows ocr error:', rest.slice(1, 200)); f(null); continue; }
      try { f(String(JSON.parse(rest))); } catch { f(null); }
    }
  });
  proc.stderr.on('data', (d) => note('windows ocr:', String(d).trim().slice(0, 200)));
  proc.on('error', (err) => done(false, String(err)));
  proc.on('exit', (code) => { done(false, 'PowerShell exited (' + code + ')'); for (const f of o.waiting.values()) f(null); o.waiting.clear(); if (ocr === o) ocr = null; });
  ocr = o;
  return o.ready;
}
function ocrStop() { if (ocr) { try { ocr.proc.kill(); } catch { /* gone */ } ocr = null; } }
ipcMain.handle('ocr:ready', (e) => (fromHelper(e) ? ocrStart() : false));
ipcMain.handle('ocr:read', async (e, w, h, grey) => {
  if (!fromHelper(e) || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 2600 || h > 2600 || !grey || grey.length !== w * h) return null;
  if (!(await ocrStart()) || !ocr) return null;
  const o = ocr;
  return new Promise((resolve) => {
    const id = ++o.next;
    const t = setTimeout(() => { o.waiting.delete(id); resolve(null); }, 6000);
    o.waiting.set(id, (v) => { clearTimeout(t); resolve(v); });
    o.proc.stdin.write(`${id} ${w} ${h} ${Buffer.from(grey.buffer, grey.byteOffset, grey.byteLength).toString('base64')}\n`);
  });
});
// (Vorax Helper) the game's picture by PrintWindow, as raw pixels: tried before desktopCapturer (whose pictures
// Windows refuses as it refuses the page's window capture); it stops being tried after it fails a few times in a row
let printFails = 0, printNoted = false, printMissNoted = false;
function printGame(width) {
  if (!win32 || !game.hwnd || printFails >= 5 || win32.minimized(game.hwnd)) return null;
  try {
    const p = win32.printClient(game.hwnd, width);
    if (!p) { if (!printMissNoted) { printMissNoted = true; note('PrintWindow gave no picture of the game (black, or refused)'); } if (++printFails === 5) note('PrintWindow gives no picture of the game: not tried again'); return null; }
    printFails = 0;
    if (!printNoted) { printNoted = true; note(`game pictures by PrintWindow (${p.width}x${p.height}${width ? ', probe' : ''})`); }
    return { raw: true, width: p.width, height: p.height, data: new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.byteLength) };
  } catch (err) { if (++printFails === 5) note('PrintWindow failed:', String(err)); return null; }
}
ipcMain.handle('capture:printable', (e) => { if (!fromHelper(e) || !game.running) return false; printFails = 0; return !!printGame(64); });
// (Vorax Helper) a tiny picture of the game window, for watching it for a move (the page compares them)
ipcMain.handle('capture:probe', async (e) => {
  if (!fromHelper(e) || !game.running) return null;
  const printed = printGame(192);
  if (printed) return printed;
  try {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 192, height: 108 }, fetchWindowIcons: false });
    const src = (game.hwnd && sources.find((x) => x.id.startsWith(`window:${game.hwnd}:`))) || sources.find((x) => GAME_TITLE.test(x.name));
    if (!src || src.thumbnail.isEmpty()) return null;
    const png = src.thumbnail.toPNG();
    return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
  } catch (err) { return null; }
});
ipcMain.on('log:detail', (e, on) => {
  if (!fromHelper(e) || logDetail === !!on) return;
  logDetail = !!on;
  if (!on) note('the game log has no detail lines: its Enable Log is off; watching the screen instead');
  send('overlay', 'status', on ? 'Game found' : 'Game log detail off: Esc → Enable Log');
});
let logDetail = null;
ipcMain.handle('log:size', async (e) => {
  if (!fromHelper(e)) return null;
  if (!logPath) await refreshLog();
  const st = logPath && statOf(logPath);
  return st && st.isFile() ? st.size : null;
});
const MAX_READ = 2 * 1024 * 1024;
ipcMain.handle('log:read', async (e, start, end) => {
  if (!fromHelper(e) || !logPath || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return new Uint8Array(0);
  const length = Math.min(end - start, MAX_READ);
  const fh = await fs.promises.open(logPath, 'r');
  try { const buf = Buffer.alloc(length); const { bytesRead } = await fh.read(buf, 0, length, start); return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead); } finally { await fh.close(); }
});
ipcMain.on('overlay:height', (e, h) => {
  if (!fromOverlay(e) || !Number.isFinite(h)) return;
  const height = Math.max(40, Math.min(600, Math.ceil(h)));
  if (height === cardHeight) return;
  cardHeight = height;
  const b = wins.overlay.getBounds();
  wins.overlay.setBounds({ x: b.x, y: b.y, width: CARD_WIDTH, height });
});
// The card never takes focus (the game stays in front), and Windows won't drag a window like that by a CSS
// drag region: the app moves it itself, following the pointer while the left button is held.
let dragging = null;
ipcMain.on('overlay:dragStart', (e) => {
  if (!fromOverlay(e) || dragging) return;
  const at = screen.getCursorScreenPoint(), b = wins.overlay.getBounds();
  const dx = at.x - b.x, dy = at.y - b.y, started = Date.now();
  dragging = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    wins.overlay.setBounds({ x: p.x - dx, y: p.y - dy, width: CARD_WIDTH, height: cardHeight });
    const up = win32 ? !win32.leftDown() : Date.now() - started > 8000;
    if (up) { clearInterval(dragging); dragging = null; const nb = wins.overlay.getBounds(); settings.overlay = { x: nb.x, y: nb.y }; saveSettings(); }
  }, 16);
});
ipcMain.on('overlay:dragEnd', (e) => { if (fromOverlay(e) && dragging && !win32) { clearInterval(dragging); dragging = null; const nb = wins.overlay.getBounds(); settings.overlay = { x: nb.x, y: nb.y }; saveSettings(); } });
ipcMain.on('overlay:fold', (e, folded) => { if (fromOverlay(e)) { settings.folded = !!folded; saveSettings(); } });
ipcMain.on('overlay:helper', (e) => fromOverlay(e) && toggleHelper());
ipcMain.on('overlay:snap', (e) => fromOverlay(e) && game.running && send('helper', 'snap'));
// the card's Send / Not now after Ctrl+Alt+J: the player's answer is the consent, so no second question
ipcMain.on('overlay:report', (e, yes) => { if (!fromOverlay(e) || !pendingReport) return; const r = pendingReport; pendingReport = null; if (yes) sendReport(r.note, true); else send('overlay', 'clicker', 'Not sent. You can send it later from Settings → Game log & debug.'); });
let pendingReport = null;

// ---------- The debug record: each run's events and pictures, kept on this PC (the last RUNS runs) ----------

const RECORDS = path.join(app.getPath('userData'), 'records');
const RUNS = 5;
let run = null; // { dir }
function runDir() {
  if (run) return run.dir;
  const dir = path.join(RECORDS, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  run = { dir };
  try {
    const old = fs.readdirSync(RECORDS).filter((d) => statOf(path.join(RECORDS, d))?.isDirectory()).sort();
    for (const d of old.slice(0, Math.max(0, old.length - RUNS))) fs.rmSync(path.join(RECORDS, d), { recursive: true, force: true });
  } catch (e) { /* nothing to prune */ }
  return dir;
}
ipcMain.on('debug:event', (e, ev) => {
  if (!fromHelper(e) || !ev || typeof ev !== 'object') return;
  try { const line = JSON.stringify(ev); if (line.length < 200000) fs.appendFileSync(path.join(runDir(), 'events.jsonl'), line + '\n'); } catch (x) { /* not kept */ }
});
ipcMain.on('debug:frame', (e, name, bytes) => {
  if (!fromHelper(e) || typeof name !== 'string' || !/^frames\/\d{4}\.jpg$/.test(name) || !(bytes instanceof Uint8Array) || bytes.length > 20e6) return;
  try { fs.writeFileSync(path.join(runDir(), name), bytes); } catch (x) { /* not kept */ }
});
const tail = (file, max) => { try { const st = fs.statSync(file); const fd = fs.openSync(file, 'r'); const n = Math.min(max, st.size); const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, st.size - n); fs.closeSync(fd); return b.toString('utf8'); } catch (e) { return ''; } };
ipcMain.handle('debug:appLog', (e) => (fromHelper(e) ? tail(LOG_FILE, 300000) : ''));

/** The latest run on disk, as one .zip the player picks a place for (it survives a restart or crash of the page). */
/** The latest run as a debug bundle: { name, bytes }, or null when nothing is recorded. maxBytes: the oldest
 *  pictures are left out until it fits (an upload's limit). */
function buildBundle(maxBytes = Infinity, note = '') {
  require('./web/js/zip.js');
  let runs = [];
  try { runs = fs.readdirSync(RECORDS).filter((d) => statOf(path.join(RECORDS, d))?.isDirectory()).sort(); } catch (e) { /* none */ }
  if (!runs.length) return null;
  const dir = path.join(RECORDS, runs[runs.length - 1]);
  const base = [{ name: 'manifest.json', data: JSON.stringify({ version: 'helper-app-' + app.getVersion(), saved: new Date().toISOString(), run: runs[runs.length - 1], app: true, os: process.getSystemVersion(), displays: screen.getAllDisplays().map((d) => ({ size: [d.size.width, d.size.height], scale: d.scaleFactor })), log: logPath, koffi: !!win32, admin: { self: win32 ? win32.selfElevated() : null, game: game.admin || null }, settings: Object.fromEntries(Object.keys(SETTING_KEYS).map((k) => [k, settings[k]])), ...(note ? { note } : {}) }, null, 2) }];
  if (fs.existsSync(path.join(dir, 'events.jsonl'))) base.push({ name: 'events.jsonl', data: fs.readFileSync(path.join(dir, 'events.jsonl')) });
  base.push({ name: 'app-log.txt', data: tail(LOG_FILE, 300000) });
  let frames = [];
  try { frames = fs.readdirSync(path.join(dir, 'frames')).sort().slice(-60).map((f) => ({ name: 'frames/' + f, data: fs.readFileSync(path.join(dir, 'frames', f)) })); } catch (e) { /* no pictures */ }
  const size = (list) => list.reduce((a, f) => a + (typeof f.data === 'string' ? Buffer.byteLength(f.data) : f.data.length) + 100, 0);
  while (frames.length && size(base) + size(frames) > maxBytes) frames.shift();
  const name = `vorax-debug-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
  return { name, bytes: Buffer.from(globalThis.VoraxZip.zip([...base.slice(0, 1), ...frames, ...base.slice(1)])), pictures: frames.length };
}
async function saveRunBundle(quiet = false) {
  const b = buildBundle();
  if (!b) { if (!quiet) dialog.showMessageBox({ message: 'Nothing recorded yet.', detail: 'Play a round with the helper following the game first.' }); return null; }
  const name = b.name;
  let file;
  if (quiet) file = path.join(app.getPath('downloads'), name);
  else {
    const res = await dialog.showSaveDialog({ title: 'Save debug bundle', defaultPath: path.join(app.getPath('downloads'), name), filters: [{ name: 'Zip', extensions: ['zip'] }] });
    if (res.canceled || !res.filePath) return null;
    file = res.filePath;
  }
  fs.writeFileSync(file, b.bytes);
  if (!quiet) shell.showItemInFolder(file);
  return file;
}

// ---------- Sending a debug report to the developer (the collector's /report, Cloudflare R2) ----------
// Only when the player presses Send and agrees. Goes to the collector built into this copy (web/js/share-config.js).
const REPORT_MAX = 24 * 1024 * 1024;
function builtCollector() {
  try {
    const t = fs.readFileSync(path.join(__dirname, 'web', 'js', 'share-config.js'), 'utf8');
    const url = /url:\s*'([^']+)'/.exec(t), key = /key:\s*'([^']+)'/.exec(t);
    return url && key ? { url: url[1].replace(/\/+$/, ''), key: key[1] } : null;
  } catch (e) { return null; }
}
let reportStatus = '';
let reportIssue = null;
async function sendReport(said = '', agreed = false) {
  reportIssue = null;
  const c = builtCollector();
  if (!c) return (reportStatus = 'This copy has no collector to send reports to.');
  const b = buildBundle(REPORT_MAX, said);
  if (!b) return (reportStatus = 'Nothing recorded yet: play a round with the helper following the game first.');
  const mb = (b.bytes.length / 1048576).toFixed(1);
  const parent = wins.helper && !wins.helper.isDestroyed() && wins.helper.isVisible() ? wins.helper : undefined;
  const ok = agreed ? { response: 0 } : await dialog.showMessageBox(parent, {
    type: 'question', buttons: ['Send', 'Cancel'], defaultId: 0, cancelId: 1, title: 'Send a debug report',
    message: `Send this debug report (${mb} MB) to the Vorax Helper developer?`,
    detail: `It holds the latest run: ${b.pictures} pictures of the game window, what the helper read and advised, the fixes you made, the app's log and its settings${said ? ', and your note' : ''}. Nothing else from your PC, no account details. It's kept by the developer only, to fix the helper.`,
  });
  if (ok.response !== 0) return (reportStatus = 'Not sent.');
  reportStatus = `Sending (${mb} MB)…`;
  send('overlay', 'clicker', reportStatus);
  try {
    const r = await net.fetch(c.url + '/report', { method: 'POST', headers: { 'x-key': c.key, 'content-type': 'application/zip', 'x-note': encodeURIComponent(said.slice(0, 300)), 'x-app': app.getVersion() }, body: b.bytes });
    const j = await r.json().catch(() => ({}));
    reportStatus = r.ok ? `Report sent. Thank you! (${mb} MB)${j.issue && j.issue.number ? ` · issue #${j.issue.number}` : ''}` : `Not sent: ${j.error || 'the collector said ' + r.status}.`;
    reportIssue = r.ok && j.issue && /^https:\/\/github\.com\//.test(j.issue.url || '') ? j.issue.url : null;
  } catch (e) { reportStatus = 'Not sent: ' + (e && e.message ? e.message : e); }
  note('report upload:', reportStatus);
  send('overlay', 'clicker', reportStatus);
  return reportStatus;
}
function openReview() {
  const w = new BrowserWindow({ width: 1400, height: 950, title: 'Debug review · Vorax Helper', backgroundColor: '#0c1119', icon: ICON, autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
  w.removeMenu();
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.loadFile(path.join(__dirname, 'web', 'review.html'));
}


// ---------- Administrator: the game run as one blocks this app's window capture unless it is one too ----------
const adminBlock = () => {
  const a = game.admin;
  if (!a || !win32 || win32.selfElevated() === true) return false;
  if (a.game === true || (a.by && a.by.admin === true)) return true;
  return false;
};
// ---------- The highlight over the game (it only draws: nothing here clicks) ----------

let clickStatus = '';
const highlighter = createHighlighter({ settings, now: () => Date.now() });
const clickLine = () => '';

let markWin = null;
// Screenshots and recordings (Snipping Tool, OBS, Game Bar) see the card and the highlight when "showInCaptures" is on.
// The reader is safe either way: it captures the game window alone, which never includes windows on top of it.
// Only the screen fallback (Windows refused the window capture) would see them, so then they stay hidden.
const hiddenFromCaptures = () => !settings.showInCaptures || useScreen;
function capturable(w) { if (w && !w.isDestroyed()) w.setContentProtection(hiddenFromCaptures()); }
function applyCapturable() { capturable(wins.overlay); capturable(markWin); }
function makeMark() {
  const w = new BrowserWindow({
    show: false, frame: false, transparent: true, resizable: false, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
    title: 'Vorax Helper highlight', webPreferences: { preload: path.join(__dirname, 'mark', 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  w.setIgnoreMouseEvents(true); // clicks go through to the game
  w.setAlwaysOnTop(true, 'screen-saver');
  capturable(w);
  w.loadFile(path.join(__dirname, 'mark', 'mark.html'));
  markWin = w;
}
let lastMarkKey = '';
function updateMark() {
  if (!markWin || markWin.isDestroyed()) return;
  const m = settings.highlight && game.running && win32 && overlayWanted() ? highlighter.marks() : null;
  const r = m && frameRect();
  if (!m || !r || win32.minimized(game.hwnd)) { if (markWin.isVisible()) markWin.hide(); lastMarkKey = ''; return; }
  const area = screen.screenToDipRect(null, r);
  const key = JSON.stringify([m.id, m.next, m.final, area]);
  if (key === lastMarkKey) return;
  lastMarkKey = key;
  markWin.setBounds(area);
  const boxes = m.steps.map((st) => ({ x: st.fx * area.width, y: st.fy * area.height, w: st.fw * area.width, h: st.fh * area.height, label: st.label + (m.final ? '' : ' (working it out…)') }));
  markWin.webContents.send('mark', { boxes, next: m.next });
  if (!markWin.isVisible()) markWin.showInactive();
  markWin.setAlwaysOnTop(true, 'screen-saver');
}
setInterval(updateMark, 250);

// (Vorax Helper) where the newest advice's picture sits on screen: the whole game window, or only its inside (the
// screen share cut to it, the app's own pictures); the highlight measured from the window's outer edge on
// a picture of its inside landed a title bar's height too high, enough to miss a small monster in its tank
let planArea = null;
function frameRect() {
  if (!game.running || !win32) return null;
  return (planArea === 'client' && win32.clientRect(game.hwnd)) || win32.rect(game.hwnd);
}
ipcMain.on('plan', (e, p) => {
  if (!fromHelper(e) || !p || typeof p !== 'object') return;
  planArea = p.area === 'client' ? 'client' : p.area === 'window' ? 'window' : null;
  highlighter.setPlan(p);
  updateMark();
});
// ---------- Settings, shown in the helper page's Settings panel ----------

const SETTING_KEYS = {
  overlayOn: 'bool', hideBehind: 'bool', highlight: 'bool', adviceSource: ['instant', 'ahead', 'deep'],
  showInCaptures: 'bool', hideFromRound: [0, 10, 11], watchScreen: 'bool', speed: ['thorough', 'fast', 'fastest'],
};
function settingsView() {
  return {
    values: Object.fromEntries(Object.keys(SETTING_KEYS).map((k) => [k, settings[k]])),
    clickStatus, screenFallback: useScreen, koffi: !!win32, reportStatus, reportIssue, canReport: !!builtCollector(), admin: { blocked: adminBlock(), self: win32 ? win32.selfElevated() : null, game: game.admin || null },
    hotkeys: HOTKEYS, log: logPath, logChosen: !!settings.logPath, game: game.running ? game.title : null, version: app.getVersion(),
  };
}
ipcMain.handle('settings:get', (e) => (fromHelper(e) ? settingsView() : null));
// agreed: the page's Report button, its text saying what is sent (no second question)
ipcMain.handle('settings:sendReport', async (e, said, agreed) => { if (!fromHelper(e)) return null; await sendReport(typeof said === 'string' ? said : '', agreed === true); return settingsView(); });
ipcMain.handle('settings:set', (e, key, value) => {
  if (!fromHelper(e) || !(key in SETTING_KEYS)) return null;
  const kind = SETTING_KEYS[key];
  if (kind === 'bool') value = !!value;
  else if (!kind.includes(value)) return settingsView();
  settings[key] = value; saveSettings();
  if (key === 'overlayOn') updateOverlay();
  if (key === 'highlight') updateMark();
  if (key === 'showInCaptures') applyCapturable();
  if (key === 'hideFromRound') updateMark();
  if (key === 'watchScreen') send('helper', 'watchScreen', value);
  if (key === 'speed') { send('helper', 'speed', value); if (wins.helper && !wins.helper.isDestroyed()) lowerPriority(wins.helper.webContents); }
  rebuildMenu();
  send('overlay', 'clicker', clickLine());
  return settingsView();
});
ipcMain.handle('settings:do', async (e, what) => {
  if (!fromHelper(e)) return null;
  if (what === 'pickLog') await pickLog();
  else if (what === 'resetLog') { settings.logPath = null; saveSettings(); await refreshLog(); }
  else if (what === 'bundle') await saveRunBundle();
  else if (what === 'records') { fs.mkdirSync(RECORDS, { recursive: true }); shell.openPath(RECORDS); }
  else if (what === 'appLog') shell.openPath(LOG_FILE);
  else if (what === 'review') openReview();
  rebuildMenu();
  return settingsView();
});
function openSettings() { showHelper(); send('helper', 'openSettings'); }

// ---------- Tray, hotkeys, permissions ----------

function rebuildMenu() {
  if (!tray) return;
  tray.setToolTip(game.running ? `Vorax Helper · following ${game.title}` : 'Vorax Helper · waiting for the game');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: game.running ? `Following ${game.title}` : 'Waiting for the game', enabled: false },
    { type: 'separator' },
    { label: 'Open the helper', accelerator: HOTKEYS.helper, click: showHelper },
    { label: 'Settings…', click: openSettings },
    { label: 'Show the card over the game', type: 'checkbox', checked: settings.overlayOn, accelerator: HOTKEYS.overlay, click: (m) => setOverlayOn(m.checked) },
    { label: 'Highlight the move', type: 'checkbox', checked: settings.highlight, click: (m) => { settings.highlight = m.checked; saveSettings(); updateMark(); } },
    { label: 'Read the board now', accelerator: HOTKEYS.snap, enabled: game.running, click: () => send('helper', 'snap') },
    { label: 'Something went wrong: save a debug bundle', accelerator: HOTKEYS.report, click: () => reportNow() },
    { label: 'Send a debug report to the developer…', click: () => { showHelper(); send('helper', 'openSettings', 'app'); } },
    { type: 'separator' },
    { label: `Vorax Helper ${app.getVersion()}`, enabled: false },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}
/** Ctrl+Alt+J: something went wrong. Marks the moment in the record, takes a fresh picture, and saves the
 *  run's debug bundle to Downloads without a dialog (you're mid-game), then says where on the card. */
async function reportNow() {
  note('report: the player pressed', HOTKEYS.report);
  send('helper', 'debugFlag');
  if (game.running) send('helper', 'snap');
  send('overlay', 'clicker', 'Saving a debug bundle…');
  await new Promise((r) => setTimeout(r, 2500)); // the picture and the flag reach the record first
  try {
    const file = await saveRunBundle(true);
    const msg = file ? `Debug bundle saved: Downloads\\${path.basename(file)}` : 'Nothing recorded yet to save.';
    clickStatus = msg; send('overlay', 'clicker', msg); note('report:', msg);
    // ask on the card whether to send it (Send / Not now)
    if (file && builtCollector()) {
      pendingReport = { note: `Ctrl+Alt+J pressed at ${new Date().toISOString()}` };
      send('overlay', 'reportAsk', { mb: (fs.statSync(file).size / 1048576).toFixed(1) });
      if (!overlayShown && wins.overlay && !wins.overlay.isDestroyed()) wins.overlay.showInactive();
    }
  } catch (e) { send('overlay', 'clicker', 'Could not save the debug bundle: ' + e.message); note('report failed:', String(e)); }
}

function registerHotkeys() {
  const missed = [];
  for (const [key, fn] of [[HOTKEYS.overlay, () => setOverlayOn(!settings.overlayOn)], [HOTKEYS.helper, toggleHelper], [HOTKEYS.snap, () => game.running && send('helper', 'snap')],
    [HOTKEYS.report, () => reportNow()]])
    if (!globalShortcut.isRegistered(key) && !globalShortcut.register(key, fn)) { note('hotkey taken by another program:', key); missed.push(key); }
  // (Vorax Helper) another program can hold them for a moment (an app closing): tried again
  if (missed.length && hotkeyTries++ < 2) setTimeout(registerHotkeys, 3000 * hotkeyTries);
  else if (missed.length) note('hotkeys still taken:', missed.join(', '));
  else if (hotkeyTries) note('hotkeys registered');
}
let hotkeyTries = 0;
function permissions() {
  // the page's window share is answered with the game window, with no picker; nothing else may ask
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!wins.helper || !request.frame || !isPage(request.frame.url)) return callback({});
    if (useScreen) {
      const d = gameDisplay();
      return desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then((sources) => {
        const s = sources.find((x) => String(x.display_id) === String(d.id)) || sources[0];
        note(s ? `screen share (window capture refused): "${s.name}"` : 'screen share failed: no screens');
        callback(s ? { video: s } : {});
      }).catch((e) => { note('screen share failed:', String(e)); callback({}); });
    }
    desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
      .then((sources) => {
        let s = sources.find((x) => GAME_TITLE.test(x.name));
        // left out of the capture list (a game run as administrator, say): asked for by its handle
        if (!s && game.running && game.hwnd) s = { id: `window:${game.hwnd}:0`, name: game.title };
        note(s ? `window share: "${String(s.name).trim()}"` : 'window share refused: no game window');
        callback(s ? { video: s } : {});
      })
      .catch((e) => { note('window share failed:', String((e && e.message) || e)); callback({}); });
  });
  const allowed = new Set(['media', 'display-capture', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(allowed.has(permission) && isPage(details.requestingUrl || wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed.has(permission));
}

app.on('second-instance', showHelper);
app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => (quitting = true));
app.on('will-quit', () => { globalShortcut.unregisterAll(); ocrStop(); });

app.whenReady().then(async () => {
  app.setAppUserModelId('local.vorax-helper.overlay');
  if (!fs.existsSync(PAGE)) { dialog.showErrorBox('Vorax Helper', 'The helper pages are missing. Run "npm start" (it copies them in) rather than "electron ." directly.'); app.quit(); return; }
  note(`Vorax Helper ${app.getVersion()} starting`);
  permissions();
  makeHelper();
  makeOverlay();
  makeMark();
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.on('click', showHelper);
  rebuildMenu();
  registerHotkeys();
  await refreshLog();
  lookForGame();
  wins.helper.once('ready-to-show', showHelper);
});
