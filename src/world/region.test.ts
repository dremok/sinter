/**
 * Occlusion geometry.
 *
 * This exists because `occluderHides` has already been deleted and restored
 * once, has no other guard, and fails silently: nothing crashes when it breaks,
 * things merely fade at the wrong moments, which is noticed only by whoever
 * happens to be standing in the wrong place. A screenshot catches that whenever
 * someone next looks; a test catches it at the moment of breakage.
 *
 * The three cases below are the three that have actually gone wrong.
 *
 * Everything is projected through a REAL camera rather than hand-written view
 * coordinates, so the test exercises the same transform the game does. A test
 * that restated the maths in its own terms would agree with a broken
 * implementation as happily as with a correct one.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { occluderHides, type OccluderInView, type TargetInView } from './region'

/**
 * The rig from `IsoCamera` at its only azimuth: orthographic, looking at the
 * target from (1,1,1). Camera rotation is unbound, so this is the projection
 * the player actually gets.
 */
function isoCameraAt(target: THREE.Vector3): THREE.Camera {
  const camera = new THREE.OrthographicCamera(-12, 12, 7, -7, 0.1, 500)
  const dir = new THREE.Vector3(1, 1, 1).normalize()
  camera.position.copy(target).addScaledVector(dir, 60)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)
  return camera
}

/** World point -> the view-space numbers the occlusion test works in. */
function toView(camera: THREE.Camera, x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse)
}

interface Case {
  /** Ground position of the thing that might be hiding the player. */
  occluder: { x: number; z: number; radius: number; top: number; pinned?: boolean }
  /** Ground position of the player. */
  player: { x: number; z: number }
}

function hides({ occluder, player }: Case): boolean {
  const at = new THREE.Vector3(player.x, 0, player.z)
  const camera = isoCameraAt(at)

  const o = toView(camera, occluder.x, 0, occluder.z)
  const t = toView(camera, player.x, 0, player.z)

  const inView: OccluderInView = {
    x: o.x,
    y: o.y,
    z: o.z,
    radius: occluder.radius,
    top: occluder.top,
    pinned: occluder.pinned,
  }
  const target: TargetInView = { x: t.x, y: t.y, z: t.z, row: 0.72 }
  return occluderHides(inView, [target])
}

/** The palisade gate: 3.9 metres tall, standing on the track at z = -8. */
const GATE = { x: 0, z: -8, radius: 1.8, top: 3.9 }
/** The old oak: the tallest thing in the clearing and the usual offender. */
const OAK = { x: 10.6, z: 8.8, radius: 3.0, top: 9.7 }

describe('occluderHides', () => {
  it('leaves the gate solid when the player is standing in front of it', () => {
    // Max's original report, and the case the projection fix was written for.
    // "In front of" means nearer the camera, which under this rig is greater
    // x + z. The old test added half the object's height to its depth without
    // also requiring that height to be the part covering the player, so the
    // gate earned a metre of slack purely for being tall.
    expect(hides({ occluder: GATE, player: { x: 0, z: -6.8 } })).toBe(false)
  })

  it('leaves the gate solid even from immediately in front of it', () => {
    // The failure got worse the closer you stood, so the boundary is the
    // interesting part rather than a comfortable distance.
    expect(hides({ occluder: GATE, player: { x: 0, z: -7.2 } })).toBe(false)
  })

  it('hides the player when something tall is genuinely between them and the camera', () => {
    // Without this, an implementation that never fades anything passes every
    // other test in the file.
    expect(hides({ occluder: OAK, player: { x: 8.0, z: 6.2 } })).toBe(true)
  })

  it('never hides behind a pinned landmark, even when it genuinely occludes', () => {
    // The pin is what stops the thing you are walking toward dissolving as you
    // approach it, which D20 makes load-bearing: with no quest markers, a
    // landmark that disappears takes the only guidance with it.
    const occluding = { ...OAK, pinned: true }
    expect(hides({ occluder: OAK, player: { x: 8.0, z: 6.2 } })).toBe(true)
    expect(hides({ occluder: occluding, player: { x: 8.0, z: 6.2 } })).toBe(false)
  })

  it('ignores an occluder the player is standing beside rather than behind', () => {
    // Sideways clearance. The centre of the target has to be inside the
    // silhouette; clipping a shoulder is not hiding anyone.
    expect(hides({ occluder: OAK, player: { x: 16.0, z: 8.8 } })).toBe(false)
  })

  it('ignores something too short to cover the player at all', () => {
    const stump = { x: 10.6, z: 8.8, radius: 3.0, top: 0.4 }
    expect(hides({ occluder: stump, player: { x: 8.0, z: 6.2 } })).toBe(false)
  })
})
