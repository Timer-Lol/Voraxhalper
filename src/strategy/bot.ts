// Strategy bots for Surgical Preparation. Every policy judges a move by its *expected* payoff:
// the move is replayed under K fresh random outcomes (the real RNG state is never peeked at)
// and the outcomes are averaged.
import { createGame, dispatch, ultimateActivity, needsTargets, canRefresh, DEFAULT_SETTINGS } from '@/engine/game'
import type { GameState, Action, SandboxSetup } from '@/engine/types'
import { BASIC_POOL, INSTRUMENTS } from '@/data/instruments'
import { buildProgress } from './steer'
import { boardValue } from './value'
import STRENGTH from '@/data/instrumentStrength.json'

export const play = (s: GameState, ...a: Action[]) => a.reduce((x, y) => dispatch(x, y).state, s)

/** Every way to play the current hand: [select, ...targets, confirm]. */
export function options(s: GameState): Action[][] {
  const out: Action[][] = []
  s.hand.forEach((_, i) => {
    const sel = play(s, { type: 'selectCard', index: i })
    const mode = needsTargets(sel)
    const tanks = sel.tanks.flatMap((t, k) => (t ? [k] : []))
    const pick: Action = { type: 'selectCard', index: i }
    if (!mode) out.push([pick, { type: 'confirm' }])
    else {
      for (const t of tanks) out.push([pick, { type: 'toggleTarget', tank: t }, { type: 'confirm' }])
      if (mode === 'select1to2')
        for (const a of tanks) for (const b of tanks) if (a < b) out.push([pick, { type: 'toggleTarget', tank: a }, { type: 'toggleTarget', tank: b }, { type: 'confirm' }])
    }
  })
  return out
}

const reseed = (s: GameState, seed: number): GameState => ({ ...s, rngState: seed >>> 0 })
export const mix = (a: number, b: number) => (Math.imul(a ^ (b + 0x9e3779b9), 0x85ebca6b) ^ (a >>> 13)) >>> 0

export interface Policy {
  /** fresh random outcomes averaged per option */
  samples: number
  /** remaining rounds played by a cheap rollout after the move (0 = judge on this round's result) */
  horizon: number
  /** fresh outcomes averaged per option inside the rollout (1 = judge on a single outcome) */
  rollSamples?: number
  /**
   * Steer toward what the instruments need: a board is worth its score times (1 + steer x buildProgress).
   * Used for the rounds inside the advice's futures, so they build toward the instruments' conditions.
   */
  steer?: number
  /**
   * Judge boards by the board value (the final score games from them tend to reach) instead of their score: the
   * player inside the futures then plays toward what pays off later. Overrides steer.
   */
  value?: boolean
}

/** Value a bot assigns to a board. cap = Infinity -> plain score (default). A finite cap makes score above the target worthless (sweeps). */
export const utility = { cap: Infinity }
const U = (s: Pick<GameState, 'tanks'>) => Math.min(ultimateActivity(s), utility.cap)
const worth = (s: GameState, steer = 0, value = false) => (value ? boardValue(s) : U(s) * (steer ? 1 + steer * buildProgress(s) : 1))

/** Score of a state after resolving any open box the best way (by expectation, recursively). */
function settle(s: GameState, p: Policy, seed: number, depth: number): number {
  if (s.phase === 'potionSelect' && s.openBox !== null && depth < 2) {
    let best = -1
    for (const o of options(s)) best = Math.max(best, expected(s, o, p, seed, depth + 1))
    return best
  }
  return rollout(s, p.horizon, seed, p.rollSamples ?? 1, p.steer, p.value)
}

/** Open a box (if any) and take its first card; only used inside rollouts. */
const resolveBox = (n: GameState) => (n.phase === 'potionSelect' && n.openBox !== null ? play(n, ...options(n)[0]) : n)

/**
 * Lookahead: play `rounds` more rounds. Each round's card is the one with the best mean over
 * `samples` fresh outcomes (common seeds across options); the round then plays out on one more fresh outcome.
 */
function rollout(s: GameState, rounds: number, seed: number, samples: number, steer = 0, value = false): number {
  for (let r = 0; r < rounds && s.phase !== 'gameOver'; r++) {
    if (s.phase === 'roundEnd') { s = play(s, { type: 'confirm' }); continue }
    if (s.phase === 'instrumentSelect') { s = play(s, { type: 'selectCard', index: priorPick(s) }, { type: 'confirm' }); continue }
    let best = options(s)[0], bv = -1
    for (const o of options(s)) {
      let v = 0
      for (let k = 0; k < samples; k++) v += worth(resolveBox(play(reseed(s, mix(seed, r * 977 + k)), ...o)), steer, value)
      if (v > bv) { bv = v; best = o }
    }
    s = resolveBox(play(reseed(s, mix(seed, r * 977 + 500)), ...best))
  }
  return worth(s, steer, value)
}

/** Mean payoff of playing option `o`, over p.samples fresh outcomes (common seeds across options). */
export function expected(s: GameState, o: Action[], p: Policy, seed: number, depth = 0): number {
  // a box's contents are judged with fewer samples, or nested boxes blow up K × K × options
  const n = depth === 0 ? p.samples : Math.max(2, p.samples >> 2)
  let sum = 0
  for (let k = 0; k < n; k++) {
    const sk = mix(seed, k + 1 + depth * 101)
    sum += settle(play(reseed(s, sk), ...o), p, sk, depth)
  }
  return sum / n
}

/**
 * Best option by expected payoff, and its value. Steered, the value is given as a score (the gain over the
 * board's worth added to its score), so callers comparing it with the board's score still can.
 */
export function choose(s: GameState, p: Policy, seed: number) {
  const slim = { ...s, log: [] }
  let best: Action[] = [], bv = -Infinity
  for (const o of options(slim)) {
    const v = expected(slim, o, p, seed)
    if (v > bv) { bv = v; best = o }
  }
  // judged by the board value, the hand is weak (refresh it while refreshes last) when the best card leads to a
  // board worth less than this one, whose value is what an average hand brings
  if (p.value) return { best, value: bv, stay: boardValue(slim) }
  return { best, value: p.steer ? bv - worth(slim, p.steer) + ultimateActivity(slim) : bv }
}

/** Old bot: judged each move on the game's own next random outcome (it could see the dice). */
export function choosePeek(s: GameState) {
  const value = (x: GameState, d = 0): number =>
    x.phase === 'potionSelect' && x.openBox !== null && d < 2 ? Math.max(...options(x).map(o => value(play(x, ...o), d + 1))) : ultimateActivity(x)
  let best: Action[] = [], bv = -1
  for (const o of options(s)) { const v = value(play(s, ...o)); if (v > bv) { bv = v; best = o } }
  return { best, value: bv }
}

export interface Plan { label: string; basic: number; adv: number[] }
/** basics in general strength order, used when the wanted basic never shows */
export const BASIC_FALLBACK = [2, 6, 4, 7, 1, 3, 8, 5]

/** `stay`: what `value` must beat for the hand to be played rather than refreshed (default: the board's score). */
export type Chooser = (s: GameState, seed: number) => { best: Action[]; value: number; stay?: number }
export const evChooser = (p: Policy): Chooser => (s, seed) => choose(s, p, seed)
export const peekChooser: Chooser = s => choosePeek(s)

/**
 * Strength of each instrument by id, from src/data/instrumentStrength.json (scripts/sim/strength.sh, rerun
 * by the strengths workflow whenever the odds change). Only used for instrument picks *inside* playouts,
 * where a full board-aware pick would be too slow.
 */
export const PRIOR: Record<number, number> = Object.fromEntries(INSTRUMENTS.map(d => [d.id, (STRENGTH.strength as Record<string, number>)[d.name] ?? 0]))
const priorPick = (s: GameState) => s.hand.reduce((b, c, i) => ((PRIOR[c.id] ?? 0) > (PRIOR[s.hand[b].id] ?? 0) ? i : b), 0)

const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a[a.length >> 1] }
const BASIC_IDS = new Set(BASIC_POOL.map(d => d.id))
const MEDIAN_PRIOR = {
  basic: median(Object.entries(PRIOR).filter(([id]) => BASIC_IDS.has(+id)).map(([, v]) => v)),
  advanced: median(Object.entries(PRIOR).filter(([id]) => !BASIC_IDS.has(+id)).map(([, v]) => v)),
}

/** Inside playouts: the strongest offered instrument, but a below-median offer is refreshed while refreshes last. */
export const refreshingPriorPicker: InstrumentPicker = s => {
  const i = priorPick(s)
  const pool = BASIC_IDS.has(s.hand[i].id) ? 'basic' : 'advanced'
  return (PRIOR[s.hand[i].id] ?? 0) < MEDIAN_PRIOR[pool] && canRefresh(s) ? 'refresh' : i
}

/**
 * The score the advice aims for: 950,000 on the board, which the endgame battle bonus takes to rainbow, so
 * it counts as rainbow here. Playouts are scored by their final Ultimate Activity counted up to it: every
 * point below counts, nothing above does, so the advice pushes runs as high as it can without gambling past it.
 */
export const TARGET = 950_000
/** The goal in use: upstream's 950,000 unless the player sets their own (the helper passes its target score). */
export const goal = { target: TARGET }
/** goal.target, reachable where a parameter called `goal` hides the object */
const target = () => goal.target
export const goalScore = (ua: number) => Math.min(ua, target())

/** How an instrument offer is answered: return a hand index, or 'refresh'. */
export type InstrumentPicker = (s: GameState, seed: number) => number | 'refresh'

/** Fixed wish list (the old way): refresh until a wanted instrument shows, ignoring the board. */
export const planPicker = (plan: Plan): InstrumentPicker => s => {
  const ids = s.hand.map(c => c.id)
  const basicStage = s.instruments.length === 0
  const wish = basicStage ? [plan.basic] : plan.adv
  if (!wish.some(w => ids.includes(w)) && canRefresh(s)) return 'refresh'
  const order = basicStage ? [...wish, ...BASIC_FALLBACK] : [...wish, ...ids]
  return ids.indexOf(order.find(w => ids.includes(w))!)
}
export const priorPicker: InstrumentPicker = s => priorPick(s)

/** Inside playouts, by the board value: the offered instrument whose board is worth most, or a refresh while refreshes
 *  last when none beats the board before the pick (what an average offer brings). */
export const valuePicker: InstrumentPicker = s => {
  const vals = s.hand.map((_, i) => boardValue(play(s, { type: 'selectCard', index: i }, { type: 'confirm' })))
  const best = vals.indexOf(Math.max(...vals))
  return canRefresh(s) && vals[best] < boardValue(s) ? 'refresh' : best
}

/**
 * Board-aware: each offered instrument (and a refresh) is played out to the end of the game
 * `playouts` times from the current board; the best average final score wins.
 * Playouts use common seeds across options so the comparison is fair.
 */
/**
 * What an instrument choice is judged by. 'target': the score counted up to TARGET, with weak offers
 * refreshed inside playouts so a refresh kept has a value. 'mean': average final score, and playouts
 * never refresh (which made spending a refresh look free).
 */
export type Goal = 'target' | 'mean'

/** Totals over some of an option's futures: the goal value summed, how many reached TARGET, and how many were played.
 *  Futures are numbered and seeded by their number, so totals over slices of them (one per CPU core) add up to the
 *  totals over all of them. */
/** v: (Vorax Helper) each future's goal value by its number, so two options are compared future by future (tli-warden's paired error) */
export interface Tally { goal: number; reached: number; n: number; v?: [number, number][] }

/** An instrument offer's answer: the card at a hand index, or a refresh. */
export type InstrumentChoice = number | 'refresh'

/** Futures `from` to `to` (excluded) of each instrument choice, played to the end of the run. */
/** `smart`: later instrument offers inside the futures are answered by the board value (valuePicker). */
export function instrumentFutures(s: GameState, seed: number, choices: InstrumentChoice[], rollout: Chooser, goal: Goal, from: number, to: number, smart = false): Tally[] {
  const slim = { ...s, log: [] }
  const picker = smart ? valuePicker : goal === 'target' ? refreshingPriorPicker : priorPicker
  const value = goal === 'target' ? (x: GameState) => goalScore(ultimateActivity(x)) : ultimateActivity
  return choices.map(c => {
    const t: Tally = { goal: 0, reached: 0, n: 0, v: [] }
    for (let k = from; k < to; k++) {
      const sk = mix(seed, 7000 + k)
      const x = reseed(slim, sk)
      const end = finish(c === 'refresh' ? play(x, { type: 'refresh' }) : play(x, { type: 'selectCard', index: c }, { type: 'confirm' }), sk, rollout, picker)
      t.goal += value(end)
      t.v!.push([k, value(end)])
      if (ultimateActivity(end) >= target()) t.reached++
      t.n++
    }
    return t
  })
}

/** offers/refresh: mean goal value per option; reached/refreshReached: the share of its playouts that reached TARGET */
export function rankInstruments(s: GameState, seed: number, playouts: number, rollout: Chooser, goal: Goal = 'target', refreshPlayouts = playouts, smart = false): { offers: number[]; refresh: number | null; reached: number[]; refreshReached: number | null } {
  const each = instrumentFutures(s, seed, s.hand.map((_, i) => i), rollout, goal, 0, playouts, smart)
  // a refresh's value rests on which offers come next, so it may be given more futures than an offered instrument
  const r = canRefresh(s) ? instrumentFutures(s, seed, ['refresh'], rollout, goal, 0, refreshPlayouts, smart)[0] : null
  return { offers: each.map(e => e.goal / e.n), refresh: r && r.goal / r.n, reached: each.map(e => e.reached / e.n), refreshReached: r && r.reached / r.n }
}

export const boardPicker = (playouts: number, rollout: Chooser, goal: Goal = 'target', refreshPlayouts = playouts, smart = false): InstrumentPicker => (s, seed) => {
  const { offers, refresh } = rankInstruments(s, seed, playouts, rollout, goal, refreshPlayouts, smart)
  const best = offers.indexOf(Math.max(...offers))
  return refresh !== null && refresh > offers[best] ? 'refresh' : best
}

export interface LookAhead {
  /** options (best by this round's score) played to the end of the run */
  top: number
  /** futures played per option */
  playouts: number
  /** how hard the rounds inside the futures steer toward what the instruments need (Policy.steer) */
  steer?: number
  /** outcomes averaged per option in each round inside the futures (default 2) */
  innerSamples?: number
  /** the rounds and instrument offers inside the futures are judged by the board value (Policy.value) */
  value?: boolean
  /**
   * Successive halving, for about the same number of futures: 8 for every option, the better half (at
   * least 2) 16 more, the best 2 another 32, so close calls get the most futures.
   */
  halving?: boolean
  /**
   * (Vorax Helper) Options the futures can't tell apart from the best (asGood) are played this many times more
   * futures each, then the best mean is taken. On 480 mid-run boards, against picks checked on 600 other futures:
   * +2.4k (±1.2k) where it changed something (+1.2k with once as many again), while taking the as-good option worth
   * most this round instead lost 10.5k (±2.6k): the futures see what this round's score doesn't, but 64 of them leave
   * close calls to luck.
   */
  settle?: number
}

/** (Vorax Helper) Whether two options' futures can't tell them apart: their mean difference, future by future, within
 *  1.96 standard errors (tli-warden's also_good). Unknown (false) with fewer than 8 futures in common. */
export function asGood(a?: [number, number][], b?: [number, number][]): boolean {
  if (!a || !b) return false
  const m = new Map(a)
  let n = 0, sum = 0, sq = 0
  for (const [k, y] of b) {
    const x = m.get(k)
    if (x === undefined) continue
    const d = x - y
    n++; sum += d; sq += d * d
  }
  if (n < 8) return false
  const mean = sum / n
  return Math.abs(mean) <= 1.96 * Math.sqrt(Math.max(0, sq / n - mean * mean) / n)
}

/** One option played to the end: this round's expected score, and over its futures the mean score counted
 *  up to TARGET and the share that reached it. */
export interface Ahead { o: Action[]; now: number; goal: number; reached: number }

/**
 * Potions judged by how the whole run ends. Played to the end `playouts` times each, with the instruments
 * owned, future instruments picked by strength, and cards dealt by the live odds: each card on offer (on its
 * best target this round, so a card that only pays off later still gets looked at), then the next best
 * options up to `top`, and a reroll while rerolls are left. Best average score counted up to TARGET first.
 */
/** The options lookAhead plays to the end, with this round's expected score (`v`): each card on its best target
 *  this round, the next best options up to `top`, and a reroll while rerolls are left. */
export function shortlist(s: GameState, seed: number, la: LookAhead): { o: Action[]; v: number }[] {
  const slim = { ...s, log: [] }
  const quick = { samples: 8, horizon: 0 }
  const now = options(slim).map(o => ({ o, v: expected(slim, o, quick, seed) })).sort((a, b) => b.v - a.v)
  const cardOf = (o: Action[]) => (o[0] as { index: number }).index
  const list = now.filter((c, i) => now.findIndex(d => cardOf(d.o) === cardOf(c.o)) === i)
  for (const c of now) if (list.length < la.top && !list.includes(c)) list.push(c)
  if (slim.openBox === null && canRefresh(slim)) list.push({ o: [{ type: 'refresh' }], v: ultimateActivity(slim) })
  return list
}

/** Futures `from` to `to` (excluded) of each potion option, played to the end of the run. */
export function potionFutures(s: GameState, seed: number, la: LookAhead, opts: Action[][], from: number, to: number): Tally[] {
  const slim = { ...s, log: [] }
  const inner = evChooser({ samples: la.innerSamples ?? 2, horizon: 0, steer: la.steer, value: la.value })
  return opts.map(o => {
    const t: Tally = { goal: 0, reached: 0, n: 0, v: [] }
    for (let k = from; k < to; k++) {
      const sk = mix(seed, 9000 + k)
      const ua = ultimateActivity(finish(play(reseed(slim, sk), ...o), sk, inner, la.value ? valuePicker : priorPicker))
      t.goal += goalScore(ua)
      t.v!.push([k, goalScore(ua)])
      if (ua >= target()) t.reached++
      t.n++
    }
    return t
  })
}

export function lookAhead(s: GameState, seed: number, la: LookAhead): Ahead[] {
  const runs = shortlist(s, seed, la).map(c => ({ c, n: 0, goal: 0, reached: 0, v: [] as [number, number][] }))
  const playMore = (r: (typeof runs)[number], n: number) => {
    const [t] = potionFutures(s, seed, la, [r.c.o], r.n, r.n + n)
    r.goal += t.goal
    r.reached += t.reached
    r.n += n
    r.v.push(...(t.v ?? []))
  }
  const mean = (r: (typeof runs)[number]) => r.goal / r.n
  if (la.halving) {
    let alive = runs
    for (const [n, keep] of [[8, Math.max(2, Math.ceil(runs.length / 2))], [16, 2], [32, 0]] as const) {
      for (const r of alive) playMore(r, n)
      if (keep) alive = [...alive].sort((a, b) => mean(b) - mean(a)).slice(0, keep)
    }
  } else {
    for (const r of runs) playMore(r, la.playouts)
    if (la.settle) {
      const best = runs.reduce((a, b) => (mean(b) > mean(a) ? b : a))
      const tied = runs.filter(r => r !== best && asGood(best.v, r.v))
      if (tied.length) for (const r of [best, ...tied]) playMore(r, la.playouts * la.settle)
    }
  }
  // options dropped early keep their estimate from fewer futures, below the ones kept
  return runs
    .map(r => ({ o: r.c.o, now: r.c.v, goal: mean(r), reached: r.reached / r.n, n: r.n }))
    .sort((a, b) => (la.halving ? b.n - a.n : 0) || b.goal - a.goal)
    .map(a => ({ o: a.o, now: a.now, goal: a.goal, reached: a.reached }))
}

/** lookAhead's best option; `value` stays this round's expected score, which finish() compares with the board to decide on a refresh. */
export const planChooser = (la: LookAhead): Chooser => (s, seed) => {
  const best = lookAhead(s, seed, la)[0]
  return { best: best?.o ?? [], value: best?.now ?? -1 }
}

/** Play a game on from state `s` to the end. */
export function finish(s: GameState, seed: number, chooser: Chooser, picker: InstrumentPicker, onPick?: (s: GameState, pick: number | 'refresh') => void, fixHand?: (s: GameState) => GameState): GameState {
  for (let g = 0; g < 300 && s.phase !== 'gameOver'; g++) {
    s = { ...s, log: [] }
    if (s.phase === 'roundEnd') { s = play(s, { type: 'confirm' }); continue }
    if (s.phase === 'instrumentSelect') {
      if (fixHand) s = fixHand(s)
      const pick = picker(s, mix(seed, 5000 + g))
      onPick?.(s, pick)
      s = pick === 'refresh' ? play(s, { type: 'refresh' }) : play(s, { type: 'selectCard', index: pick }, { type: 'confirm' })
      continue
    }
    const { best, value, stay } = chooser(s, mix(seed, g))
    // refresh a potion hand only when nothing in it is expected to beat the current board
    if (s.openBox === null && value <= (stay ?? U(s)) && canRefresh(s)) { s = play(s, { type: 'refresh' }); continue }
    s = play(s, ...best)
  }
  return s
}

/**
 * One game. `setup` given = sandbox with fixed instruments from round 1 (pair/trio sweeps).
 * No setup = realistic: everything dealt, refreshes used like a player would.
 */
export function runGame(seed: number, chooser: Chooser, picker: InstrumentPicker = priorPicker, setup?: SandboxSetup, onPick?: (s: GameState, pick: number | 'refresh') => void): GameState {
  return finish(createGame(DEFAULT_SETTINGS, setup, seed), seed, chooser, picker, onPick)
}

export function stats(xs: number[]) {
  const a = [...xs].sort((x, y) => x - y); const n = a.length; const m = a.reduce((p, c) => p + c, 0) / n
  const sd = Math.sqrt(a.reduce((p, c) => p + (c - m) ** 2, 0) / Math.max(1, n - 1))
  return { n, mean: Math.round(m), ci95: Math.round(1.96 * sd / Math.sqrt(n)), median: a[n >> 1], p10: a[Math.floor(n * 0.1)], p90: a[Math.floor(n * 0.9)], rainbowPct: +(100 * a.filter(x => x >= 1_120_000).length / n).toFixed(1) }
}
