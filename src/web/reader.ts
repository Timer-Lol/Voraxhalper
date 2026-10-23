// Screenshot reading and live following for the page: a Web Worker for the pixels, Tesseract for card names.
import type { Reading } from '../reader/types'
import type { HandPhase } from '../reader/scan/data'
import { readTitles, type PictureRead, type ReadText } from '../reader/scan/titles'
import type { Img } from '../reader/scan/pixels'
import type { LocalRefs } from '../reader/scan/scan'
import { CHECK_MS, createLiveLoop, POLL_MS, type LiveEvent } from '../reader/live/liveLoop'
import { createFollower, type FileLike } from '../reader/live/logFollower'
import { DEFAULT_RULES } from '../reader/live/triggers'
import { waitStable } from '../reader/live/stable'
import { createWatch, WATCH_MS, WATCH_W, watchThumb } from '../reader/live/watch'
import { NotAWindowError, shareWindow, type WindowShare } from '../reader/live/windowCapture'
import { newTracker, trackInstruments } from '../reader/track'
import { cropFromArea, cropRows, findChrome, hasCrop, type Crop } from './chrome'
import { gameArea, windowedGame, type GameWindow } from '../reader/live/windowCrop'

const SRC = () => (globalThis as unknown as { VORAX_WORKERS?: { scan: string; live: string } }).VORAX_WORKERS
const blobWorker = (code: string) => new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))

/* ---------- card names by OCR (loaded the first time it is needed) ---------- */
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
let pool: Promise<ReadText | null> | null = null
let tess: Promise<ReadText | null> | null = null
function tesseract(): Promise<ReadText | null> {
  tess ??= (async () => {
    const g = globalThis as unknown as { Tesseract?: any }
    if (!g.Tesseract) await new Promise<void>((ok, bad) => { const s = document.createElement('script'); s.src = TESS; s.onload = () => ok(); s.onerror = () => bad(new Error('Tesseract not reachable')); document.head.appendChild(s) })
    const T = g.Tesseract
    const scheduler = T.createScheduler()
    const workers = await Promise.all(Array.from({ length: 3 }, () => T.createWorker('eng')))
    for (const w of workers) { await w.setParameters({ tessedit_pageseg_mode: T.PSM.SINGLE_BLOCK }); scheduler.addWorker(w) }
    const toCanvas = (img: Img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0); return c }
    return async (img: Img) => (await scheduler.addJob('recognize', toCanvas(img))).data.text as string
  })().catch(() => { tess = null; return null })
  return tess
}
/** Which text reader the card names are read with, once known: Windows' own (desktop app) or Tesseract. */
export let textEngine: 'windows' | 'tesseract' | null = null
export const ocrEngine = () => textEngine
export function textReader(): Promise<ReadText | null> {
  pool ??= (async () => {
    // (Vorax Helper) in the desktop app, Windows' own text reader (tli-warden's): built in and much faster. Tesseract
    // stays the fallback, for the browser and for a PC where Windows' reader isn't there or stops answering.
    const D = (globalThis as unknown as { VoraxDesktop?: { ocrReady?(): Promise<boolean>; ocr?(w: number, h: number, grey: Uint8Array): Promise<string | null> } }).VoraxDesktop
    if (D?.ocrReady && D.ocr && (await D.ocrReady().catch(() => false))) {
      let misses = 0
      textEngine = 'windows'
      return async (img: Img) => {
        if (misses < 3) {
          const grey = new Uint8Array(img.width * img.height)
          for (let i = 0; i < grey.length; i++) grey[i] = img.data[i * 4]   // the title crops are grey already
          const text = await D.ocr!(img.width, img.height, grey).catch(() => null)
          if (typeof text === 'string') { misses = 0; return text }
          if (++misses >= 3) textEngine = 'tesseract'
        }
        const t = await tesseract()
        return t ? t(img) : ''
      }
    }
    const t = await tesseract()
    if (t) textEngine = 'tesseract'
    return t
  })().catch(() => { pool = null; return null })
  return pool
}

/* ---------- the scanner ---------- */
/** skip: (Vorax Helper) asked of the board's first reading: true leaves the cards unread (a picture the page will set aside) */
export interface ScanOptions { skip?(base: Reading): boolean }
export interface Scanner { (img: ImageData, trigger?: string, local?: LocalRefs, o?: ScanOptions): Promise<Reading>; ocr: Promise<boolean> }
export function createScanner(): Scanner {
  const w = blobWorker(SRC()!.scan)
  const waiting = new Map<number, (r: never) => void>()
  let next = 0
  w.onmessage = (e: MessageEvent<{ id: number; reading?: Reading; read?: Record<number, PictureRead> }>) => { waiting.get(e.data.id)?.((e.data.reading ?? e.data.read) as never); waiting.delete(e.data.id) }
  const ask = <T,>(m: Record<string, unknown>) => new Promise<T>(res => { const id = ++next; waiting.set(id, res as never); w.postMessage({ id, ...m }) })
  const ocr = textReader().then(r => !!r)
  // how sure a pixel reading is: the board's own fields that were read clearly
  const sureness = (r: Reading) => r.problems.some(p => p.kind === 'notFound') ? -1 : Object.entries(r.fields).filter(([k, f]) => /^(tank|round|refreshes|phase)/.test(k) && f.sure).length
  // the title bar / taskbar decision, kept per frame size (a live window keeps its size)
  const crops = new Map<string, Crop>()
  async function frame(img: ImageData, trigger: string | undefined, local: LocalRefs): Promise<{ img: ImageData; base: Reading; crop: Crop }> {
    const size = img.width + 'x' + img.height
    const known = crops.get(size)
    if (known) { const c = cropRows(img, known) as ImageData; return { img: c, base: await ask<Reading>({ img: c, trigger, local, pictures: false }), crop: known } }
    // a desktop shell that knows the game window's size gives the exact crop; otherwise it's found from the pixels
    const bridge = (globalThis as unknown as { VoraxDesktop?: { gameWindow?(): Promise<GameWindow | null> } }).VoraxDesktop
    const win = bridge?.gameWindow ? await bridge.gameWindow().catch(() => null) : null
    const area = win ? gameArea(img, win) : null
    const full = await ask<Reading>({ img, trigger, local, pictures: false })
    // candidates: the window's measured game area, the strips found in the pixels; kept only if they read better
    const seen = new Set<string>(); const tries: Crop[] = []
    // and upstream's title-bar finder (a Windows 11 title bar, 30 rows under a border row)
    const titled = windowedGame(img)
    for (const c of [area ? cropFromArea(img, area) : null, findChrome(img), titled ? cropFromArea(img, titled) : null]) if (c && hasCrop(c) && !seen.has(JSON.stringify(c))) { seen.add(JSON.stringify(c)); tries.push(c) }
    let best = { img, base: full, crop: { top: 0, bottom: 0 } as Crop, sure: sureness(full) }
    for (const c of tries) {
      const ci = cropRows(img, c) as ImageData
      const r = await ask<Reading>({ img: ci, trigger, local, pictures: false })
      const sc = sureness(r)
      if (sc >= best.sure) best = { img: ci, base: r, crop: c, sure: sc }
    }
    if (!full.problems.some(p => p.kind === 'animating')) crops.set(size, best.crop)
    return { img: best.img, base: best.base, crop: best.crop }
  }
  const scan = (async (img: ImageData, trigger?: string, local: LocalRefs = {}, o: ScanOptions = {}) => {
    const f = await frame(img, trigger, local)
    // the card names are most of the time a reading takes: not read for a picture the page won't use
    if (o.skip?.(f.base)) return Object.assign(f.base, { crop: f.crop, cardsSkipped: true })
    const readText = await textReader()
    const r = !readText
      ? await ask<Reading>({ img: f.img, trigger, local, pictures: true })
      : await readTitles(f.img, f.base, readText, async (phase: HandPhase, size: number, which: number[]) => ask<Record<number, PictureRead>>({ kind: 'slots', img: f.img, phase, size, slots: which, local, shift: f.base.handShift, ui: f.base.ui }))
    return Object.assign(r, { crop: f.crop })
  }) as Scanner
  scan.ocr = ocr
  return scan
}

/** An image file / pasted picture as pixels. */
export async function imageData(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob)
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height
  const ctx = c.getContext('2d')!; ctx.drawImage(bmp, 0, 0); bmp.close()
  return ctx.getImageData(0, 0, c.width, c.height)
}

/* ---------- live: the game log says when to look, the shared window gives the picture ---------- */
/** (Vorax Helper) the screen watch with the game window shared: a look every FAST_MS, still for FAST_WATCH.looks of them */
const FAST_MS = 150
const FAST_WATCH = { looks: 3, quietMs: 500 }
/** the same with the app's own pictures (PrintWindow, each a little dearer than a video frame) */
const PRINT_MS = 300
const PRINT_WATCH = { looks: 2, quietMs: 600 }
export interface LiveHandlers { onSnap(img: ImageData, kind: string): void; onStatus(s: { detailSeen: boolean; refreshes: number; over: boolean; lines: number }): void; onError(m: string): void; onEnded(): void }
export interface Live { connectLog(h: unknown): void; connectDesktop(): void; share(): Promise<void>; snapNow(kind?: 'manual' | 'after-click'): void; watchScreen(on: boolean): void; watchResult(sameBoard: boolean): void; stop(): void; readonly sharing: boolean; readonly appPictures: boolean; readonly frameArea: 'window' | 'client'; readonly following: boolean; readonly watching: boolean }
/** Inside the desktop app: a picture of the game window taken by the app itself (no window share needed). */
type AppPicture = ArrayBuffer | { raw: true; width: number; height: number; data: Uint8Array }
/** (Vorax Helper) A picture from the app: a PNG, or PrintWindow's raw BGRA pixels (turned to RGBA here). */
async function appPicture(b: AppPicture): Promise<ImageData> {
  if (b instanceof ArrayBuffer) return imageData(new Blob([b], { type: 'image/png' }))
  const out = new ImageData(b.width, b.height), d = out.data, s = b.data
  for (let i = 0; i < d.length; i += 4) { d[i] = s[i + 2]; d[i + 1] = s[i + 1]; d[i + 2] = s[i]; d[i + 3] = 255 }
  return out
}
function appGrab(): { grab(): Promise<ImageData>; probe?(): Promise<ImageData> } | null {
  const D = (globalThis as unknown as { VoraxDesktop?: { grabWindow?(): Promise<AppPicture | null>; probeWindow?(): Promise<AppPicture | null> } }).VoraxDesktop
  if (!D?.grabWindow) return null
  return {
    grab: async () => { const b = await D.grabWindow!(); if (!b) throw new Error('the app could not take a picture of the game window'); return appPicture(b) },
    ...(D.probeWindow ? { probe: async () => { const b = await D.probeWindow!(); if (!b) throw new Error('no picture'); return appPicture(b) } } : {}),
  }
}

export function createLive(h: LiveHandlers): Live {
  let worker: Worker | null = null, win: WindowShare | null = null, stopPage: (() => void) | null = null, pageLoop: ReturnType<typeof createLiveLoop> | null = null
  // (Vorax Helper) watching the screen: a picture after every move even without the log's detail lines
  let watchTimer: ReturnType<typeof setInterval> | null = null, watchBusy = false, snapping = 0, rebase = true, firstLook = false
  let watch = createWatch()
  // (Vorax Helper) the window capture refused, the app's own pictures in use instead (they need no screen share)
  let appPictures = false, winIsScreen = false
  // (Vorax Helper) with the game window shared, a look is a frame of a running video (a few ms), so the screen is
  // looked at every FAST_MS and a move counts as over sooner, as tli-tools' Tartarus overlay does; the app's own
  // pictures (no share) cost more and keep the slower pace
  const watchEvery = () => (win ? FAST_MS : appPictures ? PRINT_MS : WATCH_MS)
  const startWatch = () => {
    if (watchTimer) clearInterval(watchTimer)
    watch = createWatch(win ? FAST_WATCH : appPictures ? PRINT_WATCH : {})
    rebase = true
    watchTimer = setInterval(look, watchEvery())
  }
  const on = (e: LiveEvent) => {
    if (e.type === 'status') return h.onStatus(e)
    if (e.type !== 'snap') return
    const s = win ?? appGrab()
    if (!s) return
    // a watched change has already held still; a log trigger waits for the cards to land
    const take = e.kind === 'manual' || e.kind === 'watch' ? s.grab() : waitStable(() => s.grab())
    snapping++
    // (Vorax Helper) a failed picture is taken again once, plainly, rather than the move going unread until the next one
    take
      .catch(() => new Promise<void>(r => setTimeout(r, 120)).then(() => s.grab()))
      .then(img => h.onSnap(img, e.kind))
      .catch(err => h.onError(err instanceof Error ? `${err.name}: ${err.message}` : `picture failed (${String(err)})`))
      .finally(() => { snapping--; rebase = true })
  }
  const look = async () => {
    if (watchBusy || snapping) return
    const s = win ?? appGrab()
    if (!s) return
    // the board as it is when watching starts is read too, not only its changes
    if (firstLook) { firstLook = false; on({ type: 'snap', kind: 'watch', triggerAt: Date.now(), lines: [] }); return }
    watchBusy = true
    try {
      const img = await (s.probe ? s.probe() : s.grab())
      const t = watchThumb(img)
      if (rebase) { watch.setBase(t); rebase = false; return }
      if (watch.feed(t, Date.now())) on({ type: 'snap', kind: 'watch', triggerAt: Date.now(), lines: [] })
    } catch { /* no picture this time */ } finally { watchBusy = false }
  }
  return {
    connectLog(handle) {
      worker?.terminate()
      worker = blobWorker(SRC()!.live)
      worker.onmessage = (e: MessageEvent<LiveEvent>) => on(e.data)
      worker.postMessage({ type: 'start', handle, rules: DEFAULT_RULES })
    },
    // inside the desktop app: the app reads the log for the page, so the follower runs here (the app keeps
    // this window un-throttled) on a file-like view of it
    connectDesktop() {
      const b = (globalThis as unknown as { VoraxDesktop?: { logSize(): Promise<number | null>; readLog(a: number, b: number): Promise<ArrayBuffer> } }).VoraxDesktop
      if (!b) return
      worker?.terminate(); worker = null; stopPage?.()
      const handle: FileLike = { getFile: async () => { const size = (await b.logSize()) ?? 0; return { size, slice: (a: number, z?: number) => ({ arrayBuffer: () => b.readLog(a, z ?? size) }) } } }
      const loop = createLiveLoop({ follower: createFollower(handle), now: () => Date.now(), post: on, rules: DEFAULT_RULES })
      let busy = false
      const p = setInterval(async () => { if (busy) return; busy = true; try { await loop.poll() } finally { busy = false } }, POLL_MS)
      const c = setInterval(() => loop.check(), CHECK_MS)
      stopPage = () => { clearInterval(p); clearInterval(c) }
      pageLoop = loop
    },
    async share() {
      const D = (globalThis as unknown as { VoraxDesktop?: { printable?(): Promise<boolean>; useScreen?(): Promise<boolean>; useWindow?(): Promise<boolean>; gameOnScreen?(): Promise<{ x: number; y: number; w: number; h: number } | null> } }).VoraxDesktop
      try {
        // (Vorax Helper) a try after a refused one asks for the window again first
        appPictures = false
        winIsScreen = false
        await D?.useWindow?.().catch(() => false)
        try { win = await shareWindow() } catch (err) {
          // Windows refused the window capture (the app and the game at different privilege levels, say): in the
          // desktop app, share the game's screen and cut the game window out of each frame
          if (!D?.useScreen || (err as Error).name === 'NotAllowedError') throw err
          // (Vorax Helper) the app's own pictures of the game window (PrintWindow) leave the card and the highlight
          // visible to recordings (OBS); the screen share has to hide them, so it is the last resort
          if (await D.printable?.().catch(() => false)) { appPictures = true; if (watchTimer) startWatch(); return }
          await D.useScreen()
          // a moment for the refused capture to let go before the screen's starts (both failed at once, 2026-10-22)
          await new Promise(r => setTimeout(r, 800))
          win = await screenShare(D.gameOnScreen!)
          winIsScreen = true
        }
        win.onEnded(() => { win = null; worker?.postMessage({ type: 'cancel' }); pageLoop?.cancel(); if (watchTimer) startWatch(); h.onEnded() })
        if (watchTimer) startWatch()
      } catch (err) {
        if (err instanceof NotAWindowError) h.onError(err.message)
        else if ((err as Error).name !== 'NotAllowedError') h.onError(String(err))
      }
    },
    snapNow(kind = 'manual') {
      if (kind === 'after-click') return on({ type: 'snap', kind, triggerAt: Date.now(), lines: [] })
      if (pageLoop) pageLoop.snapNow(); else if (worker) worker.postMessage({ type: 'snapNow' }); else on({ type: 'snap', kind: 'manual', triggerAt: Date.now(), lines: [] })
    },
    // (Vorax Helper) what the last watched picture showed: the same board (a glowing hand, not a move) or a new one
    watchResult(sameBoard) { if (sameBoard) watch.falseAlarm(); else watch.settle() },
    watchScreen(onOff) {
      if (onOff && !watchTimer) { firstLook = true; startWatch() }
      if (!onOff && watchTimer) { clearInterval(watchTimer); watchTimer = null }
    },
    stop() { worker?.terminate(); worker = null; stopPage?.(); stopPage = null; pageLoop = null; win?.stop(); win = null; if (watchTimer) { clearInterval(watchTimer); watchTimer = null } },
    get sharing() { return !!win }, get appPictures() { return appPictures && !win },
    // (Vorax Helper) what the pictures show: the whole game window (the window share) or only its inside (the screen
    // share cut to it, the app's own pictures): the click helper and highlight place themselves on the same
    get frameArea() { return win && !winIsScreen ? 'window' as const : 'client' as const }, get following() { return !!worker || !!pageLoop }, get watching() { return !!watchTimer },
  }
}
export { newTracker, trackInstruments, createLiveLoop }

/** The game's screen, each frame cut down to where the game window sits on it. */
async function screenShare(where: () => Promise<{ x: number; y: number; w: number; h: number } | null>): Promise<WindowShare> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
  const track = stream.getVideoTracks()[0]
  const ended: (() => void)[] = []
  track.addEventListener('ended', () => ended.forEach(f => f()))
  const video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play()
  const cut = async () => {
    const W = video.videoWidth, H = video.videoHeight, r = await where().catch(() => null)
    const x = r ? Math.max(0, Math.round(r.x * W)) : 0, y = r ? Math.max(0, Math.round(r.y * H)) : 0
    return { x, y, w: r ? Math.min(W - x, Math.round(r.w * W)) : W, h: r ? Math.min(H - y, Math.round(r.h * H)) : H }
  }
  return {
    async probe() {
      const { x, y, w, h } = await cut(), pw = WATCH_W, ph = Math.max(1, Math.round((h * WATCH_W) / Math.max(1, w)))
      const c = document.createElement('canvas'); c.width = pw; c.height = ph
      const ctx = c.getContext('2d')!; ctx.drawImage(video, x, y, w, h, 0, 0, pw, ph)
      return ctx.getImageData(0, 0, pw, ph)
    },
    async grab() {
      const W = video.videoWidth, H = video.videoHeight, r = await where().catch(() => null)
      const x = r ? Math.max(0, Math.round(r.x * W)) : 0, y = r ? Math.max(0, Math.round(r.y * H)) : 0
      const w = r ? Math.min(W - x, Math.round(r.w * W)) : W, h = r ? Math.min(H - y, Math.round(r.h * H)) : H
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d')!; ctx.drawImage(video, x, y, w, h, 0, 0, w, h)
      return ctx.getImageData(0, 0, w, h)
    },
    stop: () => stream.getTracks().forEach(t => t.stop()),
    onEnded: fn => void ended.push(fn),
    get size() { return { width: video.videoWidth, height: video.videoHeight } },
  }
}
