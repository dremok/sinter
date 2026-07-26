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
import { PLAYER_RADIUS } from '../core/body'
import {
  BOUNDS,
  GROUND_SIZE,
  PALISADE,
  moorEdge,
  occluderHides,
  type OccluderInView,
  type TargetInView,
} from './region'

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

/**
 * The palisade run against the gate it meets.
 *
 * This is the cheap half of the buried-geometry problem: two structures laid
 * down independently that turned out to occupy the same space. The expensive
 * half is that `fail` strips a felled thing's blocker, so a buried destructible
 * is load-bearing for whatever it is buried in, and chopping it opens a hole
 * through something still standing. Asserting the layout catches that here
 * rather than when a player happens to swing an axe at it.
 */
describe('palisade layout', () => {
  const posts = PALISADE.posts()

  it('puts no post inside the gate pillars', () => {
    // The whole bug in one line. A post whose body reaches into a pillar is
    // invisible from every angle and destructible from all of them.
    const pillarInner = PALISADE.pillarAt - PALISADE.pillarRadius
    const pillarOuter = PALISADE.pillarAt + PALISADE.pillarRadius
    for (const x of posts) {
      const near = Math.abs(x) - PALISADE.postGirth
      const far = Math.abs(x) + PALISADE.postGirth
      const overlaps = near < pillarOuter && far > pillarInner
      expect(overlaps, `post at ${x} overlaps a gate pillar`).toBe(false)
    }
  })

  it('leaves no gap between the gate and the first post on either side', () => {
    // The other failure mode of the same fix. Move the run clear of the pillars
    // without widening the gate's own blocker and the seam becomes a doorway.
    const first = Math.min(...posts.map(Math.abs))
    expect(first - PALISADE.postRadius).toBeLessThan(PALISADE.gateHalf)
  })

  it('leaves no gap between neighbouring posts', () => {
    const side = posts.filter((x) => x > 0).sort((a, b) => a - b)
    for (let i = 1; i < side.length; i++) {
      expect(side[i]! - side[i - 1]!).toBeLessThan(PALISADE.postRadius * 2)
    }
  })

  it('has a gate blocker wide enough to cover both pillars', () => {
    // Nothing else may be load-bearing for the gate. If this shrinks below the
    // pillars, their collision silently becomes the first post's again.
    expect(PALISADE.gateHalf).toBeGreaterThanOrEqual(PALISADE.pillarAt + PALISADE.pillarRadius)
  })

  it('runs the wall past both edges of the region', () => {
    // The failure this catches is invisible to every other check in the repo.
    // `verify:collision` asks whether there is a gap WITHIN the run of rocks
    // that seals each end of the palisade, and a run that simply stops early
    // has no gap in it at all: it has open ground beyond it. The reach used to
    // be a hardcoded 29.5 on both sides, which was right for one pair of bounds
    // and became a walk-around the moment the region grew east.
    //
    // Half a player clear of the edge, because the clamp in main.ts stops them
    // AT the bound and a wall that ends exactly there leaves a body's width.
    expect(PALISADE.spurTo(1)).toBeGreaterThan(BOUNDS.maxX + PLAYER_RADIUS)
    expect(PALISADE.spurTo(-1)).toBeGreaterThan(-BOUNDS.minX + PLAYER_RADIUS)
  })
})

/**
 * The region against the ground it is drawn on, and against itself.
 *
 * These are the invariants that broke while the region was being widened, and
 * none of them is visible to `npm run typecheck`, to `verify:collision`, or to
 * a screenshot taken anywhere except the one place the fault happens to be.
 */
describe('region bounds', () => {
  it('leaves the terrain mesh wider than anything visible from inside', () => {
    // The tree line is laid at the bounds plus about ten metres of depth, and
    // the camera sees a good way past the player, so the heightfield has to
    // reach further than either. Doubling the bounds and forgetting this puts a
    // literal edge of the world in shot.
    const reach = Math.max(-BOUNDS.minX, BOUNDS.maxX, -BOUNDS.minZ, BOUNDS.maxZ)
    expect(reach + 24).toBeLessThan(GROUND_SIZE / 2)
  })

  it('never starts the moor on the near side of the wall', () => {
    // The far side is a different ground, and the whole point of it being a
    // different ground is that the palisade is what separates them. Moor
    // showing INSIDE the clearing says the world changed before the player got
    // past the obstacle, which is the one statement the wall exists to make.
    //
    // The number is the contract `moorEdge` promises, not a value read off the
    // curve: the wall is at z = -8 and the edge stays a metre and a half clear
    // of it. Today's amplitudes satisfy that on their own and the clamp inside
    // the function never fires; asserting the promise rather than the curve is
    // what makes widening the wobble fail here instead of in a screenshot.
    for (let x = BOUNDS.minX - 6; x <= BOUNDS.maxX + 6; x += 0.25) {
      expect(moorEdge(x), `moor reaches z = ${moorEdge(x)} at x = ${x}`).toBeLessThanOrEqual(-9.5)
    }
  })

  it('keeps the moor edge inside the region it is drawn over', () => {
    // The other end of the same curve. An edge below minZ means a column of the
    // sheet is inverted, which draws a strip of moor with its winding reversed.
    for (let x = BOUNDS.minX - 6; x <= BOUNDS.maxX + 6; x += 0.25) {
      expect(moorEdge(x)).toBeGreaterThan(BOUNDS.minZ + 4)
    }
  })
})
