// (Vorax Helper) Watching the screen itself for a move, as Tartarus's still-screen wait does, so a picture is taken
// after every move even when the game's log has no detail lines to trigger on (its Enable Log is off). A tiny grey
// thumbnail of the game is compared every WATCH_MS: when it has moved away from the last picture's and then held
// still for a couple of looks, the board is read again.
//
// Compared where a move always shows: the hand of cards (every move deals a new one). Measured on a player's
// frames (2560x1369, thumbnails 192 wide): the hand's brightest-changing 5% differ by 16-65 grey levels between
// two boards a move apart, and by about 10 between two looks at one board (candles, tank bubbles).
import type { Thumb } from './stable'

export const WATCH_MS = 450
export const WATCH_W = 192

/** A grey thumbnail WATCH_W wide. */
export function watchThumb(img: { width: number; height: number; data: Uint8ClampedArray }): Thumb {
  const w = WATCH_W, h = Math.max(1, Math.round((img.height * w) / img.width))
  const g = new Float32Array(w * h), n = new Float32Array(w * h)
  const sx = w / img.width, sy = h / img.height, d = img.data
  for (let y = 0; y < img.height; y++) {
    const row = Math.min(h - 1, Math.floor(y * sy)) * w
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4, t = row + Math.min(w - 1, Math.floor(x * sx))
      g[t] += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n[t]++
    }
  }
  for (let i = 0; i < g.length; i++) g[i] /= n[i] || 1
  return { w, h, g }
}

/** How much the hand's area changed: the mean of its 5% most-changed pixels (0-255). */
export function handChange(a: Thumb, b: Thumb): number {
  if (a.w !== b.w || a.h !== b.h) return 255
  const x0 = Math.floor(a.w * 0.38), x1 = Math.ceil(a.w * 0.72), y0 = Math.floor(a.h * 0.62), y1 = Math.ceil(a.h * 0.95)
  const d: number[] = []
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d.push(Math.abs(a.g[y * a.w + x] - b.g[y * a.w + x]))
  d.sort((p, q) => q - p)
  const k = Math.max(1, Math.floor(d.length * 0.05))
  let s = 0
  for (let i = 0; i < k; i++) s += d[i]
  return s / k
}

const ALARM_MS = 6000
const ALARM_NEED = 22
const ALARM_QUIET = 2000

export interface WatchOptions {
  /** handChange from the last picture that counts as a move */
  moved?: number
  /** difference between two looks in a row that counts as still */
  still?: number
  /** looks in a row that must be still */
  looks?: number
  /** the least time between two pictures it asks for */
  quietMs?: number
}

export function createWatch(o: WatchOptions = {}) {
  const { moved: MOVED = 15, still: STILL = 10, looks: LOOKS = 2, quietMs = 900 } = o
  let base: Thumb | null = null, prev: Thumb | null = null
  let moved = false, still = 0, lastFire = -Infinity
  // (Vorax Helper) a hand that only glows (the instrument cards' animated frames: 10-16 between looks on a player's
  // 2506x1440 frames) can look moved now and then: for ALARM_MS after a picture that showed the same board, a change
  // must beat that one a little (up to ALARM_NEED) and pictures come no closer than ALARM_QUIET, so a glowing hand
  // costs a read every couple of seconds at most. A dealt hand changes far more (66 there), so moves still fire.
  let need = MOVED, quiet = quietMs, peak = 0, lastPeak = 0, alarmUntil = -Infinity
  return {
    /** the screen as it was when the last picture was taken: changes are measured from it */
    setBase(t: Thumb) { base = t; prev = t; moved = false; still = 0; peak = 0 },
    /** one look; true when a picture should be taken now */
    feed(t: Thumb, now: number): boolean {
      if (!base) { this.setBase(t); return false }
      const step = prev ? handChange(prev, t) : 255
      prev = t
      const away = handChange(base, t)
      if (now > alarmUntil) { need = MOVED; quiet = quietMs }
      if (!moved && away > need) { moved = true; still = 0 }
      if (!moved) return false
      peak = Math.max(peak, away)
      still = step < STILL ? still + 1 : 0
      if (still < LOOKS || now - lastFire < quiet) return false
      lastFire = now
      lastPeak = peak
      this.setBase(t)
      return true
    },
    /** the last picture showed the same board: changes as big as that one don't count for a while */
    falseAlarm(now = Date.now()) { need = Math.min(ALARM_NEED, Math.max(need, lastPeak + 4)); quiet = Math.max(quietMs, ALARM_QUIET); alarmUntil = now + ALARM_MS },
    /** a picture showed a new board: back to the usual measure */
    settle() { need = MOVED; quiet = quietMs; alarmUntil = -Infinity },
  }
}
