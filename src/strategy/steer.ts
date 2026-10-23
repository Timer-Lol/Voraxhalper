// What the instruments owned need from the board, so the futures the advice plays can steer toward it
// instead of taking whatever scores best each round (which, with Incubation Sac and one Pest, mutates that
// Pest away). Each conditional instrument's progress toward its condition, from 0 to 1.
import { instrument } from '@/data/instruments'
import type { Archetype, GameState, Monster, Rarity } from '@/engine/types'

type Groups = Monster[]
const count = (g: Groups, ok: (m: Monster) => boolean) => g.filter(ok).length
const atLeast = (n: number, ok: (m: Monster) => boolean) => (g: Groups) => Math.min(1, count(g, ok) / n)
const of = (a: Archetype) => (m: Monster) => m.archetype === a
const rare = (r: Rarity) => r === 'rare' || r === 'boss'

/** The instruments whose effect waits on the board (their card text), by name. */
const NEEDS: Record<string, (g: Groups) => number> = {
  'Chrysalis Specimen': atLeast(6, of('pest')),
  'Incubation Sac': atLeast(2, of('pest')),
  'Egg-Burdened Butterfly': atLeast(2, of('pest')),
  'Clustered Eggs': atLeast(3, of('pest')),
  'Hyperplastic Frontal Lobe': atLeast(2, of('agito')),
  'Hypertrophic Pituitary': g => (g.some(m => m.archetype === 'agito' && rare(m.rarity)) ? 1 : g.some(of('agito')) ? 0.5 : 0),
  'Adherent Metatarsals': atLeast(2, of('boneSentry')),
  'Sinew Garrote': atLeast(2, of('boneSentry')),
  'Prismatic Liver': atLeast(2, of('aemberon')),
  'Rawhide Restraint': atLeast(3, m => m.rarity === 'magic'),
  'Nettle Toggle': atLeast(3, m => m.rarity === 'normal'),
  'Tanned Leather Restraint': g => [g.some(m => m.rarity === 'normal'), g.some(m => m.rarity === 'magic'), g.some(m => rare(m.rarity))].filter(Boolean).length / 3,
}

/** The average progress of the owned instruments that need something; 1 when none do. */
export function buildProgress(s: GameState): number {
  const groups = s.tanks.filter((t): t is Monster => !!t)
  const needs = s.instruments.map(i => NEEDS[instrument(i.id)?.name ?? '']).filter(Boolean)
  return needs.length ? needs.reduce((sum, need) => sum + need(groups), 0) / needs.length : 1
}
