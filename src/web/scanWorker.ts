// Reads frames off the page. Built into a string and started from a Blob, so it also works from a local file.
import data from '../reader/scan/data.json'
import { unpack, type HandPhase, type PackedScanData } from '../reader/scan/data'
import { scan, type LocalRefs } from '../reader/scan/scan'
import { handLayout, layout } from '../reader/scan/layout'
import { readSlots } from '../reader/scan/cards'
import { normalColours, readAreas } from '../reader/scan/levels'
import normal from '../reader/scan/levels.json'

type Ask =
  | { id: number; kind?: 'frame'; img: ImageData; trigger?: string; local: LocalRefs; pictures?: boolean }
  | { id: number; kind: 'slots'; img: ImageData; phase: HandPhase; size: number; slots: number[]; local: LocalRefs; shift?: readonly number[]; ui?: number }

const DATA = unpack(data as unknown as PackedScanData)

self.onmessage = (e: MessageEvent<Ask>) => {
  const ask = e.data
  if (ask.kind === 'slots') {
    // (Vorax Helper) with the colours the scan read them in (a capture with HDR or another gamma is corrected first)
    const img = normalColours(ask.img, normal, readAreas(layout(ask.img, ask.ui ?? 1))).img as ImageData
    const { fields, problems, ranks } = readSlots(img, handLayout(img, ask.ui, ask.shift), ask.size, ask.phase, ask.slots, DATA, ask.local)
    const read = Object.fromEntries(ask.slots.map(j => [j, { ranks: ranks[j], field: fields[`hand${j}`], unknown: problems.some(p => p.kind === 'unknownArt' && p.field === `hand${j}`) }]))
    self.postMessage({ id: ask.id, read })
    return
  }
  // (Vorax Helper) a picture the page asked for (not the screen watch's) tries every interface scale when it can't read
  const reading = scan(ask.img, DATA, ask.local, { pictures: ask.pictures ?? true, thorough: ask.trigger !== 'watch' })
  if (reading.frame) reading.frame.trigger = ask.trigger
  self.postMessage({ id: ask.id, reading })
}
