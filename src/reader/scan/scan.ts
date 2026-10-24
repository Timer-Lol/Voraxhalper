// Reads a frame of the Surgical Preparation screen into the advisor's ScreenState.
import type { ScreenState } from '@/strategy/advisor'
import { emptyState, type FieldRead, type Problem, type Reading } from '../types'
import type { ScanData } from './data'
import { HAND_SCALES, layout, scaleHand, shiftHand, UI_SCALES, type HandFit, type Layout } from './layout'
import { gray, type ArtFeature, type Img } from './pixels'
import { readText } from './digits'
import { crossCheck, readTank, type TankRead } from './tanks'
import { cardsPresent, fanSize, headerOnly, loneMiddle, readHand, readPhase } from './cards'
import { readInstruments } from './instruments'
import { normalColours, readAreas } from './levels'
import { findLabels, LABEL_MIN_OFF, withLabels, type TankFix } from './labels'
import normal from './levels.json'

const DIGIT_MIN = 0.75

export type LocalRefs = Record<string, ArtFeature[]>

/** pictures: false leaves the cards to their printed names, read afterwards (titles.ts): their pictures are
 *  most of the work, and needed only for a name that can't be read. */
export function scan(captured: Img, data: ScanData, local: LocalRefs = {}, options: { pictures?: boolean; thorough?: boolean } = {}): Reading {
  return elsewhere(scanUi(captured, data, local, options))
}

/** (Vorax Helper) Another screen of the game (a build planner, the trade house, settings) has no round, no Ultimate
 *  Activity and no "Select a ..." pick to read: not the board, whatever its tank rows seem to say. */
function elsewhere(r: Reading): Reading {
  const f = r.fields
  if (r.problems.some(p => p.kind === 'notFound' || p.kind === 'animating') || f.round?.sure || f.ultimate?.sure) return r
  // a header and cards would still be a pick (the round hidden under a menu, say); a header alone matches menus too
  const cards = !!r.handPending || (r.handRanks?.length ?? 0) > 0
  if (cards && f.phase?.sure && (f.phase.score ?? 0) >= 0.7) return r
  return { state: emptyState(), fields: {}, problems: [{ kind: 'notFound' }], frame: r.frame }
}

function scanUi(captured: Img, data: ScanData, local: LocalRefs, options: { pictures?: boolean; thorough?: boolean }): Reading {
  // the interface scale that read last is tried first; when the round can't be read, the others are
  const first = scanAt(captured, data, local, options, lastUi)
  // a picture that isn't the board, or a card mid-flight, isn't read better at another scale; but read at the scale
  // a different screen used (Vorax Helper: the scale is remembered across pictures), it can look like either, so
  // the usual scale (1) gets its chance too
  if (first.fields.round?.sure) { misses = 0; return first }
  if (first.problems.some(p => p.kind === 'animating' || p.kind === 'notFound')) {
    // (Vorax Helper) every other scale too, now and then: after hours on other screens the remembered scale was 1.75
    // (a misread), and the board at 125% then read as "a card mid-flight" for good, since only 100% was tried
    // besides it (player report, 2026-10-24). On a picture the page asked for (a move in the log, Read, a click)
    // and on every 8th miss in a row.
    misses++
    const all = options.thorough || misses % 8 === 0
    if (lastUi === 1 && !all) return first
    for (const ui of all ? [1, ...UI_SCALES].filter((u, i, a) => u !== lastUi && a.indexOf(u) === i) : [1]) {
      if (ui === lastUi) continue
      const r = scanAt(captured, data, local, options, ui)
      if (isBoard(r)) { lastUi = ui; misses = 0; return r }
    }
    return first
  }
  for (const ui of UI_SCALES.filter(u => u !== lastUi)) {
    const r = scanAt(captured, data, local, options, ui)
    if (r.fields.round?.sure) {
      lastUi = ui
      misses = 0
      return r
    }
  }
  return first
}

/** A reading clear enough to make its interface scale the one tried first: the round and the pick or the Ultimate
 *  Activity panel read clearly, not a card mid-flight (another screen can pass for a round number alone). */
const isBoard = (r: Reading) => !!r.fields.round?.sure && (!!r.fields.phase?.sure || !!r.fields.ultimate?.sure) && !r.problems.some(p => p.kind === 'animating' || p.kind === 'notFound')
let misses = 0

/** How many tanks' Activity x Quantity multiplied to their total. */
const checkedOut = (tanks: TankRead[]) => tanks.filter((t, i) => t.monster && t.fields[`tank${i}.activity`]?.sure).length

let lastUi = 1

function scanAt(captured: Img, data: ScanData, local: LocalRefs, { pictures = true }: { pictures?: boolean }, ui: number): Reading {
  // read with the colours a normal capture has, whatever HDR or gamma this PC captures with
  const l0 = layout(captured, ui)
  const colours = normalColours(captured, normal, readAreas(l0))
  const img = colours.img
  // the hand's header found where it really is (a window of another shape can put the bottom UI a little off)
  const { l: lh, shift } = alignHand(img, l0, data, ui)
  // (Vorax Helper) the tanks' labels where their hearts are, for a screen shape the layout wasn't measured on
  const labels = findLabels(img, lh)
  const g = gray(img)
  const fields: Record<string, FieldRead> = {}
  const problems: Problem[] = []
  const frame = { width: img.width, height: img.height }

  // (the labels move only the tanks' places: the hand and the panels read from the hand's layout)
  const present = cardsPresent(img, lh)
  const lone = present === 1 && loneMiddle(img, lh)
  if ((present === 1 && !lone) || present === 2) return { state: emptyState(), fields: {}, problems: [{ kind: 'animating' }], frame }

  // no cards dealt yet (or all gone): only the header to read
  const hand = present === 0 ? { ...headerOnly(img, lh, data), ranks: [] } : pictures ? readHand(img, lh, data, local, lone ? 1 : undefined) : headerOnly(img, lh, data)
  // The labels moved onto their hearts only when that reads the tanks better: a label's heart sits further right
  // the shorter its numbers are, and five short labels at once ("1296 / 6 x 216") put the hearts far enough off
  // to move every band onto the tops of the digits ("3306" for 1296, the board kept at the round before: player
  // report, 2026-10-24). Activity x Quantity has to multiply to the total, so the read with more tanks that
  // check out is the right one; a tie keeps the hearts' places.
  let l = lh
  let tanks = [0, 1, 2, 3, 4, 5].map(i => readTank(img, g, lh, i, data))
  if (labels && labels.off > LABEL_MIN_OFF * (img.height / 1440)) {
    const lf = withLabels(lh, labels)
    const moved = [0, 1, 2, 3, 4, 5].map(i => readTank(img, g, lf, i, data))
    if (checkedOut(moved) >= checkedOut(tanks)) { l = lf; tanks = moved }
  }
  if (!hand.phase && tanks.every(t => !t.monster)) return { state: emptyState(), fields: {}, problems: [{ kind: 'notFound' }], frame: { width: img.width, height: img.height } }

  // (Vorax Helper) the Ultimate Activity panel is the sum of the tanks' totals: it confirms them, or works out
  // the one tank that was misread (a candle or the heart icon in the way)
  const ua = readText(img, g, l.ultimate, 'round', data.digits.round)
  const uaN = Number(ua?.text)
  const uaOk = !!ua && Number.isInteger(uaN) && uaN >= 0 && ua.score >= DIGIT_MIN
  const check = uaOk ? crossCheck(tanks, uaN) : null
  fields.ultimate = { sure: uaOk, guess: ua?.text, score: ua?.score, second: ua?.second, ...(check ? { note: check.result + (check.tank !== undefined ? ` tank${check.tank}` : '') } : {}) } as FieldRead

  Object.assign(fields, hand.fields)
  problems.push(...hand.problems)
  for (const t of tanks) Object.assign(fields, t.fields)

  const state: ScreenState = { tanks: tanks.map(t => t.monster), hand: hand.names, instruments: [], phase: hand.phase ?? 'potion' }

  const round = readText(img, g, l.round, 'round', data.digits.round)
  const n = Number(round?.text)
  const roundOk = !!round && Number.isInteger(n) && n >= 1 && n <= 13 && round.score >= DIGIT_MIN
  state.round = roundOk ? n : 1
  fields.round = { sure: roundOk, guess: round?.text, score: round?.score, second: round?.second }
  if (!roundOk) problems.push({ kind: 'unreadable', field: 'round' })

  // (Vorax Helper) rounds 1-10 never offer a protocol: a header read as one is misread, so the cards' names
  // (titles.ts) say which pick it is
  let ranks = hand.ranks
  if (roundOk && n <= 10 && state.phase === 'protocol') {
    const next = readPhase(img, l, data).next
    state.phase = next && next !== 'protocol' ? next : 'potion'
    state.hand = []
    ranks = present === 0 ? [] : undefined
    for (const k of Object.keys(fields)) if (/^hand\d$/.test(k)) delete fields[k]
    fields.phase = { ...fields.phase, sure: false, guess: state.phase }
    for (let i = problems.length - 1; i >= 0; i--) if (problems[i].kind === 'unknownArt') problems.splice(i, 1)
  }

  if (state.phase !== 'protocol') {
    const ref = readText(img, g, l.refresh, 'refresh', data.digits.refresh)
    const left = Number(ref?.text)
    const ok = !!ref && Number.isInteger(left) && left >= 0 && left <= 9 && ref.score >= DIGIT_MIN
    state[state.phase === 'potion' ? 'potionRefreshes' : 'instrumentRefreshes'] = ok ? left : 0
    fields.refreshes = { sure: ok, guess: ref?.text, score: ref?.score, second: ref?.second }
  }

  const inst = readInstruments(img, l, data, local)
  state.instruments = inst.names
  Object.assign(fields, inst.fields)
  const instrumentRanks = inst.ranks

  for (const [k, f] of Object.entries(fields)) if (!f.sure && /^tank\d\.(activity|quantity)$/.test(k) && !problems.some(p => p.kind === 'unreadable' && p.field === k)) problems.push({ kind: 'unreadable', field: k })
  return { state, fields, problems, frame, handShift: shift, ...(ui !== 1 ? { ui } : {}), debug: { off: Math.round(colours.off * 1000) / 1000, corrected: colours.corrected, tanks: tanks.map(t => t.debug), ...(l !== lh ? { labels: { found: labels!.found, off: Math.round(labels!.off), dy: Math.round(labels!.dy) } } : {}) }, ...(l !== lh ? { tankFix: { cx: l.tankCx.slice(), dy: labels!.dy } } : {}), instrumentRanks, iconsKnown: inst.known, handRanks: ranks, ...(ranks ? {} : { handPending: true as const, handSize: lone ? 1 : state.phase === 'protocol' ? 3 : fanSize(img, l) }) }
}

/** Searches a little around the measured header for where the "Select a ..." header best matches, and moves
 *  the hand's places with it, when that finds it clearly better than the measured place does. (Vorax Helper) Also
 *  tries the hand a few percent larger or smaller than the rest of the UI, as one 3440x1440 fullscreen game draws it. */
export function alignHand(img: Img, l: Layout, data: ScanData, ui = 1): { l: Layout; shift: HandFit } {
  // (Vorax Helper) the hand stays where it was found on this screen: a card raised by the mouse covers the header,
  // and a search then finds a "header" somewhere else that half fits, with the wrong pick and the cards misplaced
  const key = `${img.width}x${img.height}@${ui}`
  const kept = keptFit?.key === key ? keptFit : null
  if (kept) {
    const lk = fitLayout(l, ui, kept.fit)
    if (readPhase(img, lk, data).score >= KEEP_MIN) return { l: lk, shift: kept.fit }
    const found = searchHand(img, l, data, ui)
    return found.s >= KEEP_MIN ? remember(key, found) : { l: lk, shift: kept.fit }
  }
  const found = searchHand(img, l, data, ui)
  return found.s >= KEEP_MIN ? remember(key, found) : found
}

/** The hand's place on the screen last read clearly: kept while the picture's size stays the same. */
let keptFit: { key: string; fit: HandFit } | null = null
/** A header this good is really there (a covered or missing one matches up to about 0.83). */
const KEEP_MIN = 0.9
const fitLayout = (l: Layout, ui: number, f: HandFit) => {
  const lh = scaleHand(l, ui, f[2] ?? 1)
  return f[0] || f[1] ? shiftHand(lh, f[0], f[1]) : lh
}
function remember(key: string, found: { l: Layout; shift: HandFit }) {
  keptFit = { key, fit: found.shift }
  return { l: found.l, shift: found.shift }
}

function searchHand(img: Img, l: Layout, data: ScanData, ui: number): { l: Layout; shift: HandFit; s: number } {
  const base = readPhase(img, l, data).score
  let best = { s: base, dx: 0, dy: 0, hs: 1 }
  const tryAt = (lh: Layout, hs: number, dx: number, dy: number) => { const s = readPhase(img, shiftHand(lh, dx, dy), data).score; if (s > best.s) best = { s, dx, dy, hs } }
  // the hand's own scale, with a little up and down: a coarse look, then closer around the best
  for (const hs of HAND_SCALES) { const lh = scaleHand(l, ui, hs); for (let dy = -24; dy <= 24; dy += 4) tryAt(lh, hs, 0, dy) }
  if (best.hs !== 1 || best.dy) { const lh = scaleHand(l, ui, best.hs), c = best; for (let dy = c.dy - 3; dy <= c.dy + 3; dy += 1) tryAt(lh, c.hs, 0, dy) }
  const fitted = best.s >= SCALE_MIN && best.s >= base + SCALE_GAIN
  if (!fitted) best = { s: base, dx: 0, dy: 0, hs: 1 }
  const lh = scaleHand(l, ui, best.hs)
  if (best.s < 0.75) {
    const c0 = best
    for (let dy = -48; dy <= 48; dy += 8) for (let dx = -160; dx <= 160; dx += 16) tryAt(lh, c0.hs, dx, dy)
    const c = best
    for (let dy = c.dy - 6; dy <= c.dy + 6; dy += 2) for (let dx = c.dx - 12; dx <= c.dx + 12; dx += 4) tryAt(lh, c.hs, dx, dy)
    if (!(best.s >= 0.6 && best.s >= c0.s + 0.1)) best = c0
  }
  const shift: HandFit = best.hs !== 1 ? [best.dx, best.dy, best.hs] : [best.dx, best.dy]
  return { l: best.dx || best.dy ? shiftHand(lh, best.dx, best.dy) : lh, shift, s: best.s }
}
/** A hand found at another scale or a little up or down is taken only when its header matches well, and clearly better than at the measured size. */
const SCALE_MIN = 0.78
const SCALE_GAIN = 0.03
