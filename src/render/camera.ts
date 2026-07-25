import * as THREE from 'three'

/**
 * Orthographic isometric rig.
 *
 * True isometric is an elevation of atan(1/sqrt(2)) (about 35.264 degrees) at
 * 45 degrees azimuth, which a camera at (d, d, d) looking at the origin gives
 * you for free, because normalize(1,1,1) has exactly that elevation.
 *
 * Rotation is in 90 degree steps so the player can see behind buildings.
 */

const AZIMUTHS: readonly THREE.Vector3[] = [
  new THREE.Vector3(1, 1, 1),
  new THREE.Vector3(-1, 1, 1),
  new THREE.Vector3(-1, 1, -1),
  new THREE.Vector3(1, 1, -1),
].map((v) => v.normalize())

/** How far out the sun sits horizontally, and how high. atan gives ~36 degrees
 * of elevation: low enough that shadows have length and every vertical face
 * shows a terminator, high enough that they do not stripe the whole clearing. */
const SUN_REACH = 42
const SUN_HEIGHT = 31

export class IsoCamera {
  readonly camera: THREE.OrthographicCamera
  readonly target = new THREE.Vector3()

  /** World units visible vertically. Lower is more zoomed in. */
  viewSize = 22
  private azimuthIndex = 0

  /**
   * How far back the camera sits. With an orthographic projection this does
   * NOT affect apparent size, only the depth range, so it exists purely to
   * keep geometry inside the near/far planes. Anything depth-based (fog,
   * shadow bounds) must be tuned relative to this, not to absolute numbers.
   */
  readonly distance = 60

  constructor(aspect: number) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500)
    this.setAspect(aspect)
    this.update()
  }

  setAspect(aspect: number): void {
    const h = this.viewSize / 2
    const w = h * aspect
    this.camera.left = -w
    this.camera.right = w
    this.camera.top = h
    this.camera.bottom = -h
    this.camera.updateProjectionMatrix()
  }

  rotate(steps: number): void {
    this.azimuthIndex = (this.azimuthIndex + steps + AZIMUTHS.length * 4) % AZIMUTHS.length
  }

  /**
   * Camera-relative movement basis, so W is always "up the screen" and D is
   * always right.
   *
   * `cross(forward, up)` already IS the camera's right vector in world space.
   * There used to be a `.multiplyScalar(-1)` on the end of this, which flipped
   * it, so A and D were swapped on every one of the four camera angles. Do not
   * reintroduce it: if strafing feels mirrored, the bug is elsewhere.
   */
  screenBasis(): { forward: THREE.Vector3; right: THREE.Vector3 } {
    const dir = AZIMUTHS[this.azimuthIndex]!
    const forward = new THREE.Vector3(-dir.x, 0, -dir.z).normalize()
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    return { forward, right }
  }

  /**
   * Where the sun belongs, relative to whatever the camera is looking at.
   *
   * Perpendicular in azimuth to the camera, so shadows fall across the screen
   * instead of hiding behind their own casters. D9 records that trap and leaves
   * the follow-up open: a *fixed* sun only satisfies it at one camera angle.
   * Rotate 90 degrees and the same sun sits directly behind the viewer, which
   * is the exact failure again. Deriving it from the current azimuth closes
   * that, and keeps the key light coming from the same side of the screen at
   * all four angles, so the frame is lit the same way however the player turns.
   */
  sunOffset(out = new THREE.Vector3()): THREE.Vector3 {
    const dir = AZIMUTHS[this.azimuthIndex]!
    const h = Math.hypot(dir.x, dir.z)
    return out.set((dir.z / h) * SUN_REACH, SUN_HEIGHT, (-dir.x / h) * SUN_REACH)
  }

  /**
   * Fog distances, in camera depth.
   *
   * Under an orthographic rig everything sits at roughly `distance` from the
   * camera and the visible frame only spans about `viewSize` either side of
   * that, so fog has to bracket `distance` or it does nothing whatsoever. The
   * old hardcoded 94..156 sat entirely behind the far tree line, which is why
   * the frame had no aerial perspective at all despite having fog. (D9)
   *
   * The window is narrow. Ground at the bottom of the frame sits about
   * `viewSize * 0.7` nearer than the camera target and ground at the top about
   * the same amount further, with tall things at the top further again. So the
   * near plane sits just in front of the target and the far plane well past the
   * top of the frame: any tighter and the middle distance goes milky.
   */
  fogRange(): { near: number; far: number } {
    return {
      near: this.distance - this.viewSize * 0.1,
      far: this.distance + this.viewSize * 3.2,
    }
  }

  update(): void {
    const dir = AZIMUTHS[this.azimuthIndex]!
    this.camera.position.copy(this.target).addScaledVector(dir, this.distance)
    this.camera.lookAt(this.target)
  }
}
