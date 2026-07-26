import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BAND0, BAND1 } from './palette'
import {
  DAY_TICKS,
  MAX_AZIMUTH_SWING,
  keyOffset,
  skyAt,
  tickForTimeOfDay,
  timeOfDay,
  type Sky,
} from './daylight'

/** Every tick of one day, coarsely. */
const DAY = Array.from({ length: 360 }, (_, i) => Math.round((i / 360) * DAY_TICKS))

describe('determinism', () => {
  /**
   * The rule the whole screenshot workflow rests on. A day cycle driven by
   * elapsed real time would make a seed stop reproducing a run, and every
   * before/after comparison in this repo would silently stop being a
   * comparison.
   */
  it('is a pure function of the tick', () => {
    for (const tick of DAY) {
      const a = skyAt(tick, BAND0)
      const b = skyAt(tick, BAND0)
      expect(a.t).toBe(b.t)
      expect(a.elevation).toBe(b.elevation)
      expect(a.azimuth).toBe(b.azimuth)
      expect(a.keyIntensity).toBe(b.keyIntensity)
      expect(a.key.getHex()).toBe(b.key.getHex())
    }
  })

  it('repeats exactly one day later', () => {
    for (const tick of DAY.slice(0, 40)) {
      expect(timeOfDay(tick + DAY_TICKS)).toBeCloseTo(timeOfDay(tick), 10)
    }
  })

  it('starts in daylight, not in the dark', () => {
    expect(skyAt(0, BAND0).afterDark).toBe(false)
    expect(skyAt(0, BAND0).phase).toBe('day')
  })

  it('round-trips a time of day back to a tick', () => {
    for (const t of [0.05, 0.32, 0.5, 0.87, 0.99]) {
      expect(timeOfDay(tickForTimeOfDay(t))).toBeCloseTo(t, 3)
    }
  })
})

describe('D9: the sun may not hide behind its own casters', () => {
  /**
   * Recorded in `docs/DECISIONS.md` because it cost a debugging cycle and looks
   * like a bug rather than a setup mistake. `IsoCamera.sunOffset` returns a
   * vector already perpendicular to the camera, so the only way this cycle can
   * violate D9 is by swinging too far off it.
   */
  it('never brings the key within 50 degrees of the camera azimuth', () => {
    // The camera looks along (1,1,1) at azimuth index 0; sunOffset is the
    // perpendicular to that. All four rotations are the same problem rotated,
    // so testing one is testing all of them.
    for (const camera of [
      new THREE.Vector3(1, 1, 1),
      new THREE.Vector3(-1, 1, 1),
      new THREE.Vector3(-1, 1, -1),
      new THREE.Vector3(1, 1, -1),
    ]) {
      camera.normalize()
      const h = Math.hypot(camera.x, camera.z)
      const base = new THREE.Vector3((camera.z / h) * 42, 40, (-camera.x / h) * 42)
      const cameraAzimuth = Math.atan2(camera.z, camera.x)
      const out = new THREE.Vector3()

      for (const tick of DAY) {
        keyOffset(base, skyAt(tick, BAND0), out)
        const keyAzimuth = Math.atan2(out.z, out.x)
        let d = Math.abs(keyAzimuth - cameraAzimuth)
        while (d > Math.PI) d = Math.abs(d - 2 * Math.PI)
        const degrees = (d * 180) / Math.PI
        expect(degrees, `tick ${tick}`).toBeGreaterThan(50)
        expect(degrees, `tick ${tick}`).toBeLessThan(130)
      }
    }
  })

  it('keeps the swing inside the declared arc', () => {
    for (const tick of DAY) {
      expect(Math.abs(skyAt(tick, BAND0).azimuth)).toBeLessThanOrEqual(MAX_AZIMUTH_SWING + 1e-9)
    }
  })

  /** The key must stay above the horizon as a light even when the sun is not:
   *  a directional light from below lights the undersides of everything. */
  it('never puts the key below the horizon', () => {
    const out = new THREE.Vector3()
    const base = new THREE.Vector3(42, 40, 0)
    for (const tick of DAY) {
      const sky = skyAt(tick, BAND0)
      expect(sky.elevation, `tick ${tick}`).toBeGreaterThan(0)
      keyOffset(base, sky, out)
      expect(out.y, `tick ${tick}`).toBeGreaterThan(0)
    }
  })

  /** `keyOffset` may rotate and tilt the rig's vector but not rescale it, or
   *  the shadow camera's near/far bracket stops matching the light's distance. */
  it('preserves the rig distance', () => {
    const base = new THREE.Vector3(42, 40, 0)
    const want = base.length()
    const out = new THREE.Vector3()
    for (const tick of DAY) {
      keyOffset(base, skyAt(tick, BAND0), out)
      expect(out.length()).toBeCloseTo(want, 6)
    }
  })
})

describe('the day itself', () => {
  it('has a real night that after_dark can key off', () => {
    const dark = DAY.filter((tick) => skyAt(tick, BAND0).afterDark)
    expect(dark.length).toBeGreaterThan(DAY.length * 0.2)
    expect(dark.length).toBeLessThan(DAY.length * 0.4)
  })

  it('reaches every phase', () => {
    const seen = new Set(DAY.map((tick) => skyAt(tick, BAND0).phase))
    expect([...seen].sort()).toEqual(['dawn', 'dusk', 'day', 'night'].sort())
  })

  it('is brightest around noon and darkest at night', () => {
    const noon = skyAt(tickForTimeOfDay(0.5), BAND0)
    const midnight = skyAt(tickForTimeOfDay(0.0), BAND0)
    const dusk = skyAt(tickForTimeOfDay(0.84), BAND0)
    expect(noon.keyIntensity).toBeGreaterThan(dusk.keyIntensity)
    expect(dusk.keyIntensity).toBeGreaterThan(midnight.keyIntensity)
    expect(noon.elevation).toBeGreaterThan(dusk.elevation)
  })

  /** Air mass reddens a low sun. The frame's whole sense of an hour comes from
   *  this, so it is worth asserting rather than trusting. */
  it('reddens the key as the sun drops', () => {
    const noon = skyAt(tickForTimeOfDay(0.5), BAND0).key.clone()
    const dusk = skyAt(tickForTimeOfDay(0.84), BAND0).key.clone()
    expect(dusk.r / dusk.b).toBeGreaterThan(noon.r / noon.b)
  })

  /** Nothing may jump: a step in the key between adjacent ticks is a visible
   *  flash, and `verify:still` would rightly fail it. */
  it('moves smoothly across every tick boundary, including midnight', () => {
    let worstColor = 0
    let worstElevation = 0
    let prev = skyAt(0, BAND0)
    let prevKey = prev.key.clone()
    for (let tick = 1; tick <= DAY_TICKS; tick += 7) {
      const now = skyAt(tick, BAND0)
      worstColor = Math.max(
        worstColor,
        Math.abs(now.key.r - prevKey.r) + Math.abs(now.key.g - prevKey.g) + Math.abs(now.key.b - prevKey.b),
      )
      worstElevation = Math.max(worstElevation, Math.abs(now.elevation - prev.elevation))
      prevKey = now.key.clone()
      prev = { ...now }
      // eslint-disable-next-line no-self-assign
      prev.elevation = now.elevation
    }
    // Over 7 ticks (~0.12s) nothing should move perceptibly.
    expect(worstColor).toBeLessThan(0.02)
    expect(worstElevation).toBeLessThan(0.01)
  })
})

describe('bands', () => {
  it('carries the band own light colour through the day', () => {
    const noon0 = skyAt(tickForTimeOfDay(0.5), BAND0).key.clone()
    const noon1 = skyAt(tickForTimeOfDay(0.5), BAND1).key.clone()
    // BAND1's sun is drained; its noon key must not come out warmer than BAND0's.
    expect(noon1.r / noon1.b).toBeLessThan(noon0.r / noon0.b)
  })

  it('reuses the caller buffer without allocating', () => {
    const buf = skyAt(0, BAND0)
    const again = skyAt(1200, BAND0, buf)
    expect(again).toBe(buf)
  })
})

describe('Sky shape', () => {
  it('exposes everything main.ts needs', () => {
    const sky: Sky = skyAt(0, BAND0)
    for (const key of [
      't',
      'phase',
      'afterDark',
      'elevation',
      'azimuth',
      'keyIntensity',
      'fillIntensity',
      'hemiIntensity',
    ] as const) {
      expect(sky[key], key).toBeDefined()
    }
  })
})
