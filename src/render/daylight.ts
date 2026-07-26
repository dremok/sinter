/**
 * Time of day, as a pure function of the tick count.
 *
 * This exists because `after_dark` is a world fact the NPC layer already reads
 * and nothing could ever set: the gate guard opens with "Nobody through after
 * dark", so the first dialogue line written against that fact would have been a
 * free walk past the one real obstacle in the game.
 *
 * ## What varies, and what is not allowed to
 *
 * Three things move: the key light's ELEVATION, its COLOUR and intensity, and
 * its AZIMUTH within a bounded arc. The bound on the last one is the whole
 * reason this file is careful.
 *
 * **Azimuth is constrained by D9.** The sun must stay roughly perpendicular in
 * azimuth to the camera, or every shadow falls directly behind its own caster
 * and the frame reads as "shadows are broken". `IsoCamera.sunOffset` currently
 * enforces that exactly, by construction. A sun that swept a real 180 degrees
 * would pass through alignment with the camera twice a day and spend a good
 * part of the morning and evening looking broken.
 *
 * It does not follow that azimuth must be frozen. What D9 actually requires is
 * a MINIMUM separation, not a fixed one, so the sun may swing inside an arc
 * centred on perpendicular. At the limit below it is still 52 degrees off the
 * camera, which throws a shadow well clear of its caster, and the swing is what
 * makes the light read as travelling rather than as dimming in place.
 *
 * **Elevation is constrained by the toon ramp, and that constraint was the
 * harder one.** It has been lifted rather than obeyed: see `LIGHT_MARGIN` in
 * `toon.ts`. Against the old fixed band edges the usable range was about 40 to
 * 62 degrees, because flat ground sits at `sin(elevation)` and slides across
 * edges that do not move, which is exactly the blotching `camera.ts` records
 * from the one time the sun was lowered. With the ramp tracking the key, the
 * ground keeps the same relationship to the bands at every hour and elevation
 * is free. The floor below is about shadow quality, not about banding.
 *
 * ## Determinism
 *
 * Every value here is a function of `tick` alone. No wall clock, no `Date`, no
 * randomness. A seed plus a tick count must reproduce a frame exactly or the
 * screenshot workflow this project runs on stops meaning anything, and a day
 * cycle driven by elapsed real time would break every comparison in `.shots/`.
 */

import * as THREE from 'three'
import type { Band } from './palette'

/**
 * Ticks in one full day. At the fixed 60Hz tick this is ten minutes of play,
 * which is long enough that noon and dusk feel like different places to be and
 * short enough that a player who needs darkness does not have to wait for it.
 */
export const DAY_TICKS = 600

/**
 * Where tick 0 sits in the day. Mid-morning, so a new run opens in good light:
 * starting a game in the dark is a bad first impression and would also mean
 * every existing screenshot in `.shots/` came back as a night shot.
 */
export const DAY_START = 0.32

/** Sun above the horizon between these two points in the day. */
const SUNRISE = 0.14
const SUNSET = 0.86

/** Highest the sun gets, at noon. */
const PEAK_ELEVATION = 62 * (Math.PI / 180)

/**
 * Lowest the sun is allowed to get while still up.
 *
 * Not a banding limit any more: the ramp follows the key now. This is about the
 * shadow map. Shadow length goes as `1 / tan(elevation)`, so at 14 degrees a 6m
 * tree throws 24m, and below that the shadows outgrow the map's extent and go
 * soft and blocky before they go long.
 */
const MIN_SUN_ELEVATION = 14 * (Math.PI / 180)

/**
 * The moon sits high and does not move much. Moonlight that throws long dramatic
 * shadows reads as a second sun; what makes night read as night is that the key
 * is weak, cool and almost overhead, so shapes are lit but barely modelled.
 */
const MOON_ELEVATION = 54 * (Math.PI / 180)

/**
 * How far either side of perpendicular-to-camera the key may swing. See the
 * note above: at this limit the key is still 52 degrees off the camera azimuth.
 */
export const MAX_AZIMUTH_SWING = 38 * (Math.PI / 180)

/**
 * Half-width of the twilight cross-fade, in days. About twenty minutes of game
 * time either side of each horizon crossing, which is long enough to walk
 * across the clearing during and short enough that dusk feels like an event.
 */
const TWILIGHT = 0.035

export type Phase = 'night' | 'dawn' | 'day' | 'dusk'

export interface Sky {
  /** Position in the day, 0..1. */
  t: number
  phase: Phase
  /** The world fact. True while the sun is below the horizon. */
  afterDark: boolean
  /** Key light elevation above the horizon, radians. Always positive: at night
   *  this is the moon's. */
  elevation: number
  /** Key azimuth as an offset from perpendicular-to-camera, radians. */
  azimuth: number
  key: THREE.Color
  keyIntensity: number
  fill: THREE.Color
  fillIntensity: number
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemiIntensity: number
  /** Fog and background. */
  haze: THREE.Color
}

/** Position in the day for a tick. Pure, and the only place `tick` is read. */
export function timeOfDay(tick: number): number {
  const t = (DAY_START + tick / DAY_TICKS) % 1
  return t < 0 ? t + 1 : t
}

/** The tick at which a given time of day next occurs at or after tick 0. Exists
 *  for tests and for aiming a screenshot at an hour. */
export function tickForTimeOfDay(t: number): number {
  const delta = (((t - DAY_START) % 1) + 1) % 1
  return Math.round(delta * DAY_TICKS)
}

const smooth = (x: number): number => {
  const c = x < 0 ? 0 : x > 1 ? 1 : x
  return c * c * (3 - 2 * c)
}
const lerp = (a: number, b: number, x: number): number => a + (b - a) * x
/** Progress of `v` through `a`..`b`, clamped to 0..1. */
const span = (v: number, a: number, b: number): number => {
  const x = (v - a) / (b - a)
  return x < 0 ? 0 : x > 1 ? 1 : x
}

// Scratch colours, so a per-tick call allocates nothing.
const MOONLIGHT = new THREE.Color(0x8fa8cc)
const NIGHT_FILL = new THREE.Color(0x33507e)
const NIGHT_SKY = new THREE.Color(0x2b3a54)
const NIGHT_GROUND = new THREE.Color(0x1b2028)
const NIGHT_HAZE = new THREE.Color(0x1e2a3e)
/** Low sun. Air mass reddens it; this is what it reddens toward. */
const SUNSET_LIGHT = new THREE.Color(0xff7a3c)
const GOLDEN_LIGHT = new THREE.Color(0xffb066)
const DAY_FILL_TINT = new THREE.Color(0x3f6fc0)
const DUSK_HAZE = new THREE.Color(0xe8a074)

/**
 * The whole lighting state for a tick.
 *
 * `out` is reused by the caller, because this runs every tick and three's Color
 * objects are the kind of small allocation that turns into a frame hitch later.
 */
export function skyAt(tick: number, band: Band, out?: Sky): Sky {
  const t = timeOfDay(tick)
  const sky: Sky = out ?? {
    t: 0,
    phase: 'day',
    afterDark: false,
    elevation: 0,
    azimuth: 0,
    key: new THREE.Color(),
    keyIntensity: 0,
    fill: new THREE.Color(),
    fillIntensity: 0,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 0,
    haze: new THREE.Color(),
  }
  sky.t = t

  const up = t >= SUNRISE && t < SUNSET
  sky.afterDark = !up

  /**
   * How far inside daylight we are, in days: positive while the sun is up,
   * negative at night, zero exactly at a horizon crossing.
   *
   * Everything below is a continuous function of this. The first version of
   * this file branched on `up` and cross-faded only the day side, which left a
   * step at the crossing: measured, the key colour moved 0.179 in one tick and
   * the elevation jumped the full 40 degrees between the setting sun and the
   * moon. A step that size is a visible flash, and `verify:still` would have
   * been right to fail it. Branching on a boolean and then trying to smooth the
   * seam is the wrong shape; there is no seam if there is no branch.
   */
  const depth = up
    ? Math.min(t - SUNRISE, SUNSET - t)
    : -Math.min(t < SUNRISE ? SUNRISE - t : t - SUNSET, 1 - SUNSET + SUNRISE)

  /** 0 in full daylight, 1 in full night, half at the horizon. */
  const night = 1 - smooth(span(depth, -TWILIGHT, TWILIGHT))

  // The sun's own arc, floored so shadows never outgrow the map. Evaluated
  // even at night, where it simply sits at the floor, so that the blend below
  // has something continuous to start from.
  const day = span(t, SUNRISE, SUNSET)
  const sunElevation = up
    ? Math.max(MIN_SUN_ELEVATION, PEAK_ELEVATION * Math.sin(Math.PI * day))
    : MIN_SUN_ELEVATION
  sky.elevation = lerp(sunElevation, MOON_ELEVATION, night)

  // East to west while up, and back again overnight, so the sweep is
  // continuous across both crossings and across midnight.
  sky.azimuth = up
    ? lerp(-MAX_AZIMUTH_SWING, MAX_AZIMUTH_SWING, day)
    : lerp(
        MAX_AZIMUTH_SWING,
        -MAX_AZIMUTH_SWING,
        span(t < SUNRISE ? t + 1 - SUNSET : t - SUNSET, 0, 1 - SUNSET + SUNRISE),
      )

  // How low the sun is, 0 at noon and 1 on the horizon. Colour is driven by
  // this rather than by the clock, because it is elevation that decides how
  // much atmosphere the light has come through.
  const low = 1 - span(sunElevation, 0, PEAK_ELEVATION)

  sky.phase = night > 0.5 ? 'night' : low > 0.7 ? (t < 0.5 ? 'dawn' : 'dusk') : 'day'

  // Daylight, warmed toward gold and then hard toward sunset red in the last
  // stretch. Two steps rather than one, because the interesting part of the
  // change all happens in the final few degrees and a single lerp spreads it
  // over the whole afternoon.
  sky.key.set(band.sun)
  sky.key.lerp(GOLDEN_LIGHT, smooth(span(low, 0.25, 0.86)) * 0.62)
  sky.key.lerp(SUNSET_LIGHT, smooth(span(low, 0.82, 1)) * 0.7)
  sky.keyIntensity = lerp(3.6, 1.4, smooth(span(low, 0.55, 1)))
  sky.fill.set(band.skyLight).lerp(DAY_FILL_TINT, 0.72)
  sky.fillIntensity = lerp(1.0, 0.72, smooth(low))
  sky.hemiSky.set(band.skyLight)
  sky.hemiGround.set(band.groundLight)
  sky.hemiIntensity = lerp(0.78, 0.5, smooth(span(low, 0.5, 1)))
  sky.haze.set(band.sky).lerp(DUSK_HAZE, smooth(span(low, 0.55, 1)) * 0.55)

  // Then the whole arrangement crosses to night as one.
  if (night > 0) {
    sky.key.lerp(MOONLIGHT, night)
    sky.keyIntensity = lerp(sky.keyIntensity, 0.55, night)
    sky.fill.lerp(NIGHT_FILL, night)
    sky.fillIntensity = lerp(sky.fillIntensity, 0.34, night)
    sky.hemiSky.lerp(NIGHT_SKY, night)
    sky.hemiGround.lerp(NIGHT_GROUND, night)
    sky.hemiIntensity = lerp(sky.hemiIntensity, 0.34, night)
    sky.haze.lerp(NIGHT_HAZE, night)
  }

  return sky
}

/**
 * Where to put the key light, given the camera's own perpendicular offset.
 *
 * Takes `base` from `IsoCamera.sunOffset`, which is already perpendicular to the
 * camera at whatever angle it is currently at, and rotates it within the
 * permitted arc before tilting it to the elevation of the hour. Going through
 * the camera's own vector rather than building one from scratch is what keeps
 * D9 true at all four camera rotations for free.
 */
export function keyOffset(base: THREE.Vector3, sky: Sky, out: THREE.Vector3): THREE.Vector3 {
  const reach = Math.hypot(base.x, base.z)
  const dist = Math.hypot(reach, base.y)
  const a = Math.atan2(base.z, base.x) + sky.azimuth
  const horizontal = Math.cos(sky.elevation) * dist
  return out.set(Math.cos(a) * horizontal, Math.sin(sky.elevation) * dist, Math.sin(a) * horizontal)
}
