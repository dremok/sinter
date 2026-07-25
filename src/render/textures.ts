/**
 * Procedural pixel-art textures.
 *
 * Every surface in the first pass was a single flat colour, which is why the
 * game read as vector art with a filter over it no matter how much the palette
 * and the pixel buffer were tuned. Untextured geometry cannot be fixed
 * downstream. These are real textures: tiling bitmaps drawn texel by texel,
 * with hard edges and a tight palette, in the manner of 16-bit tile art.
 *
 * Drawn in code rather than loaded, for three reasons that all come from the
 * existing docs (D14): the game ships offline with no network calls, everything
 * must be reproducible from a seed, and there is no art pipeline yet. When the
 * fal.ai material bake in docs/ASSET_PIPELINE.md lands it can replace the
 * insides of this file without touching a single call site.
 *
 * ---------------------------------------------------------------------------
 * ## Why the tiles are the sizes they are
 *
 * The second pass had one problem that dwarfed all the others: every texture
 * was 32x32, so the ground was the same 3-world-unit square stamped 29 times
 * across the region. Visible repetition is the single loudest "programmer art"
 * tell there is, and no amount of detail inside a 32px tile fixes it, because
 * the eye locks onto the *period*, not the content.
 *
 * Three ways out were considered:
 *
 *   1. A second detail layer at a different frequency. Rejected: it needs a
 *      second UV set and a custom shader on every material, and the call sites
 *      that would have to change are not in this file.
 *   2. Per-instance UV offset. Rejected for the ground specifically, which is
 *      one mesh, so there are no instances to offset. Useful for props, but
 *      props are not where the repetition is.
 *   3. **Tiles large enough that the period is bigger than the view.** Chosen.
 *
 * The camera shows about 41x23 world units. Sizes below are picked so that each
 * texture's dominant call site lands on a repeat of exactly 1, which is to say
 * one tile covers the whole surface and there is no period to see at all. The
 * ground carries a 1024px tile across all 92 units of the region; the shore
 * ring and the pond each get one tile of their own. What used to be tiling is
 * now, in effect, a single hand-painted bitmap per surface, and the variation
 * that stops it looking uniform is baked in at three frequencies: regional
 * value drift, patch-scale features (bare soil, ripples), and texel-scale
 * clumps.
 *
 * Everything else stays at 64, because props are small and clamp to one tile
 * anyway. Their gain is not size, it is structure: see below.
 *
 * ## Few marks, big marks
 *
 * The pass before this one replaced per-texel randomness with structure, which
 * was right, and then kept the density of a noise field, which was wrong. An
 * art review of the rendered frame called the ground "green static" and it was
 * correct: twenty-six thousand three-texel grass clumps on one tile is a noise
 * function wearing a costume. At 720 lines, and heading toward native, fine
 * variation stops reading as texture and starts reading as grain on the lens.
 *
 * So the rule is Don't Starve's rather than a 16-bit tileset's. A surface is
 * mostly one flat tone carrying a few deliberate marks: a couple of grain
 * lines, one knot, a few chips. Contrast comes from the gap between the flat
 * tone and those marks, not from having twenty tones of brown at texel scale,
 * which is mush at every resolution. Item materials go furthest in this
 * direction, because item parts are small on screen and the outline pass and
 * the cel band should be doing the work.
 *
 * Grass tufts also now each pick their own direction. Every blade used to grow
 * along -v, which on a ground plane is one fixed world direction, so the whole
 * field ran the same diagonal and read as a woven carpet.
 *
 * ## Value does the reading
 *
 * Each texture spans most of its six-step ramp (see palette.ts), because the
 * toon shader quantises lighting to three bands: if a texture's own range is
 * narrower than one band, the surface collapses to a flat colour and reads as
 * mud. The ground gets the widest span of all, as large soft drift rather than
 * as speckle, because a greyscale check showed the field as one uniform value
 * with nothing for the eye to rest on.
 *
 * Two rules from D14 that still hold:
 *   - NearestFilter always. Linear filtering blurs a pixel tile into porridge.
 *   - Roughly constant texel density per world unit. Mismatched density is what
 *     makes textured 3D look like wallpaper.
 */

import * as THREE from 'three'
import type { Rng } from '../core/rng'
import { RAMP } from './palette'

/**
 * Target texels per world unit. `tiled()` derives every repeat from this and
 * from the texture's own pixel size, so raising a tile's resolution buys detail
 * or coverage rather than silently doubling the density.
 */
export const TEXELS_PER_UNIT = 12

/** One tile across the entire 92-unit region. Nothing about it can repeat. */
const GROUND = 1024
/** One tile across the pond's shore ring. */
const SHORE = 256
/** One tile across the pond. */
const POOL = 128
/** Props, which are all smaller than one tile at this density anyway. */
const PROP = 64

type Put = (x: number, y: number, color: string) => void
type Draw = (put: Put, rng: Rng, size: number) => void

// ------------------------------------------------------------------ plumbing

const parsed = new Map<string, number>()

/** '#rrggbb' to a packed integer, memoised: this runs a million times a tile. */
function toInt(hex: string): number {
  const hit = parsed.get(hex)
  if (hit !== undefined) return hit
  const v = parseInt(hex.slice(1), 16)
  parsed.set(hex, v)
  return v
}

function build(size: number, rng: Rng, draw: Draw): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Straight into an ImageData buffer. The previous version issued one
  // fillRect per texel, which is fine for 1024 texels and hopeless for a
  // million of them.
  const img = ctx.createImageData(size, size)
  const data = img.data
  for (let i = 3; i < data.length; i += 4) data[i] = 255

  const put: Put = (x, y, color) => {
    // Wrap, so a stroke that runs off an edge comes back on the other side and
    // the tile stays seamless.
    const xi = ((Math.round(x) % size) + size) % size
    const yi = ((Math.round(y) % size) + size) % size
    const v = toInt(color)
    const i = (yi * size + xi) * 4
    data[i] = (v >> 16) & 255
    data[i + 1] = (v >> 8) & 255
    data[i + 2] = v & 255
  }

  draw(put, rng, size)
  ctx.putImageData(img, 0, 0)

  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** Pick a ramp step by index, clamped. */
function tone(ramp: readonly string[], i: number): string {
  return ramp[clamp(Math.round(i), 0, ramp.length - 1)]!
}

/** Shortest signed distance between two coordinates on a wrapping tile. */
function wrapDelta(d: number, size: number): number {
  let v = ((d % size) + size) % size
  if (v > size / 2) v -= size
  return v
}

const smooth = (t: number) => t * t * (3 - 2 * t)

/**
 * Seamless value noise on a toroidal `cells`x`cells` grid, sampled in [0,1).
 * Toroidal is the whole point: a tile whose noise does not wrap has a visible
 * seam, which is exactly the artefact these big tiles exist to remove.
 */
function valueNoise(r: Rng, cells: number): (u: number, v: number) => number {
  const g = new Float32Array(cells * cells)
  for (let i = 0; i < g.length; i++) g[i] = r.next()

  return (u, v) => {
    const x = u * cells
    const y = v * cells
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = smooth(x - x0)
    const fy = smooth(y - y0)
    const xa = ((x0 % cells) + cells) % cells
    const ya = ((y0 % cells) + cells) % cells
    const xb = (xa + 1) % cells
    const yb = (ya + 1) % cells
    const top = g[ya * cells + xa]! + (g[ya * cells + xb]! - g[ya * cells + xa]!) * fx
    const bot = g[yb * cells + xa]! + (g[yb * cells + xb]! - g[yb * cells + xa]!) * fx
    return top + (bot - top) * fy
  }
}

/**
 * Two octaves by default, which is enough for terrain-scale drift without the
 * per-pixel cost. A third is worth paying for anything whose *edge* is seen,
 * since two octaves give smooth amoeba outlines and worn ground is ragged.
 */
function fbm(r: Rng, cells: number, octaves = 2): (u: number, v: number) => number {
  const a = valueNoise(r, cells)
  const b = valueNoise(r, cells * 2)
  if (octaves < 3) return (u, v) => a(u, v) * 0.68 + b(u, v) * 0.32
  const c = valueNoise(r, cells * 4)
  return (u, v) => a(u, v) * 0.56 + b(u, v) * 0.28 + c(u, v) * 0.16
}

/**
 * Rescale a field to fill 0..1 across this particular tile.
 *
 * Without this, every threshold below would be a magic number that only holds
 * for one seed: interpolated noise clusters hard around 0.5, and how hard
 * depends on the draw. Normalising first means "0.75" means roughly the same
 * fraction of the tile whatever the seed, which is what makes the art direction
 * survive a reseed.
 */
function normalized(f: (u: number, v: number) => number): (u: number, v: number) => number {
  let lo = Infinity
  let hi = -Infinity
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const s = f(x / 48, y / 48)
      if (s < lo) lo = s
      if (s > hi) hi = s
    }
  }
  const d = hi - lo || 1
  return (u, v) => clamp((f(u, v) - lo) / d, 0, 1)
}

/**
 * Ordered 4x4 dither threshold.
 *
 * Used wherever one material has to give way to another. A straight RGB blend
 * would invent hundreds of in-between colours and destroy the limited palette
 * that makes this read as pixel art; a hard threshold gives a rubber-stamp edge.
 * Bayer dithering is how the era actually solved this, and it costs one lookup.
 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const dither = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16

/**
 * A second dither threshold, hashed from the position instead of tabled.
 *
 * Bayer is right for a hard boundary a few texels wide, and wrong for a slow
 * gradient across a whole tile: over a large area where the value sits near
 * halfway between two ramp steps, a 4x4 matrix resolves into a visible
 * crosshatch, and a screen door over the ground is the same defect as speckle.
 * A hash gives an irregular stipple that never organises into a grid.
 *
 * Deterministic and independent of the seeded stream, so calling it does not
 * shift any later rng draw.
 */
function hashDither(x: number, y: number): number {
  let h = (Math.round(x) * 374761393 + Math.round(y) * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Fill the tile with one colour. */
function fill(put: Put, size: number, color: string): void {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, color)
}

/** A filled ellipse, wrapping at the tile edge. */
function blob(put: Put, x: number, y: number, rx: number, ry: number, color: string): void {
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) put(x + dx, y + dy, color)
    }
  }
}

// ------------------------------------------------------------- mark helpers

/**
 * One straight mark, from a point along a direction, shading along its length.
 *
 * The direction argument is the point of this. Grass blades used to be drawn by
 * walking -y, which on the ground plane is a single fixed world direction, so
 * every blade in the region ran the same diagonal and the field read as woven
 * carpet. A mark that can point anywhere is the fix.
 */
function stroke(
  put: Put,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  len: number,
  ramp: readonly string[],
  from: number,
  to: number,
): void {
  for (let k = 0; k < len; k++) {
    const f = len <= 1 ? 0 : k / (len - 1)
    put(x0 + dx * k, y0 + dy * k, tone(ramp, from + f * (to - from)))
  }
}

/**
 * Pick a ramp step from a continuous position, dithering between the two
 * neighbouring steps rather than snapping to one.
 *
 * This is what lets the ground carry a wide, slow value drift without banding
 * into four visible contour rings, while still only ever putting six colours on
 * the tile. Large soft gradients and a strictly limited palette are usually in
 * tension; an ordered dither is how the era resolved it.
 */
function ditherStep(put: Put, x: number, y: number, ramp: readonly string[], f: number): void {
  const lo = Math.floor(f)
  const frac = f - lo
  // Stipple only in the middle fifth of the gap between two steps. Dithering
  // the whole gradient puts a texel of noise on every surface, which in a
  // greyscale check reads as grain over the entire field; confining it to the
  // boundary leaves four fifths of the ground genuinely flat and still avoids a
  // hard contour line where one ramp step gives way to the next.
  const t = frac < 0.4 ? 0 : frac > 0.6 ? 1 : (frac - 0.4) * 5
  put(x, y, tone(ramp, t > hashDither(x, y) ? lo + 1 : lo))
}

// ---------------------------------------------------------------- generators

/**
 * Ground cover, and the most important texture in the game: it is most of what
 * is on screen at any moment, so it sets how tiring the whole image is.
 *
 * Three layers and no fine layer at all, which is the change from the previous
 * pass. A greyscale check of the frame showed the field as one flat value with
 * texel-scale speckle over it, so the eye had nothing to rest on and the ground
 * read as static.
 *
 *   1. Slow drift, ~17 world units, swinging across three and a half ramp steps
 *      and dithered so it reads as soft light on a field rather than as bands.
 *      This is the layer that was missing.
 *   2. Bare soil, ~9 world units, dithered in so its edge is stamped not blended.
 *   3. Tufts, sparse and large: roughly one every one and a half metres, each a
 *      fan of blades pointing its own way.
 */
export const grass = (rng: Rng) =>
  build(GROUND, rng, (put, r, n) => {
    const drift = normalized(fbm(r, 5))
    const patch = normalized(fbm(r, 9, 3))

    for (let y = 0; y < n; y++) {
      const v = y / n
      for (let x = 0; x < n; x++) {
        const u = x / n
        // The whole value range of the ramp, spent on one slow gradient. Value
        // is decided here and only here, so the patches below cannot show up as
        // shapes in a greyscale check.
        const idx = clamp(0.85 + drift(u, v) * 3.3, 0, 4.9)
        // Thin, parched turf where `patch` runs high. Dithered against the
        // green ramp at the *same* index over a wide, gradual band, so the
        // transition is a hue drift rather than a stamped edge. The offset on
        // the hash keeps this decision independent of the one inside
        // ditherStep, which would otherwise correlate the two stipples.
        const dry = clamp((patch(u, v) - 0.55) * 2.2, 0, 1)
        // Confined to a narrow band, for the same reason ditherStep is. A
        // stipple of two hues held at 50/50 across a whole region is invisible
        // in greyscale, which is what the matched luminances were for, but in
        // colour at native resolution it is simply grain. Most of the parched
        // ground is now solidly parched and most of the green is solidly green.
        const dryT = dry < 0.35 ? 0 : dry > 0.65 ? 1 : (dry - 0.35) / 0.3
        const ramp = dryT > hashDither(x + 977, y) ? RAMP.dryGrass : RAMP.grass
        put(x, y, tone(ramp, idx))
      }
    }

    // Tufts, and there are far fewer of them than there were.
    //
    // At 720p through a pixel buffer this layer merged into texture. At native
    // resolution it stopped merging and became a field of discrete pale specks
    // on the one surface in the frame that has no outline to hold it together.
    // The ground now does its work through the slow value drift above; these
    // are an accent on top of it, not the thing that makes it grass.
    const tufts = Math.round((n * n) / 1400)
    for (let i = 0; i < tufts; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      const u = x / n
      const v = y / n
      // Only weakly tied to the drift. Keying density hard to it gathered them
      // into dense pale clusters exactly where the ground was already lightest,
      // which read as a spill rather than as meadow.
      if (!r.chance((0.5 + drift(u, v) * 0.2) * (patch(u, v) > 0.72 ? 0.5 : 1))) continue

      const aim = r.range(0, Math.PI * 2)
      const blades = r.int(3, 5)
      put(x, y, tone(RAMP.grass, 1))
      for (let b = 0; b < blades; b++) {
        const a = aim + r.range(-1, 1)
        // Tips stay close to the base tone. Contrast here buys nothing at
        // native resolution and costs the whole field its calm.
        stroke(put, x, y, Math.cos(a), Math.sin(a), r.int(4, 7), RAMP.grass, 2.2, 3.5)
      }
    }

    // Stones and fallen sticks, in the thin turf only, where a stone would
    // actually show through. Sparse: this is the last texel-scale layer left on
    // the ground and it is one mark short of being speckle again.
    for (let i = 0; i < Math.round((n * n) / 11000); i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      if (patch(x / n, y / n) < 0.84) continue
      if (r.chance(0.55)) {
        const rx = r.range(1.6, 3)
        blob(put, x, y, rx, rx * 0.8, tone(RAMP.stone, 2))
        blob(put, x, y - 1, rx * 0.7, rx * 0.4, tone(RAMP.stone, 4))
      } else {
        const a = r.range(0, Math.PI * 2)
        stroke(put, x, y, Math.cos(a), Math.sin(a), r.int(5, 9), RAMP.bark, 1, 2)
      }
    }
  })

/**
 * Shore sand, and the tinted base region.ts uses for tracks, yards and tilled
 * ground. Nearly flat: a slow damp drift, a handful of ripple lines, some
 * stones. The ripples used to run at full strength across the whole tile and
 * read as wood grain on every path in the game.
 */
export const sand = (rng: Rng) =>
  build(SHORE, rng, (put, r, n) => {
    const damp = normalized(fbm(r, 5))

    for (let y = 0; y < n; y++) {
      const v = y / n
      for (let x = 0; x < n; x++) {
        ditherStep(put, x, y, RAMP.sand, 1.4 + damp(x / n, v) * 2.9)
      }
    }

    // A few long ripple marks rather than a modulation of every texel.
    for (let i = 0; i < 26; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      const a = r.range(-0.5, 0.5)
      const len = r.int(14, 40)
      stroke(put, x, y, Math.cos(a), Math.sin(a) * 0.35, len, RAMP.sand, 1, 2)
    }

    // Stones, lit from above so the shore has something with a top and a bottom
    // on it. Mostly waterworn brown: all-grey pebbles read as blue flecks
    // against tan, which is the one hue a shore must not have.
    for (let i = 0; i < Math.round((n * n) / 1400); i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      const rx = r.range(1.4, 3)
      const grey = r.chance(0.3)
      blob(put, x, y, rx, rx * 0.75, tone(grey ? RAMP.stone : RAMP.dirt, 1))
      blob(put, x, y - 1, rx * 0.7, rx * 0.35, tone(grey ? RAMP.stone : RAMP.dirt, 4))
    }
  })

/**
 * Still water. The one surface where fine detail is actively wrong: a pond of
 * per-texel noise shimmers the moment the camera moves and there is no mipmap
 * chain to save it.
 */
export const water = (rng: Rng) =>
  build(POOL, rng, (put, r, n) => {
    const deep = normalized(fbm(r, 4))
    const warp = valueNoise(r, 6)

    // Two frequencies, because one gives stripes of exactly equal width and a
    // pond of those reads as a beach towel.
    const ripple = (u: number, v: number) =>
      Math.sin((v * 9 + warp(u, v) * 0.5) * Math.PI * 2) * 0.72 +
      Math.sin((v * 22 + warp(u, v) * 0.3) * Math.PI * 2) * 0.28

    for (let y = 0; y < n; y++) {
      const v = y / n
      for (let x = 0; x < n; x++) {
        const u = x / n
        const band = ripple(u, v)
        const idx = 4 + (band > 0.5 ? 1 : band > 0 ? 0 : band > -0.5 ? -1 : -2)
        put(x, y, tone(RAMP.water, idx - Math.round(deep(u, v) * 1.4)))
      }
    }

    // Glints: a few long dashes on the crests, not a scatter of white pixels.
    for (let i = 0; i < 26; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      if (ripple(x / n, y / n) < 0.7) continue
      stroke(put, x, y, 1, 0, r.int(5, 12), RAMP.water, 5, 5)
    }
  })

/**
 * Standing timber. A flat trunk tone carrying a few long grain lines and two
 * knots, rather than a ridge profile evaluated at every texel.
 *
 * The previous version computed a grain column for all 4096 texels and read, at
 * play distance, as corduroy. Six lines and two knots read as bark.
 */
export const bark = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const drift = valueNoise(r, 6)
    fill(put, n, tone(RAMP.bark, 3))

    // Long grain, wandering with height. `drift` is toroidal in v, so a line
    // that leaves the bottom of the tile arrives back at the top in the same
    // place and the trunk has no seam ring around it.
    const lines = 7
    for (let i = 0; i < lines; i++) {
      const x0 = Math.round((i / lines) * n) + r.int(-2, 2)
      const dark = r.chance(0.65)
      const wide = r.chance(0.3)
      for (let y = 0; y < n; y++) {
        const x = x0 + Math.round((drift(i / lines, y / n) - 0.5) * 7)
        put(x, y, tone(RAMP.bark, dark ? 1 : 5))
        if (wide) put(x + 1, y, tone(RAMP.bark, dark ? 2 : 4))
      }
    }

    // Two knots: a dark core, one ring, a lit rim. A knot is a hole in the
    // surface, so it needs a light edge or it is only a dark smudge.
    for (let i = 0; i < 2; i++) {
      const kx = r.int(0, n - 1)
      const ky = r.int(0, n - 1)
      const rad = r.range(4, 6)
      for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) {
        for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
          const d = Math.hypot(dx, dy * 1.2)
          if (d > rad) continue
          const idx = d < rad * 0.35 ? 0 : d > rad - 1.2 ? 5 : 2
          put(kx + dx, ky + dy, tone(RAMP.bark, idx))
        }
      }
    }
  })

/**
 * Canopy. Big clusters with a lit crown and a dark underside, so a cone of this
 * reads as a mass of leaves instead of a green cone.
 *
 * Values sit high and near-neutral on purpose. region.ts multiplies this by a
 * per-tier leaf colour, and both the value and the saturation of the result are
 * the product of map and tint, so a mid-green map under a mid-green tint comes
 * out nearly black and twice as saturated as either.
 */
export const foliage = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const light = normalized(fbm(r, 3))
    fill(put, n, tone(RAMP.leaf, 2))

    // Gaps first, so clusters drawn over them leave ragged holes rather than a
    // continuous sheet. A canopy you cannot see through has no depth.
    for (let i = 0; i < 8; i++) {
      blob(put, r.int(0, n - 1), r.int(0, n - 1), r.range(3, 6), r.range(3, 6), tone(RAMP.leaf, 0))
    }

    for (let i = 0; i < 26; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      const rx = r.range(4, 7)
      const ry = rx * r.range(0.6, 0.85)
      const lit = light(x / n, y / n)
      blob(put, x, y, rx, ry, tone(RAMP.leaf, 2 + Math.round(lit * 2)))
      // Underside shadow and a lit crown: two marks, both worth their texels.
      blob(put, x + 1, y + Math.round(ry * 0.8), rx * 0.8, ry * 0.35, tone(RAMP.leaf, 1))
      blob(put, x - 1, y - Math.round(ry * 0.7), rx * 0.55, ry * 0.3, tone(RAMP.leaf, 5))
    }
  })

/**
 * Granite. Flat facets with a lit top plane, a shadowed under plane, dark
 * joints between, a few chips, and some lichen.
 *
 * Two constraints shaped this. It has to survive being stretched: the rocks are
 * dodecahedra, so each face gets its own UV scale and the same bitmap appears
 * at wildly different densities on the top and the side of one boulder. Big
 * flat shapes tolerate that; the fine hatch that used to be here turned into
 * corrugated fabric at one scale and stripes at the other. And the interiors
 * have to stay flat, because per-texel grit on stone is the exact noise this
 * pass exists to remove.
 */
export const stone = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const SEEDS = 26
    const sx: number[] = []
    const sy: number[] = []
    const base: number[] = []
    for (let i = 0; i < SEEDS; i++) {
      sx.push(r.range(0, n))
      sy.push(r.range(0, n))
      base.push(r.int(2, 4))
    }

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let best = Infinity
        let second = Infinity
        let hit = 0
        for (let i = 0; i < SEEDS; i++) {
          const dx = wrapDelta(x - sx[i]!, n)
          const dy = wrapDelta(y - sy[i]!, n)
          const d = dx * dx + dy * dy
          if (d < best) {
            second = best
            best = d
            hit = i
          } else if (d < second) second = d
        }

        const edge = Math.sqrt(second) - Math.sqrt(best)
        // Flat interior, then a facet: the half of the block above its seed
        // catches light, the half below falls away.
        const up = wrapDelta(y - sy[hit]!, n) < 0
        let idx = base[hit]! + (up ? 1 : -1)
        if (edge < 0.9) idx = 0
        else if (edge < 2.1) idx = up ? 4 : 1
        put(x, y, tone(RAMP.stone, idx))
      }
    }

    // Chips: a struck corner shows fresh, pale rock.
    for (let i = 0; i < 7; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      const w = r.int(2, 5)
      for (let dy = 0; dy < w; dy++) {
        for (let dx = 0; dx < w - dy; dx++) put(x + dx, y + dy, tone(RAMP.stone, 4))
      }
    }

    // Lichen. A few muted green blotches, which is the cheapest way to tie the
    // rocks to the grass they sit in. A top-face-only variant would be better
    // and needs a second material in region.ts.
    for (let i = 0; i < 4; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      blob(put, x, y, r.range(2.5, 5), r.range(2, 4), tone(RAMP.grass, 3))
      blob(put, x + 1, y + 1, r.range(1, 2.5), r.range(1, 2), tone(RAMP.grass, 4))
    }
  })

/**
 * Sawn boards: a flat board tone, one dark join, one lit arris, and at most a
 * single grain line. Every texel used to get a noise lookup, which at item
 * scale was mush and at wall scale was dirt.
 */
export const plank = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    // Four texels to a board, which at TEXELS_PER_UNIT is a third of a metre:
    // roughly a split plank, and about five of them up a hut wall.
    const BOARD = 4
    const boards = n / BOARD

    for (let b = 0; b < boards; b++) {
      const base = 2 + [1, 0, 1, 0][b % 4]!
      for (let row = 0; row < BOARD; row++) {
        const y = b * BOARD + row
        const idx = row === 0 ? 0 : row === 1 ? base + 1 : row === BOARD - 1 ? base - 1 : base
        for (let x = 0; x < n; x++) put(x, y, tone(RAMP.wood, idx))
      }

      // One grain line down the middle of most boards, wandering a little.
      if (r.chance(0.7)) {
        const y = b * BOARD + 2
        const len = r.int(Math.round(n * 0.4), n)
        const x0 = r.int(0, n - 1)
        for (let k = 0; k < len; k++) put(x0 + k, y + (r.chance(0.06) ? 1 : 0), tone(RAMP.wood, 1))
      }

      // A butt join on most boards, at a different x on each, so a wall is
      // boards somebody cut rather than one extruded ribbon.
      if (r.chance(0.7)) {
        const jx = r.int(0, n - 1)
        for (let row = 1; row < BOARD; row++) {
          put(jx, b * BOARD + row, tone(RAMP.wood, 0))
          put(jx + 1, b * BOARD + row, tone(RAMP.wood, 5))
        }
        for (const nx of [jx - r.int(3, 6), jx + r.int(4, 7)]) {
          put(nx, b * BOARD + 2, tone(RAMP.stone, 1))
        }
      }
    }
  })

/**
 * Thatch and dry pasture. Laid in courses, the way a roof is, with a hard
 * shadow under each course and a handful of bold stalks rather than fur.
 */
export const straw = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const COURSE = 8
    fill(put, n, tone(RAMP.straw, 3))

    for (let c = 0; c < n / COURSE; c++) {
      const top = c * COURSE
      // One dark line per course, and a ragged edge of stalk ends just under
      // it. That is the entire read: horizontal courses with an uneven lower
      // edge is what says thatch rather than siding.
      for (let x = 0; x < n; x++) put(x, top, tone(RAMP.straw, 0))
      for (let x = 0; x < n; x++) {
        if (!r.chance(0.4)) continue
        for (let k = 0; k < r.int(1, 3); k++) put(x, top + k, tone(RAMP.straw, 2))
      }
      // A few stalks, one step either side of the base tone. This layer used to
      // run from step 2 to step 5 over a step-3 base, and at native resolution a
      // roof of that reads as a checkerboard quilt rather than as straw.
      for (let s2 = 0; s2 < 5; s2++) {
        const x = r.int(0, n - 1)
        stroke(put, x, top + 2, r.range(-0.3, 0.3), 1, r.int(4, COURSE), RAMP.straw, 2, 4)
      }
    }
  })

/** Hammered iron: flat, two brushed highlights, four rivets. */
export const steel = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    fill(put, n, tone(RAMP.steel, 3))
    for (let i = 0; i < 3; i++) {
      const y = r.int(0, n - 1)
      const h = r.int(2, 5)
      for (let dy = 0; dy < h; dy++) {
        for (let x = 0; x < n; x++) put(x, y + dy, tone(RAMP.steel, dy === 0 ? 5 : 4))
      }
    }
    for (let i = 0; i < 6; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      blob(put, x, y, 2.4, 2.2, tone(RAMP.steel, 1))
      blob(put, x, y - 1, 1.6, 1, tone(RAMP.steel, 5))
    }
  })

/** Cloth: a flat weave with a few darker threads and a fold or two. */
export const cloth = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const fold = normalized(fbm(r, 3))
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        put(x, y, tone(RAMP.cloth, 2 + Math.round(fold(x / n, y / n) * 2)))
      }
    }
    // Weave: one darker thread every four texels, in one direction only. Two
    // directions at texel scale is a moire pattern, not a fabric.
    for (let y = 0; y < n; y += 4) {
      for (let x = 0; x < n; x++) put(x, y, tone(RAMP.cloth, 1))
    }
    for (let i = 0; i < 5; i++) {
      const y = r.int(0, n - 1)
      stroke(put, r.int(0, n - 1), y, 1, 0, r.int(10, 26), RAMP.cloth, 5, 5)
    }
  })

/** Fired clay: flat, with the ridges the wheel left. */
export const clay = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    fill(put, n, tone(RAMP.clay, 3))
    for (let y = 0; y < n; y += 6) {
      for (let x = 0; x < n; x++) {
        put(x, y, tone(RAMP.clay, 1))
        put(x, y + 1, tone(RAMP.clay, 4))
      }
    }
    for (let i = 0; i < 3; i++) {
      stroke(put, r.int(0, n - 1), r.int(0, n - 1), 1, 0, r.int(12, 30), RAMP.clay, 5, 5)
    }
  })

/** Cloudy glass: flat and pale, with two streak highlights and a bubble. */
export const glass = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    fill(put, n, tone(RAMP.glass, 3))
    for (let i = 0; i < 3; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      const len = r.int(16, 40)
      stroke(put, x, y, 0.8, 0.6, len, RAMP.glass, 5, 4)
      stroke(put, x + 2, y, 0.8, 0.6, len, RAMP.glass, 2, 2)
    }
    for (let i = 0; i < 4; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      blob(put, x, y, 2.2, 2.2, tone(RAMP.glass, 1))
      blob(put, x, y, 1.2, 1.2, tone(RAMP.glass, 5))
    }
  })

/** Polished gold: flat, with two broad bands. Gold is read by its contrast. */
export const gold = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const warp = valueNoise(r, 4)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const band = Math.sin((((x + y) / n) * 2 + warp(x / n, y / n) * 0.5) * Math.PI * 2)
        put(x, y, tone(RAMP.gold, band > 0.7 ? 5 : band > -0.2 ? 3 : 1))
      }
    }
  })

/** Ripe fruit: flat skin, one highlight, one shadowed base, a couple of flecks. */
export const fruit = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    fill(put, n, tone(RAMP.fruit, 3))
    for (let i = 0; i < 3; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      blob(put, x, y, r.range(7, 11), r.range(6, 9), tone(RAMP.fruit, 4))
      blob(put, x - 2, y - 2, r.range(3, 5), r.range(2.5, 4), tone(RAMP.fruit, 5))
    }
    for (let i = 0; i < 3; i++) {
      blob(put, r.int(0, n - 1), r.int(0, n - 1), r.range(5, 9), r.range(4, 7), tone(RAMP.fruit, 1))
    }
  })

/**
 * Live coals: a crust of dark plates with fire showing in the cracks between
 * them. Inverted stone, essentially, and the same Voronoi trick.
 */
export const ember = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const SEEDS = 90
    const sx: number[] = []
    const sy: number[] = []
    for (let i = 0; i < SEEDS; i++) {
      sx.push(r.range(0, n))
      sy.push(r.range(0, n))
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let best = Infinity
        let second = Infinity
        for (let i = 0; i < SEEDS; i++) {
          const dx = wrapDelta(x - sx[i]!, n)
          const dy = wrapDelta(y - sy[i]!, n)
          const d = dx * dx + dy * dy
          if (d < best) {
            second = best
            best = d
          } else if (d < second) second = d
        }
        const edge = Math.sqrt(second) - Math.sqrt(best)
        // Hot in the fissures, cooling toward the middle of each crust plate.
        put(x, y, tone(RAMP.ember, edge < 0.8 ? 5 : edge < 1.8 ? 4 : edge < 3.2 ? 2 : 1))
      }
    }
  })

/**
 * Everything, built once from one forked stream so the set is reproducible and
 * independent of how much randomness the rest of generation consumed.
 */
export interface TextureSet {
  grass: THREE.CanvasTexture
  sand: THREE.CanvasTexture
  bark: THREE.CanvasTexture
  foliage: THREE.CanvasTexture
  stone: THREE.CanvasTexture
  plank: THREE.CanvasTexture
  straw: THREE.CanvasTexture
  steel: THREE.CanvasTexture
  cloth: THREE.CanvasTexture
  clay: THREE.CanvasTexture
  water: THREE.CanvasTexture
  glass: THREE.CanvasTexture
  gold: THREE.CanvasTexture
  ember: THREE.CanvasTexture
  /**
   * Unused until someone wires it up. The apple's kitbash recipe asks for
   * `ember`, a fire ramp, so a Red Apple renders pumpkin orange in the world and
   * in its icon. This is the red it wants; it needs one line in kitbash.ts's
   * material map and a `fruit` material key on the recipe.
   */
  fruit: THREE.CanvasTexture
}

let cached: TextureSet | null = null

/**
 * The set, once it exists. For callers that run after generation and have no
 * Rng of their own, such as item assembly. Throws rather than silently building
 * a second unseeded set, which would make two items of the same material look
 * different.
 */
export function loadedTextures(): TextureSet {
  if (!cached) throw new Error('textures() must be called once during region build')
  return cached
}

export function textures(rng: Rng): TextureSet {
  if (cached) return cached
  const r = rng.fork('textures')
  cached = {
    grass: grass(r),
    sand: sand(r),
    bark: bark(r),
    foliage: foliage(r),
    stone: stone(r),
    plank: plank(r),
    straw: straw(r),
    steel: steel(r),
    cloth: cloth(r),
    clay: clay(r),
    water: water(r),
    glass: glass(r),
    gold: gold(r),
    ember: ember(r),
    fruit: fruit(r),
  }
  return cached
}

/**
 * Fewest texels any surface is allowed to show. The floor exists for parts
 * whose caller passes a nominal size well under the size they render at, such
 * as kitbash items at DISPLAY_SCALE; without it a bucket gets two texels.
 */
const MIN_TEXELS = 12

/**
 * Clone a texture with its own repeat, since repeat is per-texture state.
 *
 * Two changes from the version that assumed every tile was 32px. The divisor is
 * the texture's real pixel size, which is what lets tiles have different
 * resolutions without silently changing their density. And the repeat is no
 * longer rounded up to a whole tile.
 *
 * That rounding was the more damaging of the two. region.ts lays its tracks and
 * yards with UVs authored in world units, one unit of UV to 3.2 world units,
 * and asks for `tiled(sand, 3.2, 3.2)`. Rounded to a whole tile that put the
 * entire 256px bitmap inside 3.2 metres of ground: eighty texels to the unit,
 * every ripple and pebble smaller than a screen pixel, and a track that read as
 * flat orange paint. A fractional repeat gives exactly TEXELS_PER_UNIT on every
 * surface in the scene, which is the density rule D14 asks for, and it means a
 * 256px tile spans 21 world units of track before it has to repeat.
 */
export function tiled(tex: THREE.CanvasTexture, worldW: number, worldH: number): THREE.Texture {
  const t = tex.clone()
  t.needsUpdate = true

  // Re-asserted rather than fixed. Texture.copy() in three r185 does carry
  // magFilter, minFilter, anisotropy and generateMipmaps across a clone, so
  // nothing was being lost here; this is a local guarantee, so that the one
  // function handing textures to materials cannot hand over a filtered one.
  //
  // Worth recording what this does NOT fix, because it was once reported as
  // texel density drifting between the near and far ground. The camera is
  // orthographic, so density on a *flat* plane is constant by construction, and
  // there are no mipmaps to mush anything. What does vary is the terrain:
  // ground tilted away from the camera compresses its texels in screen space,
  // and only projected or triplanar UVs on the ground mesh would fix that.
  //
  // The other half of that report was the fixed-height pixel buffer being
  // rescaled to the window by a non-integer factor. That is gone: the renderer
  // draws at native resolution now, which is also why the fine detail in these
  // tiles had to come down. Nothing here compensates for a resolution change,
  // so if the render path changes again, look at the frame before trusting it.
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false

  const img = tex.image as HTMLCanvasElement
  const per = (world: number, texels: number) =>
    Math.max(MIN_TEXELS / texels, (world * TEXELS_PER_UNIT) / texels)
  t.repeat.set(per(worldW, img.width), per(worldH, img.height))
  return t
}
