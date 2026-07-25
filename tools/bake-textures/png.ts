/**
 * A PNG codec, in about two hundred lines, with no dependencies.
 *
 * Written rather than installed because the repo's rule is that a new
 * dependency needs a justification in `docs/DECISIONS.md`, and "the bake tool
 * wanted to read an image" is a thin one when `node:zlib` already does the only
 * genuinely hard part. `sharp` would also have pulled a native binary into a
 * project whose entire deploy story is "static files, no backend".
 *
 * Scope is deliberately narrow: 8 bits per channel, no interlacing. That covers
 * everything fal.ai returns and everything this tool writes.
 *
 * Encoding always emits an indexed (colour type 3) image, because every texture
 * this tool commits has already been snapped to a palette of at most a couple of
 * dozen ramp steps. Indexed is roughly a quarter the size of truecolour for the
 * same pixels, and the constraint is load-bearing rather than incidental: if a
 * texture will not fit in 256 colours, it has not been quantised, and something
 * upstream is wrong.
 */

import { deflateSync, inflateSync } from 'node:zlib'

/** Straight 8-bit RGBA, row-major, the only in-memory form this tool uses. */
export interface Bitmap {
  width: number
  height: number
  /** length = width * height * 4 */
  data: Uint8Array
}

// ------------------------------------------------------------------ checksums

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// -------------------------------------------------------------------- decoding

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

/** Undo one scanline filter in place. `bpp` is bytes per pixel, for the a/c taps. */
function unfilter(type: number, line: Uint8Array, prev: Uint8Array, bpp: number): void {
  const n = line.length
  switch (type) {
    case 0:
      return
    case 1:
      for (let i = bpp; i < n; i++) line[i] = (line[i]! + line[i - bpp]!) & 255
      return
    case 2:
      for (let i = 0; i < n; i++) line[i] = (line[i]! + prev[i]!) & 255
      return
    case 3:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp]! : 0
        line[i] = (line[i]! + ((a + prev[i]!) >> 1)) & 255
      }
      return
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp]! : 0
        const b = prev[i]!
        const c = i >= bpp ? prev[i - bpp]! : 0
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        line[i] = (line[i]! + pred) & 255
      }
      return
    default:
      throw new Error(`unknown PNG filter type ${type}`)
  }
}

export function decodePng(buf: Uint8Array): Bitmap {
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('not a PNG')
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let palette: Uint8Array | null = null
  let alpha: Uint8Array | null = null
  const idat: Uint8Array[] = []

  let p = 8
  while (p < buf.length) {
    const len = view.getUint32(p)
    const tag = String.fromCharCode(buf[p + 4]!, buf[p + 5]!, buf[p + 6]!, buf[p + 7]!)
    const body = buf.subarray(p + 8, p + 8 + len)
    if (tag === 'IHDR') {
      width = view.getUint32(p + 8)
      height = view.getUint32(p + 12)
      depth = buf[p + 16]!
      colorType = buf[p + 17]!
      if (buf[p + 20] !== 0) throw new Error('interlaced PNG is not supported')
    } else if (tag === 'PLTE') {
      palette = body.slice()
    } else if (tag === 'tRNS') {
      alpha = body.slice()
    } else if (tag === 'IDAT') {
      idat.push(body.slice())
    } else if (tag === 'IEND') {
      break
    }
    p += 12 + len
  }

  if (depth !== 8) throw new Error(`only 8-bit PNGs are supported, got ${depth}`)

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType as 0 | 2 | 3 | 4 | 6]
  if (channels === undefined) throw new Error(`unsupported PNG colour type ${colorType}`)

  const merged = new Uint8Array(idat.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of idat) {
    merged.set(c, at)
    at += c.length
  }
  const raw = new Uint8Array(inflateSync(merged))

  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  let prev = new Uint8Array(stride)
  let src = 0

  for (let y = 0; y < height; y++) {
    const type = raw[src++]!
    const line = raw.subarray(src, src + stride).slice()
    src += stride
    unfilter(type, line, prev, channels)
    prev = line

    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const i = x * channels
      switch (colorType) {
        case 0:
          out[o] = out[o + 1] = out[o + 2] = line[i]!
          out[o + 3] = 255
          break
        case 4:
          out[o] = out[o + 1] = out[o + 2] = line[i]!
          out[o + 3] = line[i + 1]!
          break
        case 2:
          out[o] = line[i]!
          out[o + 1] = line[i + 1]!
          out[o + 2] = line[i + 2]!
          out[o + 3] = 255
          break
        case 6:
          out[o] = line[i]!
          out[o + 1] = line[i + 1]!
          out[o + 2] = line[i + 2]!
          out[o + 3] = line[i + 3]!
          break
        case 3: {
          const idx = line[i]!
          if (!palette) throw new Error('indexed PNG with no PLTE')
          out[o] = palette[idx * 3]!
          out[o + 1] = palette[idx * 3 + 1]!
          out[o + 2] = palette[idx * 3 + 2]!
          out[o + 3] = alpha && idx < alpha.length ? alpha[idx]! : 255
          break
        }
      }
    }
  }

  return { width, height, data: out }
}

// -------------------------------------------------------------------- encoding

function chunk(tag: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = tag.charCodeAt(i)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

/**
 * Encode as an indexed PNG. Throws above 256 distinct colours rather than
 * quietly falling back to truecolour, since that would hide a quantisation bug
 * behind a file that is merely larger than it should be.
 *
 * Every scanline is written with filter 0. The usual adaptive heuristic exists
 * to help photographic gradients; on an indexed image the byte values are
 * palette indices, where "one greater than the pixel to the left" is a
 * meaningless quantity and filtering mostly destroys the long runs that deflate
 * is about to find.
 */
export function encodeIndexedPng(bmp: Bitmap): Uint8Array {
  const lookup = new Map<number, number>()
  const plte: number[] = []
  const indices = new Uint8Array(bmp.width * bmp.height)

  for (let i = 0; i < indices.length; i++) {
    const r = bmp.data[i * 4]!
    const g = bmp.data[i * 4 + 1]!
    const b = bmp.data[i * 4 + 2]!
    const key = (r << 16) | (g << 8) | b
    let idx = lookup.get(key)
    if (idx === undefined) {
      idx = plte.length / 3
      if (idx > 255) throw new Error('more than 256 colours; quantise before encoding')
      lookup.set(key, idx)
      plte.push(r, g, b)
    }
    indices[i] = idx
  }

  const raw = new Uint8Array((bmp.width + 1) * bmp.height)
  for (let y = 0; y < bmp.height; y++) {
    raw[y * (bmp.width + 1)] = 0
    raw.set(indices.subarray(y * bmp.width, (y + 1) * bmp.width), y * (bmp.width + 1) + 1)
  }

  const ihdr = new Uint8Array(13)
  const iv = new DataView(ihdr.buffer)
  iv.setUint32(0, bmp.width)
  iv.setUint32(4, bmp.height)
  ihdr[8] = 8
  ihdr[9] = 3

  const parts = [
    new Uint8Array(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('PLTE', new Uint8Array(plte)),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ]

  const total = parts.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const c of parts) {
    out.set(c, at)
    at += c.length
  }
  return out
}
