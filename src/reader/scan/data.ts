// The reader's reference data: what digits, name colours, icons, card art and headers look like.
// Made from labelled live frames by scripts/scan/build.ts into data.json.
import type { Rarity } from '@/engine/types'
import type { ArtFeature } from './pixels'
import type { TextKind } from './text'

export type HandPhase = 'potion' | 'instrument' | 'protocol'

export interface ScanData {
  generated: string
  frames: number
  /** glyph vectors by text kind, then character ('0'-'9', 'x') */
  digits: Record<TextKind, Record<string, number[][]>>
  /** name text colours seen for each rarity */
  rarityRgb: Record<Rarity, [number, number, number][]>
  /** card art by `${phase}:${name}` */
  cards: Record<string, ArtFeature[]>
  /** card text-block shapes (title and body) by `${phase}:${name}` */
  texts: Record<string, number[][]>
  /** header text shape for each phase */
  headers: Record<HandPhase, number[][]>
  /** equipped-instrument panel icons (24x24 grey patterns) by name, and 'none' for an empty slot */
  instrumentIcons: Record<string, number[][]>
}

/** data.json as stored: the card text shapes (most of its size) packed as base64 bytes. */
export type PackedScanData = Omit<ScanData, 'texts'> & { texts: Record<string, string[]> }

/** Text shapes are unit-length vectors of 1,520 small values (under 0.14): one byte each, in steps of this. */
const TEXT_STEP = 0.002

export function packTexts(texts: Record<string, number[][]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(texts).map(([k, vs]) => [k, vs.map(v => btoa(String.fromCharCode(...v.map(x => Math.max(-127, Math.min(127, Math.round(x / TEXT_STEP))) & 255))))]),
  )
}

export function unpackTexts(packed: Record<string, string[]>): Record<string, number[][]> {
  return Object.fromEntries(
    Object.entries(packed).map(([k, vs]) => [k, vs.map(s => Array.from(atob(s), c => ((c.charCodeAt(0) << 24) >> 24) * TEXT_STEP))]),
  )
}

export const unpack = (raw: PackedScanData): ScanData => ({ ...raw, texts: unpackTexts(raw.texts) })
export const pack = (data: ScanData): PackedScanData => ({ ...data, texts: packTexts(data.texts) })
