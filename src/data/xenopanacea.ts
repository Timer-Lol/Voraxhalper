// Supreme (ULT) potions the simulator can't play out: the Xenopanacea family, whose cards print only flavour text,
// and the Holy Water rites, whose effect is another card later (issue #13: First Rite Holy Water: Confession gives a
// Ritual Holy Water: Flagellation the next round). The Solver still reads them, and when one is offered it's always
// the advice. The Xenopanacea variants seen live, and the family name alone for one not seen yet.
export const XENOPANACEA = ['Xenopanacea: Osteotrophy', 'Xenopanacea: Brood', 'Xenopanacea'] as const
export const HOLY_WATER_RITES = ['First Rite Holy Water: Confession', 'Ritual Holy Water: Flagellation'] as const
/** Every ULT name the Solver reads but doesn't simulate. */
export const ALWAYS_TAKE = [...XENOPANACEA, ...HOLY_WATER_RITES] as const

export const isXenopanacea = (name: string) => name.trim().toLowerCase().startsWith('xenopanacea')
/** A rite is "… Holy Water: …"; Purest Holy Water, which has no colon, is simulated. */
export const isAlwaysTake = (name: string) => isXenopanacea(name) || /holy water:/i.test(name)
