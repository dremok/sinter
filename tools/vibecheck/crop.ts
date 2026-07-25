/**
 * Cut a window out of a shot and blow it up, nearest-neighbour.
 *
 *   npx tsx tools/vibecheck/crop.ts <in.png> <out.png> <x> <y> <w> <h> [scale]
 *   npx tsx tools/vibecheck/crop.ts <in.png> <out.png> --centre 3   # middle third
 *
 * The reason this exists: at 1600x900 the player is about forty pixels tall,
 * which is roughly what a player sees, and roughly too small to tell whether
 * the head is attached to the body or the arms are inside the torso. The
 * region-wide sweep answers "is anything drawn where it cannot be"; this
 * answers "is the thing in the middle of the screen readable".
 *
 * Nearest-neighbour on purpose. The game renders to a low pixel buffer and
 * upscales with hard edges, so a smooth resample here would invent detail the
 * renderer never drew and hide the stair-stepping that is the actual art.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { decodePng, type Image } from './png'

function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(body.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([len, typed, crc])
}

export function encodePng(img: Image): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width, 0)
  ihdr.writeUInt32BE(img.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = img.width * 4
  const raw = Buffer.alloc((stride + 1) * img.height)
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(img.data.buffer, img.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export function cropScale(src: Image, x0: number, y0: number, w: number, h: number, scale: number): Image {
  const out = new Uint8Array(w * scale * h * scale * 4)
  const ow = w * scale
  for (let y = 0; y < h * scale; y++) {
    const sy = y0 + Math.floor(y / scale)
    for (let x = 0; x < ow; x++) {
      const sx = x0 + Math.floor(x / scale)
      const s = (Math.min(src.height - 1, Math.max(0, sy)) * src.width + Math.min(src.width - 1, Math.max(0, sx))) * 4
      const d = (y * ow + x) * 4
      out[d] = src.data[s]!
      out[d + 1] = src.data[s + 1]!
      out[d + 2] = src.data[s + 2]!
      out[d + 3] = 255
    }
  }
  return { width: ow, height: h * scale, data: out }
}

if (import.meta.filename === process.argv[1]) {
  const [inPath, outPath, ...rest] = process.argv.slice(2)
  if (!inPath || !outPath) {
    console.error('usage: crop.ts <in.png> <out.png> <x> <y> <w> <h> [scale] | <in> <out> --centre <div>')
    process.exit(1)
  }
  const src = decodePng(await readFile(inPath))
  let x: number, y: number, w: number, h: number, scale: number
  if (rest[0] === '--centre') {
    const div = Number(rest[1] ?? 3)
    w = Math.round(src.width / div)
    h = Math.round(src.height / div)
    x = Math.round((src.width - w) / 2)
    y = Math.round((src.height - h) / 2)
    scale = Number(rest[2] ?? div)
  } else {
    x = Number(rest[0])
    y = Number(rest[1])
    w = Number(rest[2])
    h = Number(rest[3])
    scale = Number(rest[4] ?? 3)
  }
  await writeFile(outPath, encodePng(cropScale(src, x, y, w, h, scale)))
  console.log(`wrote ${outPath}  ${w}x${h} @${scale}x from ${inPath}`)
}
