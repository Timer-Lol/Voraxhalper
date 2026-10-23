import data from './data.json'
import { unpack, type HandPhase, type PackedScanData } from './data'
import { scan, type LocalRefs } from './scan'
import { layout } from './layout'
import { readSlots } from './cards'

type Ask =
  | { id: number; kind?: 'frame'; img: ImageData; trigger?: string; local: LocalRefs; pictures?: boolean }
  | { id: number; kind: 'slots'; img: ImageData; phase: HandPhase; size: number; slots: number[]; local: LocalRefs; ui?: number }

const DATA = unpack(data as unknown as PackedScanData)

self.onmessage = (e: MessageEvent<Ask>) => {
  const ask = e.data
  if (ask.kind === 'slots') {
    const { fields, problems, ranks } = readSlots(ask.img, layout(ask.img, ask.ui), ask.size, ask.phase, ask.slots, DATA, ask.local)
    const read = Object.fromEntries(ask.slots.map(j => [j, { ranks: ranks[j], field: fields[`hand${j}`], unknown: problems.some(p => p.kind === 'unknownArt' && p.field === `hand${j}`) }]))
    self.postMessage({ id: ask.id, read })
    return
  }
  const reading = scan(ask.img, DATA, ask.local, { pictures: ask.pictures ?? true })
  if (reading.frame) reading.frame.trigger = ask.trigger
  self.postMessage({ id: ask.id, reading })
}
