// The board value: what final score (counted up to 950,000) games from a board like this one tend to end at,
// learned from simulated games (scripts/sim/valueData.ts, valueFit.ts). The player inside the advice's futures
// picks its cards by it instead of by this round's score, so it plays toward what pays off later.
import { ARCHETYPES, RARITIES } from '@/data/archetypes'
import { INSTRUMENTS } from '@/data/instruments'
import { ultimateActivity } from '@/engine/game'
import type { GameState, Monster } from '@/engine/types'
import SHIPPED from '@/data/boardValue.json'

const TARGET = 950_000

/** What each owned instrument is paired with: its effect depends on these. */
const PAIRED = [...ARCHETYPES, ...RARITIES, 'act>150&qty>150', 'qty>275', 'act>255', 'log score'] as const

/** The names of the numbers a board is described by, in order. */
export const FEATURE_NAMES: string[] = [
  'bias', 'log score', 'score', 'capped score', 'root score', 'past 950,000', 'activity', 'quantity', 'top activity', 'top quantity', 'top group', 'groups',
  ...ARCHETYPES, ...RARITIES, 'act>150&qty>150', 'qty>275', 'act>255',
  'potion rerolls', 'instrument rerolls', 'instruments', 'picks pending', '8,000 reached', '28,000 reached',
  'choosing an instrument', 'instrument-only round',
  ...INSTRUMENTS.flatMap(d => [d.name, ...PAIRED.map(p => `${d.name} × ${p}`)]),
  // last, so a model fitted before they were added still reads the features it knows
  ...INSTRUMENTS.flatMap((a, i) => INSTRUMENTS.slice(i + 1).map(b => `${a.name} + ${b.name}`)),
]

/** A board as numbers of about the same size (FEATURE_NAMES). */
export function features(s: GameState): number[] {
  const { head, paired, logScore } = parts(s)
  const owned = new Set(s.instruments.map(i => i.id))
  const out = [...head]
  for (const d of INSTRUMENTS) {
    const has = owned.has(d.id) ? 1 : 0
    out.push(has, ...paired.map(f => has * f), has * logScore)
  }
  INSTRUMENTS.forEach((a, i) => INSTRUMENTS.slice(i + 1).forEach(b => out.push(owned.has(a.id) && owned.has(b.id) ? 1 : 0)))
  return out
}

const INDEX = new Map(INSTRUMENTS.map((d, i) => [d.id, i]))
/** Where each instrument's block of features starts, and each pair's feature (i < j), in FEATURE_NAMES. */
const HEAD = FEATURE_NAMES.indexOf(INSTRUMENTS[0].name), BLOCK = 2 + PAIRED.length - 1
const PAIR_AT = (i: number, j: number) => HEAD + INSTRUMENTS.length * BLOCK + i * INSTRUMENTS.length - (i * (i + 1)) / 2 + (j - i - 1)

/** The weighted sum of a board's features, reading only those that aren't 0 (most aren't owned): the same as summing
 *  every feature, several times faster, as the futures rate thousands of boards per answer. */
function weighted(s: GameState, w: number[]): number {
  const { head, paired, logScore } = parts(s)
  let v = 0
  for (let i = 0; i < head.length && i < w.length; i++) v += w[i] * head[i]
  const owned = [...new Set(s.instruments.map(i => INDEX.get(i.id)!).filter(i => i !== undefined))].sort((a, b) => a - b)
  for (const i of owned) {
    const o = HEAD + i * BLOCK
    if (o >= w.length) continue
    v += w[o]
    for (let k = 0; k < paired.length; k++) v += w[o + 1 + k] * paired[k]
    v += w[o + 1 + paired.length] * logScore
  }
  for (let a = 0; a < owned.length; a++) for (let b = a + 1; b < owned.length; b++) {
    const at = PAIR_AT(owned[a], owned[b])
    if (at < w.length) v += w[at]
  }
  return v
}

/** The features that don't depend on which instruments are owned, and what each owned one is paired with. */
function parts(s: GameState) {
  const ms = s.tanks.filter((t): t is Monster => !!t)
  const ua = ultimateActivity(s)
  const share = (ok: (m: Monster) => boolean) => ms.filter(ok).length / 6
  const logScore = Math.log1p(ua) / 14
  const paired = [
    ...ARCHETYPES.map(a => share(m => m.archetype === a)),
    ...RARITIES.map(r => share(m => m.rarity === r)),
    share(m => m.activity > 150 && m.quantity > 150), share(m => m.quantity > 275), share(m => m.activity > 255),
  ]
  const head = [
    1, logScore, ua / 1e6, Math.min(ua, TARGET) / 1e6, Math.sqrt(ua) / 1000, +(ua >= TARGET),
    ms.reduce((t, m) => t + m.activity, 0) / 1000, ms.reduce((t, m) => t + m.quantity, 0) / 3000,
    Math.max(0, ...ms.map(m => m.activity)) / 1000, Math.max(0, ...ms.map(m => m.quantity)) / 3000,
    Math.max(0, ...ms.map(m => m.activity * m.quantity)) / 3e5, ms.length / 6,
    ...paired,
    s.potionRefreshes / 3, s.instrumentRefreshes / 2, s.instruments.length / 3, s.pendingPicks, +s.thresholds.t8000, +s.thresholds.t28000,
    +(s.phase === 'instrumentSelect'), +(s.phase === 'roundEnd'),
  ]
  return { head, paired, logScore }
}

/** The instruments that fire every few rounds, for the trees: rounds until each next fires (-1 when not owned). */
const PERIODIC = INSTRUMENTS.filter(d => d.timing.kind === 'periodic')

/** A board in raw numbers for the decision trees, which find the combinations themselves (TREE_FEATURES). */
export const TREE_FEATURES: string[] = [
  'round', 'choosing an instrument', 'instrument-only round', 'potion rerolls', 'instrument rerolls', 'instruments', 'picks pending',
  '8,000 reached', '28,000 reached', 'log score', 'capped score', 'activity', 'quantity', 'top activity', 'top quantity', 'top group', 'groups',
  ...ARCHETYPES, ...RARITIES, ...RARITIES.flatMap(r => ARCHETYPES.map(a => `${r} ${a}`)), 'act>150&qty>150', 'qty>275', 'act>255',
  ...INSTRUMENTS.map(d => d.name), ...PERIODIC.map(d => `${d.name} next in`),
]

export function treeFeatures(s: GameState): number[] {
  const ms = s.tanks.filter((t): t is Monster => !!t)
  const ua = ultimateActivity(s)
  const count = (ok: (m: Monster) => boolean) => ms.filter(ok).length
  const owned = new Map(s.instruments.map(i => [i.id, i.acquiredRound]))
  const nextIn = (d: (typeof PERIODIC)[number]) => {
    const at = owned.get(d.id)
    if (at === undefined || d.timing.kind !== 'periodic') return -1
    for (let k = 0; ; k++) if (s.round + k - at > 0 && (s.round + k - at) % d.timing.every === 0) return k
  }
  return [
    s.round, +(s.phase === 'instrumentSelect'), +(s.phase === 'roundEnd'), s.potionRefreshes, s.instrumentRefreshes, s.instruments.length, s.pendingPicks,
    +s.thresholds.t8000, +s.thresholds.t28000, Math.log1p(ua), Math.min(ua, TARGET),
    ms.reduce((t, m) => t + m.activity, 0), ms.reduce((t, m) => t + m.quantity, 0),
    Math.max(0, ...ms.map(m => m.activity)), Math.max(0, ...ms.map(m => m.quantity)), Math.max(0, ...ms.map(m => m.activity * m.quantity)), ms.length,
    ...ARCHETYPES.map(a => count(m => m.archetype === a)), ...RARITIES.map(r => count(m => m.rarity === r)),
    ...RARITIES.flatMap(r => ARCHETYPES.map(a => count(m => m.rarity === r && m.archetype === a))),
    count(m => m.activity > 150 && m.quantity > 150), count(m => m.quantity > 275), count(m => m.activity > 255),
    ...INSTRUMENTS.map(d => (owned.has(d.id) ? 1 : 0)), ...PERIODIC.map(nextIn),
  ]
}

/** One decision tree: node 0 is the root; at a branch (f ≥ 0) go to l when x[f] < t, else to r; a leaf (f = -1) gives v. */
export interface Tree { f: number[]; t: number[]; l: number[]; r: number[]; v: number[] }

/**
 * Weights per round (index 0 = round 1), one per feature (a model may know only the first ones), or decision trees
 * on treeFeatures added to `base`; the prediction is in millions.
 */
export type ValueModel = { rounds: number[][] } | { base: number; trees: Tree[] }

function treeSum(m: { base: number; trees: Tree[] }, x: number[]): number {
  let v = m.base
  for (const t of m.trees) {
    let n = 0
    while (t.f[n] >= 0) n = x[t.f[n]] < t.t[n] ? t.l[n] : t.r[n]
    v += t.v[n]
  }
  return v
}

/** The board value the Solver ships with: version 2 (instrument pairs, trained on version 1's games). In 480 simulated
 *  games, with 64 instrument futures, 322 reached 950,000 against 284 for the advice before it. */
let model: ValueModel | null = SHIPPED as ValueModel
/** The model the board value uses (null: none, the board value is the score). */
export const setBoardValue = (m: ValueModel | null) => void (model = m)
export const useShippedBoardValue = () => setBoardValue(SHIPPED as ValueModel)
export const hasBoardValue = () => !!model

/** Predicted final score counted up to 950,000; once the game is over, the score itself (up to 950,000). */
export function boardValue(s: GameState): number {
  if (!model) return ultimateActivity(s)
  if (s.phase === 'gameOver') return Math.min(ultimateActivity(s), TARGET)
  let v = 0
  if ('trees' in model) v = treeSum(model, treeFeatures(s))
  else {
    v = weighted(s, model.rounds[Math.min(s.round, model.rounds.length) - 1])
  }
  return Math.max(0, Math.min(TARGET, v * 1e6))
}
