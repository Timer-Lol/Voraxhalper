// Replays debug bundles through the current reader: for every picture, what was read then, what is read now,
// and what the player fixed by hand (the truth, where given). Run: bun scripts/replay.ts bundle.zip [...]
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { unpack } from '../src/reader/scan/data'
import raw from '../src/reader/scan/data.json'
import { scan } from '../src/reader/scan/scan'
import { cropRows } from '../src/web/chrome'

const D = unpack(raw as never)
function unzip(buf: Buffer): Record<string, Buffer> {
  let end = -1
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break }
  const out: Record<string, Buffer> = {}
  let p = buf.readUInt32LE(end + 16)
  for (let n = buf.readUInt16LE(end + 10); n > 0; n--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nlen)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + size)
    out[name] = method === 8 ? inflateRawSync(data) : data
    p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
  }
  return out
}
// JPEG decoding without dependencies: Bun can't decode images, so frames are decoded in Chromium when present
async function decodeJpeg(bytes: Buffer): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const { chromium } = await import('/home/claude/.npm-global/lib/node_modules/playwright' as string).catch(() => import('playwright' as string))
  browser ??= await chromium.launch(process.platform === 'linux' ? { executablePath: '/opt/pw-browsers/chromium' } : {})
  page ??= await browser.newPage()
  const r = await page.evaluate(async (b64: string) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + b64)).blob())
    const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d')!; x.drawImage(bmp, 0, 0)
    return { width: bmp.width, height: bmp.height, data: Array.from(x.getImageData(0, 0, bmp.width, bmp.height).data) }
  }, bytes.toString('base64'))
  return { width: r.width, height: r.height, data: Uint8ClampedArray.from(r.data) }
}
let browser: any = null, page: any = null

const tankKey = (k: string) => (/^tank(\d)\./.exec(k) ?? [])[1]
let frames = 0, changed = 0, fixedBefore = 0, fixedNow = 0
for (const file of process.argv.slice(2)) {
  const z = unzip(readFileSync(file))
  const events = z['events.jsonl'].toString().split('\n').filter(Boolean).map(l => JSON.parse(l))
  const fixes: Record<number, [string, unknown, unknown][]> = {}
  for (const e of events) if (e.type === 'fix') (fixes[e.of] ??= []).push(...e.diff)
  console.log(`\n== ${file}: ${events.length} events`)
  for (const e of events.filter(x => x.type === 'read' && z[x.frame])) {
    frames++
    const img = await decodeJpeg(z[e.frame])
    const crop = e.crop ?? { top: 0, bottom: 0 }
    const r = scan(cropRows(img as never, crop) as never, D)
    const now = r.state, was = e.state ?? {}
    const diffs: string[] = []
    now.tanks.forEach((t, i) => { const a = JSON.stringify(t && [t.archetype, t.rarity, t.activity, t.quantity]), b = JSON.stringify(was.tanks?.[i] && [was.tanks[i].archetype, was.tanks[i].rarity, was.tanks[i].activity, was.tanks[i].quantity]); if (a !== b) diffs.push(`tank${i}: ${b} -> ${a}`) })
    for (const k of ['round', 'phase', 'potionRefreshes', 'instrumentRefreshes'] as const) if (now[k] !== was[k]) diffs.push(`${k}: ${was[k]} -> ${now[k]}`)
    if (diffs.length) changed++
    // the player's fixes are the truth: does the reader now agree?
    for (const [k, , truth] of fixes[e.n] ?? []) {
      fixedBefore++
      const ti = /^tank(\d)$/.exec(k)
      const got = ti ? (now.tanks[+ti[1]] && [now.tanks[+ti[1]]!.archetype, now.tanks[+ti[1]]!.rarity, now.tanks[+ti[1]]!.activity, now.tanks[+ti[1]]!.quantity]) : k.startsWith('instrument') ? now.instruments[+k.slice(10)] ?? '' : k.startsWith('hand') ? now.hand[+k.slice(4)] ?? '' : k === 'pr' ? now.potionRefreshes : k === 'ir' ? now.instrumentRefreshes : (now as never)[k]
      const ok = JSON.stringify(got) === JSON.stringify(truth)
      if (ok) fixedNow++
      diffs.push(`${ok ? 'FIXED NOW' : 'still wrong'} ${k}: player says ${JSON.stringify(truth)}, reader now ${JSON.stringify(got)}`)
    }
    const unsure = Object.entries(r.fields).filter(([, f]) => !f.sure).map(([k]) => k)
    console.log(`${e.frame} (${img.width}x${img.height}, crop ${JSON.stringify(crop)})${diffs.length ? '\n  ' + diffs.join('\n  ') : ' same as recorded'}${unsure.length ? '\n  unsure now: ' + unsure.join(', ') : ''}`)
    void tankKey
  }
}
console.log(`\n${frames} pictures: ${changed} read differently now; player fixes now matched ${fixedNow} of ${fixedBefore}`)
await browser?.close()
