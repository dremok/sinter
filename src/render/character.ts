/**
 * The player character: a hooded scavenger.
 *
 * The camera shows 22 world units across 720 buffer lines, and the character is
 * 1.35 units tall, so on screen it is about 36 pixels from boot to hood tip.
 * That is sprite territory. Nothing about a face, a belt buckle or a fold of
 * cloth survives at that size; the only thing that survives is the outline. So
 * the whole design is an outline problem, and every part here earns its place
 * by changing the silhouette:
 *
 *   - a big pointed hood that overhangs the face and runs back into a spike
 *   - a short mantle that flares off the shoulders, and a long cloak behind it
 *   - a pack that rises above the shoulder line with a bedroll lashed across it
 *   - chunky boots below the hem, wider than the legs they hang off
 *
 * Read as a shape, that is a wedge on top of a triangle on top of two blocks,
 * with one bright roll cutting across the back. It is not a person-shaped blob.
 *
 * Proportions are stylised, not anatomical. The head is roughly a quarter of
 * the total height and nearly as wide as the shoulders, the legs are short, the
 * boots are oversized. Realistic proportions read as "small generic human" at
 * 36 pixels; exaggerated ones read as a character.
 *
 * Forms are beveled boxes rather than plain boxes. An octagonal prism scaled to
 * a width and a depth is a box with its four vertical corners cut, which is
 * cheap, keeps hard edges for the cel ramp, and stops everything looking like
 * it was built out of dice.
 *
 * ---------------------------------------------------------------- animation
 *
 * Procedural transforms on grouped parts, no skeleton. The hierarchy is
 *
 *   group   facing, set by the caller's heading
 *   └ root    bob, weight shift, lean, bank
 *     ├ hips    pelvis yaw and roll → legs → knees → ankles → boots
 *     └ chest   torso yaw and roll
 *       ├ arms    shoulder → elbow → mitt
 *       ├ head    counter-yaw, glances
 *       ├ mantle / cloak   sway, lagged behind the body
 *       └ pack    bounce → lantern (a pendulum)
 *
 * One stride is 2*pi of `phase`. Everything in the walk hangs off that:
 *
 *   phase 0, pi        passing position, legs together, body at its highest
 *   phase pi/2, 3pi/2  contact, legs at full extension, body at its lowest
 *
 * The body being lowest at contact rather than at passing is the difference
 * between a walk with weight and a bob that happens to be in time with the
 * feet. On top of that there is a narrow impact dip at each footfall, a knee
 * that folds just after toe off to clear the ground, an ankle that keeps the
 * sole flat through the stance, hips and shoulders counter-rotating, and the
 * hips sliding over whichever foot is carrying the weight.
 *
 * Secondary motion is a damped spring per degree of freedom. The cloak, the
 * pack and the lantern chase the body rather than being welded to it, so they
 * arrive late and overshoot when the body stops, which is the whole point.
 *
 * Idle is driven by accumulated time, never by randomness: a weight shift that
 * holds on each foot instead of swinging, a slow breath at a different period,
 * and glances gated off two slow sines whose periods do not divide into each
 * other, so the pattern takes minutes to come back round.
 */

import * as THREE from 'three'
import { BAND0 } from './palette'
import { toon, toonUnique } from './toon'

const TAU = Math.PI * 2

const HUE = {
  cloak: BAND0.tunic,
  cloakDeep: 0x8e3129,
  under: 0x39406b,
  trouser: BAND0.trouser,
  /** Lighter than the thigh: the shin is the only leg the hem leaves showing. */
  shin: 0x5b6a9e,
  leather: 0x6b4526,
  leatherDark: BAND0.hair,
  canvas: 0xc4894a,
  cloth: 0xdcc9a4,
  wrap: 0xf2e7cc,
  shadow: 0x241c26,
  brass: 0xe8a34c,
} as const

/** Hip height, and the origin of both the pelvis and the chest. */
const HIP = 0.55
/** Shoulder and neck, in chest-local space. */
const SHOULDER = 0.34
const NECK = 0.42
/** Where the pack rides, in chest-local space. */
const PACK = new THREE.Vector3(0, 0.3, -0.24)

/** Full stride frequency at top speed, in radians per second. */
const STRIDE = 14

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Shortest signed arc, so crossing the -pi/pi seam never spins the model. */
function wrapPi(a: number): number {
  while (a > Math.PI) a -= TAU
  while (a < -Math.PI) a += TAU
  return a
}

/**
 * A smooth 0..1 pulse that is on only for the top slice of a slow sine.
 *
 * This is how "occasionally" is expressed without a random number: pick a slow
 * rate and a high gate and the pulse fires on a long fixed cycle. Two of these
 * at periods that do not divide into each other never line up the same way
 * twice inside a play session.
 */
function pulse(t: number, rate: number, gate: number): number {
  const u = (Math.sin(t * rate) - gate) / (1 - gate)
  if (u <= 0) return 0
  return u * u * (3 - 2 * u)
}

/**
 * A damped spring on one degree of freedom. The entire secondary motion budget.
 *
 * Deliberately allowed to overshoot: cloth that eases to rest looks like it is
 * on a string, cloth that swings past and comes back looks like cloth.
 */
class Spring {
  value = 0
  private vel = 0

  constructor(
    private readonly stiffness: number,
    private readonly damping: number,
  ) {}

  step(dt: number, target: number): number {
    this.vel += ((target - this.value) * this.stiffness - this.vel * this.damping) * dt
    this.value += this.vel * dt
    return this.value
  }
}

function mesh(geo: THREE.BufferGeometry, color: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, toon(color))
  m.castShadow = true
  return m
}

/**
 * Flat normals. A cel ramp across smoothly interpolated normals lands as a
 * gradient with visible bands; across flat ones it lands as one value per face,
 * which is what makes the forms read as carved.
 */
function faceted(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.toNonIndexed()
  g.computeVertexNormals()
  return g
}

/** Circumradius of an octagon whose flats sit at +/-0.5. */
const OCT = 0.5 / Math.cos(Math.PI / 8)

/**
 * A box with its four vertical corners chamfered, optionally tapered toward the
 * top. Extents are exactly w by h by d across the flats.
 */
function bevel(w: number, h: number, d: number, color: number, taper = 1): THREE.Mesh {
  const g = new THREE.CylinderGeometry(OCT * taper, OCT, h, 8)
  g.rotateY(Math.PI / 8)
  g.scale(w, 1, d)
  return mesh(faceted(g), color)
}

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  return mesh(new THREE.BoxGeometry(w, h, d), color)
}

interface Leg {
  side: number
  hip: THREE.Group
  knee: THREE.Group
  ankle: THREE.Group
  /** Phase offset, so the two legs are half a stride apart. */
  offset: number
}

interface Arm {
  side: number
  shoulder: THREE.Group
  elbow: THREE.Group
}

export class Character {
  readonly group = new THREE.Group()

  private readonly root = new THREE.Group()
  private readonly hips = new THREE.Group()
  private readonly chest = new THREE.Group()
  private readonly head = new THREE.Group()
  private readonly mantle = new THREE.Group()
  private readonly cloak = new THREE.Group()
  private readonly pack = new THREE.Group()
  private readonly lantern = new THREE.Group()
  private readonly legs: Leg[] = []
  private readonly arms: Arm[] = []

  /** Accumulated animation time. Drives everything the walk does not. */
  private t = 0
  /** Stride phase, in radians. */
  private phase = 0
  /** Facing, lerped toward the direction of travel. */
  private facing = 0
  private lastFacing = 0
  /** Facing again, lagged further, so the cloak swings wide on a turn. */
  private cloakFacing = 0
  /** How far the requested heading is ahead of the body. The head looks there. */
  private lead = 0
  /** Smoothed speed. The caller only ever reports 0 or 1, so the ramp is ours. */
  private walk = 0

  private readonly cloakPitch = new Spring(120, 15)
  private readonly cloakRoll = new Spring(105, 13)
  private readonly mantleRoll = new Spring(190, 20)
  private readonly packLift = new Spring(150, 16)
  private readonly lanternRoll = new Spring(260, 11)
  private readonly lanternPitch = new Spring(260, 11)

  constructor() {
    this.group.add(this.root)
    this.hips.position.y = HIP
    this.chest.position.y = HIP
    this.root.add(this.hips, this.chest)

    this.buildLegs()
    this.buildTorso()
    this.buildArms()
    this.buildHead()
    this.buildCloth()
    this.buildPack()
  }

  private buildLegs(): void {
    for (const side of [-1, 1] as const) {
      const hip = new THREE.Group()
      hip.position.set(side * 0.105, 0, 0)

      const thigh = bevel(0.15, 0.23, 0.16, HUE.trouser)
      thigh.position.y = -0.115
      hip.add(thigh)

      const knee = new THREE.Group()
      knee.position.y = -0.21
      hip.add(knee)

      const shin = bevel(0.13, 0.19, 0.14, HUE.shin, 0.92)
      shin.position.y = -0.095
      knee.add(shin)

      const ankle = new THREE.Group()
      ankle.position.y = -0.185
      knee.add(ankle)

      // Oversized boots pushed forward at the toe. Below the hem they are the
      // only part of the lower body that is not covered, so they carry the
      // whole step: a boot that is only as wide as its leg reads as a stick.
      const boot = bevel(0.21, 0.155, 0.26, HUE.leatherDark)
      boot.position.set(0, -0.078, 0.04)
      ankle.add(boot)

      const cuff = bevel(0.17, 0.06, 0.17, HUE.leather)
      cuff.position.y = 0.02
      ankle.add(cuff)

      this.hips.add(hip)
      this.legs.push({ side, hip, knee, ankle, offset: side < 0 ? 0 : Math.PI })
    }
  }

  private buildTorso(): void {
    const torso = bevel(0.36, 0.42, 0.27, HUE.under, 1.06)
    torso.position.y = 0.19
    this.chest.add(torso)

    // Hangs below the mantle hem, on the opposite side to the lantern, so the
    // outline is never the same on both sides.
    const pouch = bevel(0.15, 0.17, 0.12, HUE.leather)
    pouch.position.set(-0.2, -0.02, 0.06)
    this.chest.add(pouch)

    const flapPouch = bevel(0.16, 0.05, 0.13, HUE.leatherDark)
    flapPouch.position.set(-0.2, 0.06, 0.06)
    this.chest.add(flapPouch)

    // Pack straps over the shoulders. Two dark lines down a red mantle, which
    // at this size is texture rather than detail, but it stops the chest
    // reading as one flat slab.
    for (const side of [-1, 1] as const) {
      const strap = box(0.05, 0.3, 0.05, HUE.leatherDark)
      strap.position.set(side * 0.1, 0.2, 0.12)
      strap.rotation.x = -0.12
      this.chest.add(strap)
    }
  }

  private buildArms(): void {
    for (const side of [-1, 1] as const) {
      const shoulder = new THREE.Group()
      shoulder.position.set(side * 0.2, SHOULDER, 0)

      const upper = bevel(0.12, 0.22, 0.13, HUE.cloakDeep)
      upper.position.y = -0.11
      shoulder.add(upper)

      const elbow = new THREE.Group()
      elbow.position.y = -0.2
      shoulder.add(elbow)

      const fore = bevel(0.11, 0.18, 0.12, HUE.cloakDeep)
      fore.position.y = -0.09
      elbow.add(fore)

      const mitt = bevel(0.12, 0.11, 0.13, HUE.leather)
      mitt.position.y = -0.215
      elbow.add(mitt)

      this.chest.add(shoulder)
      this.arms.push({ side, shoulder, elbow })
    }
  }

  private buildHead(): void {
    this.head.position.y = NECK
    this.chest.add(this.head)

    // A dark collar where the hood meets the mantle. One row of shadow, and
    // the head stops being the top of a continuous red lump.
    const collar = bevel(0.3, 0.06, 0.28, HUE.leatherDark)
    collar.position.y = -0.02
    this.head.add(collar)

    // The hood is the character. Big, square, and set back so its brow hangs
    // over the face.
    const hood = bevel(0.32, 0.3, 0.31, HUE.cloak)
    hood.position.set(0, 0.16, -0.01)
    this.head.add(hood)

    // No eyes. At nine pixels of head an eye is one pixel and reads as dirt.
    // A dark recess with one pale band across it reads as a wrapped face, and
    // more usefully it says which way the character is pointed.
    const recess = box(0.23, 0.19, 0.06, HUE.shadow)
    recess.position.set(0, 0.14, 0.145)
    this.head.add(recess)

    const wrap = bevel(0.2, 0.09, 0.09, HUE.wrap)
    wrap.position.set(0, 0.09, 0.145)
    this.head.add(wrap)

    // Brow forward, crown back to a point. Both are outline, nothing else.
    const brow = bevel(0.31, 0.08, 0.15, HUE.cloakDeep)
    brow.position.set(0, 0.25, 0.125)
    brow.rotation.x = 0.24
    this.head.add(brow)

    const tipGeo = new THREE.CylinderGeometry(0.02, 0.125, 0.24, 4)
    tipGeo.rotateY(Math.PI / 4)
    tipGeo.translate(0, 0.12, 0)
    const tip = mesh(faceted(tipGeo), HUE.cloak)
    tip.position.set(0, 0.25, -0.12)
    tip.rotation.x = -0.7
    this.head.add(tip)
  }

  private buildCloth(): void {
    this.mantle.position.y = 0.35
    this.chest.add(this.mantle)

    // A short cone off the shoulders. Covers the upper arms and swallows the
    // neck, so the head sits straight on a flaring wedge with no join.
    //
    // Narrow. The first pass had this at 0.325 and the character read as a
    // bell with a point on top: at 36 pixels a cloth mass much wider than the
    // head stops being a garment and becomes the whole body.
    const mantleGeo = new THREE.CylinderGeometry(0.185, 0.27, 0.28, 8, 1, true)
    mantleGeo.rotateY(Math.PI / 8)
    mantleGeo.translate(0, -0.14, 0)
    const mantleMesh = new THREE.Mesh(
      faceted(mantleGeo),
      toonUnique({ color: HUE.cloakDeep, side: THREE.DoubleSide }),
    )
    mantleMesh.castShadow = true
    this.mantle.add(mantleMesh)

    // A hard dark lip at the hem. One dark row of pixels is what turns a
    // continuous red mass into shoulders, then skirt, then legs.
    const trim = bevel(0.63, 0.06, 0.63, HUE.leatherDark)
    trim.position.y = -0.275
    this.mantle.add(trim)

    this.cloak.position.set(0, 0.32, -0.03)
    this.chest.add(this.cloak)

    // The long panel behind. 120 degrees of arc, so it wraps the back and
    // stops well short of the arms instead of crossing in front of the legs,
    // and it hangs to the knee rather than the ankle. This is the piece that
    // does the follow-through, and the piece a player would draw from memory.
    const arc = 2.1
    const cloakGeo = new THREE.CylinderGeometry(0.195, 0.335, 0.45, 8, 1, true, Math.PI - arc / 2, arc)
    cloakGeo.translate(0, -0.225, 0)
    const cloakMesh = new THREE.Mesh(
      faceted(cloakGeo),
      toonUnique({ color: HUE.cloakDeep, side: THREE.DoubleSide }),
    )
    cloakMesh.castShadow = true
    this.cloak.add(cloakMesh)
  }

  private buildPack(): void {
    this.pack.position.copy(PACK)
    this.chest.add(this.pack)

    const sack = bevel(0.33, 0.36, 0.24, HUE.canvas, 0.92)
    sack.position.y = 0.15
    this.pack.add(sack)

    const lid = bevel(0.34, 0.08, 0.25, HUE.leather)
    lid.position.y = 0.35
    this.pack.add(lid)

    // Bedroll lashed across the top, half again as wide as the hood and
    // brighter than everything around it. In outline it is a pale bar sticking
    // out either side of the head, and it is the single fastest way to say
    // "this person is carrying their whole life". Anything narrower than the
    // hood disappears inside the silhouette and may as well not be modelled.
    const rollGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.5, 6)
    rollGeo.rotateZ(Math.PI / 2)
    const roll = mesh(faceted(rollGeo), HUE.cloth)
    roll.position.set(0, 0.29, 0.01)
    this.pack.add(roll)

    for (const side of [-1, 1] as const) {
      const lash = box(0.035, 0.16, 0.25, HUE.leatherDark)
      lash.position.set(side * 0.1, 0.24, 0.01)
      this.pack.add(lash)
    }

    this.lantern.position.set(0.19, 0.12, -0.02)
    this.pack.add(this.lantern)

    const hook = box(0.025, 0.08, 0.025, HUE.leatherDark)
    hook.position.y = -0.04
    this.lantern.add(hook)

    const cap = bevel(0.11, 0.03, 0.11, HUE.leatherDark)
    cap.position.y = -0.09
    this.lantern.add(cap)

    const lamp = bevel(0.1, 0.11, 0.1, HUE.brass)
    lamp.position.y = -0.155
    this.lantern.add(lamp)
  }

  /**
   * @param speed01 how fast the character is moving, normalised to its top speed
   * @param heading direction of travel in radians, ignored when standing still
   */
  update(dt: number, speed01: number, heading: number | null): void {
    // Springs are integrated explicitly, so a dropped frame must not be allowed
    // to hand them a step long enough to blow up.
    const h = Math.min(dt, 1 / 30)
    const inv = 1 / Math.max(h, 1e-4)
    this.t += h

    // -------------------------------------------------------------- turning
    if (heading !== null) {
      const delta = wrapPi(heading - this.facing)
      // A turn taken at speed is a wider arc than a turn taken standing still.
      this.facing += delta * Math.min(1, h * (17 - 7 * this.walk))
      this.lead = delta
    } else {
      this.lead -= this.lead * Math.min(1, h * 6)
    }
    this.group.rotation.y = this.facing

    const turn = wrapPi(this.facing - this.lastFacing) * inv
    this.lastFacing = this.facing
    this.cloakFacing += wrapPi(this.facing - this.cloakFacing) * Math.min(1, h * 8)

    // ---------------------------------------------------------------- speed
    const before = this.walk
    this.walk += (speed01 - this.walk) * Math.min(1, h * 11)
    const w = this.walk
    const idle = 1 - w
    // The caller reports a step function, so this is the only place the game
    // knows the difference between setting off and already moving.
    const accel = (this.walk - before) * inv

    if (w > 0.02) {
      this.phase = (this.phase + h * STRIDE * (0.4 + 0.6 * w)) % TAU
    } else {
      // Below this the swing amplitude is under a tenth of a degree, so the
      // reset is invisible and every departure starts from the same foot.
      this.phase = 0
    }

    const p = this.phase
    const sp = Math.sin(p)
    const cp = Math.cos(p)
    // +1 at passing, -1 at each footfall.
    const beat = Math.cos(2 * p)
    // A narrow spike at each footfall, for the weight landing.
    const strike = Math.max(0, -beat) ** 3

    // ----------------------------------------------------------------- idle
    // tanh flattens the ends of the sine, so the weight arrives on a foot and
    // stays there for a beat instead of sliding continuously between them.
    const shift = Math.tanh(Math.sin(this.t * 0.52) * 2.4) * idle
    const breath = Math.sin(this.t * 1.7) * 0.007 * idle
    const glance = (pulse(this.t, 0.23, 0.7) * 0.6 - pulse(this.t, 0.148, 0.78) * 0.78) * idle

    // ----------------------------------------------------------------- body
    // Highest at passing, lowest at contact, with the landing dug out a little
    // deeper than the sine alone would put it.
    const rise = (beat * 0.04 - strike * 0.03 + 0.016) * w
    this.root.position.y = rise
    this.root.position.x = cp * 0.03 * w + shift * 0.026
    this.root.rotation.x = w * 0.1 + clamp(accel * 0.014, -0.17, 0.22)
    this.root.rotation.z = clamp(-turn * 0.05, -0.2, 0.2)

    // Pelvis leads with the swinging leg, shoulders answer it. The counter
    // rotation is what stops the upper body reading as a plank being carried.
    this.hips.rotation.y = sp * 0.13 * w
    this.hips.rotation.z = cp * 0.05 * w + shift * 0.055
    this.chest.rotation.y = -sp * 0.16 * w + shift * 0.05 + glance * 0.1
    this.chest.rotation.z = -cp * 0.055 * w - shift * 0.07
    this.chest.rotation.x = breath * 0.5 - w * 0.02
    this.chest.position.y = HIP + breath

    // ----------------------------------------------------------------- legs
    for (const leg of this.legs) {
      const lp = p + leg.offset
      const s = Math.sin(lp)
      // Forward is +Z and a positive rotation about X swings the foot back, so
      // the forward reach of the leg is the negative side of the sine.
      leg.hip.rotation.x = -s * 0.6 * w

      // Fold just after toe off to clear the ground, and a much smaller fold
      // just after contact as the leg takes the weight.
      const clear = Math.max(0, Math.cos(lp + 0.9)) ** 2
      const absorb = Math.max(0, -Math.cos(lp + 1.27)) ** 6
      leg.knee.rotation.x = (clear * 0.85 + absorb * 0.2) * w

      // Cancels most of the hip swing, which keeps the sole flat through the
      // stance and leaves a heel strike going in and a toe off coming out.
      leg.ankle.rotation.x = s * 0.42 * w

      // Standing: the unweighted leg softens at the knee and drifts forward.
      const slack = Math.max(0, -leg.side * shift)
      leg.hip.rotation.x -= slack * 0.07
      leg.knee.rotation.x += slack * 0.2
    }

    // ----------------------------------------------------------------- arms
    for (const arm of this.arms) {
      // Opposed to the leg on the same side.
      const swing = -arm.side * sp
      arm.shoulder.rotation.x = swing * 0.44 * w + shift * arm.side * 0.03
      arm.shoulder.rotation.z = arm.side * (0.06 + 0.05 * w)
      // Flexion carries the hand forward, so it is a negative rotation, and it
      // deepens on the forward half of the swing.
      arm.elbow.rotation.x = -(0.28 + Math.max(0, -swing) * 0.3 * w)
    }

    // ----------------------------------------------------------------- head
    // Half the chest yaw is cancelled so the head keeps looking down the line
    // of travel, and it turns toward a new heading before the body follows.
    this.head.rotation.y =
      -this.chest.rotation.y * 0.7 + clamp(this.lead, -0.7, 0.7) * 0.5 + glance + Math.sin(this.t * 0.37) * 0.04 * idle
    this.head.rotation.x =
      -this.root.rotation.x * 0.55 - beat * 0.025 * w - Math.abs(glance) * 0.12 + breath * 0.3
    this.head.position.y = NECK + breath * 0.5

    // ----------------------------------------------------- cloth and cargo
    // The cloak is a child of the chest, so these are corrections that leave it
    // sitting where the body was a moment ago rather than where it is now.
    const drag = wrapPi(this.cloakFacing - this.facing)
    this.cloakPitch.step(h, w * 0.3 + clamp(accel * 0.011, -0.14, 0.28))
    this.cloakRoll.step(h, -turn * 0.06 - cp * 0.07 * w)
    this.mantleRoll.step(h, -turn * 0.028 - cp * 0.03 * w)

    this.cloak.rotation.x = this.cloakPitch.value - this.chest.rotation.x * 0.6
    this.cloak.rotation.z = this.cloakRoll.value - this.chest.rotation.z * 0.5
    this.cloak.rotation.y = clamp(drag, -0.55, 0.55) - this.chest.rotation.y * 0.5

    this.mantle.rotation.x = this.cloakPitch.value * 0.3
    this.mantle.rotation.z = this.mantleRoll.value
    this.mantle.rotation.y = clamp(drag, -0.3, 0.3) * 0.5

    // A loaded pack does not rise and fall with the back it is strapped to; it
    // arrives a fraction late and then keeps going.
    this.packLift.step(h, rise)
    this.pack.position.y = PACK.y + (this.packLift.value - rise) * 0.8
    this.pack.rotation.x = -this.cloakPitch.value * 0.22

    // The lantern is a pendulum, so it hangs down whatever the body is doing.
    this.lanternRoll.step(h, -cp * 0.34 * w - turn * 0.07)
    this.lanternPitch.step(h, clamp(accel * 0.02, -0.35, 0.45) + rise * 1.2)
    this.lantern.rotation.z = this.lanternRoll.value - this.chest.rotation.z - this.root.rotation.z
    this.lantern.rotation.x = this.lanternPitch.value - this.chest.rotation.x - this.root.rotation.x
  }
}
