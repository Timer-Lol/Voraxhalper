// A small PNG decoder and encoder over node:zlib, for the reader's build and test scripts (no dependencies).
// Decodes 8-bit greyscale, RGB and RGBA (with or without alpha), non-interlaced, all five row filters.
import { deflateSync, inflateSync } from 'node:zlib'
import type { Img } from '../src/reader/scan/pixels'

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export function decodePng(buf: Buffer): Img {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file')
  let pos = 8
  let width = 0, height = 0, colorType = 0, depth = 0, interlace = 0
  const idat: Buffer[] = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      colorType = body[9]
      interlace = body[12]
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (depth !== 8 || !channels || interlace) throw new Error(`Unsupported PNG (depth ${depth}, colour type ${colorType}, interlace ${interlace})`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rows = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const out = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? rows[out + x - channels] : 0
      const b = y ? rows[out - stride + x] : 0
      const c = x >= channels && y ? rows[out - stride + x - channels] : 0
      let v = raw[src + x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      rows[out + x] = v & 255
    }
  }
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const s = i * channels
    if (channels === 1 || channels === 2) data.set([rows[s], rows[s], rows[s], channels === 2 ? rows[s + 1] : 255], i * 4)
    else data.set([rows[s], rows[s + 1], rows[s + 2], channels === 4 ? rows[s + 3] : 255], i * 4)
  }
  return { width, height, data }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(b: Buffer): number {
  let c = 0xffffffff
  for (const x of b) c = CRC_TABLE[(c ^ x) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, crc])
}

export function encodePng(img: Img): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width, 0)
  ihdr.writeUInt32BE(img.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  // every row with the Up filter (its difference from the row above): flat areas become runs of zeros
  const stride = img.width * 4
  const raw = Buffer.alloc((stride + 1) * img.height)
  for (let y = 0; y < img.height; y++) {
    const o = y * (stride + 1)
    raw[o] = 2
    for (let x = 0; x < stride; x++) raw[o + 1 + x] = (img.data[y * stride + x] - (y ? img.data[(y - 1) * stride + x] : 0)) & 255
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
