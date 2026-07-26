import { describe, expect, it } from 'vitest'
import { BAND0, BAND1, BANDS, RAMP, type Band, type Ramps } from './palette'

/**
 * A palette has no geometry to screenshot until a band exists in the world, so
 * the honest checks are the relationships the file argues for in prose. These
 * are those arguments, written down so they cannot quietly stop being true.
 */

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

/** Relative luminance, 0..1. The thing palette.ts says does the reading. */
function luma(hex: string): number {
  const [r, g, b] = rgb(hex)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** HSV saturation, 0..1. The thing Max said was too high. */
function sat(hex: string): number {
  const [r, g, b] = rgb(hex)
  const max = Math.max(r, g, b)
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max
}

const RAMP_KEYS = Object.keys(RAMP) as (keyof Ramps)[]

describe('every band', () => {
  it.each(BANDS.map((b) => [b.name, b] as const))('%s has all ramps, six steps each', (_n, band: Band) => {
    expect(Object.keys(band.ramps).sort()).toEqual(RAMP_KEYS.slice().sort())
    for (const key of RAMP_KEYS) expect(band.ramps[key], key).toHaveLength(6)
  })

  it.each(BANDS.map((b) => [b.name, b] as const))('%s ramps ascend in value', (_n, band: Band) => {
    for (const key of RAMP_KEYS) {
      const ramp = band.ramps[key]
      for (let i = 1; i < ramp.length; i++) {
        expect(luma(ramp[i]!), `${key} step ${i}`).toBeGreaterThan(luma(ramp[i - 1]!))
      }
    }
  })

  /**
   * The rule textures.ts depends on: the toon shader quantises lighting into
   * bands, so a ramp whose own range is narrower than one band collapses to a
   * flat colour and reads as mud.
   */
  it.each(BANDS.map((b) => [b.name, b] as const))('%s ramps span at least 2:1 in value', (_n, band: Band) => {
    for (const key of RAMP_KEYS) {
      const ramp = band.ramps[key]
      expect(luma(ramp[5]!) / luma(ramp[0]!), key).toBeGreaterThan(2)
    }
  })

  /**
   * `dryGrass` is dithered against `grass` at the same index so that what
   * varies across the boundary is hue alone. If their luminances drift apart
   * the patches show up as blobs in a greyscale check, which is exactly what
   * the ground texture was rebuilt to avoid.
   */
  it.each(BANDS.map((b) => [b.name, b] as const))('%s keeps dryGrass matched to grass in value', (_n, band: Band) => {
    for (let i = 0; i < 6; i++) {
      expect(luma(band.ramps.dryGrass[i]!), `step ${i}`).toBeCloseTo(luma(band.ramps.grass[i]!), 1)
    }
  })
})

describe('Band 1 against Band 0', () => {
  /**
   * The load-bearing property of the whole derivation. Band 1 was made by
   * drifting hue and chroma and then locking luminance back to Band 0, so that
   * every value relationship Band 0 was tuned for survives untouched. Without
   * this lock, desaturating silently moved things: wood and clay collapsed from
   * 2.4% apart in value to 0.2%, and water drifted into steel.
   */
  it('matches Band 0 in value, step for step, on every ramp', () => {
    for (const key of RAMP_KEYS) {
      for (let i = 0; i < 6; i++) {
        expect(luma(BAND1.ramps[key][i]!), `${key} step ${i}`).toBeCloseTo(luma(BAND0.ramps[key][i]!), 2)
      }
    }
  })

  /** Quieter, never louder. The brief for the outer bands is less, not more. */
  it('is never more saturated than Band 0 on any ramp step', () => {
    for (const key of RAMP_KEYS) {
      for (let i = 0; i < 6; i++) {
        expect(sat(BAND1.ramps[key][i]!), `${key} step ${i}`).toBeLessThanOrEqual(sat(BAND0.ramps[key][i]!) + 0.02)
      }
    }
  })

  /** Living things go wrong; that is where the chroma comes out. */
  it('roughly halves the chroma of anything that grows', () => {
    for (const key of ['grass', 'dryGrass', 'straw'] as const) {
      expect(sat(BAND1.ramps[key][3]!), key).toBeLessThan(sat(BAND0.ramps[key][3]!) * 0.62)
    }
  })

  /** Iron is iron in any band, and that is the point: the manufactured things
   *  look more at home in The Turn than the grass does. */
  it('leaves made things nearly alone', () => {
    for (const key of ['steel', 'glass', 'gold'] as const) {
      expect(sat(BAND1.ramps[key][3]!), key).toBeGreaterThan(sat(BAND0.ramps[key][3]!) * 0.75)
    }
  })

  /** The one thing still fully saturated is the fire you brought with you. */
  it('does not touch fire', () => {
    expect(BAND1.ramps.ember).toEqual(BAND0.ramps.ember)
    expect(BAND1.ember).toBe(BAND0.ember)
    expect(BAND1.flame).toBe(BAND0.flame)
  })

  /** The player does not change colour when they walk across a border. */
  it('does not touch the player', () => {
    expect([BAND1.tunic, BAND1.trouser, BAND1.skin, BAND1.hair]).toEqual([
      BAND0.tunic,
      BAND0.trouser,
      BAND0.skin,
      BAND0.hair,
    ])
  })

  /** The sky stops being weather, and the sun stops being warm. */
  it('drains the light', () => {
    expect(sat(`#${BAND1.sky.toString(16).padStart(6, '0')}`)).toBeLessThan(
      sat(`#${BAND0.sky.toString(16).padStart(6, '0')}`) * 0.5,
    )
    expect(sat(`#${BAND1.sun.toString(16).padStart(6, '0')}`)).toBeLessThan(
      sat(`#${BAND0.sun.toString(16).padStart(6, '0')}`),
    )
  })
})

describe('band identity', () => {
  it('has unique ids', () => {
    expect(new Set(BANDS.map((b) => b.id)).size).toBe(BANDS.length)
  })

  /**
   * Determinism guard, and the reason it is worth a test of its own.
   *
   * `textures()` forks the texture RNG with `band.seedLabel`, and `rng.fork`
   * derives a stream from the label alone. Renaming Band 0's label would
   * reseed every texture in the game: not break it, just quietly make it a
   * different world, invalidating every screenshot in `.shots/` and every
   * before/after comparison in this repo. It must stay exactly this string.
   */
  it('pins Band 0 to the original texture seed', () => {
    expect(BAND0.seedLabel).toBe('textures')
  })

  it('gives every other band its own texture stream', () => {
    expect(new Set(BANDS.map((b) => b.seedLabel)).size).toBe(BANDS.length)
  })
})
