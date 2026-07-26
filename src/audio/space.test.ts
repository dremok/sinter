import { describe, expect, it } from 'vitest'
import { hash01, heard, PAN_WIDTH, rolloff } from './space'

/**
 * The listener model, which is the one thing in the audio layer that can be
 * wrong in a way nobody hears until they are standing in the wrong place.
 *
 * The camera-versus-player question is the whole reason this file exists: an
 * orthographic rig puts every object at roughly the same depth (D9), so a
 * listener at the camera hears everything at one volume and the bug reads as
 * "positional audio does nothing" rather than as "the listener is in the wrong
 * place". These assert the model, not the wiring.
 */

/** The camera's right vector for the default azimuth, on the ground plane. */
const RIGHT = { rightX: Math.SQRT1_2, rightZ: -Math.SQRT1_2 }
const AT_ORIGIN = { x: 0, z: 0, ...RIGHT }

describe('rolloff', () => {
  it('is full at the source and silent at the radius', () => {
    expect(rolloff(0, 10)).toBe(1)
    expect(rolloff(10, 10)).toBe(0)
    expect(rolloff(11, 10)).toBe(0)
  })

  it('reaches exactly zero, so an emitter can be torn down rather than kept', () => {
    // The reason this matters: an inverse-distance law never reaches zero, and
    // every fire ever lit would keep a live node forever.
    for (let d = 10; d < 40; d += 0.5) expect(rolloff(d, 10)).toBe(0)
  })

  it('falls away with distance and never rises', () => {
    let previous = Infinity
    for (let d = 0; d <= 12; d += 0.25) {
      const g = rolloff(d, 12)
      expect(g).toBeLessThanOrEqual(previous)
      previous = g
    }
  })

  it('has a near field that dominates', () => {
    // Squared rolloff: half way to the radius should be well under half volume.
    expect(rolloff(6, 12)).toBeCloseTo(0.25, 5)
  })
})

describe('heard', () => {
  it('is loudest at the listener', () => {
    expect(heard(AT_ORIGIN, 0, 0, 10).gain).toBe(1)
  })

  it('measures distance on the ground plane from the player', () => {
    const near = heard(AT_ORIGIN, 3, 0, 20).gain
    const far = heard(AT_ORIGIN, 15, 0, 20).gain
    expect(near).toBeGreaterThan(far)
    expect(far).toBeGreaterThan(0)
  })

  it('pans along the camera right vector, not along world x', () => {
    // Straight along the camera's right: hard right. Straight along world +x is
    // diagonal on screen, so it is only partly to the right.
    const right = heard(AT_ORIGIN, RIGHT.rightX * PAN_WIDTH, RIGHT.rightZ * PAN_WIDTH, 30)
    expect(right.pan).toBeCloseTo(1, 5)

    const worldX = heard(AT_ORIGIN, PAN_WIDTH, 0, 30)
    expect(worldX.pan).toBeCloseTo(Math.SQRT1_2, 5)
  })

  it('puts the opposite side in the opposite ear', () => {
    const a = heard(AT_ORIGIN, 4, -4, 30)
    const b = heard(AT_ORIGIN, -4, 4, 30)
    expect(a.pan).toBeGreaterThan(0)
    expect(b.pan).toBeLessThan(0)
    expect(a.pan).toBeCloseTo(-b.pan, 6)
  })

  it('centres what is directly ahead or behind on screen', () => {
    // Perpendicular to the camera's right vector is up or down the screen.
    const up = heard(AT_ORIGIN, Math.SQRT1_2 * 5, Math.SQRT1_2 * 5, 30)
    expect(up.pan).toBeCloseTo(0, 6)
  })

  it('clamps the pan rather than running past the ears', () => {
    const miles = heard(AT_ORIGIN, RIGHT.rightX * 100, RIGHT.rightZ * 100, 400)
    expect(miles.pan).toBe(1)
  })

  it('is silent, and centred, outside the radius', () => {
    const out = heard(AT_ORIGIN, 30, 0, 12)
    expect(out.gain).toBe(0)
    expect(out.pan).toBe(0)
  })

  it('follows the listener rather than the origin', () => {
    const walked = { x: 20, z: 5, ...RIGHT }
    expect(heard(walked, 20, 5, 10).gain).toBe(1)
    expect(heard(walked, 0, 0, 10).gain).toBe(0)
  })
})

describe('hash01', () => {
  it('stays in range and repeats exactly', () => {
    for (let i = 0; i < 500; i++) {
      const v = hash01(i * 1.37)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      expect(hash01(i * 1.37)).toBe(v)
    }
  })

  it('does not correlate neighbouring inputs', () => {
    // Variation has to be a pure function of an index (CLAUDE.md bans
    // Math.random, and an Rng stream would be consumed at frame rate). That is
    // only useful if consecutive indices land somewhere different.
    let sum = 0
    for (let i = 0; i < 200; i++) sum += Math.abs(hash01(i) - hash01(i + 1))
    expect(sum / 200).toBeGreaterThan(0.2)
  })
})
