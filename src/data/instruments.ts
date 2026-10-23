import { RARITIES, isRareOrBoss, nextRarity, rollArchetype, rollRarity, total } from './archetypes'
import type { InstrumentDef } from './defs'
import type { EffectContext } from '@/engine/context'
import type { EquippedInstrument } from '@/engine/types'

const say = (c: EffectContext, name: string, text: string) => c.log(`[${name}] ${text}`, 'instrument')

const all = (c: EffectContext, act: number, qty: number) => {
  for (const i of c.nonEmpty()) c.boost(i, act, qty)
}

export const INSTRUMENTS: InstrumentDef[] = [
  {
    id: 1, name: 'Chrysalis Specimen', pool: 'basic', timing: { kind: 'end' },
    text: 'At the end of the round, +8 {qty}Quantity to X group(s) of random monsters, where X is equal to the number of {Pest} groups you have. Repeats X times',
    endOfRound(c) {
      const x = c.byArchetype('pest').length
      if (x === 0) return
      for (let rep = 0; rep < x; rep++) for (const i of c.rng.sample(c.nonEmpty(), x)) c.boost(i, 0, 8)
      say(c, this.name, `${x} Pest group(s): ${x}× +8 Quantity to ${x} random group(s)`)
    },
  },
  {
    id: 2, name: 'Incubation Sac', pool: 'basic', timing: { kind: 'reactive', on: ['add'] },
    text: 'When you have at least 2 group(s) of {Pest}s, +45 {qty}Quantity to all monsters each time you add a monster',
    onEvent(c) {
      if (c.byArchetype('pest').length < 2) return
      all(c, 0, 45)
      say(c, this.name, '+45 Quantity to all monsters')
    },
  },
  {
    id: 3, name: 'Hyperplastic Frontal Lobe', pool: 'basic', timing: { kind: 'end' },
    text: 'At the end of the round, if you have at least 2 group(s) of {Agito}s, +80 {act}Activity to 1 random group of Rare or Boss monsters',
    endOfRound(c) {
      if (c.byArchetype('agito').length < 2) return
      const t = c.rng.pick(c.nonEmpty().filter(i => isRareOrBoss(c.tanks[i]!.rarity)))
      if (t === undefined) return
      c.boost(t, 80, 0)
      say(c, this.name, `+80 Activity to tank ${t + 1}`)
    },
  },
  {
    id: 4, name: 'Hypertrophic Pituitary', pool: 'basic', timing: { kind: 'end' },
    text: 'At the end of the round, if you have a Rare or Boss {Agito}, +80 {act}Activity to 1 random group(s) of monsters',
    endOfRound(c) {
      if (!c.byArchetype('agito').some(i => isRareOrBoss(c.tanks[i]!.rarity))) return
      const t = c.rng.pick(c.nonEmpty())
      if (t === undefined) return
      c.boost(t, 80, 0)
      say(c, this.name, `+80 Activity to tank ${t + 1}`)
    },
  },
  {
    id: 5, name: 'Adherent Metatarsals', pool: 'basic', timing: { kind: 'reactive', on: ['remove'] },
    text: 'When you have at least 2 group(s) of {BoneSentry}s, each time a monster is {remove}d, +180 {qty}Quantity to 1 random group(s) of monsters',
    onEvent(c) {
      if (c.byArchetype('boneSentry').length < 2) return
      const t = c.rng.pick(c.nonEmpty())
      if (t === undefined) return
      c.boost(t, 0, 180)
      say(c, this.name, `+180 Quantity to tank ${t + 1}`)
    },
  },
  {
    id: 6, name: 'Contracted Claws', pool: 'basic', timing: { kind: 'reactive', on: ['remove'] },
    text: 'When a non-{BoneSentry} monster is {remove}d, +150 {qty}Quantity to 1 random group(s) of monsters',
    onEvent(c, e) {
      if (e.type !== 'remove' || e.monster.archetype === 'boneSentry') return
      const t = c.rng.pick(c.nonEmpty())
      if (t === undefined) return
      c.boost(t, 0, 150)
      say(c, this.name, `+150 Quantity to tank ${t + 1}`)
    },
  },
  {
    id: 7, name: 'Aberrant Sprout', pool: 'basic', timing: { kind: 'reactive', on: ['mutate'] },
    text: '+35 {act}Activity to all monsters when a monster {mutate}s into {Aemberon}',
    onEvent(c, e) {
      if (e.type !== 'mutate' || e.to.archetype !== 'aemberon') return
      all(c, 35, 0)
      say(c, this.name, '+35 Activity to all monsters')
    },
  },
  {
    id: 8, name: 'Prismatic Liver', pool: 'basic', timing: { kind: 'reactive', on: ['mutate'] },
    text: 'When you have at least 2 group(s) of {Aemberon}s, each time a monster {mutate}s, +20 {act}Activity to all monsters',
    onEvent(c) {
      if (c.byArchetype('aemberon').length < 2) return
      all(c, 20, 0)
      say(c, this.name, '+20 Activity to all monsters')
    },
  },
  {
    id: 9, name: 'Clustered Eggs', pool: 'advanced', timing: { kind: 'end' },
    text: 'At the end of the round, if you have at least 3 group(s) of {Pest}s, {add} 1 group(s) of {Pest}s with +100 {qty}Quantity',
    endOfRound(c) {
      if (c.byArchetype('pest').length < 3) return
      say(c, this.name, 'adds a Pest group')
      c.add('pest', rollRarity(c.rng), 0, 100)
    },
  },
  {
    id: 10, name: 'Sloughed Cortex', pool: 'advanced', timing: { kind: 'end' },
    text: 'At the end of the round, {fuse} 2 random group(s) of Magic monsters into Rare {Agito}s',
    endOfRound(c) {
      const magic = c.byRarity('magic')
      if (magic.length < 2) return
      say(c, this.name, 'fuses 2 Magic groups into a Rare Agito')
      c.fuse(c.rng.sample(magic, 2), 'agito', 'rare')
    },
  },
  {
    id: 11, name: 'Sinew Garrote', pool: 'advanced', timing: { kind: 'end' },
    text: 'At the end of the round, if you have at least 2 group(s) of {BoneSentry}s, {remove} the non-{BoneSentry} group with the lowest Total Activity. A random {BoneSentry} group gains its {act}Activity and {qty}Quantity',
    endOfRound(c) {
      const bones = c.byArchetype('boneSentry')
      if (bones.length < 2) return
      const others = c.nonEmpty().filter(i => c.tanks[i]!.archetype !== 'boneSentry')
      if (others.length === 0) return
      const victim = others.reduce((lo, i) => (total(c.tanks[i]) < total(c.tanks[lo]) ? i : lo), others[0])
      say(c, this.name, `feeds tank ${victim + 1} to a Bone Sentry`)
      const removed = c.remove(victim)
      const target = c.rng.pick(bones)
      if (removed && target !== undefined) c.boost(target, removed.activity, removed.quantity)
    },
  },
  {
    id: 12, name: 'Vermicular Spinal Cord', pool: 'advanced', timing: { kind: 'reactive', on: ['add'] },
    text: 'Each time a monster is {add}ed, 75% chance to {mutate} it into an {Aemberon} with +80 {act}Activity',
    onEvent(c, e) {
      if (e.type !== 'add' || !c.tanks[e.tank] || !c.rng.chance(0.75)) return
      say(c, this.name, `tank ${e.tank + 1} mutates into an Aemberon, +80 Activity`)
      c.mutate(e.tank, 'aemberon', 'random')
      c.boost(e.tank, 80, 0)
    },
  },
  {
    id: 13, name: 'Rawhide Restraint', pool: 'advanced', timing: { kind: 'end' },
    text: 'When you have 3 group(s) of Magic monsters, +100 {qty}Quantity to 1 group(s) of monsters with the highest Total Activity each round',
    endOfRound(c) {
      if (c.byRarity('magic').length < 3) return
      const t = c.highest()
      c.boost(t, 0, 100)
      say(c, this.name, `+100 Quantity to tank ${t + 1}`)
    },
  },
  {
    id: 14, name: 'Black Goat Gut Suture', pool: 'advanced', timing: { kind: 'end' },
    text: 'At the end of the round, for every 3 group(s) of monsters of the same rarity you have, {fuse} them into 1 group(s) of monsters 1 rarity higher (Boss excluded)',
    endOfRound(c) {
      for (const r of RARITIES) {
        if (r === 'boss') continue
        let same = c.byRarity(r)
        while (same.length >= 3) {
          const triple = same.slice(0, 3)
          say(c, this.name, `fuses 3 ${r} groups`)
          c.fuse(triple, c.tanks[triple[0]]!.archetype, nextRarity(r))
          same = c.byRarity(r)
        }
      }
    },
  },
  {
    id: 15, name: 'Pig Iron Bone Saw', pool: 'advanced', timing: { kind: 'end' },
    text: 'At the end of the round, +15 {act}Activity and +15 {qty}Quantity to monsters with both {qty}Quantity and {act}Activity higher than 150',
    endOfRound(c) {
      for (const i of c.nonEmpty()) {
        const mon = c.tanks[i]!
        if (mon.activity > 150 && mon.quantity > 150) c.boost(i, 15, 15)
      }
    },
  },
  {
    id: 16, name: 'Two-Inch Skull Nail', pool: 'advanced', timing: { kind: 'reactive', on: ['addOverflow'] },
    text: 'When adding a monster, if the Max Incubation Tank Quantity is exceeded, +25 {act}Activity and +25 {qty}Quantity to the group with the lowest Total Activity',
    onEvent(c) {
      const t = c.lowest()
      if (t < 0) return
      c.boost(t, 25, 25)
      say(c, this.name, `+25 Activity +25 Quantity to tank ${t + 1}`)
    },
  },
  {
    id: 17, name: 'Fouled Scraper', pool: 'advanced', timing: { kind: 'end' },
    text: 'At the end of the round, +20 {act}Activity to all monsters with {qty}Quantity higher than 275',
    endOfRound(c) {
      for (const i of c.nonEmpty()) if (c.tanks[i]!.quantity > 275) c.boost(i, 20, 0)
    },
  },
  {
    id: 18, name: 'Canine Teeth File', pool: 'advanced', timing: { kind: 'end' },
    text: 'At the end of the round, +30 {qty}Quantity to monsters with {act}Activity higher than 255',
    endOfRound(c) {
      for (const i of c.nonEmpty()) if (c.tanks[i]!.activity > 255) c.boost(i, 0, 30)
    },
  },
  {
    id: 19, name: 'Lady of the Plague Quarter', pool: 'advanced', timing: { kind: 'periodic', every: 2 },
    text: 'Every 2 rounds, {awaken} 1 random group of monsters of each rarity into 1 rarity higher',
    endOfRound(c) {
      // Snapshot every tier first so a monster awakened this trigger is not picked again (spec A1).
      const tiers = RARITIES.map(r => c.byRarity(r))
      say(c, this.name, 'awakens one group of each rarity')
      for (const candidates of tiers) {
        const t = c.rng.pick(candidates)
        if (t !== undefined) c.awaken(t)
      }
    },
  },
  {
    id: 20, name: 'Aberrant Stinger', pool: 'advanced', timing: { kind: 'periodic', every: 3 },
    text: 'Every 3 rounds, {mutate} all monsters into random monsters',
    endOfRound(c) {
      say(c, this.name, 'mutates every monster')
      for (const i of c.nonEmpty()) c.mutate(i, 'random', 'random')
    },
  },
  {
    id: 21, name: 'Tanned Leather Restraint', pool: 'advanced', timing: { kind: 'end' },
    text: 'At the end of the round, if you have Normal, Magic, and Rare (or Boss) monsters, +20 {act}Activity to all monsters',
    endOfRound(c) {
      const rs = c.nonEmpty().map(i => c.tanks[i]!.rarity)
      if (!rs.includes('normal') || !rs.includes('magic') || !rs.some(isRareOrBoss)) return
      all(c, 20, 0)
      say(c, this.name, '+20 Activity to all monsters')
    },
  },
  {
    id: 22, name: 'Eyelid Speculum', pool: 'advanced', timing: { kind: 'reactive', on: ['remove'] },
    text: 'Each time a monster is {remove}d, +20 {act}Activity and +20 {qty}Quantity to the group with the highest Total Activity',
    onEvent(c) {
      const t = c.highest()
      if (t < 0) return
      c.boost(t, 20, 20)
      say(c, this.name, `+20 Activity +20 Quantity to tank ${t + 1}`)
    },
  },
  {
    id: 23, name: 'Beak of the Twice-Born', pool: 'advanced', timing: { kind: 'end' },
    text: 'At the end of the round, if you have 2–5 groups of monsters, {add} 1 group(s) of random monsters. If you have 6, the group with the highest Total Activity {devour}s the one with the lowest',
    endOfRound(c) {
      const count = c.nonEmpty().length
      if (count >= 2 && count <= 5) {
        say(c, this.name, 'adds a random monster')
        c.add(rollArchetype(c.rng), rollRarity(c.rng))
      } else if (count === 6) {
        const hi = c.highest()
        const lo = c.lowest()
        if (hi === lo) return
        say(c, this.name, `tank ${hi + 1} devours tank ${lo + 1}`)
        c.devour(hi, lo)
      }
    },
  },
  {
    id: 24, name: 'Nettle Toggle', pool: 'advanced', timing: { kind: 'end' },
    text: 'When you have 3 group(s) of Normal monsters, +30 {qty}Quantity to all monsters each round',
    endOfRound(c) {
      if (c.byRarity('normal').length < 3) return
      all(c, 0, 30)
      say(c, this.name, '+30 Quantity to all monsters')
    },
  },
  {
    // Seen on a live round-2 offer (2026-10-18); not in the Chinese sim. Assumed advanced pool, and to need 2
    // Pest groups to fire. The new group's rarity is rolled, as Slough Solution's fuse into Pests is.
    id: 25, name: 'Egg-Burdened Butterfly', pool: 'advanced', timing: { kind: 'periodic', every: 3 },
    text: 'Every 3 round(s), 2 random group(s) of {Pest}s {fuse} into 1 group(s) of random {Pest}s',
    endOfRound(c) {
      const pests = c.byArchetype('pest')
      if (pests.length < 2) return
      const first = c.rng.pick(pests)!
      const second = c.rng.pick(pests.filter(t => t !== first))!
      say(c, this.name, `fuses the Pests in tanks ${first + 1} and ${second + 1}`)
      c.fuse([first, second], 'pest', rollRarity(c.rng))
    },
  },
]

const byId = new Map(INSTRUMENTS.map(i => [i.id, i]))
export function instrument(id: number): InstrumentDef | undefined {
  return byId.get(id)
}

export const BASIC_POOL = INSTRUMENTS.filter(i => i.pool === 'basic')
export const ADVANCED_POOL = INSTRUMENTS.filter(i => i.pool === 'advanced')

/** End-of-round and due periodic instruments, in id order. */
export function runEndOfRound(c: EffectContext, equipped: EquippedInstrument[], round: number): void {
  for (const eqd of [...equipped].sort((a, b) => a.id - b.id)) {
    const def = byId.get(eqd.id)
    if (!def?.endOfRound) continue
    if (def.timing.kind === 'periodic') {
      const elapsed = round - eqd.acquiredRound
      if (elapsed <= 0 || elapsed % def.timing.every !== 0) continue
    } else if (def.timing.kind !== 'end') continue
    def.endOfRound(c)
  }
}
