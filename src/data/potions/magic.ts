import { RARITIES, rollRarity } from '../archetypes'
import type { PotionDef } from '../defs'

export const MAGIC_POTIONS: PotionDef[] = [
  {
    id: 7, name: 'Viviparous Hormone', rarity: 'magic', targeting: 'auto', item: 'pill',
    text: '{add} 1 group(s) of {Pest}s. 50% chance to {add} 2 additional group(s)',
    effect(c) {
      c.add('pest', rollRarity(c.rng))
      if (c.rng.chance(0.5)) {
        c.add('pest', rollRarity(c.rng))
        c.add('pest', rollRarity(c.rng))
      }
    },
  },
  {
    id: 8, name: 'Eggshell Powder', rarity: 'magic', targeting: 'auto', item: 'powder',
    text: '+25 {qty}Quantity to 1 random group(s) of monsters. If they are {Pest}s, {add} 1 identical group of {Pest}s with +25 {qty}Quantity',
    effect(c) {
      const t = c.rng.pick(c.nonEmpty())
      if (t === undefined) return
      const mon = c.tanks[t]!
      c.boost(t, 0, 25)
      if (mon.archetype === 'pest') c.add('pest', mon.rarity, 0, 25)
    },
  },
  {
    id: 9, name: 'Brain Fog Tincture', rarity: 'magic', targeting: 'auto', item: 'tincture',
    text: '+41 {act}Activity to 1 random group(s) of monsters. If they are {Agito}s, {awaken} them into Rare monsters',
    effect(c) {
      const t = c.rng.pick(c.nonEmpty())
      if (t === undefined) return
      c.boost(t, 41, 0)
      if (c.tanks[t]!.archetype === 'agito') c.awaken(t, 'rare')
    },
  },
  {
    id: 10, name: 'Osteogenic Powder', rarity: 'magic', targeting: 'auto', item: 'powder',
    text: '+40 {qty}Quantity to 1 random group(s) of monsters. If they are {BoneSentry}s, an additional +127 {qty}Quantity and {remove} 1 group(s) of non-{BoneSentry} monsters',
    effect(c) {
      const t = c.rng.pick(c.nonEmpty())
      if (t === undefined) return
      c.boost(t, 0, 40)
      if (c.tanks[t]!.archetype !== 'boneSentry') return
      c.boost(t, 0, 127)
      const victim = c.rng.pick(c.nonEmpty().filter(i => c.tanks[i]!.archetype !== 'boneSentry'))
      if (victim !== undefined) c.remove(victim)
    },
  },
  {
    id: 11, name: 'Gray Matter Spinal Solution', rarity: 'magic', targeting: 'auto', item: 'solution',
    text: '+41 {act}Activity to 1 random group(s) of monster and {mutate} them into random monsters. There is a 50% chance to {mutate} them again into {Aemberon}s with +30 {act}Activity',
    effect(c) {
      const t = c.rng.pick(c.nonEmpty())
      if (t === undefined) return
      c.boost(t, 41, 0)
      c.mutate(t, 'random', 'random')
      if (c.rng.chance(0.5)) {
        c.mutate(t, 'aemberon', 'random')
        c.boost(t, 30, 0)
      }
    },
  },
  {
    id: 12, name: 'Hollow Spinal Solution', rarity: 'magic', targeting: 'select1', item: 'solution',
    text: 'Select 1 group(s) of monsters and +41 to their {act}Activity. 50% chance to {mutate} them into random {Aemberon}s',
    effect(c, [t]) {
      if (!c.tanks[t]) return
      c.boost(t, 41, 0)
      if (c.rng.chance(0.5)) c.mutate(t, 'aemberon', 'random')
    },
  },
  {
    id: 13, name: 'Green Bile Solution', rarity: 'magic', targeting: 'select1to2', item: 'solution',
    text: 'Select 1-2 groups of monsters, {mutate} them into random Magic monsters, and +31 to their {act}Activity',
    effect(c, targets) {
      for (const t of targets) {
        if (!c.tanks[t]) continue
        c.mutate(t, 'random', 'magic')
        c.boost(t, 31, 0)
      }
    },
  },
  {
    id: 14, name: 'Compound Leech Solution', rarity: 'magic', targeting: 'select1', item: 'solution',
    text: 'Select 1 group(s) of monsters. +31 {act}Activity to 2 random group(s) of monsters of the same rarity',
    effect(c, [t]) {
      const mon = c.tanks[t]
      if (!mon) return
      for (const i of c.rng.sample(c.byRarity(mon.rarity), 2)) c.boost(i, 31, 0)
    },
  },
  {
    id: 15, name: 'Digestive Enzyme Solution', rarity: 'magic', targeting: 'select1', item: 'solution',
    text: 'Select 1 group(s) of monsters and +61 to their {act}Activity. {remove} the monsters to their left',
    effect(c, [t]) {
      if (!c.tanks[t]) return
      c.boost(t, 61, 0)
      const left = c.neighbor(t, -1)
      if (left >= 0) c.remove(left)
    },
  },
  {
    id: 16, name: 'Vivigenic Powder', rarity: 'magic', targeting: 'auto', item: 'powder',
    text: '+32 {qty}Quantity to up to 4 random group(s) of monsters, each of a different rarity',
    effect(c) {
      for (const r of RARITIES) {
        const t = c.rng.pick(c.byRarity(r))
        if (t !== undefined) c.boost(t, 0, 32)
      }
    },
  },
  {
    id: 17, name: 'Potent Xenopurge Powder', rarity: 'magic', targeting: 'select1', item: 'powder',
    text: 'Select 1 group(s) of monsters and +154 to their {qty}Quantity, then {remove} 2 group(s) of monsters of different Archetypes',
    effect(c, [t]) {
      const mon = c.tanks[t]
      if (!mon) return
      c.boost(t, 0, 154)
      const others = c.nonEmpty().filter(i => i !== t && c.tanks[i]!.archetype !== mon.archetype)
      for (const v of c.rng.sample(others, 2)) c.remove(v)
    },
  },
  {
    id: 18, name: 'Xenopurge Powder', rarity: 'magic', targeting: 'select1', item: 'powder',
    text: 'Select 1 group(s) of monsters and +127 to their {qty}Quantity, then {remove} 1 group(s) of monsters of different Archetypes',
    effect(c, [t]) {
      const mon = c.tanks[t]
      if (!mon) return
      c.boost(t, 0, 127)
      const v = c.rng.pick(c.nonEmpty().filter(i => i !== t && c.tanks[i]!.archetype !== mon.archetype))
      if (v !== undefined) c.remove(v)
    },
  },
  {
    id: 19, name: 'Pure Leech Solution', rarity: 'magic', targeting: 'select1', item: 'solution',
    text: 'Select 1 group(s) of monsters. +31 {act}Activity to 2 random group(s) of monsters of the same Archetype',
    effect(c, [t]) {
      const mon = c.tanks[t]
      if (!mon) return
      for (const i of c.rng.sample(c.byArchetype(mon.archetype), 2)) c.boost(i, 31, 0)
    },
  },
  {
    id: 20, name: 'Bewitching Tincture', rarity: 'magic', targeting: 'select1', item: 'tincture',
    text: 'Select 1 group(s) of monsters to {awaken} into monsters that are 1 tier(s) higher in rarity',
    effect(c, [t]) {
      c.awaken(t)
    },
  },
  {
    id: 21, name: 'Mutagenic Powder', rarity: 'magic', targeting: 'select1to2', item: 'powder',
    text: 'Select 1–2 group(s) of monsters, +52 to their {qty}Quantity, and {mutate} them into random Rare monsters',
    effect(c, targets) {
      for (const t of targets) {
        if (!c.tanks[t]) continue
        c.boost(t, 0, 52)
        c.mutate(t, 'random', 'rare')
      }
    },
  },
  {
    id: 22, name: 'Viscous Bile Solution', rarity: 'magic', targeting: 'select1', item: 'solution',
    text: 'Select 1 group(s) of monsters and {mutate} the monsters to their right into identical copies. +31 {act}Activity to both',
    effect(c, [t]) {
      const mon = c.tanks[t]
      if (!mon) return
      c.boost(t, 31, 0)
      const right = c.neighbor(t, 1)
      if (right < 0) return
      c.mutate(right, mon.archetype, mon.rarity)
      c.boost(right, 31, 0)
    },
  },
]
