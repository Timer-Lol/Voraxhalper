// The cards' printed names, read with a text reader (OCR) and matched to the known names. A clearly read
// name outranks the picture match; when two names fit about as well (Potion Kit (Small) inside Rare Potion
// Kit (Small)), the picture picks between them; when nothing is read, the picture's answer stands.
import { POTIONS } from '@/data/potions'
import { INSTRUMENTS } from '@/data/instruments'
import { PROTOCOLS } from '@/data/protocols'
import { ALWAYS_TAKE } from '@/data/xenopanacea'
import type { FieldRead, Problem, Reading } from '../types'
import type { HandPhase } from './data'
import { handAt } from './cards'
import { cardFace, handK, handLayout, type CardPos } from './layout'
import { patch, type Img } from './pixels'

/** Reads the text in a picture (dark text on white). */
export type ReadText = (img: Img) => Promise<string>

/** Letters a name needs matched, and how far ahead of the next name, to be taken as read. */
const MIN_Q = 6
const GAP = 3

const NAMES: Record<HandPhase, readonly string[]> = {
  potion: [...POTIONS.map(p => p.name), ...ALWAYS_TAKE],
  instrument: INSTRUMENTS.map(i => i.name),
  protocol: PROTOCOLS,
}

const letters = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '')

/** For each start of p, the fewest edits that match it somewhere inside t. */
function prefixCosts(p: string, t: string): number[] {
  let prev = new Array<number>(t.length + 1).fill(0)
  const best = [0]
  for (let i = 1; i <= p.length; i++) {
    const row = [i]
    for (let j = 1; j <= t.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (p[i - 1] === t[j - 1] ? 0 : 1))
    best.push(Math.min(...row))
    prev = row
  }
  return best
}

/** How much of a name the text shows: its letters matched, less two for each mistake, less a half for each
 *  letter missing at its end (the next card in the fan can cover the end of a title). */
export function nameFit(name: string, text: string): { q: number } {
  const p = letters(name)
  const t = letters(text)
  if (!t.length) return { q: -Infinity }
  const c = prefixCosts(p, t)
  let q = -Infinity
  for (let i = Math.min(p.length, 6); i <= p.length; i++) q = Math.max(q, i - 2 * c[i] - 0.5 * (p.length - i))
  return { q }
}

// The title and the first lines below it, tall enough for a card raised by the mouse and wide enough for a
// hand spread by it (reference px around the card's middle).
const TITLE_AREA = { x: -140, y: -110, w: 280, h: 150 }
const ZOOM = 2
const BLUR = 8

/** A card's title area, straightened and enlarged, as dark text on white: each pixel's brightness above its
 *  neighbourhood's, so thin bright letters stand out whatever glows behind them. */
export function titleCrop(img: Img, c: CardPos, k: number): Img {
  const r = { x: TITLE_AREA.x * ZOOM, y: TITLE_AREA.y * ZOOM, w: TITLE_AREA.w * ZOOM, h: TITLE_AREA.h * ZOOM }
  const p = patch(img, c.cx, c.cy, c.angle, r, k / ZOOM)
  const W = p.width
  const H = p.height
  const g = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) g[i] = Math.max(p.data[i * 4], p.data[i * 4 + 1], p.data[i * 4 + 2])
  const sum = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sum[(y + 1) * (W + 1) + x + 1] = g[y * W + x] + sum[y * (W + 1) + x + 1] + sum[(y + 1) * (W + 1) + x] - sum[y * (W + 1) + x]
  const lift = new Float32Array(W * H)
  let top = 1
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - BLUR), x1 = Math.min(W, x + BLUR + 1), y0 = Math.max(0, y - BLUR), y1 = Math.min(H, y + BLUR + 1)
      const mean = (sum[y1 * (W + 1) + x1] - sum[y0 * (W + 1) + x1] - sum[y1 * (W + 1) + x0] + sum[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0))
      lift[y * W + x] = Math.max(0, g[y * W + x] - mean)
      top = Math.max(top, lift[y * W + x])
    }
  const data = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    const v = 255 - Math.min(255, (lift[i] / top) * 400)
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
  return { width: W, height: H, data }
}

const ranked = (phase: HandPhase, text: string) => NAMES[phase].map(n => [n, nameFit(n, text).q] as const).sort((a, b) => b[1] - a[1])
const settled = (r: (readonly [string, number])[]) => r[0][1] >= MIN_Q && r[0][1] - (r[1]?.[1] ?? -Infinity) >= GAP

/** Some of a hand's cards matched by their pictures: per position, the best few cards, that position's
 *  field, and whether no picture was close enough. */
export interface PictureRead { ranks: [string, number][]; field?: FieldRead; unknown: boolean }
export type Pictures = (phase: HandPhase, size: number, slots: number[]) => Promise<Record<number, PictureRead>>

const PHASES: HandPhase[] = ['potion', 'instrument', 'protocol']

/** The reading with each card's printed name added. pictures: matches the cards whose names can't be
 *  settled, when the reading left them out (handPending). */
export async function readTitles(img: Img, reading: Reading, readText: ReadText, pictures?: Pictures): Promise<Reading> {
  const read = reading.handRanks?.length ?? 0
  if ((!read && !reading.handPending) || reading.problems.some(p => p.kind === 'notFound' || p.kind === 'animating')) return reading
  const l = handLayout(img, reading.ui, reading.handShift)
  const header = reading.state.phase
  // rounds 1-10 never offer a protocol (Vorax Helper)
  const early = !!reading.fields.round?.sure && (reading.state.round ?? 99) <= 10
  const phases: HandPhase[] = reading.fields.phase?.sure ? [header] : PHASES.filter(p => !(early && p === 'protocol'))
  const titles = async (size: number) => {
    const texts = await Promise.all(handAt(l, size).map(c => readText(titleCrop(img, c, handK(l))).catch(() => '')))
    // A card raised by the mouse can cover the header: then the names say which pick it is.
    return phases
      .map(phase => {
        const slots = texts.map(t => ranked(phase, t))
        return { phase, size, slots, texts, fit: slots.reduce((s, r) => s + Math.max(0, r[0][1]), 0) }
      })
      .reduce((a, b) => (b.fit > a.fit ? b : a))
  }
  const { phase, size, slots, texts } = await titles(read || reading.handSize || 3)
  const pos = handAt(l, size)

  // the cards the names don't settle, by their pictures: the reading's own when it has them for this hand
  const need = slots.flatMap((r, j) => (settled(r) ? [] : [j]))
  const fromReading = read === size && phase === header
  const pics: Record<number, PictureRead> = fromReading
    ? Object.fromEntries(need.map(j => [j, { ranks: reading.handRanks![j], field: reading.fields[`hand${j}`], unknown: reading.problems.some(p => p.kind === 'unknownArt' && p.field === `hand${j}`) }]))
    : need.length && pictures
      ? await pictures(phase, size, need)
      : {}

  const fields: Record<string, FieldRead> = Object.fromEntries(Object.entries(reading.fields).filter(([k]) => !/^hand\d$/.test(k)))
  const hand: string[] = []
  const unknown: number[] = []
  slots.forEach((r, j) => {
    const [top, second] = r
    const key = `hand${j}`
    const pic = pics[j]
    let name: string | undefined
    if (settled(r)) {
      name = top[0]
      fields[key] = { sure: true, guess: name, score: top[1], second: second?.[1] }
    } else if (top[1] >= MIN_Q) {
      // two names fit about as well: the picture picks between them
      const close = r.filter(([, q]) => q >= top[1] - GAP).map(([n]) => n)
      name = pic?.ranks.find(([n]) => close.includes(n))?.[0] ?? top[0]
      fields[key] = { sure: pic?.ranks[0]?.[0] === name && !!pic.field?.sure, guess: name, score: top[1], second: second?.[1] }
    } else if (pic && !pic.unknown && pic.field?.guess) {
      name = pic.field.guess
      fields[key] = pic.field
    } else {
      fields[key] = pic?.field ?? { sure: false }
    }
    if (name) hand.push(name)
    else unknown.push(j)
  })
  const problems: Problem[] = [
    ...reading.problems.filter(p => p.kind !== 'unknownArt'),
    ...unknown.map(j => ({ kind: 'unknownArt' as const, field: `hand${j}`, crop: cardFace(pos[j], handK(l)), ...(size === 5 ? { hand: 5 as const } : {}), ...(texts[j]?.trim() ? { text: texts[j].trim() } : {}) })),
  ]
  if (phase !== header) fields.phase = { sure: unknown.length === 0, guess: phase }

  const state = { ...reading.state, phase, hand }
  // a refresh count read under the header's kind of pick belongs to the one the names show
  if (phase !== header && phase !== 'protocol') {
    const left = header === 'potion' ? reading.state.potionRefreshes : reading.state.instrumentRefreshes
    if (phase === 'potion') state.potionRefreshes = left
    else state.instrumentRefreshes = left
  }
  const out: Reading = { ...reading, state, fields, problems, handRanks: pos.map((_, j) => pics[j]?.ranks ?? []) }
  delete out.handPending
  return out
}
