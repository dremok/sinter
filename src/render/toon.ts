/**
 * Cel shading and the pixel buffer. Between them these are most of the reason
 * the game reads as a 16-bit console game rather than as untextured low-poly.
 *
 * Two ideas, both cheap:
 *
 * 1. Every surface uses MeshToonMaterial against a 3-step gradient ramp, so
 *    lighting lands in three flat bands instead of a smooth falloff. Smooth
 *    shading is what made the first pass look like grey plastic.
 *
 * 2. The whole scene renders into a buffer about 240 lines tall and is then
 *    upscaled to the window with nearest-neighbour filtering, which is done in
 *    CSS rather than with a post-processing pass. Chunky pixels are extremely
 *    forgiving of coarse geometry: the same trees that looked crude at 1080p
 *    read as deliberate sprite work at 240p.
 */

import * as THREE from 'three'

/**
 * Vertical resolution of the internal buffer.
 *
 * Raised twice on playtest feedback: 240 was unreadable, 400 was still too
 * soft. At 720 the upscale to a 1080p display is 1.5x, which keeps edges hard
 * and the hand-drawn textures legible without the frame reading as pixellated.
 * The look now comes from the textures and the cel ramp rather than from
 * throwing resolution away.
 */
export const PIXEL_HEIGHT = 720

let ramp: THREE.DataTexture | null = null

/**
 * A 3-band lighting ramp. The steps are deliberately uneven: a wide lit band, a
 * narrow mid tone, and a deep shadow, which is how hand-painted sprite work
 * tends to distribute its values.
 */
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp
  const steps = new Uint8Array([70, 150, 255])
  ramp = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat)
  ramp.minFilter = THREE.NearestFilter
  ramp.magFilter = THREE.NearestFilter
  ramp.generateMipmaps = false
  ramp.needsUpdate = true
  return ramp
}

const cache = new Map<number, THREE.MeshToonMaterial>()

/** Shared cel-shaded material for a colour. */
export function toon(color: number): THREE.MeshToonMaterial {
  const hit = cache.get(color)
  if (hit) return hit
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() })
  cache.set(color, m)
  return m
}

/** A one-off cel-shaded material, for anything that needs its own uniforms. */
export function toonUnique(params: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...params })
}

/**
 * Size the drawing buffer to ~PIXEL_HEIGHT lines while leaving the CSS size
 * alone, so the browser scales it up. `false` for `updateStyle` is the whole
 * trick; without it three.js overwrites the CSS size and the pixellation
 * disappears.
 */
export function sizeToPixelBuffer(renderer: THREE.WebGLRenderer, w: number, h: number): void {
  const aspect = w / h
  const bufferH = PIXEL_HEIGHT
  const bufferW = Math.round(bufferH * aspect)
  renderer.setPixelRatio(1)
  renderer.setSize(bufferW, bufferH, false)
}
