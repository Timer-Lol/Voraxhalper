// Comparing panel icons when the crop lands a few pixels off: the same icon moved by a few pixels compares near 0
// in place (players' named Chrysalis Specimens sat up to 6 pixels apart). Each pattern is lined up on the reference
// by their centres of brightness, then nudged a pixel or two each way; the best match counts.

const N = 24
/** Nudges tried around the lined-up position, in pixels each way. */
const REACH = 2

/** Where a pattern's brightness sits (its centre of mass above its darkest value). */
function centre(p: number[]): [number, number] {
  let lo = Infinity
  for (const v of p) if (v < lo) lo = v
  let s = 0, x = 0, y = 0
  for (let i = 0; i < p.length; i++) { const w = p[i] - lo; s += w; x += w * (i % N); y += w * Math.floor(i / N) }
  return s ? [x / s, y / s] : [(N - 1) / 2, (N - 1) / 2]
}

/** p moved dx right and dy down, its background (darkest value) coming in at the edges, zero-mean and unit-length again. */
function moved(p: number[], dx: number, dy: number): number[] {
  let bg = Infinity
  for (const v of p) if (v < bg) bg = v
  const q = new Array<number>(p.length)
  let sum = 0
  for (let i = 0; i < p.length; i++) {
    const x = (i % N) - dx, y = Math.floor(i / N) - dy
    q[i] = x >= 0 && x < N && y >= 0 && y < N ? p[y * N + x] : bg
    sum += q[i]
  }
  const mean = sum / q.length
  let norm = 0
  for (let i = 0; i < q.length; i++) { q[i] -= mean; norm += q[i] * q[i] }
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < q.length; i++) q[i] /= norm
  return q
}

const centres = new WeakMap<number[], [number, number]>()
const centreOf = (p: number[]) => { let c = centres.get(p); if (!c) { c = centre(p); centres.set(p, c) } return c }

/** How alike a reference icon and a panel pattern are (1 = the same), allowing for the crop being a few pixels off. */
export function iconSimilarity(ref: number[], p: number[], cache = new Map<string, number[]>()): number {
  // not a 24x24 icon (a test's stand-in): compared in place
  if (p.length !== N * N || ref.length !== N * N) return ref.reduce((s, x, i) => s + x * (p[i] ?? 0), 0)
  const [rx, ry] = centreOf(ref), [px, py] = centreOf(p)
  const bx = Math.round(rx - px), by = Math.round(ry - py)
  let best = -1
  for (let dy = by - REACH; dy <= by + REACH; dy++)
    for (let dx = bx - REACH; dx <= bx + REACH; dx++) {
      const key = `${dx},${dy}`
      let q = cache.get(key)
      if (!q) { q = dx === 0 && dy === 0 ? p : moved(p, dx, dy); cache.set(key, q) }
      let s = 0
      for (let i = 0; i < q.length; i++) s += ref[i] * q[i]
      if (s > best) best = s
    }
  return best
}
