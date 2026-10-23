// Plays slices of a board's futures on another CPU core.
import { playWork, type Work } from '@/strategy/advisor'

self.onmessage = (e: MessageEvent<{ id: number; work: Work; from: number; to: number }>) => {
  const { id, work, from, to } = e.data
  self.postMessage({ id, tallies: playWork(work, from, to) })
}
