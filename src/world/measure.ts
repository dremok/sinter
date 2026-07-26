/**
 * Measure a built object's collision from the object.
 *
 * WHY. Every blocker in this region used to be a handful of numbers typed next
 * to the mesh: "the barn is 9 by 4, turned 0.34". Those numbers are a SECOND
 * description of the building, and a second description drifts. The cottage
 * grew a chimney standing 0.53m proud of its west wall and the footprint did
 * not, so the player walked through a stone stack; the woodpile's collision was
 * hung off whichever upright happened to be built last and sat 1.9m outside
 * anything visible; the gate was 0.35m deep and blocked 1.9m.
 *
 * There is nothing to type here. The footprint is the extent of the geometry
 * that is actually in the player's way, and it is measured from the meshes, so
 * it cannot be wrong about them. Add a porch, a buttress, a chimney, a lean-to
 * and the collision knows on the same frame.
 *
 * WHAT COUNTS AS IN THE WAY is a height band, not the whole object. A tree's
 * canopy hangs several metres past its trunk and you walk under it. A roof
 * overhangs its walls. A cellar hatch is underfoot. Only what stands between
 * the player's knee and their shoulder can stop them, so only that is measured.
 */

import * as THREE from 'three'
import { box, type Footprint } from '../core/footprint'

/**
 * The slice of the world that can stop a walking player, relative to the
 * object's own base.
 *
 * KNEE is above a doorstep and a laid plank; both are things you step over
 * rather than walk into. SHOULDER is below a thatched eave and below any
 * canopy worth having.
 */
export const KNEE = 0.22
export const SHOULDER = 1.5

const localBox = new THREE.Box3()
const childBox = new THREE.Box3()
const toLocal = new THREE.Matrix4()
const inverse = new THREE.Matrix4()

/**
 * Bounding box of everything in the player's band, in the object's OWN frame.
 *
 * The object's frame rather than the world's, because the axis-aligned world
 * box of a building turned 0.34 radians is most of a metre larger than the
 * building on every side, and collision that big is an invisible wall of
 * exactly the kind this file exists to prevent.
 *
 * Empty if nothing at all is in the band.
 */
export function bandBounds(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true)
  inverse.copy(object.matrixWorld).invert()
  localBox.makeEmpty()

  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    // Outline shells are the same geometry pushed outward along its normals.
    // They are decoration, they are added after the footprints are measured,
    // and counting them makes every object read as slightly larger than the
    // collision that was correctly derived from it.
    if (mesh.userData.noCollide || mesh.userData.outlineHull) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    childBox.copy(mesh.geometry.boundingBox!)
    toLocal.multiplyMatrices(inverse, mesh.matrixWorld)
    childBox.applyMatrix4(toLocal)
    if (childBox.max.y < KNEE || childBox.min.y > SHOULDER) return
    localBox.union(childBox)
  })

  return localBox
}

/**
 * The footprint of a built object, measured from it.
 *
 * `turn` comes from the object's own `rotation.y`, so the collision is always
 * turned exactly as far as the thing it belongs to.
 */
export function footprintOf(object: THREE.Object3D): Footprint | null {
  const b = bandBounds(object)
  if (b.isEmpty()) return null

  const turn = object.rotation.y
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  const lx = (b.min.x + b.max.x) / 2
  const lz = (b.min.z + b.max.z) / 2

  // The object's own frame back out to the world. Position only: these are all
  // unscaled top-level groups, and a scaled building would need the matrix.
  return box(
    object.position.x + lx * c + lz * s,
    object.position.z - lx * s + lz * c,
    (b.max.x - b.min.x) / 2,
    (b.max.z - b.min.z) / 2,
    turn,
  )
}

/**
 * How far the object's player-band geometry sticks out past a footprint.
 *
 * Zero means everything you can walk into is covered. This is the check the
 * chimney failed, and it is the half that a "collision must not exceed the
 * mesh" check cannot see: that one catches invisible walls, this one catches
 * visible things you walk through.
 */
export function overhang(object: THREE.Object3D, f: Footprint): number {
  const b = bandBounds(object)
  if (b.isEmpty()) return 0

  const turn = object.rotation.y
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  const lx = (b.min.x + b.max.x) / 2
  const lz = (b.min.z + b.max.z) / 2
  const cx = object.position.x + lx * c + lz * s
  const cz = object.position.z - lx * s + lz * c
  const hx = (b.max.x - b.min.x) / 2
  const hz = (b.max.z - b.min.z) / 2

  // A circular blocker belongs to something round, and the corners of a round
  // thing's bounding box are empty air. Comparing them to the radius reports a
  // leak of 0.41r on every tree in the world, which is a fact about boxes
  // rather than about the trees.
  if (f.hx === 0 && f.hz === 0) {
    return Math.hypot(cx - f.x, cz - f.z) + Math.max(hx, hz) - f.r
  }

  const fc = Math.cos(f.ry)
  const fs = Math.sin(f.ry)
  let worst = 0
  for (const ox of [-hx, hx]) {
    for (const oz of [-hz, hz]) {
      const dx = cx + ox * c + oz * s - f.x
      const dz = cz - ox * s + oz * c - f.z
      const px = Math.abs(fc * dx - fs * dz) - f.hx - f.r
      const pz = Math.abs(fs * dx + fc * dz) - f.hz - f.r
      worst = Math.max(worst, Math.min(px, pz) > 0 ? Math.hypot(px, pz) : Math.max(px, pz))
    }
  }
  return worst
}
