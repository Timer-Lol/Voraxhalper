import type { PotionDef } from '../defs'

/** Opened by the game flow (engine/game.ts); boxes have no effect of their own. */
export const BOXES: PotionDef[] = [
  { id: 33, name: 'Potion Kit (Large)', rarity: 'rare', targeting: { box: 5 }, item: 'box', text: 'Choose 1 of 5 random potions' },
  { id: 34, name: 'Potion Kit (Small)', rarity: 'rare', targeting: { box: 3 }, item: 'box', text: 'Choose 1 of 3 random potions' },
  { id: 40, name: 'Rare Potion Kit (Small)', rarity: 'rare', targeting: { box: 3 }, item: 'box', text: 'Choose 1 of 3 random potions' },
]
