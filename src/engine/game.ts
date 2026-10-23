import { createMonster, rollArchetype, rollRarity, total } from '@/data/archetypes'
import { instrument, runEndOfRound } from '@/data/instruments'
import { potion } from '@/data/potions'
import { createContext } from './context'
import { dealInstruments, dealPotions } from './draw'
import { createRng, type Rng } from './rng'
import type { Action, GameState, LogEntry, SandboxSetup, Settings, Tanks } from './types'

export const TANK_COUNT = 6
export const LAST_ROUND = 13
export const LAST_POTION_ROUND = 10
export const THRESHOLDS = [8000, 28000] as const
export const MAX_INSTRUMENTS = 3
export const DEFAULT_SETTINGS: Settings = { potionRefreshes: 3, instrumentRefreshes: 2 }

export function ultimateActivity(s: Pick<GameState, 'tanks'>): number {
  return s.tanks.reduce((sum, t) => sum + total(t), 0)
}

function selectedPotion(s: GameState) {
  if (s.phase !== 'potionSelect' || s.selected === null) return null
  const card = s.hand[s.selected]
  return card?.kind === 'potion' ? potion(card.id) : null
}

/** The selected card's targeting, or null when it needs none (or the board is empty). */
export function needsTargets(s: GameState): 'select1' | 'select1to2' | null {
  const p = selectedPotion(s)
  if (!p || (p.targeting !== 'select1' && p.targeting !== 'select1to2')) return null
  return s.tanks.some(Boolean) ? p.targeting : null
}

export function canConfirm(s: GameState): boolean {
  if (s.phase === 'roundEnd') return true
  if (s.phase === 'gameOver' || s.selected === null || !s.hand[s.selected]) return false
  return needsTargets(s) ? s.targets.length >= 1 : true
}

export function canRefresh(s: GameState): boolean {
  if (s.phase === 'potionSelect') return s.potionRefreshes > 0
  if (s.phase === 'instrumentSelect') return s.instrumentRefreshes > 0
  return false
}

// ---------------------------------------------------------------------------

interface Run {
  s: GameState
  rng: Rng
  log: LogEntry[]
}

const sys = (run: Run, text: string) => run.log.push({ round: run.s.round, kind: 'system', text })

const instrumentPool = (s: GameState) => (s.instruments.length === 0 ? 'basic' : 'advanced')

function context(run: Run) {
  const { s } = run
  return createContext({ tanks: s.tanks, rng: run.rng, round: s.round, instruments: s.instruments, registry: instrument, log: run.log })
}

function clearSelection(s: GameState) {
  s.selected = null
  s.targets = []
}

function startInstrumentPick(run: Run) {
  run.s.phase = 'instrumentSelect'
  run.s.hand = dealInstruments(run.rng, instrumentPool(run.s), run.s.instruments)
  clearSelection(run.s)
}

/** Enter the current round's card phase; instrument-only rounds wait for the player to end them. */
function beginRound(run: Run) {
  const { s } = run
  s.openBox = null
  clearSelection(s)
  if (s.round > LAST_POTION_ROUND) {
    s.phase = 'roundEnd'
    s.hand = []
    return
  }
  s.phase = 'potionSelect'
  const forced = s.sandbox && s.round === s.sandbox.startRound ? s.sandbox.forcedHand : []
  s.hand = forced.length
    ? forced.map(id => ({ kind: 'potion' as const, id }))
    : dealPotions(run.rng, 3, false)
}

function endRound(run: Run): void {
  const { s } = run
  runEndOfRound(context(run), s.instruments, s.round)
  const ua = ultimateActivity(s)
  sys(run, `End of round ${s.round}: Ultimate Activity ${ua}`)
  const hits: [keyof GameState['thresholds'], number][] = [['t8000', THRESHOLDS[0]], ['t28000', THRESHOLDS[1]]]
  for (const [key, value] of hits) {
    if (s.thresholds[key] || ua < value) continue
    s.thresholds[key] = true
    if (s.instruments.length + s.pendingPicks < MAX_INSTRUMENTS) {
      s.pendingPicks++
      sys(run, `Ultimate Activity reached ${value}: Surgical Instrument reward`)
    }
  }
  if (s.round >= LAST_ROUND) {
    s.phase = 'gameOver'
    s.hand = []
    s.openBox = null
    clearSelection(s)
    return
  }
  s.round++
  if (s.pendingPicks > 0) return startInstrumentPick(run)
  beginRound(run)
}

function confirm(run: Run) {
  const { s } = run
  if (s.phase === 'roundEnd') return endRound(run)
  const card = s.hand[s.selected!]
  if (card.kind === 'instrument') {
    s.instruments.push({ id: card.id, acquiredRound: s.round })
    run.log.push({ round: s.round, kind: 'instrument', text: `Equipped ${instrument(card.id)?.name}` })
    if (s.pendingPicks > 0) s.pendingPicks--
    if (s.pendingPicks > 0 && s.instruments.length < MAX_INSTRUMENTS) return startInstrumentPick(run)
    s.pendingPicks = 0
    return beginRound(run)
  }
  const def = potion(card.id)
  if (typeof def.targeting === 'object') {
    s.openBox = def.id
    s.hand = dealPotions(run.rng, def.targeting.box, true)
    clearSelection(s)
    run.log.push({ round: s.round, kind: 'potion', text: `Opened ${def.name}` })
    return
  }
  const targets = needsTargets(s) ? [...s.targets] : []
  run.log.push({ round: s.round, kind: 'potion', text: `Used ${def.name}` })
  def.effect?.(context(run), targets)
  s.openBox = null
  clearSelection(s)
  endRound(run)
}

function refresh(run: Run) {
  const { s } = run
  if (s.phase === 'potionSelect') {
    s.potionRefreshes--
    const box = s.openBox === null ? null : potion(s.openBox).targeting
    s.hand = typeof box === 'object' && box ? dealPotions(run.rng, box.box, true) : dealPotions(run.rng, 3, false)
  } else {
    s.instrumentRefreshes--
    s.hand = dealInstruments(run.rng, instrumentPool(s), s.instruments)
  }
  clearSelection(s)
}

/**
 * Whether playing the card at `index` on `targets` changes the board by itself, before the round ends: a card
 * that only adds a monster does nothing when the tanks are full (unless an instrument rewards the overflow).
 * Its effect is applied to a copy, with its reactive instruments; true for a Potion Kit, which opens a hand.
 */
export function cardChanges(state: GameState, index: number, targets: number[]): boolean {
  const card = state.hand[index]
  if (!card || card.kind !== 'potion') return true
  const def = potion(card.id)
  if (typeof def.targeting === 'object' || !def.effect) return typeof def.targeting === 'object'
  const s = cloneState(state)
  const run: Run = { s, rng: createRng(s.rngState), log: [] }
  const before = JSON.stringify(s.tanks)
  def.effect(context(run), targets)
  return JSON.stringify(s.tanks) !== before
}

/**
 * (Vorax Helper) A copy of the state that the effects can change without touching the original: every object an effect
 * writes to (monsters, instruments, cards, the lists) is copied; what is never written (the settings, a sandbox setup)
 * is shared. structuredClone did the same job and took 70% of a look-ahead's time.
 */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    tanks: state.tanks.map(m => (m ? { ...m } : null)),
    instruments: state.instruments.map(i => ({ ...i })),
    hand: state.hand.map(c => ({ ...c })),
    targets: state.targets.slice(),
    thresholds: { ...state.thresholds },
    log: state.log.slice(),
  }
}

export function dispatch(state: GameState, action: Action): { state: GameState; log: LogEntry[] } {
  const s = cloneState(state)
  const run: Run = { s, rng: createRng(s.rngState), log: [] }
  switch (action.type) {
    case 'selectCard':
      if (s.phase === 'gameOver' || !s.hand[action.index]) return { state, log: [] }
      s.selected = action.index
      s.targets = []
      break
    case 'toggleTarget': {
      const mode = needsTargets(s)
      if (!mode || !s.tanks[action.tank]) return { state, log: [] }
      if (mode === 'select1') s.targets = [action.tank]
      else if (s.targets.includes(action.tank)) s.targets = s.targets.filter(t => t !== action.tank)
      else if (s.targets.length < 2) s.targets = [...s.targets, action.tank]
      break
    }
    case 'confirm':
      if (!canConfirm(s)) return { state, log: [] }
      confirm(run)
      break
    case 'refresh':
      if (!canRefresh(s)) return { state, log: [] }
      refresh(run)
      break
  }
  s.rngState = run.rng.state()
  s.log.push(...run.log)
  return { state: s, log: run.log }
}

// ---------------------------------------------------------------------------

function randomStart(rng: Rng): Tanks {
  const tanks: Tanks = Array(TANK_COUNT).fill(null)
  const n = 3 + rng.int(2)
  for (let i = 0; i < n; i++) tanks[i] = createMonster(rollArchetype(rng), rollRarity(rng))
  return tanks
}

export function createGame(settings: Settings, setup?: SandboxSetup, seed?: number): GameState {
  const rng = createRng(seed ?? setup?.seed ?? Date.now() >>> 0)
  const s: GameState = {
    tanks: setup?.tanks ? structuredClone(setup.tanks) : randomStart(rng),
    instruments: setup ? structuredClone(setup.instruments) : [],
    round: setup?.startRound ?? 1,
    phase: 'instrumentSelect',
    hand: [],
    openBox: null,
    selected: null,
    targets: [],
    potionRefreshes: settings.potionRefreshes,
    instrumentRefreshes: settings.instrumentRefreshes,
    thresholds: setup ? { ...setup.thresholdsUsed } : { t8000: false, t28000: false },
    pendingPicks: 0,
    rngState: 0,
    log: [],
    settings: { ...settings },
    sandbox: setup ? structuredClone(setup) : null,
  }
  const run: Run = { s, rng, log: s.log }
  sys(run, setup ? 'Sandbox run started' : 'New game started')
  if (s.instruments.length === 0) startInstrumentPick(run)
  else beginRound(run)
  s.rngState = rng.state()
  return s
}
