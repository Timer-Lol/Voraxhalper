// solver.html?capture: saves every triggered frame to a folder the player picks, with the log lines
// that triggered it, so the screenshot reader can be built and tested from real games.
import { frameDiff, thumb, type Thumb } from './stable'

export interface FrameMeta { lines: string[]; triggerAt: number; askedAt?: number; snappedAt: number; width: number; height: number; snapshot?: unknown }

export const isCaptureMode = (search = location.search) => new URLSearchParams(search).has('capture')

/** The highest frame number among a folder's file names, so a second session doesn't overwrite the first. */
export const nextIndex = (names: string[]) => Math.max(0, ...names.map(n => /^(\d{3,})-/.exec(n)).filter(m => m).map(m => Number(m![1])))

export const frameName = (n: number, kind: string) => `${String(n).padStart(3, '0')}-${kind}`

async function write(dir: FileSystemDirectoryHandle, name: string, data: Blob | string) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
  await w.write(data)
  await w.close()
}

export async function saveFrame(dir: FileSystemDirectoryHandle, n: number, kind: string, image: Blob, meta: FrameMeta, ext = 'png'): Promise<void> {
  const base = frameName(n, kind)
  await write(dir, `${base}.${ext}`, image)
  await write(dir, `${base}.json`, JSON.stringify(meta, null, 2))
}

/** Every TICK_MS in capture mode a frame is grabbed, and kept only when the screen changed since the last kept one. */
export const TICK_MS = 500

export function changeGate(threshold = 1.5): (img: ImageData) => boolean {
  let last: Thumb | null = null
  return img => {
    const t = thumb(img)
    if (last && frameDiff(last, t) < threshold) return false
    last = t
    return true
  }
}

/** What the Solver read from a saved frame (or advised for it), beside it, to check against the picture. */
export async function saveReading(dir: FileSystemDirectoryHandle, n: number, kind: string, value: unknown, what: 'reading' | 'advice' | 'pick' = 'reading'): Promise<void> {
  await write(dir, `${frameName(n, kind)}.${what}.json`, JSON.stringify(value, null, 2))
}
