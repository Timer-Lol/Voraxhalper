// Which game-log lines mean "the board changed", and when its animations have settled enough to look.
// Patterns come from the game's own lines in a real UE_game.log (see tests/fixtures/vorax-log-excerpt.log).

export type TriggerKind = 'board' | 'screen' | 'refresh' | 'over'

export interface TriggerRules {
  patterns: Record<TriggerKind, string[]>
  /** a card or number animation is still playing */
  animation: string
  /** sounds of the player's own clicks, which share the animation prefix but aren't animations */
  playerSounds: string[]
  /** the board's numbers have landed: the last animation of a played potion */
  done: string
  /** the player clicked something: the board they're looking at has settled */
  playerActions: string[]
  doneDelayMs: number
  settleMs: number
  maxMs: number
}

export const DEFAULT_RULES: TriggerRules = {
  patterns: {
    // the server's reply after Confirm or Refresh: the new board
    board: ['ProtoId = 5619'],
    // the game screen opens: the first board and the starting instrument offer
    screen: ['S13GamePlayMain Run', 'S13GamePlay_C_StartGameBtn'],
    refresh: ['S13GamePlayMain_C_RefreshBtn'],
    over: ['ProtoId = 5621', 'S13GamePlayMain Hide', 'S13GamePlayReward_C_FightBtn', 'S13GamePlayReward_C_GiveUpBtn'],
  },
  animation: 'Play_UI_S13_KYZ_Card_',
  playerSounds: ["KYZ_Card_Selected'", 'KYZ_Card_Selected_Confirm', 'KYZ_Card_Agentia_Use'],
  done: 'KYZ_Card_Figure_Refresh',
  playerActions: ['normal-click SelectBtn', 'normal-click ComfirmBtn', 'normal-click RefreshBtn', 'normal-click RelicBtn'],
  // Measured on a real game at the game's x4 Speed-up: a potion's animations end with the numbers
  // landing (done); a deal after an instrument pick or a reroll goes quiet within ~300 ms.
  doneDelayMs: 150,
  settleMs: 400,
  maxMs: 3000,
}

const ORDER: TriggerKind[] = ['board', 'screen', 'refresh', 'over']

export function classify(line: string, rules = DEFAULT_RULES): TriggerKind | null {
  return ORDER.find(k => rules.patterns[k].some(p => line.includes(p))) ?? null
}

export const isAnimation = (line: string, rules = DEFAULT_RULES) =>
  line.includes(rules.animation) && !rules.playerSounds.some(p => line.includes(p))

/** The time at the start of a log line, "[2026.10.17-14.24.11:563]", in ms; null if it has none. */
export function logTime(line: string): number | null {
  const m = /^\[(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d):(\d{3})\]/.exec(line)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : null
}

export interface Settler {
  feed(lines: string[], now: number): void
  /** a snap to take now, at most once per trigger */
  due(now: number): 'board' | 'screen' | null
  cancel(): void
  readonly refreshes: number
  readonly over: boolean
}

export function createSettler(rules = DEFAULT_RULES): Settler {
  let pending: { kind: 'board' | 'screen'; t0: number; lastAnim: number; doneAt: number | null; acted: boolean } | null = null
  const start = (kind: 'board' | 'screen', now: number) => ({ kind, t0: now, lastAnim: now, doneAt: null, acted: false })
  let refreshes = 0
  let over = false

  return {
    feed(lines, now) {
      for (const line of lines) {
        const kind = classify(line, rules)
        if (kind === 'screen') {
          over = false
          refreshes = 0
          pending = start(kind, now)
        } else if (kind === 'over') {
          over = true
          pending = null
        } else if (kind === 'refresh') {
          refreshes++
        } else if (kind === 'board') {
          if (!over) pending = start(kind, now)
        } else if (pending && rules.playerActions.some(p => line.includes(p))) {
          pending.acted = true
        } else if (pending && line.includes(rules.done)) {
          pending.doneAt = now
        } else if (pending && isAnimation(line, rules)) {
          pending.lastAnim = now
        }
      }
    },
    due(now) {
      if (!pending) return null
      const { kind, t0, lastAnim, doneAt, acted } = pending
      const settled = acted || (doneAt !== null && now - doneAt >= rules.doneDelayMs) || now - lastAnim >= rules.settleMs
      if (settled || now - t0 >= rules.maxMs) {
        pending = null
        return kind
      }
      return null
    },
    cancel() {
      pending = null
    },
    get refreshes() {
      return refreshes
    },
    get over() {
      return over
    },
  }
}
