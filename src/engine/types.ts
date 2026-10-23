export type Archetype = 'pest' | 'aemberon' | 'boneSentry' | 'agito'
export type Rarity = 'normal' | 'magic' | 'rare' | 'boss'

export interface Monster {
  archetype: Archetype
  rarity: Rarity
  activity: number
  quantity: number
}

/** Always length 6; null = empty tank. */
export type Tanks = (Monster | null)[]

export type GameEvent =
  | { type: 'add'; tank: number; monster: Monster }
  | { type: 'remove'; tank: number; monster: Monster }
  | {
      type: 'mutate'
      tank: number
      from: { archetype: Archetype; rarity: Rarity }
      to: { archetype: Archetype; rarity: Rarity }
    }
  | { type: 'awaken'; tank: number; from: Rarity; to: Rarity; bonus: number }
  | { type: 'fuse'; sources: number[]; tank: number }
  | { type: 'devour'; devourer: number; prey: number }
  | { type: 'addOverflow'; archetype: Archetype; rarity: Rarity }

export type EventType = GameEvent['type']

export interface EquippedInstrument {
  id: number
  acquiredRound: number
}

export interface LogEntry {
  round: number
  kind: 'potion' | 'instrument' | 'system' | 'cutoff'
  text: string
}

/** potionRefreshes 0–3, instrumentRefreshes 0–2. */
export interface Settings {
  potionRefreshes: number
  instrumentRefreshes: number
}

export type Card = { kind: 'potion'; id: number } | { kind: 'instrument'; id: number }

/** roundEnd: an instrument-only round (11–13) waiting for the player to end it. */
export type Phase = 'instrumentSelect' | 'potionSelect' | 'roundEnd' | 'gameOver'

export interface SandboxSetup {
  /** null = normal random start */
  tanks: Tanks | null
  instruments: EquippedInstrument[]
  startRound: number
  thresholdsUsed: { t8000: boolean; t28000: boolean }
  /** Potion ids for the first hand; may be empty. */
  forcedHand: number[]
  seed?: number
}

export interface GameState {
  tanks: Tanks
  instruments: EquippedInstrument[]
  round: number
  phase: Phase
  hand: Card[]
  openBox: number | null
  selected: number | null
  targets: number[]
  potionRefreshes: number
  instrumentRefreshes: number
  thresholds: { t8000: boolean; t28000: boolean }
  pendingPicks: number
  rngState: number
  log: LogEntry[]
  settings: Settings
  sandbox: SandboxSetup | null
}

export type Action =
  | { type: 'selectCard'; index: number }
  | { type: 'toggleTarget'; tank: number }
  | { type: 'confirm' }
  | { type: 'refresh' }
