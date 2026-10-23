export type VialTier = 'white' | 'purple' | 'red' | 'rainbow'
export const VIAL_COUNT = 6

/**
 * Ultimate Activity at which each vial step happens. Vials upgrade left to right:
 * steps 1–6 turn vials purple, 7–12 turn them red, 13 turns the first vial rainbow (only ever one).
 * Confirmed in-game: 38,000 (first purple), 266,000, 512,000, 607,000, 721,000 (reds 1, 4, 5, 6), 1,120,000 (rainbow).
 * Estimated: purples 2–6 (equal growth ratio up to 266,000) and reds 2–3 (evenly spaced to 512,000).
 */
export const VIAL_LEVELS = [
  38_000, 52_600, 72_700, 100_500, 139_100, 192_300, // purple 1–6 (2–6 estimated)
  266_000, 348_000, 430_000, 512_000, 607_000, 721_000, // red 1–6 (2–3 estimated)
  1_120_000, // rainbow
] as const

export function vialTiers(ultimateActivity: number): VialTier[] {
  const level = VIAL_LEVELS.filter(v => ultimateActivity >= v).length
  return Array.from({ length: VIAL_COUNT }, (_, i) => {
    if (i === 0 && level >= 2 * VIAL_COUNT + 1) return 'rainbow'
    if (level >= VIAL_COUNT + 1 + i) return 'red'
    if (level >= 1 + i) return 'purple'
    return 'white'
  })
}

/** The next vial step: the Ultimate Activity needed and the color that vial turns. */
export function nextVial(ultimateActivity: number): { value: number; tier: VialTier } | null {
  const step = VIAL_LEVELS.findIndex(level => level > ultimateActivity)
  if (step < 0) return null
  const tier: VialTier = step < VIAL_COUNT ? 'purple' : step < 2 * VIAL_COUNT ? 'red' : 'rainbow'
  return { value: VIAL_LEVELS[step], tier }
}
