/**
 * Procedural pixel-art textures.
 *
 * Every surface in the first pass was a single flat colour, which is why the
 * game read as vector art with a filter over it no matter how much the palette
 * and the pixel buffer were tuned. Untextured geometry cannot be fixed
 * downstream. These are real textures: small tiling bitmaps drawn pixel by
 * pixel, with hard edges and a tight palette, in the manner of 16-bit tile art.
 *
 * Drawn in code rather than loaded, for three reasons that all come from the
 * existing docs: the game ships offline with no network calls, everything must
 * be reproducible from a seed, and there is no art pipeline yet. When the
 * fal.ai material bake in docs/ASSET_PIPELINE.md lands it can replace the
 * insides of this file without touching a single call site.
 *
 * Two rules that matter for the look:
 *   - NearestFilter always. Linear filtering blurs a 32px tile into porridge.
 *   - Keep texel density roughly constant across surfaces, so one world unit
 *     covers a similar number of texels everywhere. Mismatched density is what
 *     makes textured 3D look like wallpaper.
 */

import * as THREE from 'three'
import type { Rng } from '../core/rng'

/** Texels per world unit. Everything sets `repeat` from this. */
export const TEXELS_PER_UNIT = 10
const TILE = 32

type Draw = (put: (x: number, y: number, color: string) => void, rng: Rng) => void

function build(size: number, rng: Rng, draw: Draw): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const put = (x: number, y: number, color: string) => {
    ctx.fillStyle = color
    // Wrap, so strokes that run off an edge come back on the other side and the
    // tile stays seamless.
    ctx.fillRect(((x % size) + size) % size, ((y % size) + size) % size, 1, 1)
  }

  draw(put, rng)

  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Fill the tile with a base colour. */
function fill(put: (x: number, y: number, c: string) => void, size: number, color: string): void {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, color)
}

/** Scatter n single pixels from a palette. */
function speckle(
  put: (x: number, y: number, c: string) => void,
  size: number,
  rng: Rng,
  palette: string[],
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    put(rng.int(0, size - 1), rng.int(0, size - 1), rng.pick(palette))
  }
}

// ---------------------------------------------------------------- generators

/** Short upright blades in three greens, on a darker bed. */
export const grass = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#5f9c38')
    speckle(put, TILE, r, ['#6aa63e', '#568c32'], 260)
    for (let i = 0; i < 90; i++) {
      const x = r.int(0, TILE - 1)
      const y = r.int(0, TILE - 1)
      const c = r.pick(['#7ab648', '#8cc456', '#4f8a2e'])
      const len = r.int(1, 3)
      for (let k = 0; k < len; k++) put(x, y - k, c)
    }
  })

/** Loose grains with the odd pebble. */
export const sand = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#d0b077')
    speckle(put, TILE, r, ['#dcc48e', '#c39c62', '#e2cda0'], 340)
    for (let i = 0; i < 10; i++) {
      const x = r.int(0, TILE - 1)
      const y = r.int(0, TILE - 1)
      put(x, y, '#a8834f')
      put(x + 1, y, '#a8834f')
    }
  })

/** Vertical grain with knots. */
export const bark = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#8b5a2b')
    for (let x = 0; x < TILE; x++) {
      const shade = r.pick(['#7a4d24', '#9a6633', '#6d4520', '#8b5a2b'])
      for (let y = 0; y < TILE; y++) {
        // Grain wanders a little so the columns are not ruler-straight.
        if (r.chance(0.82)) put(x, y, shade)
        else put(x, y, r.pick(['#a0703a', '#63401d']))
      }
    }
    for (let i = 0; i < 4; i++) {
      const x = r.int(2, TILE - 3)
      const y = r.int(2, TILE - 3)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(x + dx, y + dy, '#5a3a1a')
      put(x, y, '#4a2f15')
    }
  })

/** Clumped leaves, so a canopy reads as mass rather than as a green cone. */
export const foliage = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#3f8a33')
    for (let i = 0; i < 150; i++) {
      const x = r.int(0, TILE - 1)
      const y = r.int(0, TILE - 1)
      const c = r.pick(['#4fa03f', '#66b84d', '#357528'])
      put(x, y, c)
      if (r.chance(0.6)) put(x + 1, y, c)
      if (r.chance(0.45)) put(x, y + 1, c)
    }
    speckle(put, TILE, r, ['#7fc95c'], 30)
  })

/** Mottled blocks with a few cracks. */
export const stone = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#9a9a96')
    for (let i = 0; i < 120; i++) {
      const x = r.int(0, TILE - 1)
      const y = r.int(0, TILE - 1)
      const c = r.pick(['#8b8b87', '#a8a8a3', '#7d7d7a'])
      const w = r.int(1, 3)
      const h = r.int(1, 2)
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) put(x + dx, y + dy, c)
    }
    for (let i = 0; i < 3; i++) {
      let x = r.int(0, TILE - 1)
      let y = r.int(0, TILE - 1)
      for (let k = 0; k < 12; k++) {
        put(x, y, '#6b6b68')
        x += r.int(-1, 1)
        y += 1
      }
    }
  })

/** Sawn boards with visible joins. */
export const plank = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#b07840')
    for (let y = 0; y < TILE; y++) {
      const board = Math.floor(y / 8)
      const base = ['#b07840', '#a86e38', '#bb8449', '#a06834'][board % 4]!
      for (let x = 0; x < TILE; x++) put(x, y, r.chance(0.85) ? base : '#96612f')
      if (y % 8 === 0) for (let x = 0; x < TILE; x++) put(x, y, '#7a4d24')
    }
  })

/** Loose dry stalks. */
export const straw = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#c9a95f')
    for (let i = 0; i < 120; i++) {
      const x = r.int(0, TILE - 1)
      const y = r.int(0, TILE - 1)
      const c = r.pick(['#dcc06a', '#b8954d', '#e6d089'])
      const len = r.int(2, 5)
      for (let k = 0; k < len; k++) put(x, y - k, c)
    }
  })

/** Hammered metal: mostly flat with scattered highlights. */
export const steel = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#b8c4d0')
    speckle(put, TILE, r, ['#cdd8e2', '#9aa7b4', '#8b96a2'], 200)
    for (let i = 0; i < 14; i++) {
      const x = r.int(0, TILE - 1)
      const y = r.int(0, TILE - 1)
      put(x, y, '#e4ecf4')
      put(x + 1, y, '#e4ecf4')
    }
  })

/** Woven cloth: a visible warp and weft. */
export const cloth = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#e0c9a6')
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const weave = (x + y) % 4 < 2 ? '#d6bd97' : '#e8d4b4'
        put(x, y, r.chance(0.92) ? weave : '#c9ad84')
      }
    }
  })

/** Fired clay with a slight sheen. */
export const clay = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#c07a52')
    speckle(put, TILE, r, ['#b06e48', '#cf8a60', '#a4623c'], 260)
  })

/** Still water: bands with a scatter of glints. */
export const water = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#3f9ed6')
    for (let y = 0; y < TILE; y++) {
      const band = Math.sin(y * 0.55) > 0.4 ? '#4aa9de' : '#3792c9'
      for (let x = 0; x < TILE; x++) put(x, y, r.chance(0.9) ? band : '#2e7cb0')
    }
    for (let i = 0; i < 22; i++) {
      const x = r.int(0, TILE - 1)
      const y = r.int(0, TILE - 1)
      put(x, y, '#9fd8f2')
      put(x + 1, y, '#9fd8f2')
    }
  })

/** Cloudy glass. */
export const glass = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#9fdce6')
    speckle(put, TILE, r, ['#b6e8f0', '#8ccdd8'], 180)
  })

export const gold = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#f0d264')
    speckle(put, TILE, r, ['#ffe98c', '#d4b445'], 200)
  })

export const ember = (rng: Rng) =>
  build(TILE, rng, (put, r) => {
    fill(put, TILE, '#ff7a2f')
    speckle(put, TILE, r, ['#ffb347', '#e2481a', '#ffd98a'], 240)
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

/** Clone a texture with its own repeat, since repeat is per-texture state. */
export function tiled(tex: THREE.CanvasTexture, worldW: number, worldH: number): THREE.Texture {
  const t = tex.clone()
  t.needsUpdate = true
  t.repeat.set(Math.max(1, Math.round((worldW * TEXELS_PER_UNIT) / 32)), Math.max(1, Math.round((worldH * TEXELS_PER_UNIT) / 32)))
  return t
}
