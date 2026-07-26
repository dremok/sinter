import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ContactShadow } from './toon'

/**
 * A contact shadow has one job: lie on the ground. The screenshot harness is
 * poor at checking it, because a sheet that cuts through a bank looks like a
 * dark smudge and so does a sheet that is lying there correctly. The geometry
 * is the honest test, and it is exact: after draping, every vertex's WORLD
 * height should equal the terrain height at that vertex's WORLD x,z.
 */

/** A ramp running purely along world +x, one metre of rise per metre. */
const rampX = (x: number, _z: number): number => x

/** Worst vertical disagreement between the draped sheet and the ground. */
function worstGap(cs: ContactShadow, sample: (x: number, z: number) => number): number {
  cs.mesh.updateMatrixWorld(true)
  const pos = cs.mesh.geometry.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  let worst = 0
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(cs.mesh.matrixWorld)
    worst = Math.max(worst, Math.abs(v.y - sample(v.x, v.z)))
  }
  return worst
}

describe('ContactShadow.drape', () => {
  it('lies on a slope when its parent is unrotated', () => {
    const cs = new ContactShadow(0.6)
    const group = new THREE.Group()
    group.add(cs.mesh)
    group.updateMatrixWorld(true)

    cs.drape(0, 0, 0, rampX)

    // CONTACT_LIFT floats it 25mm, which is the whole tolerance.
    expect(worstGap(cs, rampX)).toBeLessThan(0.03)
  })

  /**
   * The regression this file exists for.
   *
   * The player's blob is parented to the character group, and that group sets
   * `rotation.y` to the heading. `drape` reads LOCAL vertex offsets and sampled
   * the terrain as though they were world offsets, so the height field it laid
   * on the sheet was rotated by the player's facing. Facing along +x it was
   * right; facing along +z the sheet tilted across the slope instead of down
   * it, so half of it sank into the bank and half stood proud of it, and it
   * counter-rotated as the player turned.
   *
   * That is the same defect the class was written to fix, arriving by a second
   * route: a sheet cutting through a bank reads as a dark hole with the player
   * standing in it.
   */
  it('lies on a slope at every heading, not just the one it was built at', () => {
    for (let step = 0; step < 8; step++) {
      const facing = (step / 8) * Math.PI * 2
      const cs = new ContactShadow(0.6)
      const group = new THREE.Group()
      group.rotation.y = facing
      group.add(cs.mesh)
      group.updateMatrixWorld(true)

      cs.drape(0, 0, 0, rampX)

      expect(worstGap(cs, rampX), `heading ${Math.round((facing * 180) / Math.PI)} degrees`).toBeLessThan(0.03)
    }
  })
})
