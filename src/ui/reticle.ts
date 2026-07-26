import * as THREE from 'three'
import type { Landing } from '../items/interactions'

/**
 * The aim reticle for thrown things.
 *
 * A11 asks for this in one line: "Projected items need an aim affordance. On an
 * isometric camera the cheapest honest one is a ground reticle under the cursor
 * with an arc preview." Before this, throwing went straight ahead at a fixed
 * range with nothing on screen, so the player could only find out where a flask
 * would land by losing the flask.
 *
 * It lives in the scene rather than in the DOM, and that is the whole reason it
 * is a Three.js object in a folder full of markup. A throw is a claim about a
 * place in the world, so the affordance has to be occluded by the wall you are
 * throwing over, has to sit on the slope it lands on, and has to shrink when
 * you zoom out. An overlay can do none of those.
 *
 * Everything it draws is a line. Filled discs on grass at this palette read as
 * a decal somebody forgot to remove, and the frame is already built out of
 * outlines, so lines are the vocabulary the picture is speaking.
 *
 * Occlusion is drawn twice: once depth-tested at full strength, once through
 * everything at a quarter. So a landing point behind the palisade is dimmed
 * rather than deleted, which keeps "I am throwing over that" legible without
 * pretending the wall is not there.
 */

/** Segments around the landing circle. Forty is round at any zoom we allow. */
const RING_SEGMENTS = 40

/** Samples along the arc. Twenty is smooth and costs nothing. */
const ARC_SEGMENTS = 20

/** How far the reticle floats above the ground, so it never z-fights terrain. */
const LIFT = 0.06

/** Where the arc leaves the character. Roughly hand height. */
const HAND_HEIGHT = 1.15

/** Peak of the arc above the straight line between hand and landing point. */
const ARC_RISE = 0.34

/** Amber, matching the warm accent every other control uses. */
const COLD = 0xe0a35c

/** Hot landings get the fire accent, because that is what arrives. */
const HOT = 0xff8244

/** Ghosted copy, drawn through the world. */
const GHOST_OPACITY = 0.24

/** How hot a landing has to be before the reticle changes colour. */
const HOT_THRESHOLD = 0.3

export class AimReticle {
  readonly group = new THREE.Group()

  /** Where the throw lands right now, or null while nothing is being aimed. */
  private readonly landing = new THREE.Vector3()
  private aiming = false

  private readonly ring: THREE.LineLoop
  private readonly ringGhost: THREE.LineLoop
  private readonly arc: THREE.Line
  private readonly arcGhost: THREE.Line
  private readonly mark: THREE.LineSegments
  private readonly markGhost: THREE.LineSegments

  private readonly solid: THREE.LineBasicMaterial
  private readonly ghost: THREE.LineBasicMaterial

  /** Scratch, so the frame loop allocates nothing. */
  private readonly scratch = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()
  private readonly ray = new THREE.Vector3()

  constructor() {
    this.group.visible = false
    // Never culled: the ring's bounding sphere is computed once from a unit
    // circle at the origin and the geometry is rewritten every frame, so the
    // culler would be testing a box that has nothing to do with where it is.
    this.group.frustumCulled = false

    this.solid = new THREE.LineBasicMaterial({ color: COLD, fog: false, transparent: true, opacity: 0.95 })
    this.ghost = new THREE.LineBasicMaterial({
      color: COLD,
      fog: false,
      transparent: true,
      opacity: GHOST_OPACITY,
      depthTest: false,
    })

    const ringGeo = new THREE.BufferGeometry()
    ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RING_SEGMENTS * 3), 3))
    const arcGeo = new THREE.BufferGeometry()
    arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ARC_SEGMENTS + 1) * 3), 3))
    // Four ticks: a cross through the impact point, so the centre reads as a
    // point rather than as the middle of an empty circle.
    const markGeo = new THREE.BufferGeometry()
    markGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3))

    this.ring = new THREE.LineLoop(ringGeo, this.solid)
    this.ringGhost = new THREE.LineLoop(ringGeo, this.ghost)
    this.arc = new THREE.Line(arcGeo, this.solid)
    this.arcGhost = new THREE.Line(arcGeo, this.ghost)
    this.mark = new THREE.LineSegments(markGeo, this.solid)
    this.markGhost = new THREE.LineSegments(markGeo, this.ghost)

    for (const o of [this.ring, this.arc, this.mark, this.ringGhost, this.arcGhost, this.markGhost]) {
      o.frustumCulled = false
      o.renderOrder = 3
      this.group.add(o)
    }
  }

  /** The point the throw will reach, or null when nothing is aimed. */
  get point(): THREE.Vector3 | null {
    return this.aiming ? this.landing : null
  }

  hide(): void {
    this.aiming = false
    this.group.visible = false
  }

  /**
   * Point it somewhere and draw it.
   *
   * `pointer` steers it when the mouse is over the world and is null otherwise,
   * in which case the throw goes where the character is facing at full range.
   * That fallback is not a degraded mode: it is what a player using only the
   * keyboard gets, and it is the state the screenshot harness can photograph.
   *
   * @param from    the thrower, at their feet
   * @param heading facing in radians, or null when they have not moved yet
   * @param range   how far this item reaches, in world units
   * @param land    what arrives, for the spread and the colour. Null draws a
   *                point-sized landing, which is the honest answer for an item
   *                with no authored landing at all.
   */
  aim(
    from: THREE.Vector3,
    heading: number | null,
    range: number,
    land: Landing | null,
    camera: THREE.Camera,
    pointer: { x: number; y: number } | null,
    heightAt: (x: number, z: number) => number,
  ): void {
    const radius = land?.radius ?? 0.4
    const hot = (land?.applies.HOT ?? 0) >= HOT_THRESHOLD
    const colour = hot ? HOT : COLD
    this.solid.color.setHex(colour)
    this.ghost.color.setHex(colour)

    // Where the player is pointing, clamped to what the item can actually do.
    // Clamping rather than refusing, because a reticle that vanishes when you
    // overreach teaches nothing; one that stops at the limit teaches the limit.
    if (pointer) {
      this.groundUnder(pointer, camera, from.y, heightAt, this.scratch)
      this.dir.set(this.scratch.x - from.x, 0, this.scratch.z - from.z)
    } else if (heading !== null) {
      this.dir.set(Math.sin(heading) * range, 0, Math.cos(heading) * range)
    } else {
      this.dir.set(0, 0, range)
    }

    const reach = Math.hypot(this.dir.x, this.dir.z)
    if (reach > range) this.dir.multiplyScalar(range / reach)

    const x = from.x + this.dir.x
    const z = from.z + this.dir.z
    this.landing.set(x, heightAt(x, z), z)

    this.drawRing(radius, heightAt)
    this.drawArc(from)
    this.drawMark(radius)

    this.aiming = true
    this.group.visible = true
  }

  dispose(): void {
    this.solid.dispose()
    this.ghost.dispose()
    for (const o of [this.ring, this.arc, this.mark]) o.geometry.dispose()
  }

  /**
   * The ground point under a screen position.
   *
   * Under an orthographic camera every ray is parallel, so this is one
   * unproject and one plane intersection. The plane starts at the thrower's own
   * height and then re-solves twice against the real terrain, which is what
   * stops the reticle sliding downhill when you aim up a slope. Two iterations
   * is enough on ground this gentle; a third moves it by millimetres.
   */
  private groundUnder(
    pointer: { x: number; y: number },
    camera: THREE.Camera,
    startY: number,
    heightAt: (x: number, z: number) => number,
    out: THREE.Vector3,
  ): void {
    // The camera moved this frame and its world matrix is only refreshed at
    // render time. Unprojecting against a stale one lags the reticle a frame
    // behind the pointer, which is exactly the frame you clicked in.
    camera.updateMatrixWorld()
    out.set((pointer.x / innerWidth) * 2 - 1, -(pointer.y / innerHeight) * 2 + 1, -1).unproject(camera)

    const ray = camera.getWorldDirection(this.ray)
    // A camera looking level at the horizon never meets the ground. It cannot
    // happen with this rig, but the divide would be by zero if it did.
    if (Math.abs(ray.y) < 1e-5) return

    let planeY = startY
    for (let i = 0; i < 3; i++) {
      const t = (planeY - out.y) / ray.y
      const x = out.x + ray.x * t
      const z = out.z + ray.z * t
      planeY = heightAt(x, z)
      if (i === 2) out.set(x, planeY, z)
    }
  }

  /**
   * The landing circle, draped over whatever it lands on.
   *
   * Sampling the terrain per vertex rather than drawing a flat disc, because a
   * flat circle on a slope reads as a sticker floating in the air, and this is
   * the one part of the reticle that has to say "here, on this ground".
   */
  private drawRing(radius: number, heightAt: (x: number, z: number) => number): void {
    const pos = this.ring.geometry.getAttribute('position') as THREE.BufferAttribute
    const a = pos.array as Float32Array
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const t = (i / RING_SEGMENTS) * Math.PI * 2
      const x = this.landing.x + Math.cos(t) * radius
      const z = this.landing.z + Math.sin(t) * radius
      a[i * 3] = x
      a[i * 3 + 1] = heightAt(x, z) + LIFT
      a[i * 3 + 2] = z
    }
    pos.needsUpdate = true
  }

  /**
   * The arc from hand to ground.
   *
   * A straight line between two points on an isometric screen is ambiguous:
   * the same pixels describe a short throw at a steep angle and a long one at a
   * shallow angle. Lifting the middle disambiguates it for free, and it is also
   * what a thrown flask does.
   */
  private drawArc(from: THREE.Vector3): void {
    const pos = this.arc.geometry.getAttribute('position') as THREE.BufferAttribute
    const a = pos.array as Float32Array
    const y0 = from.y + HAND_HEIGHT
    const rise = ARC_RISE * Math.max(1, Math.hypot(this.landing.x - from.x, this.landing.z - from.z))

    for (let i = 0; i <= ARC_SEGMENTS; i++) {
      const t = i / ARC_SEGMENTS
      a[i * 3] = from.x + (this.landing.x - from.x) * t
      // Straight-line height plus a parabola that is zero at both ends.
      a[i * 3 + 1] = y0 + (this.landing.y + LIFT - y0) * t + Math.sin(t * Math.PI) * rise
      a[i * 3 + 2] = from.z + (this.landing.z - from.z) * t
    }
    pos.needsUpdate = true
  }

  /** Four ticks pointing in at the impact point. */
  private drawMark(radius: number): void {
    const pos = this.mark.geometry.getAttribute('position') as THREE.BufferAttribute
    const a = pos.array as Float32Array
    const outer = radius * 0.42
    const inner = radius * 0.16
    const y = this.landing.y + LIFT
    let n = 0
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      a[n++] = this.landing.x + dx * outer
      a[n++] = y
      a[n++] = this.landing.z + dz * outer
      a[n++] = this.landing.x + dx * inner
      a[n++] = y
      a[n++] = this.landing.z + dz * inner
    }
    pos.needsUpdate = true
  }
}
