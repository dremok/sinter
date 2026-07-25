/**
 * Just enough PNG to compare two screenshots, with no new dependency.
 *
 * Playwright writes 8-bit non-interlaced RGB or RGBA, which is the only thing
 * decoded here. Anything else throws rather than guessing, because a decoder
 * that silently mis-reads a format produces a diff number that looks fine and
 * means nothing, and a number nobody can trust is worse than no number.
 */

import { inflateSync } from 'node:zlib'

export interface Image {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array
}

export function decodePng(buf: Buffer): Image {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Buffer[] = []

  let off = 8
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const body = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bitDepth = body[8]!
      colorType = body[9]!
      if (body[12] !== 0) throw new Error('interlaced PNG unsupported')
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }

  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} unsupported`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (channels === 0) throw new Error(`color type ${colorType} unsupported`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  const line = new Uint8Array(stride)
  const prev = new Uint8Array(stride)

  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]!
    for (let i = 0; i < stride; i++) {
      const x = raw[p + i]!
      const a = i >= channels ? line[i - channels]! : 0
      const b = prev[i]!
      const c = i >= channels ? prev[i - channels]! : 0
      let v: number
      switch (filter) {
        case 0: v = x; break
        case 1: v = x + a; break
        case 2: v = x + b; break
        case 3: v = x + ((a + b) >> 1); break
        case 4: {
          const q = a + b - c
          const pa = Math.abs(q - a)
          const pb = Math.abs(q - b)
          const pc = Math.abs(q - c)
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: throw new Error(`bad filter ${filter}`)
      }
      line[i] = v & 0xff
    }
    p += stride
    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = (y * width + x) * 4
      out[d] = line[s]!
      out[d + 1] = line[s + 1]!
      out[d + 2] = line[s + 2]!
      out[d + 3] = channels === 4 ? line[s + 3]! : 255
    }
    prev.set(line)
  }

  return { width, height, data: out }
}

export interface DiffResult {
  /** Fraction of pixels that moved by more than the threshold, 0..1. */
  changed: number
  /** Bounding box of everything that moved, in pixels, or null if nothing did. */
  box: { x0: number; y0: number; x1: number; y1: number } | null
  /** 8x8 coarse map of where the change is, as fractions per cell. */
  cells: number[]
}

/**
 * Where two shots differ, not by how much.
 *
 * The threshold is per channel and deliberately loose. Everything here is
 * deterministic given a seed, so a real difference is a difference in what was
 * drawn, not in dithering; the tolerance only absorbs the last bit of the
 * software rasteriser. The bounding box and the coarse cell map exist because
 * a percentage tells you nothing about where to look, and looking is the job.
 */
export function diff(a: Image, b: Image, threshold = 12): DiffResult {
  if (a.width !== b.width || a.height !== b.height) {
    return { changed: 1, box: { x0: 0, y0: 0, x1: a.width, y1: a.height }, cells: new Array(64).fill(1) }
  }
  const cells = new Array(64).fill(0)
  let count = 0
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity

  for (let y = 0; y < a.height; y++) {
    const cy = Math.min(7, Math.floor((y / a.height) * 8))
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4
      const d =
        Math.abs(a.data[i]! - b.data[i]!) +
        Math.abs(a.data[i + 1]! - b.data[i + 1]!) +
        Math.abs(a.data[i + 2]! - b.data[i + 2]!)
      if (d > threshold) {
        count++
        cells[cy * 8 + Math.min(7, Math.floor((x / a.width) * 8))]++
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }

  const total = a.width * a.height
  const per = total / 64
  return {
    changed: count / total,
    box: count > 0 ? { x0, y0, x1, y1 } : null,
    cells: cells.map((c) => c / per),
  }
}
