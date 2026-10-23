// Cuts a cleaned-up slice of UE_game.log for tests: only the game's own lines, no network details.
// Usage: npx vite-node scripts/solver/excerpt.ts <UE_game.log> <fromLine> <toLine> > tests/fixtures/vorax-log-excerpt.log
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const KEEP = (l: string) => /TLLua:|TLGame:|S13GamePlay/.test(l) || (l.includes('LogDataTable') && l.includes('KYZ'))
const DROP = /Ping|ConnectSock|SaveAddr|getaddrinfo|UDP/
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g

export function clean(lines: Iterable<string>): string[] {
  const out: string[] = []
  for (const l of lines) if (KEEP(l) && !DROP.test(l)) out.push(l.replace(IPV4, '0.0.0.0'))
  return out
}

async function main() {
  const [file, from, to] = process.argv.slice(2)
  if (!file || !from || !to) throw new Error('usage: excerpt.ts <UE_game.log> <fromLine> <toLine>')
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  const picked: string[] = []
  let n = 0
  for await (const line of rl) {
    n++
    if (n < Number(from)) continue
    if (n > Number(to)) break
    picked.push(line)
  }
  rl.close()
  process.stdout.write(clean(picked).join('\n') + '\n')
}

if (process.argv.length > 2) main()
