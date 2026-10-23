// Browser-facing API for the Vorax Helper site. Everything here runs on the page (no server).
import { POTIONS, isBox } from '@/data/potions'
import { INSTRUMENTS } from '@/data/instruments'
import { HOLY_WATER_RITES, XENOPANACEA } from '@/data/xenopanacea'
import { addTallies, advise, conclude, prepare, toState, type Advice, type ScreenState, type Work } from '@/strategy/advisor'
import { canRefresh, ultimateActivity } from '@/engine/game'
import { evChooser, finish, options, play, type Tally } from '@/strategy/bot'
import { boardValue } from '@/strategy/value'
import { DEFAULT_TAU, tablePicker, tableValue, type Tables } from '@/strategy/pickers'
import type { GameState } from '@/engine/types'
import TABLES_JSON from '../../data/tables.json'

export const TABLES = TABLES_JSON as Tables
export type HelperInput = ScreenState & { /** choosing from an opened Potion Kit */ fromBox?: boolean }

const clean = (t: string) => t.replace(/\{(\w+)\}/g, (_, k: string) => (k === 'qty' || k === 'act' ? '' : k === 'BoneSentry' ? 'Bone Sentry' : k))

export function catalog() {
  return {
    potions: POTIONS.map(p => ({ id: p.id, name: p.name, rarity: p.rarity, box: isBox(p), targeting: typeof p.targeting === 'object' ? 'box' : p.targeting, text: clean(p.text) })).concat(XENOPANACEA.map((n, i) => ({ id: 900 + i, name: n, rarity: 'supreme' as never, box: false, targeting: 'none' as never, text: 'Effect not printed on the card. Always take it.' })))
      .concat(HOLY_WATER_RITES.map((n, i) => ({ id: 950 + i, name: n, rarity: 'supreme' as never, box: false, targeting: 'none' as never, text: 'A Holy Water rite: its effect is another card later (Confession gives a Ritual Holy Water the next round). Always take it.' }))),
    instruments: INSTRUMENTS.map(i => ({ id: i.id, name: i.name, pool: i.pool, text: clean(i.text) })),
    threshold: TABLES.threshold,
  }
}

const mix = (a: number, b: number) => (Math.imul(a ^ (b + 0x9e3779b9), 0x85ebca6b) ^ (a >>> 13)) >>> 0
const reseed = (s: GameState, seed: number): GameState => ({ ...s, rngState: seed >>> 0 })
// the kit that was opened: five cards is the Large kit; three is a Small one (both Small kits deal alike)
const LARGE_KIT = 33, SMALL_KIT = 34

function build(x: HelperInput) {
  const unknown: string[] = []
  const s = toState(x, unknown)
  if (x.fromBox && s.phase === 'potionSelect') s.openBox = x.hand.length >= 4 ? LARGE_KIT : SMALL_KIT
  return { s: { ...s, log: [] }, unknown }
}

/** Instant answer: this round's expected score for every play (potions), or the sweep tables (instruments). */
export function quick(x: HelperInput): Advice {
  return advise(x, 16, false)
}

export interface InstrumentAdvice {
  stage: 0 | 1 | 2
  tau: number
  rows: { index: number; id: number; name: string; value: number | null }[]
  action: 'take' | 'refresh'
  best: number | null
  refreshesLeft: number
  why: string
}

/** Instrument picks use the validated strategy: take the best offer by sweep value, refresh while it is below tau. */
export function instrumentAdvice(x: HelperInput, tau = DEFAULT_TAU): InstrumentAdvice {
  const { s } = build(x)
  const have = s.instruments.map(i => i.id)
  const stage = Math.min(have.length, 2) as 0 | 1 | 2
  const rows = s.hand.map((c, index) => ({ index, id: c.id, name: INSTRUMENTS.find(i => i.id === c.id)?.name ?? '?', value: tableValue(TABLES, have, c.id) ?? null }))
  const known = rows.filter(r => r.value !== null)
  const best = known.length ? known.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a)).index : null
  const bv = best === null ? null : (rows[best].value as number)
  const t = tau[stage]
  const canRef = s.instrumentRefreshes > 0
  const action = bv !== null && bv < t && canRef ? 'refresh' : 'take'
  const stageName = ['first (basic)', 'second (advanced)', 'third (advanced)'][stage]
  const why = bv === null
    ? 'No sweep data for this combination yet; the fixed ranking picks for you.'
    : action === 'refresh'
      ? `Best offer is worth ${(bv * 100).toFixed(0)}% to reach the target score; below the ${(t * 100).toFixed(0)}% bar for a ${stageName} pick, and you have ${s.instrumentRefreshes} refresh${s.instrumentRefreshes === 1 ? '' : 'es'} left.`
      : canRef || bv >= t
        ? `Best offer is worth ${(bv * 100).toFixed(0)}% for a ${stageName} pick${bv >= t ? ', above the ' + (t * 100).toFixed(0) + '% bar' : ''}.`
        : `No refreshes left, so take the best offer (${(bv * 100).toFixed(0)}%).`
  return { stage, tau: t, rows, action, best, refreshesLeft: s.instrumentRefreshes, why }
}

export interface Row {
  key: string
  label: string
  refresh: boolean
  index: number | null
  targets: number[]
  n: number
  hits: number
  p: number
  lo: number
  hi: number
  mean: number
  p10: number
  /** paired difference to the best row, in probability points, with its 95% half-width */
  diff: number
  diffCi: number
  /** ruled out early: clearly worse than the leader, so no more playouts were spent on it */
  out: boolean
}

const wilson = (k: number, n: number, z = 1.96): [number, number] => {
  if (n === 0) return [0, 0]
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
  return [(c - h) / d, (c + h) / d]
}

/**
 * Deep check: play every option, then the rest of the game with the validated strategy, many times on the same dice.
 * Ranks by chance of reaching `target`. Calls onUpdate as results firm up. Runs in small slices so the page stays usable.
 */
export async function check(
  x: HelperInput, target: number,
  o: { playouts?: number; /** deep-check only the N plays the instant answer ranks highest (refresh is always included) */ maxOptions?: number; onUpdate?: (rows: Row[], done: number, total: number) => void; shouldStop?: () => boolean } = {},
): Promise<Row[]> {
  const playouts = o.playouts ?? 60
  const { s } = build(x)
  if (s.phase === 'gameOver') return []
  const chooser = evChooser({ samples: 4, horizon: 0 })
  const picker = tablePicker(TABLES)
  const name = (id: number) => (s.phase === 'potionSelect' ? POTIONS.find(p => p.id === id)?.name : INSTRUMENTS.find(i => i.id === id)?.name) ?? '?'

  interface Opt { key: string; label: string; refresh: boolean; index: number | null; targets: number[]; first: (st: GameState) => GameState }
  const opts: Opt[] = []
  if (s.phase === 'potionSelect') {
    const keep = new Set(advise(x, 16, false).ranking.slice(0, o.maxOptions ?? 6).map(r => `${r.index}:${r.targets.join(',')}`))
    for (const a of options(s)) {
      const index = (a[0] as { index: number }).index
      const targets = a.flatMap(t => (t.type === 'toggleTarget' ? [t.tank] : []))
      if (!keep.has(`${index}:${targets.join(',')}`)) continue
      opts.push({ key: `${index}:${targets.join(',')}`, label: name(s.hand[index].id) + (targets.length ? ` → tank ${targets.map(t => t + 1).join(' + ')}` : ''), refresh: false, index, targets, first: st => play(st, ...a) })
    }
  } else if (s.phase === 'instrumentSelect') {
    s.hand.forEach((c, index) => opts.push({ key: `${index}`, label: name(c.id), refresh: false, index, targets: [], first: st => play(st, { type: 'selectCard', index }, { type: 'confirm' }) }))
  }
  if (canRefresh(s) && opts.length) opts.push({ key: 'refresh', label: 'Refresh the hand', refresh: true, index: null, targets: [], first: st => play(st, { type: 'refresh' }) })
  if (!opts.length) return []

  const scores: number[][] = opts.map(() => [])
  const alive = opts.map(() => true)
  const rows = (): Row[] => {
    const r = opts.map((op, i) => {
      const xs = scores[i]; const n = xs.length; const hits = xs.filter(v => v >= target).length; const [lo, hi] = wilson(hits, n)
      const sorted = [...xs].sort((a, b) => a - b)
      return { key: op.key, label: op.label, refresh: op.refresh, index: op.index, targets: op.targets, n, hits, p: n ? hits / n : 0, lo, hi, mean: n ? xs.reduce((a, b) => a + b, 0) / n : 0, p10: n ? sorted[Math.floor(n * 0.1)] : 0, diff: 0, diffCi: 0, out: !alive[i] }
    })
    r.sort((a, b) => Number(a.out) - Number(b.out) || b.p - a.p || b.mean - a.mean)
    const top = r[0]
    const ti = opts.findIndex(op => op.key === top.key)
    for (const row of r) {
      const oi = opts.findIndex(op => op.key === row.key); const n = Math.min(scores[oi].length, scores[ti].length)
      let b10 = 0, b01 = 0
      for (let k = 0; k < n; k++) { const a = scores[oi][k] >= target, b = scores[ti][k] >= target; if (a && !b) b10++; if (b && !a) b01++ }
      row.diff = n ? (b10 - b01) / n : 0
      row.diffCi = n ? 1.96 * Math.sqrt(Math.max(b10 + b01 - (b10 - b01) ** 2 / n, 0)) / n : 0
    }
    return r
  }

  const SLICE = 4
  for (let k0 = 0; k0 < playouts; k0 += SLICE) {
    if (o.shouldStop?.()) break
    for (let k = k0; k < Math.min(playouts, k0 + SLICE); k++) {
      const sk = mix(0x5eed, k + 1)
      opts.forEach((op, i) => {
        if (!alive[i]) return
        const start = op.first(reseed(s, sk))
        scores[i].push(ultimateActivity(finish({ ...start, log: [] }, sk, chooser, picker)))
      })
    }
    const cur = rows()
    // rule out options that are clearly worse than the leader (paired, 95%), always keeping the top 3
    if (k0 + SLICE >= 16) cur.forEach((row, rank) => {
      const i = opts.findIndex(op => op.key === row.key)
      if (alive[i] && rank >= 3 && row.diff + row.diffCi < 0) alive[i] = false
    })
    o.onUpdate?.(rows(), Math.min(playouts, k0 + SLICE), playouts)
    await new Promise(r => setTimeout(r, 0))
  }
  return rows()
}

/** Whole-run look-ahead on this thread (the fallback when workers can't start): potions or instruments. */
export function plan(x: HelperInput): Advice {
  return advise(x, 16, true)
}

/** Instrument offers played out from this exact board, on this thread (fallback). */
export function instrumentAhead(x: HelperInput): Advice {
  return advise(x, 16, true)
}

// ---------- the look-ahead over every CPU core but one ----------

interface Waiting { id: number; slice: { work: Work; from: number; to: number }; done: (t: Tally[] | null) => void; tag: number }
let pool: { workers: Worker[]; idle: Worker[]; busy: Map<Worker, Waiting>; queue: Waiting[]; ids: number } | null = null
let poolFailed = false
/** All CPU threads but one (the game's), between 1 and 16. */
export const poolSize = () => Math.max(1, Math.min(16, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 1)
/** Futures per option: 64 from 8 threads up, 32 below, so a slow PC isn't kept waiting (upstream's futuresFor). */
export const futuresFor = (threads: number) => (threads >= 8 ? 64 : 32)

function startPool() {
  if (pool || poolFailed) return pool
  const src = (globalThis as unknown as { VORAX_WORKERS?: { futures?: string } }).VORAX_WORKERS?.futures
  if (!src || typeof Worker === 'undefined') { poolFailed = true; return null }
  try {
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
    const p = { workers: [] as Worker[], idle: [] as Worker[], busy: new Map<Worker, Waiting>(), queue: [] as Waiting[], ids: 0 }
    for (let i = 0; i < poolSize(); i++) {
      const w = new Worker(url)
      w.onmessage = (e: MessageEvent<{ id: number; tallies: Tally[] }>) => { const q = p.busy.get(w); p.busy.delete(w); p.idle.push(w); q?.done(e.data.tallies); next() }
      w.onerror = () => { const q = p.busy.get(w); p.busy.delete(w); q?.done(null) }
      p.workers.push(w); p.idle.push(w)
    }
    pool = p
  } catch { poolFailed = true }
  return pool
}
function next() {
  if (!pool) return
  while (pool.idle.length && pool.queue.length) { const w = pool.idle.shift()!, q = pool.queue.shift()!; pool.busy.set(w, q); w.postMessage({ id: q.id, ...q.slice }) }
}
/** (Vorax Helper) Starts the look-ahead's workers ahead of the first board, so the first advice doesn't wait for them to load. */
export const warmPool = () => !!startPool()
let currentTag = 0
/** Drops the slices of older boards that no worker has taken yet. */
export function cancelAhead() {
  currentTag++
  if (!pool) return
  for (let i = pool.queue.length - 1; i >= 0; i--) if (pool.queue[i].tag !== currentTag) pool.queue.splice(i, 1)[0].done(null)
}

/**
 * The whole-run look-ahead for a potion or an instrument offer, its futures played over the CPU's cores in small slices
 * (64 per option, from 8 threads up). The same answer as plan() on one thread, sooner. Null when a newer board replaced it.
 */
/** futures: (Vorax Helper) how many per option, when the player's game speed asks for fewer than this PC's usual */
export async function ahead(x: HelperInput, futures?: number): Promise<Advice | null> {
  cancelAhead()
  const tag = currentTag
  const p0 = startPool()
  if (!p0) return advise(x, 16, true)
  const p = prepare(x, futures ?? futuresFor(p0.workers.length + 1))
  if ('advice' in p) return p.advice
  const n = p.work.futures, k = Math.min(p0.workers.length * 4, n)
  const run = (from: number, to: number) => new Promise<Tally[] | null>(done => { p0.queue.push({ id: ++p0.ids, slice: { work: p.work, from, to }, done, tag }); next() })
  const parts = await Promise.all(Array.from({ length: k }, (_, i) => run(Math.floor((i * n) / k), Math.floor(((i + 1) * n) / k))))
  return parts.some(t => t === null) ? null : conclude(p, addTallies(parts as Tally[][]))
}

/**
 * (Vorax Helper) An instrument offer by the board value alone (the simulator's value picker, as the faster game
 * speeds use): each offer taken on this board and the board valued, no playouts, so it is instant. In the 16-hour test
 * (946 deals) it reached 925k 2.4 points less often than playing each offer out, a difference within chance.
 */
export function instrumentValue(x: HelperInput): { best: number | 'refresh'; ranking: { index: number; value: number }[]; board: number } {
  const { s } = build(x)
  const ranking = s.hand.map((_, index) => ({ index, value: boardValue(play(s, { type: 'selectCard', index }, { type: 'confirm' })) })).sort((a, b) => b.value - a.value)
  const board = boardValue(s)
  const best = ranking.length ? (canRefresh(s) && ranking[0].value < board ? 'refresh' : ranking[0].index) : 'refresh'
  return { best, ranking, board }
}
