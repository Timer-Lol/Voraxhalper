// Text on the screen as glyph boxes: the numbers under each tank, the round and the refreshes left.
// Each kind of text has its own colour, which keeps hearts, dice and the "/13" out of the glyphs.
import type { Rect } from '../types'
import { hsv, type Img } from './pixels'

export type TextKind = 'label' | 'round' | 'refresh'

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
const isRed = (r: number, g: number, b: number) => r > g + 60 && r > b + 50

/** Otsu's threshold over the luminance of a rect's pixels that pass `use`. */
function otsu(img: Img, r: Rect, use: (r: number, g: number, b: number) => boolean): number {
  const hist = new Array(256).fill(0)
  let n = 0
  for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(img.height, r.y + r.h); y++) {
    for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(img.width, r.x + r.w); x++) {
      const i = (y * img.width + x) * 4
      const [R, G, B] = [img.data[i], img.data[i + 1], img.data[i + 2]]
      if (!use(R, G, B)) continue
      hist[Math.round(lum(R, G, B))]++
      n++
    }
  }
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0, wB = 0, best = 0, at = 0
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = n - wB
    if (!wF) break
    sumB += t * hist[t]
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2
    if (between > best) {
      best = between
      at = t
    }
  }
  return at
}

function testFor(img: Img, r: Rect, kind: TextKind): (r: number, g: number, b: number) => boolean {
  if (kind === 'round') return (R, G, B) => { const [, s, v] = hsv(R, G, B); return s > 0.2 && v > 0.45 && R >= G && G >= B }
  if (kind === 'refresh') return (R, G, B) => { const [, s, v] = hsv(R, G, B); return s < 0.35 && v > 0.6 }
  const t = Math.max(60, 0.7 * otsu(img, r, (R, G, B) => !isRed(R, G, B)))
  return (R, G, B) => !isRed(R, G, B) && lum(R, G, B) > t
}

/**
 * Glyph boxes in a rect, left to right. Small text breaks apart under any brightness cut, so glyphs are the
 * runs of columns holding text pixels within the text's own row, not connected blobs.
 */
export function glyphs(img: Img, r: Rect, kind: TextKind): Rect[] {
  const test = testFor(img, r, kind)
  const x0 = Math.max(0, Math.floor(r.x)), x1 = Math.min(img.width, Math.ceil(r.x + r.w))
  const y0 = Math.max(0, Math.floor(r.y)), y1 = Math.min(img.height, Math.ceil(r.y + r.h))
  const w = x1 - x0, h = y1 - y0
  if (w <= 0 || h <= 0) return []
  const on = new Uint8Array(w * h)
  const rows = new Array(h).fill(0)
  const red = new Array(w).fill(0)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y0 + y) * img.width + x0 + x) * 4
    const [R, G, B] = [img.data[i], img.data[i + 1], img.data[i + 2]]
    if (test(R, G, B)) {
      on[y * w + x] = 1
      rows[y]++
    }
    if (R > G + 40) red[x]++
  }
  // the text's row: the run of rows holding the most text. (Vorax Helper: not the run around the single busiest
  // row: the flat feet of the line above, cut by the band's top edge, can make one busy row on their own, and
  // the digits below them were then missed: "6 x 186" read as "47444x474744")
  if (Math.max(...rows) === 0) return []
  let top = 0, bottom = -1, bestSum = -1
  for (let y = 0; y < h; ) {
    if (!rows[y]) { y++; continue }
    let e = y, sum = 0
    while (e < h && rows[e] > 0) sum += rows[e++]
    if (sum > bestSum) { bestSum = sum; top = y; bottom = e - 1 }
    y = e
  }
  const out: Rect[] = []
  let start = -1
  const flush = (end: number) => {
    let n = 0, ry0 = h, ry1 = -1, reddish = 0
    for (let x = start; x < end; x++) {
      reddish += red[x]
      for (let y = top; y <= bottom; y++) if (on[y * w + x]) {
        n++
        if (y < ry0) ry0 = y
        if (y > ry1) ry1 = y
      }
    }
    // a heart's anti-aliased rim can pass the test: its columns are mostly red
    if (n >= 3 && reddish < (end - start) * (bottom - top + 1) * 0.3) out.push({ x: x0 + start, y: y0 + ry0, w: end - start, h: ry1 - ry0 + 1 })
    start = -1
  }
  for (let x = 0; x < w; x++) {
    let any = false
    for (let y = top; y <= bottom && !any; y++) if (on[y * w + x]) any = true
    if (any && start < 0) start = x
    if (!any && start >= 0) flush(x)
  }
  if (start >= 0) flush(w)
  if (kind === 'refresh') {
    // Shelley's portrait can reach into the box from the left: the count is the right-most glyph of a
    // digit's height (about 0.37 of the box at any size; her hair can be taller)
    const last = out.filter(g => g.h >= 0.25 * h && g.h <= 0.5 * h).pop()
    return last ? [last] : []
  }
  // a bright sliver of a heart's rim next to the digits is short and narrow; an x is short but digit-wide
  const tall = Math.max(0, ...out.map(g => g.h))
  const widths = out.map(g => g.w).sort((a, b) => a - b)
  const typicalW = widths[Math.floor(widths.length / 2)] ?? 0
  const kept = out.filter(g => !(g.h < 0.6 * tall && g.w < 0.55 * typicalW))
  // digits share their top and bottom: a bright bit of the heart's tail touching one stretches its box
  const mid = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
  const typicalH = mid(kept.map(g => g.h))
  const clean = kept.filter(g => g.h >= 0.8 * typicalH && g.h <= 1.15 * typicalH)
  const rowTop = clean.length >= 2 ? mid(clean.map(g => g.y)) : -1
  const rowBottom = clean.length >= 2 ? mid(clean.map(g => g.y + g.h - 1)) : -1
  const clipped = kept.map(g => {
    if (rowTop < 0 || g.h <= 1.15 * typicalH) return g
    const y0 = Math.max(g.y, rowTop)
    const y1 = Math.min(g.y + g.h - 1, rowBottom)
    return y1 > y0 ? { ...g, y: y0, h: y1 - y0 + 1 } : g
  })
  const split = splitWide(clipped, x => {
    let n = 0
    for (let y = top; y <= bottom; y++) n += on[y * w + x - x0]
    return n
  })
  return kind === 'label' ? onTheLine(split, typicalH, rowBottom) : split
}

/**
 * A tank label's glyphs without bright bits around it: a candle under the tank flickers into the band as a
 * glyph or two, lower than the text and a gap away (1x36 read as 1x3621, 66x319 as 66x319661). The line
 * is the longest run of glyphs on the text's bottom row with less than a glyph's height between them.
 */
function onTheLine(gs: Rect[], typicalH: number, rowBottom: number): Rect[] {
  // (Vorax Helper) the bottom most glyphs share, not the median one: with a few bright bits lower down, as on a small
  // 2558x1367 window, the median was theirs and the line's own glyphs were dropped ("5 x 49" read as "49")
  if (rowBottom >= 0) {
    const near = (b: number) => gs.filter(g => Math.abs(g.y + g.h - 1 - b) <= Math.max(1, 0.2 * typicalH)).length
    rowBottom = gs.map(g => g.y + g.h - 1).reduce((best, b) => (near(b) > near(best) ? b : best), rowBottom)
  }
  const onRow = rowBottom < 0 ? gs : gs.filter(g => Math.abs(g.y + g.h - 1 - rowBottom) <= Math.max(1, 0.3 * typicalH))
  const runs: Rect[][] = []
  for (const g of onRow) {
    const run = runs[runs.length - 1]
    const last = run?.[run.length - 1]
    if (last && g.x - (last.x + last.w) < typicalH) run.push(g)
    else runs.push([g])
  }
  return runs.reduce<Rect[]>((best, run) => (run.length > best.length ? run : best), [])
}

/** Glyphs much wider than the typical one are touching digits: split them at their thinnest columns. */
function splitWide(gs: Rect[], density: (x: number) => number): Rect[] {
  if (!gs.length) return gs
  // a digit is about 0.62 of its height wide; a narrow 1 would make a width median useless
  const heights = gs.map(g => g.h).sort((a, b) => a - b)
  const typical = 0.62 * heights[Math.floor(heights.length / 2)]
  return gs.flatMap(g => {
    // sized a little wide: some digits (a 4) are broader than the typical one
    const parts = Math.round(g.w / (typical * 1.15))
    if (g.w < 1.6 * typical || parts < 2) return [g]
    const cuts: number[] = []
    for (let p = 1; p < parts; p++) {
      const aim = g.x + (g.w * p) / parts
      let best = Math.round(aim), low = Infinity
      for (let x = Math.round(aim - typical / 3); x <= Math.round(aim + typical / 3); x++) {
        const d = density(x)
        if (d < low) {
          low = d
          best = x
        }
      }
      cuts.push(best)
    }
    // the thinnest column itself belongs to neither digit
    const starts = [g.x, ...cuts.map(c => c + 1)]
    const ends = [...cuts, g.x + g.w]
    return starts.map((x, i) => ({ x, y: g.y, w: ends[i] - x, h: g.h })).filter(p => p.w > 0.25 * typical)
  })
}

/** Mean colour of the brightest 5% of a rect's pixels (by their strongest channel): the colour of its text. */
export function brightest(img: Img, r: Rect): [number, number, number] {
  const px: [number, number, number][] = []
  for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(img.height, r.y + r.h); y++) {
    for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(img.width, r.x + r.w); x++) {
      const i = (y * img.width + x) * 4
      px.push([img.data[i], img.data[i + 1], img.data[i + 2]])
    }
  }
  px.sort((a, b) => Math.max(...b) - Math.max(...a))
  const top = px.slice(0, Math.max(1, Math.floor(px.length / 20)))
  return [0, 1, 2].map(c => Math.round(top.reduce((s, p) => s + p[c], 0) / top.length)) as [number, number, number]
}
