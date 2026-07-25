/**
 * Fire, as a thing you look at.
 *
 * The first version was two cones and a point light. It read as an orange
 * arrow, because a flame is not a shape, it is a shape that will not hold
 * still. Everything here is in service of that:
 *
 *   - a cluster of teardrop tongues rather than one form, so the silhouette
 *     changes as they move against each other
 *   - each tongue alpha-cut by a scrolling noise mask, so the OUTLINE breaks up
 *     and reforms. This is the part that matters. Scaling and rotating a solid
 *     shape gives you a wobbling solid shape; fire reads because its edge is
 *     never the same edge twice, and no amount of tinting the burning object
 *     substitutes for it
 *   - a bright core tongue taller than the cluster, so something licks up out
 *     of the mass instead of the whole mass pulsing together
 *   - stepped flicker per tongue at different rates, roughly 7 to 20 Hz, which
 *     is where real flame sits. A smooth sine reads as breathing, not burning
 *   - square pixel embers rising and fading, and smoke above them
 *   - a light that pulses with the flame, so the warmth on nearby geometry
 *     moves too
 *
 * Nothing here calls Math.random. Every particle, every flicker step and the
 * noise mask itself come from a hash of index and position, so a seed
 * reproduces a frame exactly and the headless screenshots stay comparable.
 */

import * as THREE from 'three'
import { BAND0 } from './palette'

/** Deterministic 0..1 noise. Stands in for the RNG, which is not the right tool
 *  here: this has to be a pure function of (particle, time), not a stream. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

// ------------------------------------------------------------------ the mask

const NOISE_SIZE = 32

let noiseTex: THREE.DataTexture | null = null

/**
 * Tiling value noise, smoothed, single channel.
 *
 * Wraps in both axes so the mask can scroll forever without a seam. Coarse on
 * purpose: eight cells across means the blobs are the size of a flame's own
 * lobes, which is what makes the erosion read as fire rather than as static.
 */
function flameNoise(): THREE.DataTexture {
  if (noiseTex) return noiseTex

  const cells = 8
  const grid = new Float32Array(cells * cells)
  for (let i = 0; i < grid.length; i++) grid[i] = hash01(i * 17.3 + 5.1)

  const fade = (t: number): number => t * t * (3 - 2 * t)
  const wrap = (v: number): number => ((v % cells) + cells) % cells
  const at = (x: number, y: number): number => grid[wrap(y) * cells + wrap(x)]!

  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE)
  for (let y = 0; y < NOISE_SIZE; y++) {
    for (let x = 0; x < NOISE_SIZE; x++) {
      const gx = (x / NOISE_SIZE) * cells
      const gy = (y / NOISE_SIZE) * cells
      const x0 = Math.floor(gx)
      const y0 = Math.floor(gy)
      const tx = fade(gx - x0)
      const ty = fade(gy - y0)
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx
      const bot = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx
      data[y * NOISE_SIZE + x] = Math.round((top * (1 - ty) + bot * ty) * 255)
    }
  }

  noiseTex = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RedFormat)
  noiseTex.wrapS = THREE.RepeatWrapping
  noiseTex.wrapT = THREE.RepeatWrapping
  noiseTex.minFilter = THREE.LinearFilter
  noiseTex.magFilter = THREE.LinearFilter
  noiseTex.generateMipmaps = false
  noiseTex.needsUpdate = true
  return noiseTex
}

// ------------------------------------------------------------------ geometry

/**
 * A teardrop, revolved. Widest a third of the way up and drawn to a point, with
 * few enough segments to stay faceted; a smooth flame reads as a balloon.
 */
function tongueGeometry(): THREE.LatheGeometry {
  const profile: THREE.Vector2[] = []
  const rings = 10
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    const r = Math.sin(Math.pow(t, 0.62) * Math.PI) * (1 - t * 0.28) * 0.5
    profile.push(new THREE.Vector2(Math.max(r, 1e-4), t))
  }
  return new THREE.LatheGeometry(profile, 9)
}

const TONGUE = tongueGeometry()

const EMBER = new THREE.Color(BAND0.ember)
const FLAME = new THREE.Color(BAND0.flame)
/** The deep base of the fire and the near-white core, both derived from the
 *  palette rather than invented, so a band retint carries through. */
const DEEP = EMBER.clone().lerp(new THREE.Color(0x8c1e05), 0.55)
const CORE = FLAME.clone().lerp(new THREE.Color(0xffffff), 0.28)

// ------------------------------------------------------------------- tongues

const TONGUE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`

/**
 * Erode the tongue with scrolling noise.
 *
 * The mask scrolls downward in UV, so the holes travel *up* the flame, and the
 * cut threshold rises with height, so the tip shreds into separate licks while
 * the base stays solid. That gradient is the whole illusion; a uniform cut just
 * makes a moth-eaten cone.
 */
const TONGUE_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform vec3 uColor;
uniform float uTime;
uniform float uCut;
varying vec2 vUv;

void main() {
  float n = texture2D( uNoise, vec2( vUv.x * 2.0, vUv.y * 0.9 - uTime ) ).r;
  if ( n < uCut + vUv.y * 0.78 ) discard;
  gl_FragColor = vec4( uColor, 1.0 );
}
`

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
  /** How aggressively the noise eats it. The core survives; the outer lobes are
   *  mostly holes, which is what gives the fire a ragged edge. */
  cut: number
  /** How fast the mask scrolls, in UV per second. */
  scroll: number
}

const TONGUES: readonly TongueSpec[] = [
  { color: DEEP, height: 0.9, width: 1.1, angle: 0.0, radius: 0.17, rate: 7, cut: 0.3, scroll: 1.1 },
  { color: EMBER, height: 1.0, width: 0.95, angle: 2.09, radius: 0.16, rate: 11, cut: 0.26, scroll: 1.4 },
  { color: EMBER, height: 0.84, width: 0.9, angle: 4.19, radius: 0.18, rate: 9, cut: 0.28, scroll: 1.25 },
  { color: FLAME, height: 1.06, width: 0.7, angle: 0.0, radius: 0.0, rate: 14, cut: 0.16, scroll: 1.7 },
  { color: CORE, height: 1.2, width: 0.48, angle: 0.0, radius: 0.0, rate: 19, cut: 0.08, scroll: 2.1 },
]

/** One material per tongue role, shared by every fire in the scene. The time
 *  uniform is set per draw in `onBeforeRender`, which is what lets two posts
 *  alight side by side flicker out of step without a material each. */
const tongueMaterials = TONGUES.map(
  (spec) =>
    new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: flameNoise() },
        uColor: { value: spec.color },
        uTime: { value: 0 },
        uCut: { value: spec.cut },
      },
      vertexShader: TONGUE_VERT,
      fragmentShader: TONGUE_FRAG,
      side: THREE.DoubleSide,
    }),
)

// ----------------------------------------------------------------- particles

/**
 * Points with a per-particle size and alpha.
 *
 * `PointsMaterial` has neither, and both are what separate embers that rise and
 * die from a fixed constellation of dots. Size is in world units and converted
 * with the live drawing-buffer height, so it survives the move to native
 * resolution and a window resize without anything being hardcoded.
 */
const PARTICLE_VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aTint;
uniform float uHalfHeight;
varying vec4 vTint;
void main() {
  vTint = aTint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_PointSize = max( aSize * projectionMatrix[1][1] * uHalfHeight, 1.0 );
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

function particleMaterial(round: boolean, blending: THREE.Blending): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uRound: { value: round ? 1 : 0 }, uHalfHeight: { value: 360 } },
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    transparent: true,
    depthWrite: false,
    blending,
  })
}

const emberMaterial = particleMaterial(false, THREE.AdditiveBlending)
const smokeMaterial = particleMaterial(true, THREE.NormalBlending)

/** Tell the particle shaders how tall the drawing buffer is, so a world-space
 *  ember size lands on the same fraction of the screen at any resolution. */
export function setFlameViewport(bufferHeight: number): void {
  emberMaterial.uniforms.uHalfHeight!.value = bufferHeight / 2
  smokeMaterial.uniforms.uHalfHeight!.value = bufferHeight / 2
}

const EMBERS = 16
const SMOKE = 9

class Particles {
  readonly points: THREE.Points
  private readonly position: THREE.BufferAttribute
  private readonly size: THREE.BufferAttribute
  private readonly tint: THREE.BufferAttribute

  constructor(count: number, material: THREE.ShaderMaterial) {
    const geo = new THREE.BufferGeometry()
    this.position = new THREE.BufferAttribute(new Float32Array(count * 3), 3)
    this.size = new THREE.BufferAttribute(new Float32Array(count), 1)
    this.tint = new THREE.BufferAttribute(new Float32Array(count * 4), 4)
    geo.setAttribute('position', this.position)
    geo.setAttribute('aSize', this.size)
    geo.setAttribute('aTint', this.tint)

    this.points = new THREE.Points(geo, material)
    // The bounding sphere is never right for particles rewritten every frame,
    // and a wrong one culls the whole system at the edge of the screen.
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
  }
}

// ---------------------------------------------------------------------- fire

const SMOKE_COLOR = new THREE.Color(0x6b6058)
const scratchColor = new THREE.Color()

export class Flame {
  readonly group = new THREE.Group()
  readonly light: THREE.PointLight

  private readonly tongues: THREE.Mesh[] = []
  private readonly embers = new Particles(EMBERS, emberMaterial)
  private readonly smoke = new Particles(SMOKE, smokeMaterial)

  /** Per-fire phase offset, so two posts alight side by side do not flicker in
   *  lockstep. Derived from where the fire is, so it is stable across a replay. */
  private readonly seed: number
  /** Read by each tongue's `onBeforeRender`, which is how a shared material can
   *  still draw a different moment of the animation per fire. */
  private phase = 0

  constructor(at: THREE.Vector3) {
    this.seed = hash01(at.x * 12.9898 + at.z * 78.233) * 97

    for (let i = 0; i < TONGUES.length; i++) {
      const spec = TONGUES[i]!
      const mat = tongueMaterials[i]!
      const mesh = new THREE.Mesh(TONGUE, mat)
      mesh.userData.noShadow = true
      mesh.userData.noOutline = true
      mesh.onBeforeRender = () => {
        mat.uniforms.uTime!.value = this.phase * spec.scroll
      }
      this.tongues.push(mesh)
      this.group.add(mesh)
    }

    this.group.add(this.embers.points, this.smoke.points)

    /**
     * decay 1.4 rather than a physical 2.
     *
     * The two complaints about fire light pull in opposite directions: it must
     * reach a character three metres away, and it must not blow a boulder one
     * metre away into a bright structureless mass. Inverse square cannot do
     * both, because it spends almost everything inside the first half metre. A
     * flatter falloff, a light sitting above the flame rather than in it, and a
     * hue-preserving shoulder in the grade solve both at once.
     */
    this.light = new THREE.PointLight(BAND0.ember, 0, 12, 1.4)
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
    this.phase = t

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

    this.updateEmbers(heat, size, t)
    this.updateSmoke(heat, size, t)

    // The light pulses slower than the flame flickers. Warmth on a wall moves
    // like the fire as a whole, not like its tips.
    this.light.visible = light
    if (light) {
      const pulse = 0.78 + hash01(Math.floor(t * 5) + this.seed) * 0.28
      // Above the flame, not inside it. Nothing should sit 20cm from a light
      // that is meant to warm a clearing.
      this.light.position.y = size * (0.7 + heat * 0.6)
      this.light.intensity = heat * heat * 9 * pulse * size
      this.light.distance = 6 + heat * size * 9
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
      const fade = (1 - k) * (1 - k) * heat * 0.75
      scratchColor.copy(EMBER).lerp(DEEP, k * 0.8)

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
      const alpha = Math.min(k * 4, 1) * (1 - k) * 0.46 * heat

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
    this.embers.dispose()
    this.smoke.dispose()
  }
}
