// What the Solver remembers through a game. Instrument icons are small and some look alike (two grey
// brains), but instruments only change when one is picked, and a new one must be one of the three just
// offered, whose cards are read reliably from their text.
import type { FieldRead, Reading } from './types'

export interface InstrumentTracker {
  /** instruments known so far this game, in pick order */
  owned: string[]
  /** the last instrument offer's cards, until one of them is picked */
  offer: string[] | null
  /** picks it wasn't sure of, until a later board shows them clearly or the player says; `looks`: boards seen
   *  since the pick */
  unsure: (PickQuestion & { looks: number })[]
  /** icons in the panel before the first pick: a starting item (it shapes the starting tanks, and isn't an
   *  instrument) sits in the oldest slot, so the picks are the rest; at most 3 */
  start: number
  /** the round each owned instrument was picked in, as the engine counts it (0: not known); in pick order */
  rounds?: number[]
  /** (Vorax Helper) owned instruments taken from the panel's icons rather than from a pick seen on its offer (the
   *  helper joined mid-game, or missed a picture): read again from every board, and replaced by a clearer reading,
   *  so one bad first picture doesn't fix the wrong instruments for the rest of the game. true: its icon read sure. */
  fromPanel?: (boolean | null)[]
  /** (Vorax Helper) the highest round read clearly this game: a clear round 1 after it is a new game */
  maxRound?: number
  /** (Vorax Helper) per instrument taken from the panel: each name it was read as, with its match scores added up */
  votes?: Record<string, number>[]
}

/** Looks after the pick's first picture before the player is asked: that picture can catch the new icon
 *  sliding into the panel (the game's log says nothing of it), so the Solver takes another a moment later
 *  (SolverApp RELOOK_MS) and asks only if that one isn't clear either. */
const ASK_AFTER = 1

export const newTracker = (): InstrumentTracker => ({ owned: [], offer: null, unsure: [], start: 0, rounds: [], fromPanel: [] })

/** The player says which instrument a pick was: it's known from then on. */
export function confirmPick(t: InstrumentTracker, slot: number, name: string): InstrumentTracker {
  const owned = [...t.owned]
  owned[slot] = name
  const fromPanel = [...(t.fromPanel ?? [])]
  fromPanel[slot] = null
  return { ...t, owned, fromPanel, unsure: (t.unsure ?? []).filter(q => q.slot !== slot) }
}

// choosing among the 3 offered, icons compared lined up: on the 151 icons players named, each offered beside 2 others
// of its pool, this asks 13% of the time against 87% for 0.9 compared in place, and picks wrong 0.4% of the time
const SURE = 0.7
const GAP = 0.1

/** A pick the Solver can't place: the offer it came from, and which instrument (in pick order) it is. */
export interface PickQuestion { offer: string[]; slot: number }

export function trackInstruments(
  t: InstrumentTracker,
  r: Reading,
  trigger?: string,
): { tracker: InstrumentTracker; instruments: string[]; rounds: number[]; fields: Record<string, FieldRead>; ask?: PickQuestion; settled: number[] } {
  const s = r.state
  // (Vorax Helper) a new game: its first instrument offer with an empty panel, or a clear round 1 after a later round
  // of the game before. A starting item in the panel used to hide the first: the last game's three instruments were
  // kept, and with three owned no instrument was advised (player reports, 2026-10-23).
  const roundSure = !!r.fields.round?.sure && s.round !== undefined
  const again = roundSure && s.round === 1 && (t.maxRound ?? 0) >= 2 && (s.phase === 'instrument' || s.phase === 'potion')
  const start = trigger === 'screen' || (s.phase === 'instrument' && s.round === 1 && s.instruments.length === 0) || again
  const maxRound = Math.max(start ? 0 : (t.maxRound ?? 0), roundSure ? s.round! : 0)
  let owned = start ? [] : [...t.owned]
  // a pick comes from the offer before this picture; this picture's offer is for the next pick
  let offer = start ? null : t.offer
  let unsure = start ? [] : (t.unsure ?? [])
  let rounds = start ? [] : [...(t.rounds ?? [])]
  // null: known from a pick or the player; true/false: taken from the panel, and whether that icon read sure
  let fromPanel: (boolean | null)[] = start ? [] : [...(t.fromPanel ?? [])]
  let votes: Record<string, number>[] = start ? [] : [...(t.votes ?? [])]
  // an owned instrument is sure unless it's a pick the player hasn't confirmed
  const known = (n: string, i: number): FieldRead => (unsure.some(q => q.slot === i) ? { sure: false, guess: n } : { sure: true, guess: n })
  const nextOffer = s.phase === 'instrument' && s.hand.length ? [...s.hand] : null
  if (!offer && start) offer = nextOffer

  // Before the first pick nothing is owned, so whatever the panel shows while the first offer is up (round 1)
  // isn't a pick: a starting item, which stays in the oldest slot, or on 16:9 a flask, which the first pick
  // replaces. Later offers can show a new pick beside them.
  const beforeFirstPick = s.phase === 'instrument' && s.round === 1 && owned.length === 0
  // a new game noticed on its potion board (its instrument offer missed) keeps the last game's starting items
  let startItems = start && !(again && s.phase === 'potion') ? 0 : (t.start ?? 0)
  if (beforeFirstPick) startItems = s.instruments.length
  // the first pick didn't add an icon: what was there was the flask, now the pick
  else if (owned.length === 0 && startItems > 0 && offer && s.instruments.length === startItems) startItems = 0
  let panel = s.instruments.slice(startItems)
  let ranks = (r.instrumentRanks ?? []).slice(startItems)
  // three picks at most: a fourth icon (a game joined late) is a starting item
  if (panel.length > 3) {
    const extra = panel.length - 3
    startItems += extra
    panel = panel.slice(extra)
    ranks = ranks.slice(extra)
  }
  const count = beforeFirstPick ? 0 : panel.length
  const fields: Record<string, FieldRead> = {}
  let ask: PickQuestion | undefined
  // an unsure pick looked at again: the first picture can catch the icon sliding in; on a later board, a clear
  // match with one of the offer it came from settles it
  const settled: number[] = []
  if (count >= owned.length) {
    for (const q of unsure) {
      const scored = q.offer.map(n => [n, ranks[q.slot]?.find(([name]) => name === n)?.[1] ?? 0] as const).sort((a, b) => b[1] - a[1])
      if (scored[0][1] >= SURE && scored[0][1] - (scored[1]?.[1] ?? 0) >= GAP) {
        owned = owned.map((n, i) => (i === q.slot ? scored[0][0] : n))
        settled.push(q.slot)
      }
    }
    unsure = unsure.filter(q => !settled.includes(q.slot)).map(q => ({ ...q, looks: q.looks + 1 }))
    // still unclear after a few boards: the player is asked
    const due = unsure.find(q => q.looks === ASK_AFTER)
    if (due) ask = { offer: [...due.offer], slot: due.slot }
  }
  if (count === owned.length) {
    // (Vorax Helper) instruments taken from the panel are read again on every board, and each slot goes to the name it
    // was read as most, weighted by match score: one picture with the mouse pointer over an icon read Black Goat Gut
    // Suture as Contracted Claws, clearly enough to replace it for good, and the advice followed the wrong instrument
    // (player report, 2026-10-23: Osteolytic Ointment advised beside a 246k tank)
    owned = owned.map((n, i) => {
      if (fromPanel[i] === undefined || fromPanel[i] === null) return n
      const f = r.fields[`instrument${i + startItems}`], now = panel[i]
      if (!now || !f) return n
      const v = { ...(votes[i] ?? { [n]: 0 }) }
      v[now] = (v[now] ?? 0) + Math.max(0.05, f.score ?? (f.sure ? 1 : 0.5))
      votes[i] = v
      // a change of name needs more than one picture's worth of lead, so a single odd picture can't flip it
      const top = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]
      const best = top !== n && v[top] - (v[n] ?? 0) < 0.5 ? n : top
      if (f.sure && now === best) fromPanel[i] = true
      return best
    })
    owned.forEach((n, i) => (fields[`instrument${i}`] = fromPanel[i] === false ? { sure: false, guess: n } : known(n, i)))
  } else if (count === owned.length + 1 && offer) {
    const pick = offer
      .map(n => [n, ranks[count - 1]?.find(([name]) => name === n)?.[1] ?? 0] as const)
      .sort((a, b) => b[1] - a[1])
    let [name, score] = pick[0]
    // like none of those we have pictures of: one we have no picture of yet (shown as unsure, to check;
    // with two or more of those it's a guess between them, and a correction sticks)
    const unpictured = offer.filter(n => !ranks[count - 1]?.some(([k]) => k === n))
    if (score < SURE && unpictured.length) [name, score] = [unpictured[0], 0]
    owned = [...owned, name]
    fromPanel = [...fromPanel.slice(0, count - 1), null]
    // the first pick opens round 1; a later one shows up on the round's potion board, or beside the next offer,
    // whose screen still shows the round just played
    rounds = [...rounds.slice(0, count - 1), count === 1 ? 1 : s.round === undefined ? 0 : s.phase === 'instrument' ? s.round + 1 : s.round]
    owned.forEach((n, i) => (fields[`instrument${i}`] = known(n, i)))
    const sure = score >= SURE && score - (pick[1]?.[1] ?? 0) >= GAP
    fields[`instrument${count - 1}`] = { sure, guess: name, score, second: pick[1]?.[1] }
    // not confident which one it was (no picture of it yet, or the pictures don't match well): the player says,
    // and the answer trains the reader
    // not judged on this picture: later boards look again, and only then is the player asked
    if (!sure) unsure = [...unsure, { offer: [...offer], slot: count - 1, looks: 0 }]
    offer = null
  } else {
    // out of step (joined mid-game, or a missed picture): take the panel as read
    owned = [...panel]
    fromPanel = owned.map((_, i) => !!r.fields[`instrument${i + startItems}`]?.sure)
    votes = owned.map((n, i) => ({ [n]: Math.max(0.05, r.fields[`instrument${i + startItems}`]?.score ?? 0.5) }))
    rounds = owned.map(() => 0)
    unsure = unsure.filter(q => q.slot < owned.length)
    owned.forEach((n, i) => (fields[`instrument${i}`] = r.fields[`instrument${i + startItems}`] ?? { sure: false, guess: n }))
  }
  // (Vorax Helper) the game offers an instrument only to a player with fewer than three: three owned beside an offer
  // is a count gone wrong (the last game's, or a phantom icon), and "already full" would hide the pick. The icons
  // that read clearly are kept, at most two, and shown to check.
  if (s.phase === 'instrument' && s.hand.length > 0 && owned.length >= 3 && (s.round ?? 99) <= 10) {
    const clear = panel.filter((n, i) => n && r.fields[`instrument${i + startItems}`]?.sure).slice(0, 2)
    owned = clear
    fromPanel = owned.map(() => false)
    rounds = owned.map(() => 0)
    unsure = []
    for (const k of Object.keys(fields)) delete fields[k]
    owned.forEach((n, i) => (fields[`instrument${i}`] = { sure: false, guess: n }))
  }
  rounds = owned.map((_, i) => rounds[i] ?? 0)
  fromPanel = owned.map((_, i) => (fromPanel[i] === undefined ? null : fromPanel[i]))
  votes = owned.map((_, i) => (fromPanel[i] === null ? {} : votes[i] ?? {}))
  return { tracker: { owned, offer: nextOffer ?? offer, unsure, start: startItems, rounds, fromPanel, maxRound, votes }, instruments: owned, rounds, fields, settled, ...(ask ? { ask } : {}) }
}
