import { AWAKEN_BONUS, RARITIES, nextRarity, rollArchetype, rollRarity, total, createMonster, monsterName } from '@/data/archetypes'
import type { InstrumentDef } from '@/data/defs'
import type { Rng } from './rng'
import type { Archetype, EquippedInstrument, GameEvent, LogEntry, Monster, Rarity, Tanks } from './types'

export const MAX_CHAIN_DEPTH = 8

export interface EffectContext {
  readonly tanks: Tanks
  readonly rng: Rng
  readonly round: number
  /** Returns the tank index, or -1 when every tank is full (emits addOverflow). */
  add(a: Archetype, r: Rarity, actBonus?: number, qtyBonus?: number): number
  remove(tank: number): Monster | null
  /** Keeps Activity and Quantity; 'random' rolls archetype / rarity. */
  mutate(tank: number, a: Archetype | 'random', r: Rarity | 'random'): void
  /** Defaults: to = next rarity, bonus = AWAKEN_BONUS[to]. Never lowers rarity; a Boss stays Boss and gains nothing. */
  awaken(tank: number, to?: Rarity, bonus?: number): void
  fuse(sources: number[], a: Archetype, r: Rarity): number
  devour(devourer: number, prey: number): void
  /** Plain stat change; emits no event. */
  boost(tank: number, act: number, qty: number): void
  nonEmpty(): number[]
  byArchetype(a: Archetype): number[]
  byRarity(r: Rarity): number[]
  /** By Total Activity; ties → leftmost; -1 when empty. */
  highest(): number
  lowest(): number
  /** Nearest non-empty tank in a direction, or -1. */
  neighbor(tank: number, dir: -1 | 1): number
  log(text: string, kind?: LogEntry['kind']): void
}

export interface ContextInit {
  tanks: Tanks
  rng: Rng
  round: number
  instruments: EquippedInstrument[]
  registry: (id: number) => InstrumentDef | undefined
  log: LogEntry[]
  /** Observer for every emitted event (tests, UI). */
  onEvent?: (e: GameEvent) => void
}

/** Mutates init.tanks and init.log in place. */
export function createContext(init: ContextInit): EffectContext {
  const { tanks, rng, round, log } = init
  let depth = 0
  let cutoffLogged = false

  const reactive = () =>
    [...init.instruments]
      .sort((a, b) => a.id - b.id)
      .map(i => init.registry(i.id))
      .filter((d): d is InstrumentDef => !!d && d.timing.kind === 'reactive' && !!d.onEvent)

  const emit = (e: GameEvent) => {
    init.onEvent?.(e)
    const eventDepth = depth
    if (eventDepth >= MAX_CHAIN_DEPTH) {
      if (!cutoffLogged) {
        cutoffLogged = true
        ctx.log(`Chain stopped at depth ${MAX_CHAIN_DEPTH}; further triggers ignored`, 'cutoff')
      }
      return
    }
    for (const def of reactive()) {
      if (def.timing.kind !== 'reactive' || !def.timing.on.includes(e.type)) continue
      depth = eventDepth + 1
      def.onEvent!(ctx, e)
    }
    depth = eventDepth
    if (depth === 0) cutoffLogged = false
  }

  const nonEmpty = () => tanks.flatMap((t, i) => (t ? [i] : []))
  const pickBy = (better: (a: number, b: number) => boolean) => {
    const idx = nonEmpty()
    if (idx.length === 0) return -1
    return idx.reduce((best, i) => (better(total(tanks[i]), total(tanks[best])) ? i : best), idx[0])
  }

  const ctx: EffectContext = {
    tanks,
    rng,
    round,

    add(a, r, actBonus = 0, qtyBonus = 0) {
      const i = tanks.indexOf(null)
      if (i < 0) {
        ctx.log(`Tanks full: ${monsterName({ archetype: a, rarity: r })} could not be added`)
        emit({ type: 'addOverflow', archetype: a, rarity: r })
        return -1
      }
      const monster = createMonster(a, r, actBonus, qtyBonus)
      tanks[i] = monster
      ctx.log(`Added ${monsterName(monster)} to tank ${i + 1}`)
      emit({ type: 'add', tank: i, monster: { ...monster } })
      return i
    },

    remove(tank) {
      const monster = tanks[tank]
      if (!monster) return null
      tanks[tank] = null
      ctx.log(`Removed ${monsterName(monster)} from tank ${tank + 1}`)
      emit({ type: 'remove', tank, monster: { ...monster } })
      return monster
    },

    mutate(tank, a, r) {
      const mon = tanks[tank]
      if (!mon) return
      const from = { archetype: mon.archetype, rarity: mon.rarity }
      mon.archetype = a === 'random' ? rollArchetype(rng) : a
      mon.rarity = r === 'random' ? rollRarity(rng) : r
      ctx.log(`Tank ${tank + 1} mutated: ${monsterName(from)} → ${monsterName(mon)}`)
      emit({ type: 'mutate', tank, from, to: { archetype: mon.archetype, rarity: mon.rarity } })
    },

    awaken(tank, to, bonus) {
      const mon = tanks[tank]
      if (!mon) return
      const from = mon.rarity
      const named = to ?? nextRarity(from)
      // Awakening never demotes: "awaken into Rare" on a Boss keeps Boss. A Boss gains no Activity either
      // (seen in game, 2026-10-21).
      const target = RARITIES.indexOf(named) < RARITIES.indexOf(from) ? from : named
      const gain = from === 'boss' ? 0 : bonus ?? AWAKEN_BONUS[target]
      mon.rarity = target
      mon.activity += gain
      ctx.log(`Tank ${tank + 1} awakened: ${from} → ${target} (+${gain} Activity)`)
      emit({ type: 'awaken', tank, from, to: target, bonus: gain })
    },

    fuse(sources, a, r) {
      let activity = 0
      let quantity = 0
      const used: number[] = []
      for (const s of sources) {
        const mon = tanks[s]
        if (!mon) continue
        activity += mon.activity
        quantity += mon.quantity
        used.push(s)
      }
      if (used.length === 0) return -1
      for (const s of used) ctx.remove(s)
      const i = tanks.indexOf(null)
      const monster: Monster = { archetype: a, rarity: r, activity, quantity }
      tanks[i] = monster
      ctx.log(`Fused tanks ${used.map(s => s + 1).join('+')} into ${monsterName(monster)} in tank ${i + 1}`)
      emit({ type: 'add', tank: i, monster: { ...monster } })
      emit({ type: 'fuse', sources: used, tank: i })
      return i
    },

    devour(devourer, prey) {
      const d = tanks[devourer]
      const p = tanks[prey]
      if (!d || !p || devourer === prey) return
      d.activity += p.activity
      d.quantity += p.quantity
      ctx.log(`Tank ${devourer + 1} devoured tank ${prey + 1}`)
      ctx.remove(prey)
      emit({ type: 'devour', devourer, prey })
    },

    boost(tank, act, qty) {
      const mon = tanks[tank]
      if (!mon) return
      mon.activity += act
      mon.quantity += qty
    },

    nonEmpty,
    byArchetype: a => nonEmpty().filter(i => tanks[i]!.archetype === a),
    byRarity: r => nonEmpty().filter(i => tanks[i]!.rarity === r),
    highest: () => pickBy((a, b) => a > b),
    lowest: () => pickBy((a, b) => a < b),
    neighbor(tank, dir) {
      for (let i = tank + dir; i >= 0 && i < tanks.length; i += dir) if (tanks[i]) return i
      return -1
    },

    log(text, kind = 'system') {
      log.push({ round, kind, text })
    },
  }
  return ctx
}
