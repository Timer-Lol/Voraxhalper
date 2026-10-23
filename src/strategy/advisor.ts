// Live advice for the Solver: given what is on screen, rank the choices by expected payoff.
import { ALWAYS_TAKE, isAlwaysTake, isXenopanacea } from '@/data/xenopanacea'
import { POTIONS, potion } from '@/data/potions'
import { INSTRUMENTS } from '@/data/instruments'
import { canRefresh, cardChanges, createGame, DEFAULT_SETTINGS, ultimateActivity } from '@/engine/game'
import type { Action, Archetype, Card, GameState, Monster, Rarity } from '@/engine/types'
import { settingsForShelley } from '@/data/shelley'
import { evChooser, expected, instrumentFutures, options, potionFutures, shortlist, type InstrumentChoice, type LookAhead, type Tally } from './bot'

export interface ScreenMonster { archetype: Archetype; rarity: Rarity; activity: number; quantity: number }
export interface ScreenState {
  /** 6 entries, left to right; null = empty tank */
  tanks: (ScreenMonster | null)[]
  /** card names as printed, left to right */
  hand: string[]
  /** names of equipped instruments */
  instruments: string[]
  /** the round each instrument was picked in (as the engine counts: the round its potions are played in); round 1 when absent or 0 */
  instrumentRounds?: number[]
  /** 'potion' while choosing a potion, 'instrument' while choosing an instrument, 'protocol' in rounds 11-13 */
  phase: 'potion' | 'instrument' | 'protocol'
  round?: number
  potionRefreshes?: number
  instrumentRefreshes?: number
  /** Intern Shelley level; DEFAULT_SETTINGS when absent */
  shelley?: number
  /** (Vorax Helper) the hand is the inside of an opened Potion Kit */
  fromBox?: boolean
}
/** end: with look-ahead, the predicted end of the run (average final Ultimate Activity counted up to 950,000; share reaching 950,000, which counts as rainbow) */
export interface Ranked {
  index: number
  targets: number[]
  value: number
  end?: { activity: number; reached: number }
  /** the card changes nothing on this board (it only adds a monster, and the tanks are full) */
  noEffect?: true
  /** (Vorax Helper) the look-ahead can't tell it from the best: within the margin of error, future by future */
  even?: true
}

/** Whether the card at `index` is a Potion Kit (it opens a hand of potions). */
const isKit = (s: GameState, index: number) => {
  const c = s.hand[index]
  return c?.kind === 'potion' && typeof potion(c.id)?.targeting === 'object'
}

/** How close a do-nothing move's value must be for a move that does something to go first instead. */
const NO_EFFECT_MARGIN = 0.01

/** Marks the moves that change nothing, and puts a move that does something first when it's about as good: a
 *  card that adds to a full board came out tied for best and was advised as if it did something. */
export function markNoEffect(s: GameState, ranking: Ranked[]): Ranked[] {
  const marked = ranking.map(r => (cardChanges(s, r.index, r.targets) ? r : { ...r, noEffect: true as const }))
  const top = marked[0]
  if (!top?.noEffect) return marked
  const real = marked.find(r => !r.noEffect && r.value >= top.value * (1 - NO_EFFECT_MARGIN))
  return real ? [real, ...marked.filter(r => r !== real)] : marked
}
export interface Advice {
  /** best card (hand index) and the tanks to target, a refresh, or null when the choice doesn't change the score */
  best: Ranked | 'refresh' | null
  /** every option, best first (potion phase), or one entry per offered instrument */
  ranking: Ranked[]
  board: number
  /** with look-ahead and rerolls left: the predicted end of the run after a reroll, like a card's `end` */
  refreshEnd?: Ranked['end']
  /** true: potions judged by look-ahead to the end of the run (values: predicted final score); false: expected score after this round */
  plan: boolean
  /** no better answer is coming for this screen */
  final: boolean
  ms: number
  unknown: string[]
  /** a rule decided the advice rather than simulation: shown instead of values */
  note?: string
  /** (Vorax Helper) every option is as good as the best, as far as the look-ahead can tell */
  allEven?: true
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
const potionIds = new Map(POTIONS.map(p => [norm(p.name), p.id]))
const instrumentIds = new Map(INSTRUMENTS.map(i => [norm(i.name), i.id]))

/** The screen place of each card the game rebuilt from the screen holds (unknown names are left out of its hand). */
const places = (x: ScreenState) => x.hand.flatMap((n, i) => ((x.phase === 'potion' ? potionIds : instrumentIds).has(norm(n)) ? [i] : []))

/** Every card and instrument name the reader should know about. */
export function names() {
  return { potions: [...POTIONS.map(p => p.name), ...ALWAYS_TAKE], instruments: INSTRUMENTS.map(i => i.name), basics: INSTRUMENTS.filter(i => i.pool === 'basic').map(i => i.name) }
}

export function toState(x: ScreenState, unknown: string[]): GameState {
  const lookup = (m: Map<string, number>, n: string) => { const id = m.get(norm(n)); if (id === undefined) unknown.push(n); return id }
  const equipped = x.instruments.flatMap((n, i) => { const id = lookup(instrumentIds, n); return id === undefined ? [] : [{ id, acquiredRound: x.instrumentRounds?.[i] || 1 }] })
  const settings = x.shelley === undefined ? DEFAULT_SETTINGS : settingsForShelley(x.shelley)
  const s = createGame(settings, { tanks: null, instruments: [], startRound: 1, thresholdsUsed: { t8000: false, t28000: false }, forcedHand: [] }, 1)
  const ids = x.hand.map(n => lookup(x.phase === 'potion' ? potionIds : instrumentIds, n))
  const hand: Card[] = ids.filter((id): id is number => id !== undefined).map(id => ({ kind: x.phase === 'potion' ? 'potion' : 'instrument', id }))
  const round = x.round ?? 1
  const had = equipped.length + (x.phase === 'instrument' ? 1 : 0)
  return {
    ...s,
    tanks: x.tanks.map(t => (t ? ({ ...t } as Monster) : null)),
    instruments: equipped,
    round,
    phase: x.phase === 'potion' ? 'potionSelect' : 'instrumentSelect',
    hand,
    potionRefreshes: x.potionRefreshes ?? 0,
    instrumentRefreshes: x.instrumentRefreshes ?? 0,
    // past thresholds only matter for whether more instruments are coming: from what's equipped, and an
    // instrument offer on screen past the first is the reward of the next threshold
    thresholds: { t8000: had >= 2, t28000: had >= 3 },
    // (Vorax Helper) choosing inside an opened Potion Kit: five cards is the Large kit (33), three a Small one (34)
    ...(x.fromBox && x.phase === 'potion' ? { openBox: hand.length >= 4 ? 33 : 34 } : {}),
    log: [],
  }
}

/** Potion look-ahead: each card on offer, the next best options up to 4, and a reroll, each played to the end of the run 64 times;
 *  the rounds inside steer toward what the instruments need (steer 0.3: 50% reached 950k in 240 games against 47% without, within luck).
 *  64 futures rather than 32, with instruments judged up to 950k (INSTRUMENT_FUTURES): 63.9% of 360 simulated games reached 950k
 *  against 58.6%. The rounds and instrument offers inside are played by the smarter player (value: the board value,
 *  src/strategy/value.ts), which replaces the steer. */
export const LOOK_AHEAD: LookAhead = { top: 4, playouts: 64, steer: 0.3, value: true }

/** Futures per instrument choice, each judged by its final score counted up to 950k (64 rather than 32: 152 of 240
 *  simulated games reached 950k against 143; spread over the CPU cores it still answers in about a second). */
export const INSTRUMENT_FUTURES = 64

/** How the rounds inside an instrument choice's futures are played: by the smarter player (the board value). */
const INSTRUMENT_ROLLOUT = { samples: 4, horizon: 0, value: true }

/** A few rounds of look-ahead, only to order options that score the same this round. */
const TIE_BREAK = { samples: 32, horizon: 4 }

/**
 * Options tied with the best this round (say, the same potion on two equal tanks) are put in order by
 * playing a few more rounds, so the board the build needs (two Bone Sentries for Adherent Metatarsals)
 * isn't given up on a coin flip.
 */
function breakTies(s: GameState, ranking: Ranked[], seed: number): Ranked[] {
  const tied = ranking.filter(r => r.value === ranking[0]?.value)
  if (tied.length < 2) return ranking
  const toAction = (r: Ranked) => [{ type: 'selectCard', index: r.index } as const, ...r.targets.map(tank => ({ type: 'toggleTarget', tank }) as const), { type: 'confirm' } as const]
  const ahead = new Map(tied.map(r => [r, expected(s, toAction(r), TIE_BREAK, seed)]))
  return [...tied.sort((a, b) => ahead.get(b)! - ahead.get(a)!), ...ranking.slice(tied.length)]
}

/** The futures a board's advice needs, as plain data, so slices of them can be played on other CPU cores. */
export type Work =
  | { kind: 'potion'; s: GameState; seed: number; la: LookAhead; opts: { o: Action[]; v: number }[]; futures: number }
  | { kind: 'instrument'; s: GameState; seed: number; choices: InstrumentChoice[]; futures: number }

/** A board's advice before its futures are played: the futures to play, or the advice already (no futures needed). */
export type Prepared = { advice: Advice } | { work: Work; x: ScreenState; unknown: string[]; t0: number }

const SEED = 0x5eed

/** The advice that needs no futures (a protocol, a Xenopanacea), or the futures to play for it: `futures` per option
 *  (default LOOK_AHEAD's for potions, INSTRUMENT_FUTURES for instruments). */
export function prepare(x: ScreenState, futures?: number): Prepared {
  const t0 = Date.now(); const unknown: string[] = []
  // Surgical Protocols change the endgame battle, not Ultimate Activity
  if (x.phase === 'protocol') return { advice: { best: null, ranking: [], board: 0, plan: false, final: true, ms: 0, unknown } }
  // a ULT the simulator can't play out (a Xenopanacea, a Holy Water rite) is always taken: it's worth more than
  // anything beside it
  const xeno = x.phase === 'potion' ? x.hand.findIndex(isAlwaysTake) : -1
  if (xeno >= 0) {
    const pick = { index: xeno, targets: [], value: 0 }
    const note = isXenopanacea(x.hand[xeno]) ? 'A Xenopanacea: always take it when it’s offered.' : `${x.hand[xeno]}: always take it when it’s offered.`
    return { advice: { best: pick, ranking: [pick], board: ultimateActivity(toState({ ...x, hand: [] }, [])), plan: false, final: true, ms: Date.now() - t0, unknown, note } }
  }
  const s = { ...toState(x, unknown), log: [] }
  const work: Work = s.phase === 'potionSelect'
    ? { kind: 'potion', s, seed: SEED, la: { ...LOOK_AHEAD, playouts: futures ?? LOOK_AHEAD.playouts }, opts: shortlist(s, SEED, LOOK_AHEAD), futures: futures ?? LOOK_AHEAD.playouts }
    : { kind: 'instrument', s, seed: SEED, choices: [...s.hand.map((_, i) => i), ...(canRefresh(s) ? ['refresh' as const] : [])], futures: futures ?? INSTRUMENT_FUTURES }
  return { work, x, unknown, t0 }
}

/** Futures `from` to `to` (excluded) of every option; slices add up to the whole (Tally). */
export function playWork(w: Work, from: number, to: number): Tally[] {
  return w.kind === 'potion'
    ? potionFutures(w.s, w.seed, w.la, w.opts.map(c => c.o), from, to)
    : instrumentFutures(w.s, w.seed, w.choices, evChooser(INSTRUMENT_ROLLOUT), 'target', from, to, true)
}

/** Adds up slices of futures, option by option. */
export const addTallies = (parts: Tally[][]): Tally[] =>
  parts[0].map((_, i) => parts.reduce<Tally>((t, p) => ({ goal: t.goal + p[i].goal, reached: t.reached + p[i].reached, n: t.n + p[i].n, v: [...t.v!, ...(p[i].v ?? [])] }), { goal: 0, reached: 0, n: 0, v: [] }))

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

/** Marks the options as good as the advised one, and drops the futures they were judged on. */
function markEven(best: Advice['best'], ranking: (Ranked & { _v?: [number, number][] })[]): { ranking: Ranked[]; allEven: boolean } {
  const same = (a: Ranked, b: Ranked) => a.index === b.index && String(a.targets) === String(b.targets)
  const top = best && best !== 'refresh' ? ranking.find(r => same(r, best)) : undefined
  const out = ranking.map(({ _v, ...r }) => (top && !same(r, top) && asGood(top._v, _v) ? { ...r, even: true as const } : r))
  const others = out.filter(r => !(top && same(r, top)))
  return { ranking: out, allEven: !!top && others.length > 0 && others.every(r => r.even) }
}

/** The advice from the futures played (every option's totals). */
export function conclude(p: Exclude<Prepared, { advice: Advice }>, tallies: Tally[]): Advice {
  const { work: w, x } = p
  const s = w.s
  let ranking: (Ranked & { _v?: [number, number][] })[]
  let best: Advice['best']
  let refreshEnd: Advice['refreshEnd']
  if (w.kind === 'potion') {
    const ahead = w.opts.map((c, i) => ({ o: c.o, goal: tallies[i].goal / tallies[i].n, reached: tallies[i].reached / tallies[i].n, v: tallies[i].v })).sort((a, b) => b.goal - a.goal)
    const reroll = ahead.find(a => a.o[0].type === 'refresh')
    if (reroll) refreshEnd = { activity: reroll.goal, reached: reroll.reached }
    ranking = markNoEffect(s, ahead.filter(a => a !== reroll).map(a => ({ ...toRanked(a.o, Math.round(a.goal)), end: { activity: a.goal, reached: a.reached }, _v: a.v })))
    best = ahead[0] === reroll ? 'refresh' : ranking[0]
    // a Potion Kit on offer is taken before a refresh (a player's rule: the look-ahead rated refreshes above
    // kits on 7 of 12 live boards where it was offered)
    if (best === 'refresh') best = ranking.find(r => isKit(s, r.index)) ?? best
  } else {
    const mean = (t: Tally) => t.goal / t.n
    ranking = w.choices.flatMap((c, i) => (c === 'refresh' ? [] : [{ index: c, targets: [], value: Math.round(mean(tallies[i])), end: { activity: mean(tallies[i]), reached: tallies[i].reached / tallies[i].n }, _v: tallies[i].v }])).sort((a, b) => b.value - a.value)
    const r = w.choices.indexOf('refresh')
    if (r >= 0) refreshEnd = { activity: mean(tallies[r]), reached: tallies[r].reached / tallies[r].n }
    best = refreshEnd && refreshEnd.activity > ranking[0].value ? 'refresh' : ranking[0]
  }
  const even = markEven(best, ranking)
  return onScreen(x, { best: best && best !== 'refresh' ? even.ranking.find(r => r.index === best.index && String(r.targets) === String(best.targets)) ?? best : best, ranking: even.ranking, board: ultimateActivity(s), plan: w.kind === 'potion', final: true, ms: Date.now() - p.t0, unknown: p.unknown, refreshEnd, ...(even.allEven ? { allEven: true as const } : {}) })
}

const toRanked = (o: Action[], value: number): Ranked => ({
  index: (o[0] as { index: number }).index,
  targets: o.flatMap(a => (a.type === 'toggleTarget' ? [a.tank] : [])),
  value,
})

/** The engine's hand leaves unknown cards out: each choice gets its place on screen. */
function onScreen(x: ScreenState, a: Advice): Advice {
  const at = places(x)
  const place = (r: Ranked): Ranked => ({ ...r, index: at[r.index] })
  return { ...a, ranking: a.ranking.map(place), best: a.best && a.best !== 'refresh' ? place(a.best) : a.best }
}

/**
 * Rank the current choices on this thread. `samples`: fresh outcomes per potion option, when not planning.
 * `plan`: judge potions by how the run ends (look-ahead) instead of this round's score (~10 ms). Instruments are
 * always judged by how the run ends. adviseOn (the Solver's) plays the same futures over several CPU cores.
 */
export function advise(x: ScreenState, samples = 16, plan = false): Advice {
  if (x.phase !== 'potion' || plan) {
    const p = prepare(x)
    return 'advice' in p ? p.advice : conclude(p, playWork(p.work, 0, p.work.futures))
  }
  const t0 = Date.now(); const unknown: string[] = []
  const xeno = x.hand.findIndex(isAlwaysTake)
  if (xeno >= 0) return (prepare(x) as { advice: Advice }).advice
  const s = toState(x, unknown)
  const ranking = markNoEffect(s, breakTies(s, options(s).map(o => toRanked(o, Math.round(expected(s, o, { samples, horizon: 0 }, SEED)))).sort((a, b) => b.value - a.value), SEED))
  let best: Advice['best'] = ranking[0] && !(ranking[0].value <= ultimateActivity(s) && s.potionRefreshes > 0) ? ranking[0] : 'refresh'
  if (best === 'refresh') best = ranking.find(r => isKit(s, r.index)) ?? best
  return onScreen(x, { best, ranking, board: ultimateActivity(s), plan: false, final: false, ms: Date.now() - t0, unknown })
}
