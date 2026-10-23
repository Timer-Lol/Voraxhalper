import type { Archetype, Monster, Rarity } from '@/engine/types'
import type { Rng } from '@/engine/rng'
import { LIVE_WEIGHTS } from './liveWeights'

export const ARCHETYPES: Archetype[] = ['pest', 'aemberon', 'boneSentry', 'agito']
export const RARITIES: Rarity[] = ['normal', 'magic', 'rare', 'boss']

export const ARCHETYPE_NAMES: Record<Archetype, string> = {
  pest: 'Pest',
  aemberon: 'Aemberon',
  boneSentry: 'Bone Sentry',
  agito: 'Agito',
}

export const ARCHETYPE_PLURALS: Record<Archetype, string> = {
  pest: 'Pests',
  aemberon: 'Aemberons',
  boneSentry: 'Bone Sentries',
  agito: 'Agitoes',
}

export const RARITY_NAMES: Record<Rarity, string> = {
  normal: 'Normal',
  magic: 'Magic',
  rare: 'Rare',
  boss: 'Boss',
}

export const BASE_STATS: Record<Rarity, { activity: number; quantity: number }> = {
  normal: { activity: 1, quantity: 36 },
  magic: { activity: 5, quantity: 24 },
  rare: { activity: 15, quantity: 12 },
  boss: { activity: 300, quantity: 1 },
}

/** Measured from live games (src/data/liveWeights.ts). */
export const SPAWN_WEIGHTS: Record<Rarity, number> = LIVE_WEIGHTS.spawnRarity

/** Activity gained when awakening *into* a rarity. */
export const AWAKEN_BONUS: Record<Rarity, number> = { normal: 0, magic: 60, rare: 120, boss: 120 }

export function nextRarity(r: Rarity): Rarity {
  return RARITIES[Math.min(RARITIES.indexOf(r) + 1, RARITIES.length - 1)]
}

export function rollRarity(rng: Rng): Rarity {
  const roll = rng.next() * RARITIES.reduce((s, r) => s + SPAWN_WEIGHTS[r], 0)
  let acc = 0
  for (const r of RARITIES) {
    acc += SPAWN_WEIGHTS[r]
    if (roll < acc) return r
  }
  return 'boss'
}

export function rollArchetype(rng: Rng): Archetype {
  return ARCHETYPES[rng.int(ARCHETYPES.length)]
}

/** Boss counts as Rare for condition checks only (spec ruling 4.5). */
export function isRareOrBoss(r: Rarity): boolean {
  return r === 'rare' || r === 'boss'
}

export function monsterName(m: Pick<Monster, 'archetype' | 'rarity'>): string {
  return `${RARITY_NAMES[m.rarity]} ${ARCHETYPE_NAMES[m.archetype]}`
}

export function createMonster(a: Archetype, r: Rarity, actBonus = 0, qtyBonus = 0): Monster {
  return {
    archetype: a,
    rarity: r,
    activity: BASE_STATS[r].activity + actBonus,
    quantity: BASE_STATS[r].quantity + qtyBonus,
  }
}

export function total(m: Monster | null): number {
  return m ? m.activity * m.quantity : 0
}
