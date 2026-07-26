/**
 * Where a sound is, relative to the person listening.
 *
 * Pure maths, no AudioContext, so it can be tested in node and so the rest of
 * the audio layer has nothing to reason about but nodes and gain.
 *
 * THE LISTENER IS THE PLAYER, NOT THE CAMERA. This is the audio version of the
 * fog trap in D9 and it fails the same way: under an orthographic rig every
 * object sits roughly `IsoCamera.distance` deep, so a listener placed at the
 * camera hears the hearth and the mill at almost exactly the same volume and
 * the whole scene turns into one flat wash. Distance is measured on the ground
 * plane from the player.
 *
 * Panning is the other half and it goes the other way: the player has no ears
 * and no facing that the screen agrees with, but the SCREEN has a left and a
 * right, and that is what a player checks a stereo image against. So pan is the
 * offset projected onto the camera's own right vector, which is the same basis
 * `iso.screenBasis()` hands the movement keys. Rotate the camera and the mill
 * moves to the other ear, which is correct and comes out for free.
 *
 * Nothing here uses a PannerNode. A PannerNode would want a listener position
 * and orientation in the same 3D space as the emitters, which is exactly the
 * arrangement the paragraph above says is wrong, and it would hide the mistake
 * inside a node instead of in twelve lines that can be asserted against.
 */

/** The player, plus which way "right" is on screen. */
export interface Ears {
  x: number
  z: number
  /** Camera right vector on the ground plane, normalised. From `screenBasis()`. */
  rightX: number
  rightZ: number
}

export interface Heard {
  /** 0 to 1. Zero means far enough away to not be worth a node. */
  gain: number
  /** -1 hard left to +1 hard right. */
  pan: number
}

/**
 * How wide the stereo field is, in metres.
 *
 * A sound this far to the side of the player is panned fully to that ear.
 * Deliberately small relative to the region: the clearing is 56m across and a
 * fire eight metres to your left should already be clearly on the left.
 */
export const PAN_WIDTH = 7

const SILENT: Heard = { gain: 0, pan: 0 }

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Rolloff.
 *
 * `(1 - d/radius)^2` rather than the usual inverse-distance law, for one
 * practical reason: inverse distance never reaches zero, so every emitter in
 * the region keeps a live node forever and the mixer slowly fills up with
 * inaudible fires. This reaches exactly zero at `radius`, which makes "far
 * enough away to stop paying for it" a fact rather than a threshold somebody
 * picked. Squared so the near field still dominates, which is what an inverse
 * law was buying.
 */
export function rolloff(distance: number, radius: number): number {
  if (radius <= 0 || distance >= radius) return 0
  const t = 1 - distance / radius
  return t * t
}

/** What the player hears from a thing at (x, z), given a radius in metres. */
export function heard(ears: Ears, x: number, z: number, radius: number): Heard {
  const dx = x - ears.x
  const dz = z - ears.z
  const d = Math.hypot(dx, dz)
  const gain = rolloff(d, radius)
  if (gain <= 0) return SILENT
  // Along the camera's right vector, so "right" means right on screen.
  const side = dx * ears.rightX + dz * ears.rightZ
  return { gain, pan: clamp(side / PAN_WIDTH, -1, 1) }
}

/**
 * Deterministic 0..1 noise, the same shape as the one in `render/flame.ts` and
 * for the same reason.
 *
 * Math.random is banned (CLAUDE.md) and the seeded Rng in `core/rng.ts` is the
 * wrong tool here as well: an Rng is a stream, and how far a stream has been
 * consumed would depend on how many footsteps happened to be played at a given
 * frame rate. A pure function of the step index cannot desync anything, because
 * it has no state to desync.
 */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
