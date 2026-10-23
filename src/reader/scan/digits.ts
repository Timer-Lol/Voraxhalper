// Reading numbers: each glyph is matched against the reference shapes of its kind of text.
import type { Rect } from '../types'
import { glyphVector, type Img } from './pixels'
import { glyphs, type TextKind } from './text'

/** alts: each glyph's three best characters, best first */
export interface TextRead { text: string; score: number; second: number; alts: string[][] }

/** The characters in a rect, with the mean best and runner-up match scores (1 = identical). */
export function readText(img: Img, g: Float32Array, r: Rect, kind: TextKind, refs: Record<string, number[][]>): TextRead | null {
  const gs = glyphs(img, r, kind)
  if (!gs.length) return null
  const lineH = Math.max(...gs.map(b => b.h))
  let text = '', score = 0, second = 0
  const alts: string[][] = []
  for (const b of gs) {
    const v = glyphVector(g, img.width, img.height, b, lineH)
    const best = Object.entries(refs).map(([ch, vs]) => [ch, Math.max(...vs.map(ref => ref.reduce((s, x, i) => s + x * v[i], 0)))] as const).sort((a, b) => b[1] - a[1])
    text += best[0][0]
    alts.push(best.slice(0, 3).map(([ch]) => ch))
    score += best[0][1]
    second += best[1]?.[1] ?? -1
  }
  return { text, score: score / gs.length, second: second / gs.length, alts }
}
