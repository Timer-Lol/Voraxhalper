// Where each part of the Surgical Preparation screen sits. Measured on 3440x1440 frames (21:9) from a live
// game, in pixels of that frame, and placed on other frames by scaling with the height from the anchor the
// game's UI uses: the left or right edge, or the centre. The tanks are part of the 3D scene, which is
// framed differently on each screen shape: on 16:9 they sit closer together and higher (measured on a live
// 1920x1080 frame). Between those two shapes the tank positions are blended; outside them they stay at
// the nearest measured one, so 16:10, 4:3 and 32:9 screens still need frames of their own.
import type { Rect } from '../types'

const REF_H = 1440

/** Reference rects, x relative to the frame centre unless noted. */
/** The tanks' labels, by screen shape: centres under the six tanks (perspective pushes the right-hand ones
 *  further out), and the rows of the name, the total and Activity x Quantity. */
interface TankScene { x: number[]; name: [number, number]; total: [number, number]; aq: [number, number]; icon: number; iconSize: number }
const ULTRAWIDE: TankScene = { x: [-858, -421, 16, 454, 913, 1386], name: [556, 577], total: [578, 600], aq: [599, 619], icon: 533, iconSize: 26 }
const WIDE_16_9: TankScene = { x: [-756, -400, -48, 304, 667, 1037], name: [511, 531], total: [532, 552], aq: [554, 574], icon: 496, iconSize: 22 }
const ASPECT_16_9 = 16 / 9
const ASPECT_ULTRAWIDE = 3440 / 1440
const LABEL_HALF_W = 200

const mix = (a: number, b: number, t: number) => a + (b - a) * t
const mixPair = (a: [number, number], b: [number, number], t: number): [number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t)]

/** The tanks' labels for a screen of this shape. */
export function tankScene(aspect: number): TankScene {
  const t = Math.min(1, Math.max(0, (aspect - ASPECT_16_9) / (ASPECT_ULTRAWIDE - ASPECT_16_9)))
  return {
    x: ULTRAWIDE.x.map((x, i) => mix(WIDE_16_9.x[i], x, t)),
    name: mixPair(WIDE_16_9.name, ULTRAWIDE.name, t),
    total: mixPair(WIDE_16_9.total, ULTRAWIDE.total, t),
    aq: mixPair(WIDE_16_9.aq, ULTRAWIDE.aq, t),
    icon: mix(WIDE_16_9.icon, ULTRAWIDE.icon, t),
    iconSize: mix(WIDE_16_9.iconSize, ULTRAWIDE.iconSize, t),
  }
}

const CARD_X0 = -90
const CARD_PITCH = 226.5
const CARD_ART = { y: 975, w: 100, h: 120 }
const CARD_FACE = { y: 960, w: 230, h: 340 }
/** The hand is fanned: each card's centre and tilt (radians), measured from the cards' edges. */
const CARD_CY = 1130
const CARD_TILT = [-0.0576, 0, 0.0506]
/** The fan's arc: the side cards sit a little lower and further out than the middle one. */
const CARD_SHIFT = [{ x: 6, y: 6 }, { x: 0, y: 0 }, { x: -6, y: 6 }]
/** A Potion Kit opens to five cards, fanned wider: centres from the frame centre, heights and tilts. */
const HAND5 = { x: [-385, -163, 70, 303, 515], y: [1141, 1121, 1111, 1121, 1141], tilt: [-0.11, -0.06, 0, 0.05, 0.11] }
/** Art and title in a card's own frame, in reference pixels from its centre. */
export const CARD_LOCAL = { art: { x: -50, y: -155, w: 100, h: 120 }, text: { x: -100, y: -45, w: 185, h: 175 } }
const HEADER = { x: -260, y: 908, w: 560, h: 30 }
const REFRESH = { x: 300, y: 1342, w: 160, h: 40 }

/** From the left edge. */
const ROUND = { x: 105, y: 500, w: 100, h: 70 }
/** (Vorax Helper) the Ultimate Activity number under the round, from the left edge: the sum of the tanks' totals.
 *  Measured on live 2558x1367 frames: digits 139-233 wide (centred), rows 648-665. */
const ULTIMATE = { x: 95, y: 640, w: 185, h: 34 }

/** From the right edge: icon centres, the newest first. Three picks fit, and a fourth slot holds the permanent
 *  item some players have (an ewer) at the oldest end. */
const INSTRUMENT = { right: 162, pitch: 135, y: 66, size: 74 }

export interface CardPos { cx: number; cy: number; angle: number }

/** A card's face around its centre, for showing it in "What is this?". */
export const cardFace = (c: CardPos, k: number): Rect => ({ x: c.cx - (CARD_FACE.w / 2) * k, y: c.cy - (CARD_FACE.h / 2) * k, w: CARD_FACE.w * k, h: CARD_FACE.h * k })

export interface Layout {
  width: number
  height: number
  /** pixels per reference pixel of the interface */
  k: number
  /** (Vorax Helper) the same for the hand, header and buttons, when the bottom UI is drawn a little larger or smaller than the rest */
  hk?: number
  tankCx: number[]
  icon: Rect[]
  nameBand: Rect[]
  totalBand: Rect[]
  aqBand: Rect[]
  cardArt: Rect[]
  cardFace: Rect[]
  /** each card's centre and tilt, for sampling its art and title straightened */
  cards: CardPos[]
  /** the same for a Potion Kit's five cards */
  hand5: CardPos[]
  header: Rect
  refresh: Rect
  round: Rect
  /** the Ultimate Activity number (Vorax Helper) */
  ultimate: Rect
  /** rightmost slot first */
  instrumentIcon: Rect[]
}

/** The game's interface scale: Windows' display scale (or the game's own) enlarges every panel, card and label
 *  from where it's anchored, while the 3D tanks stay put (issue #12: 125% at 2560x1440). */
export const UI_SCALES = [1, 1.25, 1.5, 1.75, 2]
/** The tanks' labels grow about their total's row. */
const LABEL_MID = 542

export function layout(frame: { width: number; height: number }, ui = 1): Layout {
  const { width, height } = frame
  const s = height / REF_H
  const k = s * ui
  const cx = width / 2
  /** a y from the bottom edge, from the middle, and in a tank's label */
  const bottom = (y: number) => (REF_H - (REF_H - y) * ui) * s
  const middle = (y: number) => (REF_H / 2 + (y - REF_H / 2) * ui) * s
  const label = (y: number) => (LABEL_MID + (y - LABEL_MID) * ui) * s
  // the labels' text grows, but not the space between tanks: a wider band would take in the next label
  const band = (x: number, y: [number, number] | number[]) => ({ x: x - LABEL_HALF_W * s, y: label(y[0]), w: 2 * LABEL_HALF_W * s, h: (y[1] - y[0]) * k })
  const scene = tankScene(width / height)
  const tankCx = scene.x.map(x => cx + x * s)
  const cardCx = [0, 1, 2].map(j => cx + (CARD_X0 + CARD_PITCH * j) * k)
  const instrumentCx = [0, 1, 2, 3].map(j => width - (INSTRUMENT.right + INSTRUMENT.pitch * j) * k)
  return {
    width,
    height,
    k,
    tankCx,
    icon: tankCx.map(x => ({ x: x - (scene.iconSize / 2) * k, y: label(scene.icon) - (scene.iconSize / 2) * k, w: scene.iconSize * k, h: scene.iconSize * k })),
    nameBand: tankCx.map(x => band(x, scene.name)),
    totalBand: tankCx.map(x => band(x, scene.total)),
    aqBand: tankCx.map(x => band(x, scene.aq)),
    cardArt: cardCx.map(x => ({ x: x - (CARD_ART.w / 2) * k, y: bottom(CARD_ART.y), w: CARD_ART.w * k, h: CARD_ART.h * k })),
    cardFace: cardCx.map(x => ({ x: x - (CARD_FACE.w / 2) * k, y: bottom(CARD_FACE.y), w: CARD_FACE.w * k, h: CARD_FACE.h * k })),
    cards: cardCx.map((x, j) => ({ cx: x + CARD_SHIFT[j].x * k, cy: bottom(CARD_CY + CARD_SHIFT[j].y), angle: CARD_TILT[j] })),
    hand5: HAND5.x.map((x, j) => ({ cx: cx + x * k, cy: bottom(HAND5.y[j]), angle: HAND5.tilt[j] })),
    header: { x: cx + HEADER.x * k, y: bottom(HEADER.y), w: HEADER.w * k, h: HEADER.h * k },
    refresh: { x: cx + REFRESH.x * k, y: bottom(REFRESH.y), w: REFRESH.w * k, h: REFRESH.h * k },
    round: { x: ROUND.x * k, y: middle(ROUND.y), w: ROUND.w * k, h: ROUND.h * k },
    ultimate: { x: ULTIMATE.x * k, y: middle(ULTIMATE.y), w: ULTIMATE.w * k, h: ULTIMATE.h * k },
    instrumentIcon: instrumentCx.map(x => ({ x: x - (INSTRUMENT.size / 2) * k, y: (INSTRUMENT.y - INSTRUMENT.size / 2) * k, w: INSTRUMENT.size * k, h: INSTRUMENT.size * k })),
  }
}

/** Pixels per reference pixel for the hand's cards, header and buttons. */
export const handK = (l: Layout): number => l.hk ?? l.k

/** The hand's widgets moved by (dx, dy) reference pixels (dx for the header only; the Confirm/Refresh row stays put; the cards' places across hold
 *  on every screen measured), for a window whose bottom UI sits a little off the measured place. */
export function shiftHand(l: Layout, dx: number, dy: number): Layout {
  const k = handK(l), mv = (r: Rect, x = 0): Rect => ({ ...r, x: r.x + x * k, y: r.y + dy * k })
  const mc = (c: CardPos): CardPos => ({ ...c, cy: c.cy + dy * k })
  return { ...l, header: mv(l.header, dx), cardArt: l.cardArt.map(r => mv(r)), cardFace: l.cardFace.map(r => mv(r)), cards: l.cards.map(mc), hand5: l.hand5.map(mc) }
}

/** (Vorax Helper) How much larger than the rest the bottom UI (hand, header, buttons) can be drawn: seen 5-7% larger on a
 *  3440x1440 fullscreen game, 2026-10-21. 1 first. */
export const HAND_SCALES = [1, 1.03, 1.05, 1.07, 1.1, 0.97]

/** The layout with the hand, header and buttons drawn hs times the size of the rest (grown from the bottom edge). */
export function scaleHand(l: Layout, ui: number, hs: number): Layout {
  if (hs === 1) return l
  const h = layout(l, ui * hs)
  return { ...l, hk: h.k, header: h.header, refresh: h.refresh, cardArt: h.cardArt, cardFace: h.cardFace, cards: h.cards, hand5: h.hand5 }
}

/** Where the reader found the hand: [dx, dy] reference pixels off the measured place, and the hand's own scale. */
export type HandFit = [number, number] | [number, number, number]

/** The layout with the hand placed where the reader found it (Reading.handShift). */
export function handLayout(frame: { width: number; height: number }, ui = 1, fit?: readonly number[] | null): Layout {
  const l = layout(frame, ui)
  if (!fit) return l
  const [dx = 0, dy = 0, hs = 1] = fit
  const h = scaleHand(l, ui, hs)
  return dx || dy ? shiftHand(h, dx, dy) : h
}
