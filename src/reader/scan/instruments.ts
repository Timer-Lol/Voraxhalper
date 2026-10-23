// The equipped instruments, from the icons in the top-right panel. They fill from the right, newest on the
// right, so reading stops at the first empty slot. Icons are compared as small grey patterns: two of them
// are grey brains that differ only in their shape (one sits on a tray), which colours can't tell apart.
import type { FieldRead, Rect } from '../types'
import type { ScanData } from './data'
import type { Layout } from './layout'
import { signature, type Img } from './pixels'
import learned from './learnedIcons.json'
import { iconSimilarity } from './iconMatch'

// An empty slot is dark glass: under 0.2% of its pixels are bright, against at least 2% for any icon, at
// every screen size measured. Matching empty slots against pictures of empty slots didn't carry over to
// 16:9, whose background differs.
const BRIGHT = 60
const FILLED_MIN = 0.008

export function holdsAnIcon(img: Img, r: Rect): boolean {
  const x0 = Math.floor(r.x)
  const y0 = Math.floor(r.y)
  let n = 0
  for (let y = y0; y < Math.min(img.height, y0 + r.h); y++)
    for (let x = x0; x < Math.min(img.width, x0 + r.w); x++) {
      const i = (y * img.width + x) * 4
      if (Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) >= BRIGHT) n++
    }
  return n / (r.w * r.h) >= FILLED_MIN
}

// compared lined up (iconMatch): pictures of one instrument score 0.97 typically, another instrument's under 0.80 in
// 99 cases of 100, so sure among all of them takes a clear lead; the tracker, choosing among the 3 offered, needs less
const ICON_MIN = 0.85
const ICON_GAP = 0.08

/** An icon as a zero-mean, unit-length 24x24 grey pattern. */
export const iconPattern = (img: Img, r: Rect) => signature(img, r, 24, 24)


/** The permanent item at the oldest end of some players' panels (a teal ewer): not an instrument, skipped. */
export const STARTING_ITEM = '(starting item)'

/** Panel icons a player named in this browser (WhichPick), kept under `icon:${name}` beside the named cards. */
export const ICON_PREFIX = 'icon:'

/** The built-in panel icons, with the ones players taught that were confirmed (scripts/live/mergeIcons.ts). */
export function allIcons(data: Pick<ScanData, 'instrumentIcons'>): Record<string, number[][]> {
  const icons: Record<string, number[][]> = { ...data.instrumentIcons }
  for (const [name, vs] of Object.entries(learned as Record<string, number[][]>)) icons[name] = [...(icons[name] ?? []), ...vs]
  return icons
}

// Cards named in the browser are whole-card pictures, not panel icons, so only the icon: entries take part.
export function readInstruments(img: Img, l: Layout, data: ScanData, local: Record<string, unknown[]> = {}): { names: string[]; fields: Record<string, FieldRead>; ranks: [string, number][][]; known: string[] } {
  const icons = allIcons(data)
  for (const [k, vs] of Object.entries(local)) if (k.startsWith(ICON_PREFIX)) icons[k.slice(ICON_PREFIX.length)] = [...(icons[k.slice(ICON_PREFIX.length)] ?? []), ...(vs as number[][])]
  const fromRight: string[] = []
  const reads: FieldRead[] = []
  const ranksFromRight: [string, number][][] = []
  for (const r of l.instrumentIcon) {
    if (!holdsAnIcon(img, r)) break
    const p = iconPattern(img, r)
    const lined = new Map<string, number[]>()
    const ranked = Object.entries(icons).filter(([n]) => n !== 'none').map(([n, vs]) => [n, Math.max(...vs.map(v => iconSimilarity(v, p, lined)))] as [string, number]).sort((a, b) => b[1] - a[1])
    if (ranked[0][0] === STARTING_ITEM) continue
    fromRight.push(ranked[0][0])
    ranksFromRight.push(ranked.filter(([n]) => n !== STARTING_ITEM))
    reads.push({ sure: ranked[0][1] >= ICON_MIN && ranked[0][1] - (ranked[1]?.[1] ?? 0) >= ICON_GAP, guess: ranked[0][0], score: ranked[0][1], second: ranked[1]?.[1] })
  }
  const names = fromRight.reverse()
  const fields: Record<string, FieldRead> = {}
  reads.reverse().forEach((f, i) => (fields[`instrument${i}`] = f))
  return { names, fields, ranks: ranksFromRight.reverse(), known: Object.keys(icons).filter(n => n !== 'none' && n !== STARTING_ITEM) }
}
