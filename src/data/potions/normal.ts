import { rollArchetype, rollRarity } from '../archetypes'
import type { PotionDef } from '../defs'

export const NORMAL_POTIONS: PotionDef[] = [
  {
    id: 23, name: 'Slender-Limb Powder - Pest', rarity: 'normal', targeting: 'auto', item: 'powder',
    text: '{add} 1 group(s) of {Pest}s and +73 to their {qty}Quantity',
    effect(c) {
      c.add('pest', rollRarity(c.rng), 0, 73)
    },
  },
  {
    id: 24, name: 'Twin Hormone - Pest', rarity: 'normal', targeting: 'select1', item: 'pill',
    text: 'Select 1 group(s) of monsters, {mutate} them into {Pest}s, and {add} 1 identical group',
    effect(c, [t]) {
      if (!c.tanks[t]) return
      c.mutate(t, 'pest', 'random')
      const mon = c.tanks[t]
      if (mon) c.add('pest', mon.rarity)
    },
  },
  {
    id: 25, name: 'Spinal Solution - Agito', rarity: 'normal', targeting: 'auto', item: 'solution',
    text: '{add} 1 group(s) of {Agito}s and +31 to their {act}Activity',
    effect(c) {
      c.add('agito', rollRarity(c.rng), 31)
    },
  },
  {
    id: 26, name: 'Anesthetic Tincture - Agito', rarity: 'normal', targeting: 'select1', item: 'tincture',
    text: 'Select 1 group(s) of monsters to {mutate} into {Agito}s and {awaken} them into Magic monsters',
    effect(c, [t]) {
      if (!c.tanks[t]) return
      c.mutate(t, 'agito', 'random')
      c.awaken(t, 'magic')
    },
  },
  {
    id: 27, name: 'Slender-Limb Powder - Bone Sentry', rarity: 'normal', targeting: 'auto', item: 'powder',
    text: '{add} 1 group(s) of {BoneSentry}s and +73 to their {qty}Quantity',
    effect(c) {
      c.add('boneSentry', rollRarity(c.rng), 0, 73)
    },
  },
  {
    id: 28, name: 'Twin Hormone - Bone Sentry', rarity: 'normal', targeting: 'select1', item: 'pill',
    text: 'Select 1 group(s) of monsters, {mutate} them into {BoneSentry}s, and +62 to their {qty}Quantity',
    effect(c, [t]) {
      if (!c.tanks[t]) return
      c.mutate(t, 'boneSentry', 'random')
      c.boost(t, 0, 62)
    },
  },
  {
    id: 29, name: 'Anesthetic Tincture - Aemberon', rarity: 'normal', targeting: 'select1', item: 'tincture',
    text: 'Select 1 group(s) of monsters to {mutate} into {Aemberon}s, with a 50% chance to randomly {mutate} another 1',
    effect(c, [t]) {
      if (!c.tanks[t]) return
      c.mutate(t, 'aemberon', 'random')
      if (!c.rng.chance(0.5)) return
      const other = c.rng.pick(c.nonEmpty().filter(i => i !== t))
      if (other !== undefined) c.mutate(other, 'aemberon', 'random')
    },
  },
  {
    id: 30, name: 'Spinal Solution - Aemberon', rarity: 'normal', targeting: 'auto', item: 'solution',
    text: '{add} 1 group(s) of {Aemberon}s and +31 to their {act}Activity',
    effect(c) {
      c.add('aemberon', rollRarity(c.rng), 31)
    },
  },
  {
    id: 31, name: 'Xeno-Hormone', rarity: 'normal', targeting: 'select1to2', item: 'pill',
    text: 'Select 1–2 group(s) of monsters and {remove} them. {add} 4 group(s) of random monsters with +5 {act}Activity',
    effect(c, targets) {
      if (targets.length === 0) return
      for (const t of targets) c.remove(t)
      for (let i = 0; i < 4; i++) c.add(rollArchetype(c.rng), rollRarity(c.rng), 5)
    },
  },
  {
    id: 32, name: 'Targeted Xeno-Hormone', rarity: 'normal', targeting: 'select1', item: 'pill',
    text: 'Select 1 group(s) of monsters and {remove} them. {add} 2 group(s) of Magic monsters of random Archetypes with +25 {qty}Quantity',
    effect(c, [t]) {
      if (t === undefined) return
      c.remove(t)
      for (let i = 0; i < 2; i++) c.add(rollArchetype(c.rng), 'magic', 0, 25)
    },
  },
]
