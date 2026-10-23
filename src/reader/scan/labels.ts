// (Vorax Helper) Where the tanks' labels really are, found from the red heart icons that head their total and
// Activity x Quantity rows. The layout places the labels by screen shape, measured on 16:9 and 21:9 frames and
// blended between; a 16:10 or 32:9 screen frames the 3D scene differently, so the labels are looked for, and the
// layout moved onto them when they are found clearly somewhere else.
import type { Rect } from '../types'
import type { Layout } from './layout'
import { blobs, type Img } from './pixels'

/** A heart: saturated red (the glass behind the tanks is a dark red that fails r > 140; a Boss name's red is thin text). */
const isHeart = (r: number, g: number, b: number) => r > 140 && r - g > 60 && r - b > 60

export interface TankFix {
  /** each tank's label centre x (frame px), from its hearts, or the layout's where none were seen */
  cx: number[]
  /** how far down (frame px) the label rows sit from the layout's */
  dy: number
  /** how many tanks' hearts were seen, and how far (px) the labels sit from the layout on average */
  found: number
  off: number
}

/** The labels' places from the hearts; null when fewer than two tanks' hearts are seen. */
export function findLabels(img: Img, l: Layout): TankFix | null {
  const s = l.height / 1440
  // the rows around where the layout expects the hearts, with room for a screen shape that puts them elsewhere
  // (not up to the archetype icon's row: an Agito's icon is red too)
  const y0 = Math.max(0, l.totalBand[0].y - 40 * s), y1 = Math.min(img.height, l.aqBand[0].y + l.aqBand[0].h + 60 * s)
  const bs = blobs(img, { x: 0, y: y0, w: img.width, h: y1 - y0 }, isHeart)
    .filter(b => b.w >= 8 * s && b.w <= 34 * s && b.h >= 8 * s && b.h <= 62 * s)
  // the total's heart sits right over the Activity x Quantity's, touching it on most frames (one blob of about
  // twice a heart's height), apart on others (two blobs 12-36 px apart)
  const pairs: { x: number; top: number; bottom: number }[] = []
  for (const a of bs) {
    if (a.h >= 26 * s && a.h <= 62 * s && a.w <= a.h) { pairs.push({ x: a.x + a.w / 2, top: a.y + a.h * 0.27, bottom: a.y + a.h * 0.75 }); continue }
    if (a.h > 34 * s) continue
    for (const b of bs) {
      if (a === b || b.h > 34 * s) continue
      const dx = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)), dy = b.y + b.h / 2 - (a.y + a.h / 2)
      if (dx <= 16 * s && dy >= 12 * s && dy <= 36 * s && Math.max(a.w, b.w) / Math.min(a.w, b.w) < 1.6) pairs.push({ x: (a.x + a.w / 2 + b.x + b.w / 2) / 2, top: a.y + a.h / 2, bottom: b.y + b.h / 2 })
    }
  }
  // the labels share their rows: the biggest group of pairs with the same top row is the tanks'
  let best: typeof pairs = []
  for (const p of pairs) { const g = pairs.filter(q => Math.abs(q.top - p.top) <= 6 * s); if (g.length > best.length) best = g }
  pairs.splice(0, pairs.length, ...best)
  pairs.sort((p, q) => p.x - q.x)
  // one per tank: pairs closer than half a tank apart are the same label
  const tanks: typeof pairs = []
  for (const p of pairs) if (!tanks.length || p.x - tanks[tanks.length - 1].x > 120 * s) tanks.push(p)
  if (tanks.length < 2 || tanks.length > 6) return null
  // the heart sits left of the numbers: the label's centre is a little right of it
  const HEART_TO_CENTRE = 16 * s
  const cxFound = tanks.map(t => t.x + HEART_TO_CENTRE)
  // which tank each is: the nearest of the layout's, each layout tank taken once (in order, since both are sorted)
  const idx: number[] = []
  let j = 0
  for (const x of cxFound) { while (j < 5 && Math.abs(l.tankCx[j + 1] - x) < Math.abs(l.tankCx[j] - x)) j++; idx.push(j); j++ }
  if (new Set(idx).size !== idx.length) return null
  // the rows: the hearts' centres against the layout's total/aq band centres
  const totalMid = l.totalBand[0].y + l.totalBand[0].h / 2, aqMid = l.aqBand[0].y + l.aqBand[0].h / 2
  const dy = tanks.reduce((a, t) => a + (t.top - totalMid + (t.bottom - aqMid)) / 2, 0) / tanks.length
  // a found label far from its layout place is some other red thing: no fix from this picture
  if (idx.some((i, k) => Math.abs(cxFound[k] - l.tankCx[i]) > 150 * s)) return null
  // the other tanks (empty ones have no hearts): moved as far as the found ones on average; with four or more found,
  // along the line through them (the spacing is about even, a little wider to the right)
  const cx = l.tankCx.slice()
  const n = idx.length, mi = idx.reduce((a, b) => a + b, 0) / n, mx = cxFound.reduce((a, b) => a + b, 0) / n
  const meanDx = idx.reduce((a, i, k) => a + (cxFound[k] - l.tankCx[i]), 0) / n
  let num = 0, den = 0
  idx.forEach((i, k) => { num += (i - mi) * (cxFound[k] - mx); den += (i - mi) * (i - mi) })
  for (let i = 0; i < 6; i++) cx[i] = n >= 4 && den ? mx + (num / den) * (i - mi) : l.tankCx[i] + meanDx
  idx.forEach((i, k) => { cx[i] = cxFound[k] })
  const off = Math.max(Math.abs(dy), ...idx.map((i, k) => Math.abs(cxFound[k] - l.tankCx[i])))
  return { cx, dy, found: tanks.length, off }
}

/** The layout with its tank labels moved onto where the hearts put them. */
export function withLabels(l: Layout, fix: TankFix): Layout {
  const mv = (r: Rect, x: number): Rect => ({ ...r, x: r.x + x, y: r.y + fix.dy })
  const d = fix.cx.map((x, i) => x - l.tankCx[i])
  return {
    ...l,
    tankCx: fix.cx.slice(),
    icon: l.icon.map((r, i) => mv(r, d[i])),
    nameBand: l.nameBand.map((r, i) => mv(r, d[i])),
    totalBand: l.totalBand.map((r, i) => mv(r, d[i])),
    aqBand: l.aqBand.map((r, i) => mv(r, d[i])),
  }
}

/** Taken only when the labels sit clearly off the layout's places (reference px): less is the layout's own tolerance. */
export const LABEL_MIN_OFF = 24
