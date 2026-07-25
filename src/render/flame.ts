/**
 * Fire, as a thing you look at.
 *
 * The previous version was two cones and a point light. It read as an orange
 * arrow, because a flame is not a shape, it is a shape that will not hold
 * still. Everything here is in service of that:
 *
 *   - a cluster of teardrop tongues rather than one form, so the silhouette
 *     changes as they move against each other
 *   - a bright core tongue taller than the cluster, so something licks up out
 *     of the mass instead of the whole mass pulsing together
 *   - stepped flicker per tongue at different rates, roughly 7 to 20 Hz, which
 *     is where real flame sits. A smooth sine reads as breathing, not burning
 *   - square pixel embers rising and fading, which is what makes it read at a
 *     distance where the tongues are only a dozen pixels tall
 *   - smoke, and a light that pulses with the flame so the warmth on nearby
 *     geometry moves too
 *
 * Nothing here calls Math.random. Every particle and every flicker step comes
 * from a hash of its own index and the fire's world position, so a seed
 * reproduces a frame exactly and the headless screenshots stay comparable.
 */

import * as THREE from 'three'
import { BAND0 } from './palette'
import { PIXEL_HEIGHT } from './toon'

/** Deterministic 0..1 noise. Stands in for the RNG, which is not the right tool
 *  here: this has to be a pure function of (particle, time), not a stream. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * A teardrop, revolved. Widest a third of the way up and drawn to a point, with
 * few enough segments to stay faceted; a smooth flame reads as a balloon once
 * the frame is pixellated.
 */
function tongueGeometry(): THREE.LatheGeometry {
  const profile: THREE.Vector2[] = []
  const rings = 8
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    const r = Math.sin(Math.pow(t, 0.62) * Math.PI) * (1 - t * 0.28) * 0.5
    profile.push(new THREE.Vector2(Math.max(r, 1e-4), t))
  }
  return new THREE.LatheGeometry(profile, 7)
}

const TONGUE = tongueGeometry()

const EMBER = new THREE.Color(BAND0.ember)
const FLAME = new THREE.Color(BAND0.flame)
/** The deep base of the fire and the near-white core, both derived from the
 *  palette rather than invented, so a band retint carries through. */
const DEEP = EMBER.clone().lerp(new THREE.Color(0x8c1e05), 0.55)
const CORE = FLAME.clone().lerp(new THREE.Color(0xffffff), 0.55)

interface TongueSpec {
  color: THREE.Color
  /** Height and width as a fraction of the fire's size. */
  height: number
  width: number
  /** Where it stands in the cluster. */
  angle: number
  radius: number
  /** Flicker rate in Hz. Spread out so the cluster never beats in time. */
  rate: number
}

const TONGUES: readonly TongueSpec[] = [
  { color: DEEP, height: 0.86, width: 1.05, angle: 0.0, radius: 0.17, rate: 7 },
  { color: EMBER, height: 0.94, width: 0.92, angle: 2.09, radius: 0.16, rate: 11 },
  { color: EMBER, height: 0.8, width: 0.86, angle: 4.19, radius: 0.18, rate: 9 },
  { color: FLAME, height: 1.02, width: 0.6, angle: 0.0, radius: 0.0, rate: 14 },
  { color: CORE, height: 1.3, width: 0.3, angle: 0.0, radius: 0.0, rate: 19 },
]

const EMBERS = 14
const SMOKE = 8

// --------------------------------------------------------------- particles

/**
 * Points with a per-particle size and alpha.
 *
 * `PointsMaterial` has neither, and both are what separate embers that rise and
 * die from a fixed constellation of dots. The size is given in world units and
 * converted here, using the fact that the drawing buffer is always PIXEL_HEIGHT
 * tall whatever the window does, so the conversion needs no uniform and no
 * resize plumbing.
 */
const PARTICLE_VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aTint;
varying vec4 vTint;
void main() {
  vTint = aTint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_PointSize = max( aSize * projectionMatrix[1][1] * ${(PIXEL_HEIGHT / 2).toFixed(1)}, 1.0 );
}
`

const PARTICLE_FRAG = /* glsl */ `
uniform float uRound;
varying vec4 vTint;
void main() {
  float mask = 1.0;
  if ( uRound > 0.5 ) {
    mask = smoothstep( 0.5, 0.16, length( gl_PointCoord - 0.5 ) );
  }
  if ( vTint.a * mask < 0.01 ) discard;
  gl_FragColor = vec4( vTint.rgb, vTint.a * mask );
}
`

class Particles {
  readonly points: THREE.Points
  private readonly position: THREE.BufferAttribute
  private readonly size: THREE.BufferAttribute
  private readonly tint: THREE.BufferAttribute

  constructor(count: number, round: boolean, blending: THREE.Blending) {
    const geo = new THREE.BufferGeometry()
    this.position = new THREE.BufferAttribute(new Float32Array(count * 3), 3)
    this.size = new THREE.BufferAttribute(new Float32Array(count), 1)
    this.tint = new THREE.BufferAttribute(new Float32Array(count * 4), 4)
    geo.setAttribute('position', this.position)
    geo.setAttribute('aSize', this.size)
    geo.setAttribute('aTint', this.tint)
    // The bounding sphere is never right for particles that are rewritten every
    // frame, and a wrong one culls the whole system at the screen edge.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6)

    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uRound: { value: round ? 1 : 0 } },
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        transparent: true,
        depthWrite: false,
        blending,
      }),
    )
    this.points.frustumCulled = false
  }

  set(i: number, x: number, y: number, z: number, size: number, c: THREE.Color, a: number): void {
    this.position.setXYZ(i, x, y, z)
    this.size.setX(i, size)
    this.tint.setXYZW(i, c.r, c.g, c.b, a)
  }

  commit(): void {
    this.position.needsUpdate = true
    this.size.needsUpdate = true
    this.tint.needsUpdate = true
  }

  dispose(): void {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}

// -------------------------------------------------------------------- fire

const SMOKE_COLOR = new THREE.Color(0x4a4038)
const scratchColor = new THREE.Color()

export class Flame {
  readonly group = new THREE.Group()
  readonly light: THREE.PointLight

  private readonly tongues: THREE.Mesh[] = []
  private readonly materials: THREE.MeshBasicMaterial[] = []
  private readonly embers = new Particles(EMBERS, false, THREE.AdditiveBlending)
  private readonly smoke = new Particles(SMOKE, true, THREE.NormalBlending)
  private readonly glow: THREE.Mesh

  /** Per-fire phase offset, so two posts alight side by side do not flicker in
   *  lockstep. Derived from where the fire is, so it is stable across a replay. */
  private readonly seed: number

  constructor(at: THREE.Vector3) {
    this.seed = hash01(at.x * 12.9898 + at.z * 78.233) * 97

    for (const spec of TONGUES) {
      const mat = new THREE.MeshBasicMaterial({ color: spec.color, fog: false })
      const mesh = new THREE.Mesh(TONGUE, mat)
      this.materials.push(mat)
      this.tongues.push(mesh)
      this.group.add(mesh)
    }

    // A soft additive envelope. Does most of the work of making the fire look
    // hot rather than orange, and costs one more draw of the same geometry.
    const glowMat = new THREE.MeshBasicMaterial({
      color: EMBER,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
    this.glow = new THREE.Mesh(TONGUE, glowMat)
    this.materials.push(glowMat)
    this.group.add(this.glow)

    this.group.add(this.embers.points, this.smoke.points)

    this.light = new THREE.PointLight(BAND0.ember, 0, 9, 2)
    this.group.add(this.light)
  }

  /**
   * @param at    where the fire sits, in world space
   * @param heat  0..1, how hard it is burning
   * @param size  height of the flame in metres at full heat
   * @param age   seconds since it caught, which is the only clock it needs
   * @param light whether this fire is close enough to be worth a real light
   */
  update(at: THREE.Vector3, heat: number, size: number, age: number, light: boolean): void {
    this.group.position.copy(at)

    const t = age + this.seed

    for (let i = 0; i < TONGUES.length; i++) {
      const spec = TONGUES[i]!
      const mesh = this.tongues[i]!

      // Quantised. A flame does not ease between shapes, it snaps to a new one,
      // and stepping the time is the cheapest way to get that.
      const step = Math.floor(t * spec.rate)
      const n = hash01(step + i * 31.7 + this.seed)
      const m = hash01(step * 1.7 + i * 13.1 + this.seed)

      const h = size * heat * spec.height * (0.78 + n * 0.42)
      const w = size * heat * spec.width * (0.9 + m * 0.2)
      mesh.scale.set(w, h, w)

      // Tongues lean out from the centre and sway. The lean grows up the
      // cluster, so the tips scatter more than the base, like a real flame.
      const ang = spec.angle + m * 0.7
      const r = size * heat * spec.radius
      mesh.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r)
      mesh.rotation.set((m - 0.5) * 0.34 * spec.height, ang, (n - 0.5) * 0.34 * spec.height)
    }

    const glowStep = Math.floor(t * 6)
    const glowN = hash01(glowStep + this.seed)
    this.glow.scale.set(size * heat * 1.6, size * heat * 1.35 * (0.9 + glowN * 0.2), size * heat * 1.6)
    this.glow.position.y = size * heat * 0.1
    ;(this.glow.material as THREE.MeshBasicMaterial).opacity = 0.18 + heat * 0.16

    this.updateEmbers(heat, size, t)
    this.updateSmoke(heat, size, t)

    // The light pulses slower than the flame flickers. Warmth on a wall moves
    // like the fire as a whole, not like its tips.
    this.light.visible = light
    if (light) {
      const pulse = 0.76 + hash01(Math.floor(t * 5) + this.seed) * 0.3
      this.light.position.y = size * heat * 0.5
      this.light.intensity = heat * heat * 16 * pulse * size
      this.light.distance = 3 + heat * size * 5.5
      this.light.color.copy(EMBER).lerp(FLAME, pulse * 0.45)
    }
  }

  private updateEmbers(heat: number, size: number, t: number): void {
    for (let i = 0; i < EMBERS; i++) {
      const a = hash01(i * 7.31 + this.seed)
      const b = hash01(i * 3.17 + this.seed + 19.3)
      const life = 1.0 + a * 1.1
      // Each ember runs its own loop, offset so they do not all leave together.
      const age = (t * (0.75 + b * 0.3) + b * life) % life
      const k = age / life

      const rise = k * size * (1.5 + a * 1.6) * heat
      const spread = size * (0.12 + k * (0.3 + b * 0.55)) * heat
      const ang = b * Math.PI * 2 + k * (1.4 + a * 2)

      // Additive, so fading the colour to black fades the ember out. Cheaper
      // than a per-particle alpha ramp and it cools toward red on the way.
      const fade = (1 - k) * (1 - k) * heat
      scratchColor.copy(FLAME).lerp(DEEP, k)

      this.embers.set(
        i,
        Math.cos(ang) * spread,
        size * 0.2 + rise,
        Math.sin(ang) * spread,
        0.045 + a * 0.03,
        scratchColor,
        fade,
      )
    }
    this.embers.commit()
  }

  private updateSmoke(heat: number, size: number, t: number): void {
    for (let i = 0; i < SMOKE; i++) {
      const a = hash01(i * 5.13 + this.seed + 41.7)
      const b = hash01(i * 9.71 + this.seed + 7.9)
      const life = 2.4 + a * 1.4
      const age = (t * 0.55 + b * life) % life
      const k = age / life

      const rise = size * (0.9 + k * (2.6 + a * 1.8))
      const drift = size * k * (0.35 + b * 0.6)
      const ang = b * Math.PI * 2

      // Fades in from the flame tip and out again, so it never pops.
      const alpha = Math.min(k * 4, 1) * (1 - k) * 0.34 * heat

      this.smoke.set(
        i,
        Math.cos(ang) * drift,
        rise,
        Math.sin(ang) * drift,
        size * (0.28 + k * 0.85),
        SMOKE_COLOR,
        alpha,
      )
    }
    this.smoke.commit()
  }

  dispose(): void {
    for (const m of this.materials) m.dispose()
    this.embers.dispose()
    this.smoke.dispose()
  }
}
