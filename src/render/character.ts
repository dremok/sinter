/**
 * The player character.
 *
 * Was a white capsule with a cone stuck to it, which is why it "looked like
 * nothing". This is a blocky humanoid with a head, tunic, arms and legs, built
 * from boxes so it stays crisp once the frame is pixellated. Round shapes lose
 * their silhouette at 240p; flat planes and hard corners survive.
 *
 * The walk cycle is a single phase value driving opposed limb swings plus a
 * two-per-step vertical bob, which is the minimum that reads as walking. The
 * body also leans very slightly into the direction of travel, which does more
 * for the sense of weight than any amount of extra geometry.
 */

import * as THREE from 'three'
import { BAND0 } from './palette'
import { toon } from './toon'

const box = (w: number, h: number, d: number, color: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color))
  m.castShadow = true
  return m
}

export class Character {
  readonly group = new THREE.Group()

  private leftLeg = new THREE.Group()
  private rightLeg = new THREE.Group()
  private leftArm = new THREE.Group()
  private rightArm = new THREE.Group()
  private body = new THREE.Group()

  /** Accumulated walk phase, in radians. */
  private phase = 0
  /** Facing, in radians, lerped toward the direction of travel. */
  private facing = 0

  constructor() {
    // Legs hang from hip height and rotate about their top, so the pivot has to
    // sit at the hip rather than at the centre of the limb.
    const legGeoY = -0.22
    for (const [pivot, dx] of [
      [this.leftLeg, -0.11],
      [this.rightLeg, 0.11],
    ] as const) {
      const limb = box(0.16, 0.44, 0.16, BAND0.trouser)
      limb.position.y = legGeoY
      pivot.add(limb)
      pivot.position.set(dx, 0.46, 0)
      this.body.add(pivot)
    }

    for (const [pivot, dx] of [
      [this.leftArm, -0.26],
      [this.rightArm, 0.26],
    ] as const) {
      const limb = box(0.12, 0.38, 0.12, BAND0.skin)
      limb.position.y = -0.19
      pivot.add(limb)
      pivot.position.set(dx, 0.82, 0)
      this.body.add(pivot)
    }

    const torso = box(0.46, 0.42, 0.28, BAND0.tunic)
    torso.position.y = 0.67
    this.body.add(torso)

    const head = box(0.34, 0.32, 0.32, BAND0.skin)
    head.position.y = 1.04
    this.body.add(head)

    // Hair as a slab on top and a fringe at the front, which gives the head a
    // front and therefore makes facing readable without a face.
    const hair = box(0.37, 0.12, 0.35, BAND0.hair)
    hair.position.y = 1.19
    this.body.add(hair)
    const fringe = box(0.37, 0.12, 0.06, BAND0.hair)
    fringe.position.set(0, 1.06, -0.16)
    this.body.add(fringe)

    this.group.add(this.body)
  }

  /**
   * @param speed01 how fast the character is moving, normalised to its top speed
   * @param heading direction of travel in radians, ignored when standing still
   */
  update(dt: number, speed01: number, heading: number | null): void {
    if (heading !== null) {
      // Shortest-arc turn, so crossing the -pi/pi seam does not spin the model
      // all the way around.
      let delta = heading - this.facing
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      this.facing += delta * Math.min(1, dt * 14)
    }
    this.group.rotation.y = this.facing

    this.phase += dt * (4 + speed01 * 7) * (speed01 > 0.01 ? 1 : 0.25)

    const swing = Math.sin(this.phase) * (0.15 + speed01 * 0.75)
    this.leftLeg.rotation.x = swing
    this.rightLeg.rotation.x = -swing
    this.leftArm.rotation.x = -swing * 0.8
    this.rightArm.rotation.x = swing * 0.8

    // Two bobs per stride, and a breathing idle when standing.
    const bob = speed01 > 0.01 ? Math.abs(Math.cos(this.phase)) * 0.07 * speed01 : Math.sin(this.phase) * 0.012
    this.body.position.y = bob
    this.body.rotation.x = speed01 * 0.12
  }
}
