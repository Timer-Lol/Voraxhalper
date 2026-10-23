// Following the log and deciding when to snap, without timers of its own: the Worker (or the page)
// calls poll() every POLL_MS and check() every CHECK_MS.
import type { Follower } from './logFollower'
import { classify, createSettler, DEFAULT_RULES, type TriggerRules } from './triggers'

export const POLL_MS = 250
export const CHECK_MS = 50

export type LiveEvent =
  | { type: 'snap'; kind: 'board' | 'screen' | 'manual' | 'watch' | 'after-click'; triggerAt: number; lines: string[] }
  | { type: 'status'; detailSeen: boolean; refreshes: number; over: boolean; lines: number }
  /** the capture-mode clock (TICK_MS), kept off the page so a background tab isn't throttled */
  | { type: 'tick' }

export function createLiveLoop(o: { follower: Follower; now: () => number; post: (e: LiveEvent) => void; rules?: TriggerRules }) {
  const rules = o.rules ?? DEFAULT_RULES
  const settler = createSettler(rules)
  let trigger: { at: number; lines: string[] } | null = null
  let total = 0

  return {
    async poll() {
      const lines = await o.follower.poll()
      const t = o.now()
      for (const line of lines) {
        const kind = classify(line, rules)
        if (kind === 'board' || kind === 'screen') trigger = { at: t, lines: [line] }
        else if (kind && trigger) trigger.lines.push(line)
      }
      settler.feed(lines, t)
      total += lines.length
      o.post({ type: 'status', detailSeen: o.follower.detailSeen, refreshes: settler.refreshes, over: settler.over, lines: total })
    },
    check() {
      const kind = settler.due(o.now())
      if (kind) o.post({ type: 'snap', kind, triggerAt: trigger?.at ?? o.now(), lines: trigger?.lines ?? [] })
    },
    snapNow() {
      o.post({ type: 'snap', kind: 'manual', triggerAt: o.now(), lines: [] })
    },
    cancel() {
      settler.cancel()
    },
  }
}
