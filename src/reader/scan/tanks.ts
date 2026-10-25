// One tank from its label: empty or not, rarity from the name's colour, archetype from the icon above it,
// and Activity x Quantity, which must multiply to the total shown above it.
import type { Archetype, Rarity } from '@/engine/types'
import type { ScreenMonster } from '@/strategy/advisor'
import type { FieldRead, Rect } from '../types'
import type { ScanData } from './data'
import type { Layout } from './layout'
import { hsv, type Img } from './pixels'
import { readText } from './digits'
import { brightest } from './text'

/** How bright a name must be to be there at all: names measure 119 or more even shrunk to 1080p, empty
 *  tanks (dark glass) 88 or less. */
const NAME_MIN = 105
/** brighter than this, a name with nothing read under it is still taken for a monster (its numbers covered) */
const GLOW_MAX = 140
/** dimmer than every name measured (119 at the least): with no Activity x Quantity line under it, not a name */
const NAME_SURE = 117
const DIGIT_MIN = 0.75

/** The engine's cap on Activity and Quantity (src/ui/sandboxValidate.ts). */
const MAX_STAT = 1_000_000
/** the most a single tank plausibly shows (live games: Activity up to about 500, Quantity up to about 1,500); well above both */
const MAX_ACTIVITY = 3000
const MAX_QUANTITY = 5000

/** Activity x Quantity from their line, kept within the game, and whether they multiply to the total. */
export function stats(total: string | undefined, aq: string | undefined): { activity: number; quantity: number; fits: boolean } {
  const parts = (aq ?? '').split('x')
  const [a, q] = parts.length === 2 ? parts.map(Number) : [NaN, NaN]
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_STAT
  if (!ok(a) || !ok(q)) return { activity: 1, quantity: 1, fits: false }
  return { activity: a, quantity: q, fits: a * q === Number(total) }
}

/**
 * Archetype from the little icon above a tank's name, by colour: yellow helmet Bone Sentry, purple swirl
 * Pest, pale blue swirl Aemberon, red sun Agito. The red glass behind every icon is ignored, so "no other
 * colour" means the Agito. Right on all 138 labelled tanks.
 */
export function archetypeOf(img: Img, r: Rect): { archetype: Archetype; sure: boolean } {
  const n = { boneSentry: 0, pest: 0, aemberon: 0 }
  // (Vorax Helper) a whole icon's width either side: in a small window the icon is a dozen pixels across and the
  // layout's tank places, blended between the screen shapes it was measured on, can be most of that off (a
  // 1598x872 window: every icon missed, so every tank read as an Agito, the advice built on the wrong monsters:
  // player report, 2026-10-25). Not up or down: the name under it can be gold or blue.
  for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(img.height, r.y + r.h); y++) {
    for (let x = Math.max(0, Math.floor(r.x - r.w)); x < Math.min(img.width, r.x + 2 * r.w); x++) {
      const i = (y * img.width + x) * 4
      const [h, s, v] = hsv(img.data[i], img.data[i + 1], img.data[i + 2])
      if (v < 0.45) continue
      if (h >= 35 && h <= 65 && s >= 0.5) n.boneSentry++
      // (a Pest's violet washes out to a saturation of 0.3-0.45 on an icon a dozen pixels across: same report)
      else if ((h >= 255 && h <= 305 && s >= 0.5) || (h >= 262 && h <= 300 && s >= 0.25)) n.pest++
      else if (h >= 190 && h <= 240 && s >= 0.25) n.aemberon++
    }
  }
  const [best, count] = (Object.entries(n) as [Archetype, number][]).sort((a, b) => b[1] - a[1])[0]
  if (count >= 4) return { archetype: best, sure: true }
  if (count >= 2) return { archetype: best, sure: false }
  return { archetype: 'agito', sure: true }
}

/** Candidate characters for each glyph of a line, best first: from the digit matcher. */
type Alts = string[][]

/** Most readings tried when working out which of a line's candidate characters make the numbers fit. */
const MAX_COMBOS = 200_000

/** Most stray glyphs dropped from one end of a line: a cursor over the label read as "21" (1x36 as 1x3621). */
const MAX_STRAY = 2

/** All readings of a line from its candidates, with how far down each glyph's list it went. */
function readings(alts: Alts): { text: string; rank: number }[] {
  if (alts.reduce((n, a) => n * a.length, 1) > MAX_COMBOS) return []
  let out: { text: string; rank: number }[] = [{ text: '', rank: 0 }]
  for (const choices of alts) out = out.flatMap(o => choices.map((c, i) => ({ text: o.text + c, rank: o.rank + i })))
  return out
}

/**
 * When Activity x Quantity doesn't make the total, one line has a misread digit (a digit touching the heart
 * icon can look like another). Tries each glyph's next-best characters, on the Activity x Quantity line first
 * (the total's digits are sharper), and returns the lines that fit, or null when nothing fits or two readings
 * fit equally well.
 */
export function reconcile(total: Alts, aq: Alts): { total: string; aq: string } | null {
  const first = (a: Alts) => a.map(c => c[0]).join('')
  const best = (cands: { text: string; rank: number }[]) => {
    const lowest = Math.min(...cands.map(c => c.rank))
    const top = cands.filter(c => c.rank === lowest)
    return top.length === 1 ? top[0].text : null
  }
  const totalText = first(total)
  const aqFits = readings(aq).filter(r => stats(totalText, r.text).fits)
  if (aqFits.length) {
    const text = best(aqFits)
    return text === null ? null : { total: totalText, aq: text }
  }
  const aqText = first(aq)
  const totalFits = readings(total).filter(r => stats(r.text, aqText).fits)
  if (totalFits.length) {
    const text = best(totalFits)
    return text === null ? null : { total: text, aq: aqText }
  }
  // a sliver of the heart, or a cursor over the label, can pass as a glyph or two more at either end of a
  // line: dropped if the rest then fits, the fewest first
  for (let n = 1; n <= MAX_STRAY; n++) {
    const ends = (s: string) => (s.length > n ? [s.slice(n), s.slice(0, -n)] : [])
    const trimmed = [...ends(aqText).filter(t => stats(totalText, t).fits).map(t => ({ total: totalText, aq: t })), ...ends(totalText).filter(t => stats(t, aqText).fits).map(t => ({ total: t, aq: aqText }))]
    if (trimmed.length === 1) return trimmed[0]
    if (trimmed.length > 1) return null
  }
  // a digit squeezed against the heart can be misread beyond its candidates: with the total and one number
  // read, the other is their quotient, taken only if it has as many digits and differs in just one
  const [a, q] = aqText.split('x')
  const total$ = Number(totalText)
  if (!a || !q || !Number.isInteger(total$)) return null
  const oneOff = (read: string, want: number) => String(want).length === read.length && [...read].filter((c, i) => c !== String(want)[i]).length === 1
  const fromQ = Number(q) > 0 && total$ % Number(q) === 0 && oneOff(a, total$ / Number(q)) ? `${total$ / Number(q)}x${q}` : null
  const fromA = Number(a) > 0 && total$ % Number(a) === 0 && oneOff(q, total$ / Number(a)) ? `${a}x${total$ / Number(a)}` : null
  const fixed = fromQ && fromA ? null : fromQ ?? fromA
  return fixed && stats(totalText, fixed).fits ? { total: totalText, aq: fixed } : null
}

/** The quantity worked out from the total and a clearly read activity, when the end of the line is covered. */
export function fromActivity(total: string, aq: string): { activity: number; quantity: number; sure: boolean } | null {
  const t = Number(total)
  const m = /^(\d+)x(.*)$/.exec(aq)
  if (!m || !Number.isInteger(t) || t <= 0) return null
  const a = Number(m[1])
  if (!a || t % a !== 0) return null
  const q = t / a
  const rest = m[2].replace(/[^0-9x]/g, '')
  // the true quantity's digits come first, the covered part's misreads after them; an activity read as more
  // digits than the total has is a misread too
  if (String(a).length > String(t).length) return null
  return { activity: a, quantity: q, sure: rest.startsWith(String(q)) && rest.length > String(q).length }
}

/** The activity worked out from the total and a clearly read quantity, when the start of the line is mangled. */
export function fromQuantity(total: string, aq: string): { activity: number; quantity: number; sure: boolean } | null {
  const t = Number(total)
  const m = /^(.*)x(\d+)$/.exec(aq)
  if (!m || !Number.isInteger(t) || t <= 0) return null
  const q = Number(m[2])
  if (!q || t % q !== 0) return null
  const a = t / q
  const lead = m[1].replace(/[^0-9]/g, '')
  return { activity: a, quantity: q, sure: lead.endsWith(String(a)) && lead.length > String(a).length }
}

/**
 * (Vorax Helper) Both ends of the line misread at once (a sliver of the heart before the activity and the candle's
 * glow after the quantity: "437x36111" for 37 x 36): the activity is some ending of what was read before the x, the
 * quantity some beginning of what was read after it, and the two must multiply to the total. Taken only when
 * exactly one pair fits.
 */
export function fromBothEnds(total: string, aq: string): { activity: number; quantity: number; sure: boolean } | null {
  const t = Number(total)
  const m = /^(\d*)x(\d*)/.exec(aq.replace(/[^0-9x]/g, ''))
  if (!m || !Number.isInteger(t) || t <= 0 || !m[1] || !m[2]) return null
  const fits: { activity: number; quantity: number }[] = []
  for (let i = 0; i < m[1].length; i++) for (let j = 1; j <= m[2].length; j++) {
    const a = Number(m[1].slice(i)), q = Number(m[2].slice(0, j))
    if (a >= 1 && q >= 1 && a <= MAX_STAT && q <= MAX_STAT && a * q === t && !fits.some(f => f.activity === a && f.quantity === q)) fits.push({ activity: a, quantity: q })
  }
  return fits.length === 1 ? { ...fits[0], sure: true } : null
}

export interface TankRead { monster: ScreenMonster | null; fields: Record<string, FieldRead>; debug: { rgb: [number, number, number]; total: string; aq: string } | null }

/**
 * Rarity from a name's colour. Measured on live frames: Normal is greyish white (saturation under 0.18, a
 * little pink from the glass), Magic pale blue (hue 200-210, saturation ~0.24), Rare gold (hue ~36, ~0.5)
 * and Boss red. A faint blue between Normal and Magic is left unsure.
 */
export function rarityOf(rgb: [number, number, number]): { rarity: Rarity; sure: boolean } {
  const [h, s] = hsv(...rgb)
  if (s >= 0.35) {
    if (h >= 15 && h <= 70) return { rarity: 'rare', sure: true }
    if (h < 15 || h > 330) return { rarity: 'boss', sure: true }
    return { rarity: 'magic', sure: h >= 180 && h <= 240 }
  }
  if (h >= 180 && h <= 240) return s >= 0.15 ? { rarity: 'magic', sure: true } : { rarity: s >= 0.12 ? 'magic' : 'normal', sure: false }
  return { rarity: 'normal', sure: true }
}

export function readTank(img: Img, g: Float32Array, l: Layout, i: number, data: ScanData): TankRead {
  const fields: Record<string, FieldRead> = {}
  const rgb = brightest(img, l.nameBand[i])
  if (Math.max(...rgb) < NAME_MIN) return { monster: null, fields: { [`tank${i}.empty`]: { sure: true } }, debug: null }

  const { rarity, sure } = rarityOf(rgb)
  fields[`tank${i}.rarity`] = { sure, guess: rarity }

  const { archetype, sure: archetypeSure } = archetypeOf(img, l.icon[i])
  fields[`tank${i}.archetype`] = { sure: archetypeSure, guess: archetype }

  const total = readText(img, g, l.totalBand[i], 'label', data.digits.label)
  const aq = readText(img, g, l.aqBand[i], 'label', data.digits.label)
  // (Vorax Helper) an empty tank's dark label plate, lit by the red glass behind it, can pass for a dim name: no
  // total and no Activity x Quantity under it means no monster (seen at 125% interface scale: "tank 4 read while empty")
  // (and a plate a little brighter than that, lit by the pointer on it, with no Activity x Quantity line at all)
  const noLine = !(aq?.text ?? '').includes('x')
  if ((!total?.text && (aq?.text ?? '').length <= 1 && Math.max(...rgb) < GLOW_MAX) || (noLine && Math.max(...rgb) < NAME_SURE)) return { monster: null, fields: { [`tank${i}.empty`]: { sure: true } }, debug: null }
  let st = stats(total?.text, aq?.text)
  // a digit beside the heart icon can be misread: the total decides which next-best digits are right
  const fix = !st.fits && total && aq ? reconcile(total.alts, aq.alts) : null
  if (fix) st = stats(fix.total, fix.aq)
  // numbers that multiply to the total are right whatever the glyph scores: the check is too strict to pass by chance
  let fits = st.fits && !!total && !!aq && (!!fix || (total.score >= DIGIT_MIN && aq.score >= DIGIT_MIN))
  // Something in the scene covers the end of the Activity x Quantity line (the candles in front of the second
  // tank): extra glyphs get read after the quantity ("300x11x" for 300 x 1). The total and the activity are
  // clear, so the quantity is total / activity; taken as read when the line's quantity starts with it.
  // (the total's score can sag a little beside the flames too: a total that divides by the activity, with the
  // line's quantity starting with the quotient, is checked well enough by that agreement)
  if (!fits && total && aq && total.score >= 0.5) {
    // the end of the line covered (candles): quantity from the activity; the start mangled (a sliver of the
    // heart read as digits before the activity): activity from the quantity. A sure answer wins.
    const tries = [fromActivity(total.text, aq.text), fromQuantity(total.text, aq.text), fromBothEnds(total.text, aq.text)].filter((x): x is NonNullable<typeof x> => !!x)
    const occ = tries.find(x => x.sure) ?? tries[0]
    if (occ) { st = { activity: occ.activity, quantity: occ.quantity, fits: true }; fits = occ.sure }
  }
  // (Vorax Helper) numbers no tank reaches (the most seen in live games: Activity 465 x Quantity 1492 on a round-10 Boss)
  // are a misread that happened to multiply up (a candle or the pointer read as digits: "7997 x 7977"): not sure
  if (st.activity > MAX_ACTIVITY || st.quantity > MAX_QUANTITY) fits = false
  fields[`tank${i}.activity`] = { sure: fits, guess: String(st.activity), score: aq?.score, second: aq?.second }
  fields[`tank${i}.quantity`] = { sure: fits, guess: String(st.quantity), score: aq?.score, second: aq?.second }
  const debug = { rgb: rgb.map(Math.round) as [number, number, number], total: total?.text ?? '', aq: aq?.text ?? '' }
  return { monster: { archetype, rarity, activity: st.activity, quantity: st.quantity }, fields, debug }
}

/**
 * (Vorax Helper) The Ultimate Activity panel is the sum of every tank's total, so it checks the tanks as a set:
 * - the numbers add up to it: every tank is right (an unsure one is confirmed);
 * - they don't, and one tank is the odd one out (unsure, or worth more than the whole board, or one whose own
 *   line didn't multiply to its total): that tank's total is the panel less the others, and its Activity x
 *   Quantity is worked out from that total and what could be read of its line.
 * A fix is taken only when exactly one tank can explain the difference, and its line agrees with the answer.
 * Changes `tanks` and its fields in place; returns what it did, for the debug record.
 */
export function crossCheck(tanks: TankRead[], ultimate: number): { result: 'agrees' | 'fixed' | 'mismatch'; tank?: number } {
  const live = tanks.map((t, i) => ({ t, i })).filter(x => x.t.monster)
  if (!live.length) return { result: ultimate === 0 ? 'agrees' : 'mismatch' }
  const value = (t: TankRead) => t.monster!.activity * t.monster!.quantity
  const sure = (t: TankRead, i: number) => !!t.fields[`tank${i}.activity`]?.sure && !!t.fields[`tank${i}.quantity`]?.sure
  const confirm = (t: TankRead, i: number, how?: string) => {
    for (const k of ['activity', 'quantity'] as const) {
      const f = t.fields[`tank${i}.${k}`]
      t.fields[`tank${i}.${k}`] = { ...f, sure: true, guess: String(t.monster![k]), ...(how ? { note: how } : {}) } as FieldRead
    }
  }
  const sum = live.reduce((s, x) => s + value(x.t), 0)
  if (sum === ultimate) {
    for (const { t, i } of live) if (!sure(t, i)) confirm(t, i, 'adds up to Ultimate Activity')
    return { result: 'agrees' }
  }
  // (Vorax Helper) the others add up to the panel without a tank that had no Activity x Quantity line to read: an
  // empty tank whose plate the pointer rests on (its arrow passes for a name, and for digits)
  const ghosts = live.filter(({ t, i }) => !sure(t, i) && !!t.debug && !t.debug.aq.includes('x') && sum - value(t) === ultimate)
  if (ghosts.length === 1) {
    const { t, i } = ghosts[0]
    t.monster = null
    t.fields = { [`tank${i}.empty`]: { sure: true, note: 'nothing under its name; the others add up to Ultimate Activity' } as FieldRead }
    for (const x of live) if (x.t !== t && !sure(x.t, x.i)) confirm(x.t, x.i, 'adds up to Ultimate Activity')
    return { result: 'fixed', tank: i }
  }
  // which tank could be wrong: unsure ones first, then any worth more than the whole board, then any whose
  // line and total disagreed
  const suspects = live.filter(({ t, i }) => !sure(t, i) || value(t) > ultimate || (t.debug && !stats(t.debug.total, t.debug.aq).fits))
  const fixes: { i: number; activity: number; quantity: number }[] = []
  for (const { t, i } of suspects) {
    const total = ultimate - (sum - value(t))
    if (total <= 0 || !t.debug) continue
    const T = String(total)
    const a = /^(\d+)x/.exec(t.debug.aq)?.[1], q = /x(\d+)$/.exec(t.debug.aq)?.[1]
    // the other number must agree with what was read of it: its digits start or end the misread part, or
    // differ by one digit (a number that merely divides would let almost anything through, an activity of 1)
    const close = (read: string, want: number) => { const w = String(want); return read.startsWith(w) || read.endsWith(w) || (read.length === w.length && [...read].filter((c, k) => c !== w[k]).length <= 1) }
    const rest = /x(.*)$/.exec(t.debug.aq)?.[1] ?? '', lead = /^(.*)x/.exec(t.debug.aq)?.[1] ?? ''
    type Way = { activity: number; quantity: number; sure: boolean }
    const derived = [fromActivity(T, t.debug.aq), fromQuantity(T, t.debug.aq), fromBothEnds(T, t.debug.aq)].filter((w): w is Way => !!w && (w.sure || (close(rest, w.quantity) && close(lead, w.activity))))
    const plain: (Way | null)[] = [
      a && total % Number(a) === 0 && close(rest, total / Number(a)) ? { activity: Number(a), quantity: total / Number(a), sure: false } : null,
      q && total % Number(q) === 0 && close(lead, total / Number(q)) ? { activity: total / Number(q), quantity: Number(q), sure: false } : null,
    ]
    const ways = [...derived, ...plain].filter((w): w is Way => !!w && w.activity >= 1 && w.quantity >= 1 && w.activity <= MAX_STAT && w.quantity <= MAX_STAT)
    const uniq = [...new Map(ways.map(w => [`${w.activity}x${w.quantity}`, w])).values()]
    if (uniq.length === 1) fixes.push({ i, activity: uniq[0].activity, quantity: uniq[0].quantity })
  }
  if (fixes.length !== 1) return { result: 'mismatch' }
  const f = fixes[0], t = tanks[f.i]
  t.monster = { ...t.monster!, activity: f.activity, quantity: f.quantity }
  confirm(t, f.i, 'worked out from Ultimate Activity')
  return { result: 'fixed', tank: f.i }
}
