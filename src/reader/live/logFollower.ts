// Follows the game's UE_game.log: each poll returns the complete lines written since the last one.
// The log can be over a gigabyte, so the first poll only notes where it ends.

export interface FileLike { getFile(): Promise<{ size: number; slice(a: number, b?: number): { arrayBuffer(): Promise<ArrayBuffer> } }> }
export interface Follower { poll(): Promise<string[]>; readonly detailSeen: boolean }

/** The game's own lines; with Enable Log off it writes almost none. */
const DETAIL = /\b(TLLua|TLGame):/

export function createFollower(handle: FileLike, opts: { maxRead?: number } = {}): Follower {
  const maxRead = opts.maxRead ?? 1_048_576
  let offset = -1
  let decoder = new TextDecoder('utf-8')
  let rest = ''
  let detailSeen = false

  const restart = (at: number) => {
    offset = at
    decoder = new TextDecoder('utf-8')
    rest = ''
  }

  async function poll(): Promise<string[]> {
    let file
    try {
      file = await handle.getFile()
    } catch {
      return []
    }
    if (offset < 0) {
      restart(file.size)
      return []
    }
    if (file.size < offset) restart(0)
    let skipped = false
    if (file.size - offset > maxRead) {
      restart(file.size - maxRead)
      skipped = true
    }
    if (file.size === offset) return []
    const buf = await file.slice(offset, file.size).arrayBuffer()
    offset = file.size
    const parts = (rest + decoder.decode(new Uint8Array(buf), { stream: true })).split('\n')
    rest = parts.pop() ?? ''
    // After skipping ahead we land mid-line: that piece is dropped.
    if (skipped) parts.shift()
    const lines = parts.map(l => (l.endsWith('\r') ? l.slice(0, -1) : l))
    if (!detailSeen && lines.some(l => DETAIL.test(l))) detailSeen = true
    return lines
  }

  return {
    poll,
    get detailSeen() {
      return detailSeen
    },
  }
}
