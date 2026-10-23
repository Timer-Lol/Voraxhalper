import { RARITIES, isRareOrBoss, rollRarity } from '../archetypes'
import type { PotionDef } from '../defs'

export const SUPREME_POTIONS: PotionDef[] = [
  {
    id: 35, name: 'Compound Revitalizing Pill', rarity: 'supreme', targeting: 'auto', item: 'pill',
    text: '{mutate} all monsters into random {Aemberon}s with +11 {act}Activity. Magic {Aemberon}s get an additional +11 {act}Activity; Rare and Boss {Aemberon}s get +11 {qty}Quantity',
    effect(c) {
      for (const t of c.nonEmpty()) {
        c.mutate(t, 'aemberon', 'random')
        const mon = c.tanks[t]
        if (!mon) continue
        c.boost(t, 11, 0)
        if (mon.rarity === 'magic') c.boost(t, 11, 0)
        else if (isRareOrBoss(mon.rarity)) c.boost(t, 0, 11)
      }
    },
  },
  {
    id: 36, name: 'Fast-Acting Heart Tonic', rarity: 'supreme', targeting: 'auto', item: 'pill',
    text: '+42 {act}Activity and +42 {qty}Quantity to the group of monsters with the lowest Total Activity',
    effect(c) {
      const t = c.lowest()
      if (t >= 0) c.boost(t, 42, 42)
    },
  },
  {
    id: 37, name: 'Plague Quarter Peat Poultice', rarity: 'supreme', targeting: 'auto', item: 'ointment',
    text: 'If you have at least 1 group of {BoneSentry}s, {remove} all non-{BoneSentry} monsters. For each group removed, +20 {act}Activity and +39 {qty}Quantity to all {BoneSentry}s',
    effect(c) {
      if (c.byArchetype('boneSentry').length === 0) return
      for (const v of c.nonEmpty().filter(i => c.tanks[i]!.archetype !== 'boneSentry')) {
        c.remove(v)
        for (const b of c.byArchetype('boneSentry')) c.boost(b, 20, 39)
      }
    },
  },
  {
    id: 38, name: 'Insect Attractant', rarity: 'supreme', targeting: 'auto', item: 'pill',
    text: '{add} 4 group(s) of {Pest}s. +10 {act}Activity and +15 {qty}Quantity to existing {Pest}s for every 1 group(s) over the Max Incubation Tank Quantity',
    effect(c) {
      let overflow = 0
      for (let i = 0; i < 4; i++) if (c.add('pest', rollRarity(c.rng)) < 0) overflow++
      if (overflow === 0) return
      for (const p of c.byArchetype('pest')) c.boost(p, 10 * overflow, 15 * overflow)
    },
  },
  {
    id: 39, name: 'Purest Holy Water', rarity: 'supreme', targeting: 'auto', item: 'pill',
    text: '{awaken} all {Agito}s into monsters 2 rarities higher. Boss {Agito}s gain +120 {act}Activity instead',
    effect(c) {
      for (const t of c.byArchetype('agito')) {
        const r = c.tanks[t]!.rarity
        if (r === 'boss') c.boost(t, 120, 0)
        else c.awaken(t, RARITIES[Math.min(RARITIES.indexOf(r) + 2, RARITIES.length - 1)], 120)
      }
    },
  },
  {
    id: 41, name: 'Rousing Salts', rarity: 'supreme', targeting: 'auto', item: 'pill',
    text: 'Select 1 random group(s) of monsters, +111 {act}Activity and +111 to their {qty}Quantity',
    effect(c) {
      const t = c.rng.pick(c.nonEmpty())
      if (t !== undefined) c.boost(t, 111, 111)
    },
  },
]
