// The cards on offer: which kind of pick it is (from the header), and each card from its art and the shape
// of its text block (title and body). Cards that share a bottle (Twin Hormone - Pest and - Bone Sentry, ...)
// differ in their text: "Pests" or "Bone Sentries", and the archetype icon beside it.
import type { FieldRead, Problem } from '../types'
import type { HandPhase, ScanData } from './data'
import { CARD_LOCAL, cardFace, handK, type CardPos, type Layout } from './layout'
import { artFeature, gray, patch, resizeTaps, signature, similarity, type ArtFeature, type Img } from './pixels'

const HEADER_MIN = 0.6
const ART_MIN = 0.95
const ART_GAP = 0.015
const ART_UNKNOWN = 0.92

/** The text block's grid: fine enough for the words, coarse enough to forgive a few pixels. */
export const TEXT = { w: 40, h: 38 }

const whole = (r: { w: number; h: number }) => ({ x: 0, y: 0, w: r.w, h: r.h })

/** A card's art, straightened and at reference size, whatever the screen; dx, dy shift it (reference px). */
export function cardArt(img: Img, c: CardPos, k: number, dx = 0, dy = 0): ArtFeature {
  return artFeature(patch(img, c.cx + dx * k, c.cy + dy * k, c.angle, CARD_LOCAL.art, k), whole(CARD_LOCAL.art))
}

/** A card's text block (title and body) as a shape, straightened and at reference size. */
export function cardText(img: Img, c: CardPos, k: number, dx = 0, dy = 0): number[] {
  return signature(patch(img, c.cx + dx * k, c.cy + dy * k, c.angle, CARD_LOCAL.text, k, TEXT_TAPS), whole(CARD_LOCAL.text), TEXT.w, TEXT.h)
}
/** (Vorax Helper) the text block is shrunk to TEXT at once: only the pixels the shrinking reads are sampled (the same result, 5x faster) */
const TEXT_TAPS = { xs: resizeTaps(Math.round(CARD_LOCAL.text.w), TEXT.w), ys: resizeTaps(Math.round(CARD_LOCAL.text.h), TEXT.h) }

// The middle of a card face, around its title: busy with text on a card, smooth on the bare floor.
const FACE_MIDDLE = { x: -100, y: -45, w: 185, h: 175 }
const EDGE_STEP = 25
// cards measure 0.10 or more and bare floor 0.04 or less, at 1440p and at 1080p alike
const CARD_DETAIL = 0.07

// Measured at the screen's own resolution: stretched to the reference size, a smaller screen's edges soften.
function hasCard(img: Img, c: CardPos, k: number): boolean {
  const p = patch(img, c.cx, c.cy, c.angle, { x: FACE_MIDDLE.x * k, y: FACE_MIDDLE.y * k, w: FACE_MIDDLE.w * k, h: FACE_MIDDLE.h * k }, 1)
  const g = gray(p)
  let edges = 0
  for (let y = 1; y < p.height; y++)
    for (let x = 1; x < p.width; x++) {
      const i = y * p.width + x
      if (Math.abs(g[i] - g[i - 1]) > EDGE_STEP || Math.abs(g[i] - g[i - p.width]) > EDGE_STEP) edges++
    }
  return edges / (p.width * p.height) > CARD_DETAIL
}

/** How many of the three hand positions hold a card. A real hand fills all three (a Potion Kit's five
 *  cover them too); when a card is played or picked it flies off alone, leaving one or two. */
export const cardsPresent = (img: Img, l: Layout): number => l.cards.filter(c => hasCard(img, c, handK(l))).length

/** 5 when a Potion Kit's fan reaches both far ends, where a usual hand of three leaves bare floor. */
export const fanSize = (img: Img, l: Layout): 3 | 5 => (hasCard(img, l.hand5[0], handK(l)) && hasCard(img, l.hand5[4], handK(l)) ? 5 : 3)

/** The card positions for a hand of this size. */
export const handAt = (l: Layout, size: number) => (size === 5 ? l.hand5 : size === 1 ? [l.cards[1]] : l.cards)

/** A single card in the middle with bare floor either side: a one-card offer (the game sometimes deals one
 *  instrument), not a card flying off the hand. */
export const loneMiddle = (img: Img, l: Layout): boolean => hasCard(img, l.cards[1], handK(l)) && !hasCard(img, l.cards[0], handK(l)) && !hasCard(img, l.cards[2], handK(l))

/** Offsets every card is compared at (reference px): the hand shifts sideways when one card is hovered,
 *  and the hovered card itself rises about 35. */
export const SHIFTS = [-36, -27, -18, -9, 0, 9, 18].flatMap(dy => [-48, -36, -24, -12, 0, 12, 24, 36, 48].map(dx => [dx, dy] as const))
/** Text is sharp enough that one pixel matters, so the closest few cards are also tried around their best offset. */
const FINE = [-4, -2, 0, 2, 4].flatMap(dy => [-6, -4, -2, 0, 2, 4, 6].map(dx => [dx, dy] as const))
const REFINE = 6
/** picture matches kept per card position, for the printed name to choose among */
const KEEP_RANKS = 5

export interface HandRead { phase: HandPhase | null; names: string[]; fields: Record<string, FieldRead>; problems: Problem[]; ranks?: [string, number][][] }

export function readPhase(img: Img, l: Layout, data: ScanData): { phase: HandPhase | null; score: number; second: number; next?: HandPhase } {
  const sig = signature(img, l.header)
  const ranked = (Object.keys(data.headers) as HandPhase[])
    .map(p => [p, Math.max(...data.headers[p].map(h => h.reduce((s, v, i) => s + v * sig[i], 0)))] as const)
    .sort((a, b) => b[1] - a[1])
  return { phase: ranked[0][1] >= HEADER_MIN ? ranked[0][0] : null, score: ranked[0][1], second: ranked[1]?.[1] ?? 0, next: ranked[1]?.[0] }
}

const dot = (a: number[], b: number[]) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** Where a known card's references fit best around its position (reference px), and how well: a card
 *  raised by the mouse fits about 35 higher, one in a flash of light fits poorly. null with no references. */
export function fitOffset(img: Img, c: CardPos, k: number, key: string, data: ScanData): { at: readonly [number, number]; score: number } | null {
  const fs = data.cards[key]
  const texts = data.texts[key]
  if (!fs || !texts) return null
  let best = -Infinity
  let at: readonly [number, number] = [0, 0]
  for (const [dx, dy] of SHIFTS) {
    const art = cardArt(img, c, k, dx, dy)
    const text = cardText(img, c, k, dx, dy)
    const v = 0.5 * Math.max(...fs.map(f => similarity(f, art))) + 0.25 * (1 + Math.max(...texts.map(t => dot(t, text))))
    if (v > best) [best, at] = [v, [dx, dy]]
  }
  return { at, score: best }
}

/** Every known card ranked for one card position, best first. */
function rank(img: Img, c: CardPos, k: number, prefix: string, data: ScanData, local: Record<string, ArtFeature[]>): (readonly [string, number])[] {
  const arts = new Map<string, ArtFeature>()
  const txts = new Map<string, number[]>()
  const art = (dx: number, dy: number) => arts.get(`${dx},${dy}`) ?? arts.set(`${dx},${dy}`, cardArt(img, c, k, dx, dy)).get(`${dx},${dy}`)!
  const text = (dx: number, dy: number) => txts.get(`${dx},${dy}`) ?? txts.set(`${dx},${dy}`, cardText(img, c, k, dx, dy)).get(`${dx},${dy}`)!
  const scored = Object.entries({ ...data.cards, ...local })
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, fs]) => {
      const texts = data.texts[key]
      const artAt = (dx: number, dy: number) => Math.max(...fs.map(f => similarity(f, art(dx, dy))))
      // a card a player named in this browser has art but no text yet: its art alone decides
      const both = (a: number, dx: number, dy: number) => (texts ? 0.5 * a + 0.25 * (1 + Math.max(...texts.map(t => dot(t, text(dx, dy))))) : a)
      let best = -Infinity
      let at: readonly [number, number] = [0, 0]
      let a0 = 0
      for (const [dx, dy] of SHIFTS) {
        const a = artAt(dx, dy)
        const v = both(a, dx, dy)
        if (v > best) [best, at, a0] = [v, [dx, dy], a]
      }
      return { name: key.slice(prefix.length), best, at, a0, both, texts }
    })
    .sort((a, b) => b.best - a.best)
  // the art barely changes over a pixel or two, so only the text is re-read around the best offset
  for (const s of scored.slice(0, REFINE))
    if (s.texts) for (const [fx, fy] of FINE) s.best = Math.max(s.best, s.both(s.a0, s.at[0] + fx, s.at[1] + fy))
  return scored.map(s => [s.name, s.best] as const).sort((a, b) => b[1] - a[1])
}

function readAt(img: Img, l: Layout, size: number, phase: HandPhase, data: ScanData, local: Record<string, ArtFeature[]>, slots?: number[]) {
  const fields: Record<string, FieldRead> = {}
  const problems: Problem[] = []
  const names: string[] = []
  const ranks: [string, number][][] = []
  let total = 0
  handAt(l, size).forEach((c, j) => {
    if (slots && !slots.includes(j)) return ranks.push([])
    const ranked = rank(img, c, handK(l), `${phase}:`, data, local)
    ranks.push(ranked.slice(0, KEEP_RANKS).map(([n, v]) => [n, v]))
    total += ranked[0]?.[1] ?? 0
    if (!ranked.length || ranked[0][1] < ART_UNKNOWN) {
      problems.push({ kind: 'unknownArt', field: `hand${j}`, crop: cardFace(c, handK(l)), ...(size === 5 ? { hand: 5 as const } : {}) })
      fields[`hand${j}`] = { sure: false, guess: ranked[0]?.[0], score: ranked[0]?.[1], second: ranked[1]?.[1] }
      return
    }
    names.push(ranked[0][0])
    fields[`hand${j}`] = { sure: ranked[0][1] >= ART_MIN && ranked[0][1] - (ranked[1]?.[1] ?? 0) >= ART_GAP, guess: ranked[0][0], score: ranked[0][1], second: ranked[1]?.[1] }
  })
  return { names, fields, problems, ranks, mean: total / size }
}

/** Which kind of pick the header shows, without reading the cards: their printed names will. */
export function headerOnly(img: Img, l: Layout, data: ScanData): HandRead {
  const { phase, score, second } = readPhase(img, l, data)
  return { phase, names: [], fields: { phase: { sure: !!phase && score - second >= 0.05, guess: phase ?? undefined, score, second } }, problems: [] }
}

/** Some of a hand's cards by their pictures: those the printed names couldn't settle. */
export function readSlots(img: Img, l: Layout, size: number, phase: HandPhase, slots: number[], data: ScanData, local: Record<string, ArtFeature[]> = {}) {
  const { fields, problems, ranks } = readAt(img, l, size, phase, data, local, slots)
  return { fields, problems, ranks }
}

export function readHand(img: Img, l: Layout, data: ScanData, local: Record<string, ArtFeature[]> = {}, size?: number): HandRead {
  const head = headerOnly(img, l, data)
  const { phase } = head
  const phaseField = head.fields.phase
  // no header to go by (a raised card covers it): the printed names will say which pick it is
  if (!phase) return head
  const read = readAt(img, l, size ?? (phase === 'potion' ? fanSize(img, l) : 3), phase, data, local)
  return { phase, names: read.names, fields: { phase: phaseField, ...read.fields }, problems: read.problems, ranks: read.ranks }
}
