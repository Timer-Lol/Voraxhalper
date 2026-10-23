// Pixel helpers for the screenshot reader. Pure functions over ImageData-shaped images, so the browser and
// the Node build/test scripts share them.
import type { Rect } from '../types'

export interface Img { width: number; height: number; data: Uint8ClampedArray }
export interface ArtFeature { hist: number[]; grid: number[] }

export function gray(img: Img): Float32Array {
  const n = img.width * img.height
  const g = new Float32Array(n)
  const d = img.data
  for (let i = 0; i < n; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  return g
}

/** Hue 0-360, saturation and value 0-1. */
export function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max ? d / max : 0, max / 255]
}

export function crop(img: Img, r: Rect): Img {
  const x0 = Math.max(0, Math.round(r.x))
  const y0 = Math.max(0, Math.round(r.y))
  const w = Math.max(1, Math.min(img.width - x0, Math.round(r.w)))
  const h = Math.max(1, Math.min(img.height - y0, Math.round(r.h)))
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4)
  return { width: w, height: h, data }
}

/** (Vorax Helper) The source columns (or rows) a bilinear resize from n to m reads: patch() need sample no others. */
export function resizeTaps(n: number, m: number): number[] {
  const out = new Set<number>()
  const sc = n / m
  for (let x = 0; x < m; x++) {
    const f = Math.min(n - 1, Math.max(0, (x + 0.5) * sc - 0.5))
    const x0 = Math.floor(f)
    out.add(x0)
    out.add(Math.min(n - 1, x0 + 1))
  }
  return [...out].sort((a, b) => a - b)
}

/** Bilinear resize. */
export function resize(img: Img, w: number, h: number): Img {
  const data = new Uint8ClampedArray(w * h * 4)
  const sx = img.width / w
  const sy = img.height / h
  for (let y = 0; y < h; y++) {
    const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(img.height - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(img.width - 1, x0 + 1)
      const tx = fx - x0
      for (let c = 0; c < 4; c++) {
        const a = img.data[(y0 * img.width + x0) * 4 + c] * (1 - tx) + img.data[(y0 * img.width + x1) * 4 + c] * tx
        const b = img.data[(y1 * img.width + x0) * 4 + c] * (1 - tx) + img.data[(y1 * img.width + x1) * 4 + c] * tx
        data[(y * w + x) * 4 + c] = a * (1 - ty) + b * ty
      }
    }
  }
  return { width: w, height: h, data }
}

/** Connected (4-way) groups of pixels passing `test` inside a rect, as bounding boxes in reading order. */
export function blobs(img: Img, r: Rect, test: (r: number, g: number, b: number) => boolean): Rect[] {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(img.width, Math.ceil(r.x + r.w))
  const y1 = Math.min(img.height, Math.ceil(r.y + r.h))
  const w = x1 - x0
  const h = y1 - y0
  if (w <= 0 || h <= 0) return []
  const on = new Uint8Array(w * h)
  const d = img.data
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y0 + y) * img.width + x0 + x) * 4
    on[y * w + x] = test(d[i], d[i + 1], d[i + 2]) ? 1 : 0
  }
  const out: Rect[] = []
  const stack: number[] = []
  for (let start = 0; start < on.length; start++) {
    if (on[start] !== 1) continue
    let minX = w, minY = h, maxX = -1, maxY = -1
    on[start] = 2
    stack.push(start)
    while (stack.length) {
      const p = stack.pop()!
      const px = p % w
      const py = (p - px) / w
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
      for (const q of [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1]) {
        if (q >= 0 && on[q] === 1) {
          on[q] = 2
          stack.push(q)
        }
      }
    }
    out.push({ x: x0 + minX, y: y0 + minY, w: maxX - minX + 1, h: maxY - minY + 1 })
  }
  return out
}

function sample(g: Float32Array, w: number, h: number, x: number, y: number): number {
  x = Math.min(w - 1.001, Math.max(0, x))
  y = Math.min(h - 1.001, Math.max(0, y))
  const xi = x | 0
  const yi = y | 0
  const fx = x - xi
  const fy = y - yi
  const i = yi * w + xi
  return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy
}

export const GLYPH = { w: 12, h: 16 }

/** A glyph as a small zero-mean, unit-length grid, scaled by the line height so a narrow 1 stays narrow. */
export function glyphVector(g: Float32Array, w: number, h: number, box: Rect, lineH: number): Float32Array {
  const v = new Float32Array(GLYPH.w * GLYPH.h)
  const scale = Math.max(box.h, lineH * 0.7) / GLYPH.h
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const sub = Math.max(1, Math.min(4, Math.round(scale)))
  let mean = 0
  for (let j = 0; j < GLYPH.h; j++) for (let i = 0; i < GLYPH.w; i++) {
    let s = 0
    for (let b = 0; b < sub; b++) for (let a = 0; a < sub; a++)
      s += sample(g, w, h, cx + (i + (a + 0.5) / sub - GLYPH.w / 2) * scale - 0.5, cy + (j + (b + 0.5) / sub - GLYPH.h / 2) * scale - 0.5)
    v[j * GLYPH.w + i] = s / (sub * sub)
    mean += v[j * GLYPH.w + i]
  }
  mean /= v.length
  let norm = 0
  for (let i = 0; i < v.length; i++) {
    v[i] -= mean
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

/** A picture's colours (4x4x4 histogram) and layout (8x8 grey grid), for matching card art and icons. */
export function artFeature(img: Img, r: Rect): ArtFeature {
  const c = crop(img, r)
  const hist = new Array(64).fill(0)
  const grid = new Array(64).fill(0)
  const n = new Array(64).fill(0)
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4
    const [R, G, B] = [c.data[i], c.data[i + 1], c.data[i + 2]]
    hist[(R >> 6) * 16 + (G >> 6) * 4 + (B >> 6)]++
    const cell = Math.min(7, Math.floor((y * 8) / c.height)) * 8 + Math.min(7, Math.floor((x * 8) / c.width))
    grid[cell] += 0.299 * R + 0.587 * G + 0.114 * B
    n[cell]++
  }
  const total = c.width * c.height
  return { hist: hist.map(v => v / total), grid: grid.map((v, i) => v / (n[i] || 1)) }
}

function cosine(a: number[], b: number[]): number {
  let ab = 0, aa = 0, bb = 0
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i]
    aa += a[i] * a[i]
    bb += b[i] * b[i]
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0
}

const centered = (a: number[]) => {
  const m = a.reduce((s, v) => s + v, 0) / a.length
  return a.map(v => v - m)
}
/** (Vorax Helper) each feature's centred grid worked out once: a card is compared with every reference at 63 offsets */
const centredOf = new WeakMap<number[], number[]>()
const centredGrid = (a: number[]) => centredOf.get(a) ?? (centredOf.set(a, centered(a)), centredOf.get(a)!)

export const similarity = (a: ArtFeature, b: ArtFeature) =>
  0.5 * cosine(a.hist, b.hist) + 0.5 * (0.5 + 0.5 * cosine(centredGrid(a.grid), centredGrid(b.grid)))

/** A rect's grey layout as a zero-mean, unit-length 48x8 grid: tells apart text lines such as headers. */
export function signature(img: Img, r: Rect, w = 48, h = 8): number[] {
  const g = gray(resize(crop(img, r), w, h))
  const mean = g.reduce((s, v) => s + v, 0) / g.length
  const v = Array.from(g, x => x - mean)
  const norm = Math.hypot(...v) || 1
  return v.map(x => x / norm)
}

/**
 * A rect given in a tilted object's own frame (x right, y down, origin at its centre), sampled out of the
 * image and straightened: the hand's cards are fanned a few degrees each way.
 */
export function patch(img: Img, cx: number, cy: number, angle: number, r: Rect, scale = 1, only?: { xs: number[]; ys: number[] }): Img {
  const w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h))
  const data = new Uint8ClampedArray(w * h * 4)
  const c = Math.cos(angle), s = Math.sin(angle)
  const src = img.data, W = img.width, xMax = img.width - 1.001, yMax = img.height - 1.001
  // (Vorax Helper) the same sums as before, written out: about four times faster than a helper per channel
  // only: just these columns and rows are sampled (the rest stay 0), for a patch that is shrunk straight after
  const xs = only?.xs, ys = only?.ys
  const nj = ys ? ys.length : h, ni = xs ? xs.length : w
  for (let jj = 0; jj < nj; jj++) for (let ii = 0; ii < ni; ii++) {
    const j = ys ? ys[jj] : jj, i = xs ? xs[ii] : ii
    const u = (r.x + i + 0.5) * scale, v = (r.y + j + 0.5) * scale
    const x = Math.min(xMax, Math.max(0, cx + u * c - v * s - 0.5))
    const y = Math.min(yMax, Math.max(0, cy + u * s + v * c - 0.5))
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0
    const a = (y0 * W + x0) * 4, b = a + W * 4, o = (j * w + i) * 4
    for (let k = 0; k < 4; k++) data[o + k] = (src[a + k] * (1 - fx) + src[a + 4 + k] * fx) * (1 - fy) + (src[b + k] * (1 - fx) + src[b + 4 + k] * fx) * fy
  }
  return { width: w, height: h, data }
}
