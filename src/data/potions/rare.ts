import { rollRarity } from '../archetypes'
import type { PotionDef } from '../defs'

export const RARE_POTIONS: PotionDef[] = [
  {
    id: 0, name: 'Probiotic Enzyme Solution', rarity: 'rare', targeting: 'auto', item: 'solution',
    text: 'For each group of {Pest}s you have, +11 {act}Activity to all {Pest}s',
    effect(c) {
      const pests = c.byArchetype('pest')
      for (const i of pests) c.boost(i, 11 * pests.length, 0)
    },
  },
  {
    id: 1, name: 'Slough Solution', rarity: 'rare', targeting: 'select1to2', item: 'solution',
    text: 'Select 1–2 group(s) of monsters and {fuse} them into 1 group of {Pest}s',
    effect(c, targets) {
      if (targets.length) c.fuse(targets, 'pest', rollRarity(c.rng))
    },
  },
  {
    id: 2, name: 'Leptomeningeal Solution', rarity: 'rare', targeting: 'select1', item: 'solution',
    text: 'Select 1 group(s) of monsters and +30 to their {act}Activity. Triggers 2 times on Magic {Agito}s and 3 times on Rare and Boss {Agito}s',
    effect(c, [t]) {
      const mon = c.tanks[t]
      if (!mon) return
      let times = 1
      if (mon.archetype === 'agito') times = mon.rarity === 'magic' ? 2 : mon.rarity === 'rare' || mon.rarity === 'boss' ? 3 : 1
      c.boost(t, 30 * times, 0)
    },
  },
  {
    id: 3, name: 'Osteolytic Ointment', rarity: 'rare', targeting: 'auto', item: 'ointment',
    text: 'When you have at least 1 group(s) of {BoneSentry}s, {remove} up to 3 group(s) of monsters that are not {BoneSentry}s. For each group removed, +28 {act}Activity and +28 {qty}Quantity to all monsters',
    effect(c) {
      if (c.byArchetype('boneSentry').length === 0) return
      const victims = c.rng.sample(c.nonEmpty().filter(i => c.tanks[i]!.archetype !== 'boneSentry'), 3)
      for (const v of victims) {
        c.remove(v)
        for (const i of c.nonEmpty()) c.boost(i, 28, 28)
      }
    },
  },
  {
    id: 4, name: 'Cleansing Ointment', rarity: 'rare', targeting: 'select1', item: 'ointment',
    text: 'Select 1 group(s) of monsters and +20 to their {act}Activity. If they are {BoneSentry}s, an additional +41 {qty}Quantity and {remove} the monsters to their right',
    effect(c, [t]) {
      const mon = c.tanks[t]
      if (!mon) return
      c.boost(t, 20, 0)
      if (mon.archetype !== 'boneSentry') return
      c.boost(t, 0, 41)
      const right = c.neighbor(t, 1)
      if (right >= 0) c.remove(right)
    },
  },
  {
    id: 5, name: 'Fresh Spinal Powder', rarity: 'rare', targeting: 'auto', item: 'powder',
    text: 'Randomly {mutate} up to 3 group(s) of monsters that are not {Aemberon}s into {Aemberon}s, +42 {qty}Quantity to 3 random group(s) of {Aemberon}s for each group mutated',
    effect(c) {
      const picks = c.rng.sample(c.nonEmpty().filter(i => c.tanks[i]!.archetype !== 'aemberon'), 3)
      for (const p of picks) {
        c.mutate(p, 'aemberon', 'random')
        for (const i of c.rng.sample(c.byArchetype('aemberon'), 3)) c.boost(i, 0, 42)
      }
    },
  },
  {
    id: 6, name: 'Petrified Spinal Solution', rarity: 'rare', targeting: 'select1', item: 'solution',
    text: 'Select 1 group(s) of monsters and +20 to their {act}Activity. If they are not {Aemberon}s, {mutate} them into {Aemberon}s with an additional +30 {act}Activity',
    effect(c, [t]) {
      const mon = c.tanks[t]
      if (!mon) return
      c.boost(t, 20, 0)
      if (mon.archetype === 'aemberon') return
      c.mutate(t, 'aemberon', 'random')
      c.boost(t, 30, 0)
    },
  },
]
