import type { Settings } from '@/engine/types'

/** Intern Shelley (Pactspirit) levels. Source: tlidb.com/Intern_Shelley (beta data). */
export const SHELLEY_LEVELS = [1, 2, 3, 4, 5, 6] as const
export const DEFAULT_SHELLEY_LEVEL = 6

/** Potion refreshes don't depend on Shelley. */
export const POTION_REFRESHES = 3

const INSTRUMENT_BONUS = [0, 1, 1, 2, 2, 2]

/** "During the Surgical Preparation phase, Surgical Instrument refresh attempts +N". */
export function instrumentRefreshesFor(level: number): number {
  return INSTRUMENT_BONUS[level - 1] ?? 0
}

export function settingsForShelley(level: number): Settings {
  return { potionRefreshes: POTION_REFRESHES, instrumentRefreshes: instrumentRefreshesFor(level) }
}
