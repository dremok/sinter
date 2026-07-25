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

  /** Camera-relative movement basis, so W is always "up the screen". */
  screenBasis(): { forward: THREE.Vector3; right: THREE.Vector3 } {
    const dir = AZIMUTHS[this.azimuthIndex]!
    const forward = new THREE.Vector3(-dir.x, 0, -dir.z).normalize()
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    return { forward, right: right.multiplyScalar(-1) }
  }

  update(): void {
    const dir = AZIMUTHS[this.azimuthIndex]!
    this.camera.position.copy(this.target).addScaledVector(dir, this.distance)
    this.camera.lookAt(this.target)
  }
}
