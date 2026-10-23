import { BOX_POOL, NORMAL_POOL, SUPREME_POOL } from '@/data/potions'
import { ADVANCED_POOL, BASIC_POOL } from '@/data/instruments'
import { LIVE_WEIGHTS } from '@/data/liveWeights'
import type { Rng } from './rng'
import type { Card, EquippedInstrument } from './types'

export const SUPREME_CHANCE = LIVE_WEIGHTS.supremeChance

/** One item: uniformly while every weight is equal (the same dice as before weights existed), else by weight. */
function pickBy<T extends { name: string }>(rng: Rng, pool: T[], weights: Record<string, number>): T | undefined {
  const w = (x: T) => weights[x.name] ?? 1
  return pool.every(x => w(x) === w(pool[0])) ? rng.pick(pool) : rng.weighted(pool, w)
}

/** n distinct potions; each card independently has SUPREME_CHANCE to be Supreme. */
export function dealPotions(rng: Rng, n: number, fromBox: boolean): Card[] {
  const base = fromBox ? BOX_POOL : NORMAL_POOL
  const used = new Set<number>()
  const hand: Card[] = []
  for (let i = 0; i < n; i++) {
    const supreme = rng.chance(SUPREME_CHANCE)
    const fresh = (pool: typeof base) => pool.filter(p => !used.has(p.id))
    let pool = fresh(supreme ? SUPREME_POOL : base)
    if (pool.length === 0) pool = fresh(supreme ? base : SUPREME_POOL)
    const p = supreme && pool[0]?.rarity === 'supreme' ? rng.pick(pool) : pickBy(rng, pool, fromBox ? LIVE_WEIGHTS.boxOffer : LIVE_WEIGHTS.potionOffer)
    if (!p) break
    used.add(p.id)
    hand.push({ kind: 'potion', id: p.id })
  }
  return hand
}

export function dealInstruments(rng: Rng, pool: 'basic' | 'advanced', equipped: EquippedInstrument[]): Card[] {
  const owned = new Set(equipped.map(e => e.id))
  const available = (pool === 'basic' ? BASIC_POOL : ADVANCED_POOL).filter(d => !owned.has(d.id))
  const weights = LIVE_WEIGHTS.instrumentOffer[pool]
  const w = (d: { name: string }) => weights[d.name] ?? 1
  if (available.every(d => w(d) === w(available[0]))) return rng.sample(available, 3).map(d => ({ kind: 'instrument', id: d.id }))
  const left = [...available]
  const out: Card[] = []
  while (out.length < 3 && left.length) {
    const d = rng.weighted(left, w)
    left.splice(left.indexOf(d), 1)
    out.push({ kind: 'instrument', id: d.id })
  }
  return out
}
