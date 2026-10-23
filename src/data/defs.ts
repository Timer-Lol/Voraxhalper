import type { EffectContext } from '@/engine/context'
import type { EventType, GameEvent } from '@/engine/types'

export type Targeting = 'auto' | 'select1' | 'select1to2' | { box: number }

export type ItemKind = 'tincture' | 'solution' | 'powder' | 'ointment' | 'pill' | 'box'

export interface PotionDef {
  id: number
  name: string
  rarity: 'normal' | 'magic' | 'rare' | 'supreme'
  targeting: Targeting
  item: ItemKind
  /** Card text in {markup}; see ui/CardText. */
  text: string
  /** Absent for potion boxes, which the game flow opens instead. */
  effect?: (ctx: EffectContext, targets: number[]) => void
}

export type Timing =
  | { kind: 'end' }
  | { kind: 'reactive'; on: EventType[] }
  | { kind: 'periodic'; every: number }

export interface InstrumentDef {
  id: number
  name: string
  pool: 'basic' | 'advanced'
  timing: Timing
  text: string
  endOfRound?: (ctx: EffectContext) => void
  onEvent?: (ctx: EffectContext, e: GameEvent) => void
}
