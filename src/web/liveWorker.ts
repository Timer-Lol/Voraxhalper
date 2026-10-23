// Follows the game log off the page, so a background tab keeps up with the game.
import { createFollower, type FileLike } from '../reader/live/logFollower'
import { CHECK_MS, createLiveLoop, POLL_MS } from '../reader/live/liveLoop'
import type { TriggerRules } from '../reader/live/triggers'

let stop: (() => void) | null = null
let loopRef: ReturnType<typeof createLiveLoop> | null = null

self.onmessage = (e: MessageEvent<{ type: 'start'; handle: FileLike; rules: TriggerRules } | { type: 'stop' } | { type: 'snapNow' } | { type: 'cancel' }>) => {
  const m = e.data
  if (m.type === 'start') {
    stop?.()
    const loop = createLiveLoop({ follower: createFollower(m.handle), now: () => Date.now(), post: ev => self.postMessage(ev), rules: m.rules })
    let busy = false
    const p = setInterval(async () => {
      if (busy) return
      busy = true
      try { await loop.poll() } finally { busy = false }
    }, POLL_MS)
    const c = setInterval(() => loop.check(), CHECK_MS)
    stop = () => { clearInterval(p); clearInterval(c) }
    loopRef = loop
  } else if (m.type === 'stop') { stop?.(); stop = null; loopRef = null }
  else if (m.type === 'snapNow') loopRef?.snapNow()
  else if (m.type === 'cancel') loopRef?.cancel()
}
