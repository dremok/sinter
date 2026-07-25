/**
 * The part of the bake that is not fal.ai: reduction, palette snapping, and the
 * checks that decide whether a generated image is allowed to be committed.
 *
 * ## Why a generated texture is not used as it arrives
 *
 * Two reasons, and the second one is the interesting one.
 *
 * The first is resolution. `src/render/textures.ts` fixes texel density at
 * `TEXELS_PER_UNIT = 12`, and `tiled()` derives every repeat from that and the
 * bitmap's own pixel size. A texture's pixel size is therefore not a quality
 * dial, it is a statement about how much of the world one tile covers: a 64px
 * prop tile spans 5.3 world units, and a tree trunk 1.5 units wide shows
 * eighteen texels of it. Committing the model's 1024px output unchanged would
 * silently declare that one bark tile covers eighty-five metres of trunk, and
 * every prop in the game would render a near-flat crop of it.
 *
 * The second is palette. `src/render/palette.ts` is the single source of colour
 * for the whole game, six steps per material, and the ramps encode a decision
 * that took a round of playtesting to get right: saturation by role, roughly
 * 3:1 in value, hue rotating warm into the light. An image model has opinions
 * about colour and none of them are that one. So the model is used for
 * *structure* and the ramps supply *colour*: every pixel is snapped to the
 * nearest step of a small palette assembled from the same file the renderer
 * reads. On-palette then stops being something to check for and becomes
 * something that cannot fail, and Max's "too saturated, hurts my eyes" cannot
 * come back through this door.
 *
 * Snapping also restores the hard edges that averaging 256 source pixels into
 * one destroyed, because posterising to six steps turns a soft ramp back into a
 * boundary. That is the whole reason the pipeline can survive a 16:1 reduction.
 */

// ---------------------------------------------------------------- colour space

/** sRGB 0..255 to linear 0..1. */
const LIN = (() => {
  const t = new Float64Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return t
})()

/** Linear 0..1 to sRGB 0..255. */
function encodeSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(v * 255)))
}

export interface Oklab {
  L: number
  a: number
  b: number
}

/** Oklab from linear sRGB. Perceptually uniform, which is the whole point: the
 *  nearest ramp step by Euclidean distance here is the nearest one to an eye. */
export function oklab(r: number, g: number, b: number): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

export function oklabOfHex(hex: string): Oklab {
  const v = parseInt(hex.slice(1), 16)
  return oklab(LIN[(v >> 16) & 255]!, LIN[(v >> 8) & 255]!, LIN[v & 255]!)
}

/** Oklab back to linear sRGB. Needed to change a pixel's value and keep its hue. */
function unOklab(c: Oklab): [number, number, number] {
  const l = (c.L + 0.3963377774 * c.a + 0.2158037573 * c.b) ** 3
  const m = (c.L - 0.1055613458 * c.a - 0.0638541728 * c.b) ** 3
  const s = (c.L - 0.0894841775 * c.a - 1.291485548 * c.b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/**
 * How much hue is allowed to matter against value when picking a ramp step.
 *
 * Oklab's a and b span roughly a tenth of what L does over this palette, so
 * unweighted distance is very nearly a luminance match, and every brown patch
 * the model paints into a grass tile would come back green at the right
 * brightness. Doubling chroma makes a clearly brown pixel choose the dirt ramp
 * while value still chooses the step within it, which is exactly the division
 * of labour the palette file asks for.
 */
const CHROMA_WEIGHT = 2

function distance(p: Oklab, q: Oklab): number {
  const dL = p.L - q.L
  const da = (p.a - q.a) * CHROMA_WEIGHT
  const db = (p.b - q.b) * CHROMA_WEIGHT
  return dL * dL + da * da + db * db
}

// -------------------------------------------------------------------- bitmaps

import type { Bitmap } from './png'

/**
 * Integer box reduction, averaged in linear light.
 *
 * Averaging sRGB bytes directly is the classic mistake and it shows up as a
 * texture that darkens every time it is halved. Only exact integer factors are
 * accepted: a fractional one needs edge handling to stay seamless, and every
 * size this tool asks for divides cleanly anyway.
 */
export function reduce(src: Bitmap, size: number): Bitmap {
  if (src.width !== src.height) throw new Error('expected a square source')
  if (src.width % size !== 0) throw new Error(`${src.width} does not reduce evenly to ${size}`)
  const f = src.width / size
  if (f === 1) return src

  const out = new Uint8Array(size * size * 4)
  const n = f * f
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * src.width
        for (let dx = 0; dx < f; dx++) {
          const i = (row + x * f + dx) * 4
          r += LIN[src.data[i]!]!
          g += LIN[src.data[i + 1]!]!
          b += LIN[src.data[i + 2]!]!
        }
      }
      const o = (y * size + x) * 4
      out[o] = encodeSrgb(r / n)
      out[o + 1] = encodeSrgb(g / n)
      out[o + 2] = encodeSrgb(b / n)
      out[o + 3] = 255
    }
  }
  return { width: size, height: size, data: out }
}

/**
 * A one-texel unsharp mask, applied *after* reduction and before snapping.
 *
 * The order is the whole point and the first version had it backwards. A
 * 3x3 unsharp at 1024px sharpens exactly the detail that a 16:1 box filter is
 * about to average out of existence, which costs a pass and changes nothing.
 * Run at 64px it widens the value gap across each boundary that survived, and
 * the palette snap then resolves that gap into a hard edge. That is what turns
 * a soft reduction back into something that reads as pixel art rather than as a
 * photograph someone shrank.
 *
 * Applied in linear light and clamped, because an unsharp that overshoots
 * produces halos, and a halo survives posterisation as a bright outline drawn
 * around every shape.
 */
export function sharpen(src: Bitmap, amount: number): Bitmap {
  if (amount <= 0) return src
  const { width: w, height: h, data } = src
  const out = new Uint8Array(data.length)
  const at = (x: number, y: number, c: number) =>
    LIN[data[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4 + c]!]!

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const mid = at(x, y, c)
        const blur =
          (at(x - 1, y, c) + at(x + 1, y, c) + at(x, y - 1, c) + at(x, y + 1, c)) * 0.2 + mid * 0.2
        out[o + c] = encodeSrgb(Math.max(0, Math.min(1, mid + (mid - blur) * amount)))
      }
      out[o + 3] = 255
    }
  }
  return { width: w, height: h, data: out }
}

/**
 * Subtract the tile's own large-scale lighting, leaving its texture behind.
 *
 * This is a high-pass on value only: blur the lightness channel with a very wide
 * wrapping kernel, subtract it, add the mean back. Hue and chroma are untouched.
 *
 * It exists because "flat lighting, no baked shadows or highlights" is the one
 * instruction the models ignore most reliably. The plank tile came back with a
 * broad dark-at-the-top, light-at-the-bottom gradient across the whole image,
 * which is a light source, and it caused two separate faults: it is exactly what
 * the art direction forbids, since the cel shader is supposed to be the only
 * thing that decides where the light falls, and it does not wrap, so the tile
 * failed the seam check with a visible band where one copy met the next.
 *
 * Both faults have the same cause and this removes it.
 *
 * The radius wants care. The first version used a quarter of the tile, which is
 * useless and took a while to notice: two box passes of radius w/4 have a
 * combined support of 4 * (w/4) = w, so on a wrapping image every output pixel
 * is the mean of the whole tile, the blurred field comes out constant, and
 * subtracting it does nothing at all. An eighth gives a support of half the
 * image, which removes anything spanning the tile and leaves everything smaller
 * than about eight texels alone: stone blocks at five and plank boards at four
 * pass through untouched, which is the point.
 *
 * Not for every texture. The ground wants regional drift at a sixth of its own
 * width and that is the art rather than a fault, so `grass` opts out.
 */
export function flattenLighting(src: Bitmap, amount: number): Bitmap {
  if (amount <= 0) return src
  const { width: w, height: h, data } = src
  const n = w * h
  const radius = Math.max(2, Math.round(w / 8))

  const lab = labField(src)
  const L = Float64Array.from(lab, (p) => p.L)

  // Separable wrapping box blur, run twice so the kernel is a tent rather than a
  // step. A single box pass leaves faint square-edged banding behind.
  let field = L
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float64Array(n)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        for (let k = -radius; k <= radius; k++) sum += field[y * w + (((x + k) % w) + w) % w]!
        tmp[y * w + x] = sum / (radius * 2 + 1)
      }
    }
    const out = new Float64Array(n)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        for (let k = -radius; k <= radius; k++) sum += tmp[((((y + k) % h) + h) % h) * w + x]!
        out[y * w + x] = sum / (radius * 2 + 1)
      }
    }
    field = out
  }

  let mean = 0
  for (let i = 0; i < n; i++) mean += L[i]!
  mean /= n

  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const p = lab[i]!
    const corrected = p.L + (mean - field[i]!) * amount
    const [r, g, b] = unOklab({ L: Math.max(0, corrected), a: p.a, b: p.b })
    out[i * 4] = encodeSrgb(Math.max(0, Math.min(1, r)))
    out[i * 4 + 1] = encodeSrgb(Math.max(0, Math.min(1, g)))
    out[i * 4 + 2] = encodeSrgb(Math.max(0, Math.min(1, b)))
    out[i * 4 + 3] = 255
  }
  return { width: w, height: h, data: out }
}

// ------------------------------------------------------------------- snapping

export interface SnapOptions {
  /** Hex colours the output is allowed to contain, in any order. */
  palette: readonly string[]
  /**
   * How far to stretch the source's own value range onto the palette's, 0 to 1.
   *
   * The models come back low contrast surprisingly often, and a texture whose
   * value range is narrower than one cel band collapses to a flat colour under
   * the toon shader, which is the failure `palette.ts` warns about by name. The
   * stretch is measured between the 2nd and 98th percentile so that a handful of
   * stray highlight pixels cannot set the scale for the whole tile.
   */
  stretch: number
  /** Above 1 pushes the result light, below 1 pushes it dark, after stretching. */
  gamma: number
}

export interface SnapResult {
  bitmap: Bitmap
  /** How many of the palette's entries the result actually uses. */
  used: number
  /** Share of pixels in the most common colour. High means a flat, dead tile. */
  dominance: number
}

function percentile(sorted: Float64Array, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
}

export function snapToPalette(src: Bitmap, opt: SnapOptions): SnapResult {
  const entries = opt.palette.map((hex) => ({ hex, lab: oklabOfHex(hex), rgb: parseInt(hex.slice(1), 16) }))
  const targetLo = Math.min(...entries.map((e) => e.lab.L))
  const targetHi = Math.max(...entries.map((e) => e.lab.L))

  const n = src.width * src.height
  const labs: Oklab[] = new Array(n)
  const ls = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const lab = oklab(LIN[src.data[i * 4]!]!, LIN[src.data[i * 4 + 1]!]!, LIN[src.data[i * 4 + 2]!]!)
    labs[i] = lab
    ls[i] = lab.L
  }

  const sorted = Float64Array.from(ls).sort()
  const srcLo = percentile(sorted, 0.02)
  const srcHi = percentile(sorted, 0.98)
  const span = srcHi - srcLo || 1

  const out = new Uint8Array(n * 4)
  const counts = new Int32Array(entries.length)

  for (let i = 0; i < n; i++) {
    const lab = labs[i]!
    let L = lab.L
    if (opt.stretch > 0) {
      const t = Math.max(0, Math.min(1, (L - srcLo) / span))
      const g = opt.gamma === 1 ? t : Math.pow(t, 1 / opt.gamma)
      L = L + (targetLo + g * (targetHi - targetLo) - L) * opt.stretch
    }
    const probe = { L, a: lab.a, b: lab.b }

    let best = 0
    let bestD = Infinity
    for (let e = 0; e < entries.length; e++) {
      const d = distance(probe, entries[e]!.lab)
      if (d < bestD) {
        bestD = d
        best = e
      }
    }
    counts[best]!++
    const rgb = entries[best]!.rgb
    out[i * 4] = (rgb >> 16) & 255
    out[i * 4 + 1] = (rgb >> 8) & 255
    out[i * 4 + 2] = rgb & 255
    out[i * 4 + 3] = 255
  }

  let used = 0
  let top = 0
  for (const c of counts) {
    if (c > 0) used++
    if (c > top) top = c
  }

  return { bitmap: { width: src.width, height: src.height, data: out }, used, dominance: top / n }
}

// ----------------------------------------------------------------- validation

export interface TileReport {
  /**
   * Difference across the wrap seam, over the tile's mean neighbour-to-neighbour
   * difference. A seamless texture sits near or below 1, because its edge is no
   * more of an event than anywhere else in it; a tile that does not wrap runs 3
   * to 10.
   *
   * The denominator is deliberately isotropic, averaged over both axes rather
   * than measured along the seam's own. The first version of this check
   * normalised each seam by the interior difference on the same axis, and it
   * failed every anisotropic texture in the set: bark's grain runs vertically,
   * so its row-to-row difference is almost nothing, so a horizontal seam of
   * almost nothing came out as a ratio of 2.3 and a visually perfect tile was
   * rejected three times in a row. What makes a seam visible is how it compares
   * to the texture's contrast in general, not to its contrast in the one
   * direction that happens to be flat.
   */
  seamX: number
  seamY: number
  /**
   * Mean neighbour-to-neighbour difference, in Oklab. This is the noise metric:
   * "clear deliberate shapes" and "photographic detail" are the same amount of
   * variance spread over very different numbers of edges, and only this
   * separates them.
   */
  busyness: number
}

function labField(bmp: Bitmap): Oklab[] {
  const n = bmp.width * bmp.height
  const out: Oklab[] = new Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = oklab(LIN[bmp.data[i * 4]!]!, LIN[bmp.data[i * 4 + 1]!]!, LIN[bmp.data[i * 4 + 2]!]!)
  }
  return out
}

export function inspectTiling(bmp: Bitmap): TileReport {
  const { width: w, height: h } = bmp
  const lab = labField(bmp)
  const d = (i: number, j: number) => Math.sqrt(distance(lab[i]!, lab[j]!))

  let seamX = 0
  let seamY = 0
  for (let y = 0; y < h; y++) seamX += d(y * w + w - 1, y * w)
  for (let x = 0; x < w; x++) seamY += d((h - 1) * w + x, x)
  seamX /= h
  seamY /= w

  let interiorX = 0
  let interiorY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) interiorX += d(y * w + x, y * w + x + 1)
  }
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w; x++) interiorY += d(y * w + x, (y + 1) * w + x)
  }
  interiorX /= h * (w - 1)
  interiorY /= (h - 1) * w

  // A floor, so a nearly uniform tile cannot divide a tiny seam by a tinier
  // denominator and report a discontinuity nobody could see.
  const busyness = (interiorX + interiorY) / 2
  const denom = Math.max(busyness, 0.004)

  return { seamX: seamX / denom, seamY: seamY / denom, busyness }
}

/** Mean Oklab of an image, for checking a texture came back the right colour. */
export function meanLab(bmp: Bitmap): Oklab {
  const lab = labField(bmp)
  let L = 0
  let a = 0
  let b = 0
  for (const p of lab) {
    L += p.L
    a += p.a
    b += p.b
  }
  return { L: L / lab.length, a: a / lab.length, b: b / lab.length }
}

/**
 * Distance between two colours ignoring lightness.
 *
 * Used for the "did the model paint the right material" check, and deliberately
 * blind to value: `snapToPalette` renormalises the source's value range onto the
 * palette's on purpose, so a bark tile that came back two stops too bright is
 * not a fault, it is the input the stretch exists to handle. A bark tile that
 * came back grey, or green, is a fault, and only chroma sees the difference.
 */
export function chromaDistance(p: Oklab, q: Oklab): number {
  return Math.hypot(p.a - q.a, p.b - q.b)
}

/** Lay a tile out 2x2 so a seam has somewhere to show itself. */
export function tile2x2(bmp: Bitmap): Bitmap {
  const w = bmp.width * 2
  const out = new Uint8Array(w * w * 4)
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y % bmp.height) * bmp.width + (x % bmp.width)) * 4
      const o = (y * w + x) * 4
      out[o] = bmp.data[s]!
      out[o + 1] = bmp.data[s + 1]!
      out[o + 2] = bmp.data[s + 2]!
      out[o + 3] = 255
    }
  }
  return { width: w, height: w, data: out }
}

/** Blow a tile up with nearest-neighbour, so texels are visible when reviewing. */
export function magnify(bmp: Bitmap, factor: number): Bitmap {
  const w = bmp.width * factor
  const h = bmp.height * factor
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (Math.floor(y / factor) * bmp.width + Math.floor(x / factor)) * 4
      const o = (y * w + x) * 4
      out[o] = bmp.data[s]!
      out[o + 1] = bmp.data[s + 1]!
      out[o + 2] = bmp.data[s + 2]!
      out[o + 3] = 255
    }
  }
  return { width: w, height: h, data: out }
}
