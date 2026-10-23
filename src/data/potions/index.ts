import type { PotionDef } from '../defs'
import { RARE_POTIONS } from './rare'
import { MAGIC_POTIONS } from './magic'
import { NORMAL_POTIONS } from './normal'
import { BOXES } from './boxes'
import { SUPREME_POTIONS } from './supreme'

export const POTIONS: PotionDef[] = [...RARE_POTIONS, ...MAGIC_POTIONS, ...NORMAL_POTIONS, ...BOXES, ...SUPREME_POTIONS]

const byId = new Map(POTIONS.map(p => [p.id, p]))

export function potion(id: number): PotionDef {
  const p = byId.get(id)
  if (!p) throw new Error(`Unknown potion id ${id}`)
  return p
}

export function hasPotion(id: number): boolean {
  return byId.has(id)
}

export const isBox = (p: PotionDef) => typeof p.targeting === 'object'

/** Regular deal pool: everything except Supreme potions (boxes included). */
export const NORMAL_POOL = POTIONS.filter(p => p.rarity !== 'supreme')
/** Pool for cards inside an opened box: no boxes, no Supremes. */
export const BOX_POOL = NORMAL_POOL.filter(p => !isBox(p))
export const SUPREME_POOL = POTIONS.filter(p => p.rarity === 'supreme')
