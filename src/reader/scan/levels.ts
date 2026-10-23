// Colour correction: a capture through Windows HDR, another gamma or brightness shifts every level of the
// picture, which breaks reads tuned on fixed colours (the digits beside the heart, a name's rarity). Each
// frame is mapped so its levels spread like a normal capture's (levels.json), with one curve for all three
// channels so hues stay as they are. On frames recoloured as HDR, every field read as on the true colours.
// A normal capture is left alone: boards differ (empty tanks, other cards), and pulling every frame to the
// average misread 5 of the 141 labelled frames.
import type { Rect } from '../types'
import type { Layout } from './layout'
import type { Img } from './pixels'

/** Where the levels are measured: the parts the reader looks at (as the test fixtures keep them). */
export const readAreas = (l: Layout): Rect[] => [...l.icon, ...l.nameBand, ...l.totalBand, ...l.aqBand, ...l.cardFace, l.header, l.refresh, l.round, ...l.instrumentIcon]

/** For each level 0-255, the share of the channel values (all three pooled) at or below it, in `areas` or the whole frame. */
export function levels(img: Img, areas: Rect[] = [{ x: 0, y: 0, w: img.width, h: img.height }]): number[] {
  const h = new Array(256).fill(0)
  let n = 0
  for (const r of areas) {
    const x0 = Math.max(0, Math.floor(r.x)), x1 = Math.min(img.width, Math.ceil(r.x + r.w))
    for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(img.height, Math.ceil(r.y + r.h)); y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * img.width + x) * 4
        h[img.data[i]]++
        h[img.data[i + 1]]++
        h[img.data[i + 2]]++
        n += 3
      }
  }
  let below = 0
  return h.map(c => (below += c) / n)
}

/** The frame with its levels mapped to spread like `ref` (histogram matching), the same curve on every channel. */
export function matchLevels(img: Img, ref: number[], areas?: Rect[]): Img {
  const src = levels(img, areas)
  const curve = new Uint8Array(256)
  for (let v = 0, w = 0; v < 256; v++) {
    // the middle of level v's share, and the level that holds that share in the reference
    const p = ((v ? src[v - 1] : 0) + src[v]) / 2
    while (w < 255 && ref[w] < p) w++
    const lo = w ? ref[w - 1] : 0
    curve[v] = Math.max(0, Math.min(255, Math.round(w - 0.5 + (ref[w] > lo ? (p - lo) / (ref[w] - lo) : 0.5))))
  }
  const d = new Uint8ClampedArray(img.data.length)
  for (let i = 0; i < d.length; i += 4) {
    d[i] = curve[img.data[i]]
    d[i + 1] = curve[img.data[i + 1]]
    d[i + 2] = curve[img.data[i + 2]]
    d[i + 3] = img.data[i + 3]
  }
  return { width: img.width, height: img.height, data: d }
}

/** How far a frame's levels are from normal: the largest gap between the two curves. The labelled frames
 *  measure 0.10 or less; recoloured as HDR or another gamma, 0.26 or more. */
export const offNormal = (q: number[], ref: number[]) => Math.max(...q.map((v, i) => Math.abs(v - ref[i])))

/** Just beyond what any normal capture measured (0.10): 0.2 left more brightness x1.25 frames uncorrected
 *  (57% of their numbers read, against 84%). */
export const OFF_NORMAL = 0.12

/** The frame with a normal capture's colours: as it is if it already has them, else matched to `ref`; with
 *  how far off it was. */
export function normalColours(img: Img, ref: number[], areas: Rect[]): { img: Img; off: number; corrected: boolean } {
  const off = offNormal(levels(img, areas), ref)
  return off > OFF_NORMAL ? { img: matchLevels(img, ref, areas), off, corrected: true } : { img, off, corrected: false }
}
