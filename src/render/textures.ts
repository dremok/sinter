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
 * ## Structure, not noise
 *
 * The other half of the second pass's problem was that bark, stone and plank
 * were per-texel random picks from a three-colour list. Per-texel randomness
 * reads as dirt on the lens, never as a material. Everything here is built from
 * deliberate shapes instead: grain columns that bend around knots, Voronoi
 * blocks with mortar and a lit bevel, boards with joins and staggered butt
 * ends, grass in clumps with a dark base and a lit tip.
 *
 * The value range matters as much as the shapes. Each texture spans most of its
 * six-step ramp (see palette.ts), because the toon shader quantises lighting to
 * three bands: if a texture's own range is narrower than one band, the whole
 * surface collapses to a single flat colour and reads as mud.
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

/** Pick a ramp step from a 0..1 position along it. */
function shade(ramp: readonly string[], t: number): string {
  return ramp[clamp(Math.floor(t * ramp.length), 0, ramp.length - 1)]!
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

/** Two octaves. Enough for terrain-scale drift without the per-pixel cost. */
function fbm(r: Rng, cells: number): (u: number, v: number) => number {
  const a = valueNoise(r, cells)
  const b = valueNoise(r, cells * 2)
  return (u, v) => a(u, v) * 0.68 + b(u, v) * 0.32
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

// ---------------------------------------------------------------- generators

/**
 * Ground cover, and the most important texture in the game: it is most of what
 * is on screen at any moment.
 *
 * Four layers, deliberately at four different scales, because a single scale of
 * detail is what makes procedural ground read as carpet:
 *   1. Regional drift, ~15 world units, decides lush versus dry green.
 *   2. Bare soil, ~7 world units, dithered in so the edge is stamped not blended.
 *   3. Clumps, ~0.5 world units, dense in the lush regions and absent on soil.
 *   4. Blades and flowers at texel scale, but only ever attached to a clump, so
 *      the tile never degenerates into salt-and-pepper noise.
 */
export const grass = (rng: Rng) =>
  build(GROUND, rng, (put, r, n) => {
    const lush = normalized(fbm(r, 6))
    const bare = normalized(fbm(r, 11))
    const fine = valueNoise(r, 96)

    for (let y = 0; y < n; y++) {
      const v = y / n
      for (let x = 0; x < n; x++) {
        const u = x / n
        // Soil surfaces where `bare` peaks. The steep multiplier is deliberate:
        // a wide dithered ramp between mid green and tan is not a soft edge, it
        // is a field of red pixels, because a 50/50 stipple of two saturated
        // complementary hues resolves to neither of them. Keep the stipple a
        // few texels wide and darken both sides as they approach it, so the
        // boundary reads as worn ground rather than as measles.
        const soil = (bare(u, v) - 0.72) * 16
        if (soil > dither(x, y)) {
          put(x, y, shade(RAMP.dirt, 0.02 + clamp(soil, 0, 1) * 0.5 + fine(u, v) * 0.3))
        } else {
          const t = lush(u, v) * 0.75 + fine(u, v) * 0.2
          const dim = 1 - clamp(soil + 0.6, 0, 1) * 0.5
          put(x, y, shade(RAMP.grass, (0.16 + t * 0.62) * dim))
        }
      }
    }

    // Clumps. This is the layer that turns a speckled field into tile art: each
    // is a small fan of blades with a shadow at the root and the lightest step
    // of the ramp at the tips, so the eye reads discrete plants.
    const clumps = Math.round((n * n) / 40)
    for (let i = 0; i < clumps; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      const u = x / n
      const v = y / n
      if (bare(u, v) > 0.7) continue
      const lift = lush(u, v)
      if (!r.chance(0.2 + lift * 0.9)) continue

      // A root shadow on only a third of them. On all of them it reads as
      // polka dots, which is the failure mode one step along from speckle.
      if (r.chance(0.34)) put(x, y + 1, tone(RAMP.grass, 0))
      const blades = r.int(2, 3)
      for (let bl = 0; bl < blades; bl++) {
        const bx = x + r.int(-1, 1)
        const by = y + r.int(-1, 1)
        const len = r.int(2, 4)
        const lean = r.int(-1, 1)
        const tip = 3.4 + lift * 1.6
        for (let k = 0; k < len; k++) {
          const f = k / Math.max(1, len - 1)
          put(bx + Math.round(lean * f), by - k, tone(RAMP.grass, 2 + f * (tip - 2)))
        }
      }
    }

    // Pebbles and twigs, on the soil only, so a bare patch reads as ground that
    // something wore through rather than as a paint spill.
    for (let i = 0; i < Math.round((n * n) / 2600); i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      if (bare(x / n, y / n) < 0.72) continue
      if (r.chance(0.6)) {
        blob(put, x, y, r.range(1, 2.2), r.range(1, 1.8), tone(RAMP.stone, r.int(1, 3)))
        put(x, y - 1, tone(RAMP.stone, 5))
      } else {
        const len = r.int(3, 7)
        const dy = r.int(-1, 1)
        for (let k = 0; k < len; k++) put(x + k, y + Math.round((k * dy) / len), tone(RAMP.bark, 1))
      }
    }

    // Wildflowers. Two texels each and roughly one every six world units: any
    // denser and they stop being a detail the eye finds and start being noise.
    for (let i = 0; i < Math.round((n * n) / 9000); i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      if (bare(x / n, y / n) > 0.55 || lush(x / n, y / n) < 0.45) continue
      const c = r.chance(0.6) ? tone(RAMP.straw, 5) : tone(RAMP.cloth, 5)
      put(x, y, c)
      put(x + 1, y, c)
      put(x, y + 1, tone(RAMP.grass, 1))
    }
  })

/**
 * Shore sand. One tile covers the whole ring around the pond.
 *
 * Ripples run as broad low-frequency arcs rather than as speckle, because sand
 * at this distance is read by its banding, not by its grains; the grains are
 * there but they are worth one ramp step, no more.
 */
export const sand = (rng: Rng) =>
  build(SHORE, rng, (put, r, n) => {
    const damp = normalized(fbm(r, 5))
    const warp = valueNoise(r, 7)
    const grain = valueNoise(r, n / 2)

    for (let y = 0; y < n; y++) {
      const v = y / n
      for (let x = 0; x < n; x++) {
        const u = x / n
        // Ripple crests: a sine whose phase is dragged around by low-frequency
        // noise, which is what stops them reading as corduroy.
        const ripple = Math.sin((v * 9 + warp(u, v) * 2.2) * Math.PI * 2)
        let idx = 3 + (ripple > 0.45 ? 1 : ripple < -0.5 ? -1 : 0)
        idx -= Math.round(damp(u, v) * 2.2)
        if (grain(u, v) > 0.72) idx += 1
        else if (grain(u, v) < 0.3) idx -= 1
        put(x, y, tone(RAMP.sand, idx + 1))
      }
    }

    // Pebbles, lit from above so the shore has something with a top and a
    // bottom on it. Everything else here is flat by design.
    for (let i = 0; i < Math.round((n * n) / 900); i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      const rx = r.range(1.2, 2.6)
      blob(put, x, y, rx, rx * 0.75, tone(RAMP.stone, r.int(1, 3)))
      put(x, y - Math.round(rx * 0.7), tone(RAMP.stone, 5))
      put(x, y + Math.round(rx * 0.75), tone(RAMP.dirt, 0))
    }
  })

/**
 * Still water. Kept deliberately low-frequency: this is the one surface where
 * fine detail is actively wrong, because a pond of per-texel noise shimmers the
 * moment the camera moves and there is no mipmap chain to save it.
 */
export const water = (rng: Rng) =>
  build(POOL, rng, (put, r, n) => {
    const deep = normalized(fbm(r, 4))
    const warp = valueNoise(r, 6)

    // Phase drift is kept small. At 1.6 periods of warp the ripples curled into
    // closed loops and the pond read as polished marble; a third of a period is
    // enough to stop them being corduroy and not enough to make them swirl.
    const ripple = (u: number, v: number) => Math.sin((v * 7 + warp(u, v) * 0.45) * Math.PI * 2)

    for (let y = 0; y < n; y++) {
      const v = y / n
      for (let x = 0; x < n; x++) {
        const u = x / n
        const band = ripple(u, v)
        let idx = 4 + (band > 0.4 ? 1 : band < -0.45 ? -1 : 0)
        idx -= Math.round(deep(u, v) * 1.4)
        put(x, y, tone(RAMP.water, idx))
      }
    }

    // Glints: short horizontal dashes on the crests only, so they read as light
    // catching a wave rather than as scattered white pixels.
    for (let i = 0; i < Math.round((n * n) / 220); i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      if (ripple(x / n, y / n) < 0.72) continue
      const len = r.int(2, 5)
      for (let k = 0; k < len; k++) put(x + k, y, tone(RAMP.water, 5))
    }
  })

/**
 * Standing timber. Vertical grain, knots, and depth, which the old version had
 * none of: it picked a random shade per texel and hoped.
 *
 * The grain is a ridge profile repeated every four texels, drifting sideways
 * with height and *bending around the knots*, which is the detail that makes it
 * read as wood rather than as stripes. The profile is asymmetric on purpose: a
 * deep groove, a broad face, a lit crest, in the proportions a split log has.
 */
export const bark = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const drift = valueNoise(r, 8)
    const jitter = valueNoise(r, 6)
    const GRAIN = 4

    const knots = Array.from({ length: 3 }, () => ({
      x: r.int(0, n - 1),
      y: r.int(0, n - 1),
      rad: r.range(3, 5.5),
    }))

    for (let y = 0; y < n; y++) {
      const v = y / n
      const slide = (drift(0.5, v) - 0.5) * 7
      for (let x = 0; x < n; x++) {
        let gx = x + slide
        for (const k of knots) {
          const dx = wrapDelta(x - k.x, n)
          const dy = wrapDelta(y - k.y, n)
          const d = Math.hypot(dx, dy)
          const reach = k.rad * 3
          if (d < reach) gx += (1 - d / reach) * (dx < 0 ? -1 : 1) * k.rad * 1.5
        }
        const g = gx / GRAIN + jitter(gx / n, v) * 0.7
        const f = g - Math.floor(g)
        const idx = f < 0.16 ? 0 : f < 0.34 ? 1 : f < 0.66 ? 3 : f < 0.86 ? 4 : 2
        put(x, y, tone(RAMP.bark, idx))
      }
    }

    // Knots: concentric rings around a dark core, with a lit rim, so each one
    // is a hole in the surface rather than a dark smudge on it.
    for (const k of knots) {
      const rad = k.rad
      for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) {
        for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
          const d = Math.hypot(dx, dy * 1.25)
          if (d > rad) continue
          let idx = Math.floor(d / 1.5) % 2 === 0 ? 0 : 2
          if (d < 1.3) idx = 0
          else if (d > rad - 1.1) idx = 5
          put(k.x + dx, k.y + dy, tone(RAMP.bark, idx))
        }
      }
    }
  })

/**
 * Canopy. Clusters with a lit top-left and a dark underside, so a cone of this
 * reads as a mass of leaves instead of a green cone.
 *
 * Values sit high on purpose. region.ts multiplies this by a per-tier leaf
 * colour, and a mid-green map under a mid-green tint comes out nearly black,
 * which is exactly what the trees used to look like.
 */
export const foliage = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const light = normalized(fbm(r, 3))
    fill(put, n, tone(RAMP.leaf, 1))

    // Gaps first, so clusters drawn over them leave ragged holes rather than a
    // continuous sheet. A canopy you cannot see through has no depth.
    for (let i = 0; i < 14; i++) {
      blob(put, r.int(0, n - 1), r.int(0, n - 1), r.range(2, 4), r.range(2, 4), tone(RAMP.leaf, 0))
    }

    for (let i = 0; i < 90; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      const rx = r.range(1.8, 3.6)
      const ry = rx * r.range(0.6, 0.9)
      const lit = light(x / n, y / n)
      const idx = 2 + Math.round(lit * 2.4)
      blob(put, x, y, rx, ry, tone(RAMP.leaf, idx))
      // Underside shadow, one texel down and right of the cluster.
      blob(put, x + 1, y + Math.round(ry), rx * 0.7, 0.9, tone(RAMP.leaf, 0))
      if (lit > 0.62) {
        put(x - 1, y - Math.round(ry * 0.7), tone(RAMP.leaf, 5))
        put(x, y - Math.round(ry * 0.7), tone(RAMP.leaf, 5))
      }
    }
  })

/**
 * Granite. Voronoi blocks with mortar-dark joints and a bevel: light on the
 * up-facing side of every joint, shadow on the down-facing side.
 *
 * That bevel is doing most of the work. Blocks of flat colour separated by dark
 * lines read as a floor plan; the same blocks with two texels of directional
 * edge read as carved stone, and it survives cel shading because it is baked
 * into the albedo rather than left to the lighting.
 */
export const stone = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const SEEDS = 10
    const sx: number[] = []
    const sy: number[] = []
    const base: number[] = []
    for (let i = 0; i < SEEDS; i++) {
      sx.push(r.range(0, n))
      sy.push(r.range(0, n))
      base.push(r.int(2, 4))
    }
    // Grit sampled at half resolution: single-texel speckle on stone is the
    // exact noise this rewrite is trying to remove, and it aliases badly on a
    // rock seen from thirty metres.
    const grit = valueNoise(r, n / 4)

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
        let idx = base[hit]!
        const g = grit(x / n, y / n)
        if (g > 0.66) idx += 1
        else if (g < 0.34) idx -= 1

        // Thin joints on purpose. The rocks are dodecahedra, so their UVs
        // stretch badly across a face and a fat joint turns into a long black
        // scratch rather than a seam between two blocks.
        if (edge < 0.8) idx = 0
        else if (edge < 2) idx = wrapDelta(y - sy[hit]!, n) < 0 ? 5 : 1

        put(x, y, tone(RAMP.stone, idx))
      }
    }

    // Cracks, which wander downward and thin out. Two per tile: any more and
    // the blocks stop reading as solid.
    for (let i = 0; i < 2; i++) {
      let x = r.int(0, n - 1)
      let y = r.int(0, n - 1)
      const len = r.int(10, 20)
      for (let k = 0; k < len; k++) {
        put(x, y, tone(RAMP.stone, 0))
        if (k < len * 0.6) put(x + 1, y, tone(RAMP.stone, 1))
        x += r.int(-1, 1)
        y += 1
      }
    }
  })

/**
 * Sawn boards. Joins between boards, a lit arris under each join, lengthwise
 * grain with runout, staggered butt ends, and nails.
 *
 * The butt ends matter more than they look. Without them a wall of this is one
 * extruded ribbon eight boards tall; with them it is a wall somebody built.
 */
export const plank = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    // Four texels to a board, which at TEXELS_PER_UNIT is a third of a metre:
    // roughly a split plank, and about five of them up a hut wall. Wider boards
    // were tried first and a wall only showed two of them.
    const BOARD = 4
    // Stretched four to one along y, so the noise reads as grain running the
    // length of the board rather than as blotches.
    const grain = valueNoise(r, 20)
    const boards = n / BOARD

    for (let b = 0; b < boards; b++) {
      const base = 2 + [1, 0, 2, 0][b % 4]!
      for (let row = 0; row < BOARD; row++) {
        const y = b * BOARD + row
        for (let x = 0; x < n; x++) {
          let idx = base
          const g = grain(x / n, (y * 4) / n)
          if (g > 0.68) idx += 1
          else if (g < 0.32) idx -= 1
          if (row === 0) idx = 0
          else if (row === 1) idx += 2
          else if (row === BOARD - 1) idx -= 1
          put(x, y, tone(RAMP.wood, idx))
        }
      }

      // A butt join on most boards, at a different x on each, so a wall is
      // boards somebody cut rather than one extruded ribbon.
      if (r.chance(0.75)) {
        const jx = r.int(0, n - 1)
        for (let row = 1; row < BOARD; row++) {
          put(jx, b * BOARD + row, tone(RAMP.wood, 0))
          put(jx + 1, b * BOARD + row, tone(RAMP.wood, 5))
        }
        // Nails, iron-grey, either side of the join.
        for (const nx of [jx - r.int(3, 6), jx + r.int(4, 7)]) {
          put(nx, b * BOARD + 2, tone(RAMP.stone, 1))
        }
      }
    }
  })

/**
 * Thatch and dry pasture. Laid in courses, the way a roof actually is, with the
 * stalk ends of each course overhanging the shadow of the one below.
 */
export const straw = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const COURSE = 16
    fill(put, n, tone(RAMP.straw, 1))

    for (let c = 0; c < n / COURSE; c++) {
      const top = c * COURSE
      // The shadow the course above throws down onto this one.
      for (let x = 0; x < n; x++) put(x, top, tone(RAMP.straw, 0))

      // Stalks, grouped into bundles so a course has rhythm rather than fur,
      // but each stalk keeps its own tone. Giving a whole bundle one tone was
      // what made the roof read as a patchwork quilt.
      for (let bundle = 0; bundle < 13; bundle++) {
        const bx = r.int(0, n - 1)
        const bidx = r.range(2.4, 4)
        for (let s = 0; s < r.int(4, 7); s++) {
          const x = bx + r.int(-2, 2)
          const len = r.int(10, COURSE + 3)
          const lean = r.range(-0.2, 0.2)
          const start = top + 1 + r.int(0, 2)
          // Dark where it disappears under the course above, lightest at the
          // cut end, which is the only part of a thatch stalk in full sun.
          for (let k = 0; k < len; k++) {
            put(x + Math.round(lean * k), start + k, tone(RAMP.straw, bidx - 1 + (k / len) * 2.4))
          }
        }
      }
    }
  })

/**
 * Hammered iron. Broad brushed banding with dents that have a lit top edge and
 * a shadowed bottom, since a dent with no direction to it is just a smudge.
 */
export const steel = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const brush = valueNoise(r, 16)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const b = brush(x / n, (y * 6) / n)
        put(x, y, tone(RAMP.steel, 2 + Math.round(b * 2.4)))
      }
    }
    for (let i = 0; i < 16; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      const rad = r.range(2, 4)
      blob(put, x, y, rad, rad * 0.8, tone(RAMP.steel, 1))
      blob(put, x, y - 1, rad * 0.8, rad * 0.4, tone(RAMP.steel, 4))
      put(x, y - Math.round(rad * 0.8), tone(RAMP.steel, 5))
    }
  })

/** Woven cloth: a 2/2 twill, with slubs where a thread runs thick. */
export const cloth = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const fold = normalized(fbm(r, 4))
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        // Twill: the over-under offsets by one thread each row, which is what
        // gives real cloth its diagonal.
        const over = (x + (y >> 1)) % 4 < 2
        const base = 2 + Math.round(fold(x / n, y / n) * 2)
        put(x, y, tone(RAMP.cloth, base + (over ? 1 : -1)))
      }
    }
    for (let i = 0; i < 22; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      const len = r.int(3, 8)
      for (let k = 0; k < len; k++) put(x + k, y, tone(RAMP.cloth, r.int(0, 1)))
    }
  })

/** Fired clay: the ridges left by the wheel, and a sheen along one of them. */
export const clay = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const wobble = valueNoise(r, 6)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const ridge = Math.sin((y / n * 11 + wobble(x / n, y / n) * 0.8) * Math.PI * 2)
        put(x, y, tone(RAMP.clay, 3 + (ridge > 0.5 ? 1 : ridge < -0.55 ? -2 : 0)))
      }
    }
    for (let i = 0; i < 40; i++) {
      put(r.int(0, n - 1), r.int(0, n - 1), tone(RAMP.clay, r.int(1, 5)))
    }
  })

/** Cloudy glass: streaked, with the odd trapped bubble. */
export const glass = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const streak = valueNoise(r, 10)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        // (x+y)/n advances by exactly one period per tile on both axes, so the
        // diagonal streaks still wrap.
        const s = streak((x + y) / n, (y * 3) / n)
        put(x, y, tone(RAMP.glass, 2 + Math.round(s * 3)))
      }
    }
    for (let i = 0; i < 10; i++) {
      const x = r.int(0, n - 1)
      const y = r.int(0, n - 1)
      blob(put, x, y, 2, 2, tone(RAMP.glass, 4))
      put(x, y - 1, tone(RAMP.glass, 5))
      put(x, y + 2, tone(RAMP.glass, 1))
    }
  })

/** Polished gold: broad diagonal bands, because gold is read by its contrast. */
export const gold = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const warp = valueNoise(r, 5)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const band = Math.sin(((x + y) / n * 3 + warp(x / n, y / n) * 0.7) * Math.PI * 2)
        put(x, y, tone(RAMP.gold, band > 0.6 ? 5 : band > 0 ? 3 : band > -0.6 ? 2 : 1))
      }
    }
  })

/**
 * Live coals: a crust of dark cells with fire showing in the cracks between
 * them. Inverted stone, essentially, and the same Voronoi trick.
 */
export const ember = (rng: Rng) =>
  build(PROP, rng, (put, r, n) => {
    const SEEDS = 10
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
        const idx = edge < 1 ? 5 : edge < 2.4 ? 4 : edge < 5 ? 2 : edge < 8 ? 1 : 0
        put(x, y, tone(RAMP.ember, idx))
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
  const img = tex.image as HTMLCanvasElement
  const per = (world: number, texels: number) =>
    Math.max(MIN_TEXELS / texels, (world * TEXELS_PER_UNIT) / texels)
  t.repeat.set(per(worldW, img.width), per(worldH, img.height))
  return t
}
