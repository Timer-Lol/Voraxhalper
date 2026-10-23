// (Vorax Helper) Racing look-ahead: the same futures as upstream's look-ahead, but an option that is clearly behind
// after the first slices stops being played. Futures are numbered and seeded by their number, so every option is
// played on the same futures (common random numbers) and slices add up exactly as the full run would.
// Meant to give the same advice as the full look-ahead in less time; the local sim (dealt.ts rplan / rsmart) checks that.
import type { Action, GameState } from '@/engine/types'
import { canRefresh } from '@/engine/game'
import { evChooser, instrumentFutures, play, potionFutures, shortlist, type Chooser, type InstrumentChoice, type InstrumentPicker, type LookAhead, type Tally } from './bot'

export interface Race {
  /** futures per option before the first cut, and between cuts */
  step: number
  /** the most futures an option is played */
  max: number
  /** an option whose mean goal is below the leader's by more than this share is dropped (0.03 = 3%) */
  margin: number
}

/** Plays the options' futures in slices, dropping the clearly worse; returns each option's totals. */
export function race(n: number, slice: (alive: number[], from: number, to: number) => Tally[], r: Race): Tally[] {
  const t: Tally[] = Array.from({ length: n }, () => ({ goal: 0, reached: 0, n: 0 }))
  let alive = Array.from({ length: n }, (_, i) => i)
  for (let from = 0; from < r.max && alive.length; from += r.step) {
    const to = Math.min(r.max, from + r.step)
    slice(alive, from, to).forEach((p, k) => { const i = alive[k]; t[i].goal += p.goal; t[i].reached += p.reached; t[i].n += p.n })
    if (alive.length === 1) break
    const mean = (i: number) => t[i].goal / t[i].n
    const best = Math.max(...alive.map(mean))
    alive = alive.filter(i => mean(i) >= best * (1 - r.margin))
  }
  return t
}

/** Potions: the look-ahead's choice with racing. `value` stays this round's expected score (finish() uses it for refreshes). */
export const raceChooser = (la: LookAhead, r: Race): Chooser => (s, seed) => {
  const opts = shortlist(s, seed, la)
  if (!opts.length) return { best: [], value: -1 }
  if (opts.length === 1) return { best: opts[0].o, value: opts[0].v }
  const t = race(opts.length, (alive, from, to) => potionFutures(s, seed, la, alive.map(i => opts[i].o), from, to), r)
  // the options played furthest, then by their mean goal
  const order = opts.map((_, i) => i).sort((a, b) => t[b].n - t[a].n || t[b].goal / t[b].n - t[a].goal / t[a].n)
  const best = opts[order[0]]
  return { best: best.o as Action[], value: best.v }
}

/** Instruments: upstream's smart board picker (each offer and a refresh played to the end) with racing. */
export const racePicker = (r: Race): InstrumentPicker => (s, seed) => {
  const choices: InstrumentChoice[] = [...s.hand.map((_, i) => i), ...(canRefresh(s) ? ['refresh' as const] : [])]
  if (choices.length === 1) return choices[0]
  const rollout = evChooser({ samples: 4, horizon: 0, value: true })
  const t = race(choices.length, (alive, from, to) => instrumentFutures(s, seed, alive.map(i => choices[i]), rollout, 'target', from, to, true), r)
  const order = choices.map((_, i) => i).sort((a, b) => t[b].n - t[a].n || t[b].goal / t[b].n - t[a].goal / t[a].n)
  return choices[order[0]]
}
export { play }
