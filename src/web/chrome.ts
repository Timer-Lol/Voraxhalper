// Windowed games come with a title bar above and, in desktop screenshots, the taskbar below. The reader's
// layout assumes the frame is all game, so these strips are found and cut off first. A strip counts only when
// it is flat and ends in a sharp brightness step: the game's own black edges (letterboxing, vignette) have no
// such step and are left alone. The scanner still checks that the cut reading is the more confident one.

export interface Crop { top: number; bottom: number; left?: number; right?: number }
type Px = { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

function rowStats(img: Px, y: number) {
  const L: number[] = []
  for (let x = 0; x < img.width; x += 4) { const i = (y * img.width + x) * 4; L.push(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]) }
  L.sort((a, b) => a - b)
  const med = L[L.length >> 1]
  return { mean: L.reduce((a, b) => a + b, 0) / L.length, uni: L.filter(v => Math.abs(v - med) < 12).length / L.length }
}

const STEP = 8

export function findChrome(img: Px): Crop {
  const h = img.height, s = h / 1440
  const maxTop = Math.round(70 * s) + 10, maxBottom = Math.round(100 * s) + 10
  const rows = new Map<number, ReturnType<typeof rowStats>>()
  const row = (y: number) => { let r = rows.get(y); if (!r) { r = rowStats(img, y); rows.set(y, r) } return r }

  // title bar: flat rows from the top, then a step
  let top = 0
  if (row(0).uni >= 0.9) {
    for (let y = 1; y < Math.min(maxTop, h); y++) {
      if (Math.abs(row(y).mean - row(y - 1).mean) >= STEP) { if (y >= 12 * s) top = y; break }
      if (row(y).uni < 0.85) break
    }
  }
  // taskbar: a step near the bottom, with fairly flat rows beneath it
  let bottom = 0
  for (let y = h - maxBottom; y < h - 4; y++) {   // down to a sliver: a window cut a little low shows a few rows of taskbar
    if (y <= top + 1) continue
    if (Math.abs(row(y).mean - row(y - 1).mean) < STEP) continue
    let u = 0, n = 0
    for (let k = y; k < h; k += 2) { u += row(k).uni; n++ }
    if (u / n >= 0.7 && row(y - 1).uni >= 0.6) { bottom = h - y; break }
  }
  // side borders of a window that isn't maximised: a few flat columns at both edges, ending in a step
  const col = (x: number) => { let m = 0, n = 0; for (let y = top; y < h - bottom; y += 4) { const i = (y * img.width + x) * 4; m += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; n++ } return m / n }
  const side = (edge: (k: number) => number) => { const max = Math.round(16 * s) + 2; for (let k = 1; k < max; k++) if (Math.abs(col(edge(k)) - col(edge(k - 1))) >= STEP * 2) return k; return 0 }
  const left = side(k => k), right = side(k => img.width - 1 - k)
  // a border shows on both sides alike; a lone step is the game's own picture
  const both = left && right && Math.abs(left - right) <= 2
  return { top, bottom, left: both ? left : 0, right: both ? right : 0 }
}

export const hasCrop = (c: Crop) => !!(c.top || c.bottom || c.left || c.right)

export function cropRows<T extends Px>(img: T, c: Crop): ImageData | T {
  if (!hasCrop(c)) return img
  const x0 = c.left ?? 0, w = img.width - x0 - (c.right ?? 0), h = img.height - c.top - c.bottom
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((c.top + y) * img.width + x0) * 4, ((c.top + y) * img.width + x0 + w) * 4), y * w * 4)
  return typeof ImageData !== 'undefined' ? new ImageData(data, w, h) : ({ width: w, height: h, data } as unknown as T)
}

/** The crop from the window's own measurements (the desktop app provides them), as rows and columns. */
export function cropFromArea(frame: { width: number; height: number }, r: { x: number; y: number; w: number; h: number }): Crop {
  return { top: Math.round(r.y), bottom: Math.max(0, frame.height - Math.round(r.y + r.h)), left: Math.round(r.x), right: Math.max(0, frame.width - Math.round(r.x + r.w)) }
}
