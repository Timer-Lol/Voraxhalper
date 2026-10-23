// Instrument pick strategies built from sweep data (see scripts/sweep/make_tables.py).
import { canRefresh } from '@/engine/game'
import { priorPicker, type InstrumentPicker } from './bot'

export interface Tables {
  threshold: number
  basic: Record<string, number>
  pair: Record<string, number>
  trio: Record<string, number>
}

/** Validated default: refresh until the best offer is worth at least tau (basic / 2nd / 3rd pick). */
export const DEFAULT_TAU: [number, number, number] = [0.6, 0.6, 0.6]

/** Value (P(hit) from sweeps) of taking instrument `id` given what is already equipped; undefined when no data. */
export function tableValue(t: Tables, have: number[], id: number): number | undefined {
  if (have.length === 0) return t.basic[id]
  if (have.length === 1) return t.pair[`${have[0]},${id}`]
  return t.trio[`${have[0]},${have[1]},${id}`]
}

export const tablePicker = (t: Tables, tau: number[] = DEFAULT_TAU): InstrumentPicker => s => {
  const have = s.instruments.map(i => i.id)
  const vals = s.hand.map(c => tableValue(t, have, c.id))
  if (vals.some(v => v === undefined)) return priorPicker(s, 0)   // no data for this combination: fixed prior, no refresh
  const v = vals as number[]
  const best = v.indexOf(Math.max(...v))
  return v[best] < (tau[Math.min(have.length, 2)] ?? 0) && canRefresh(s) ? 'refresh' : best
}
