/**
 * The player character: a hooded scavenger.
 *
 * The camera shows 22 world units top to bottom whatever the resolution, and
 * the character is 1.35 units tall, so it is always about a twentieth of the
 * frame height: roughly 50 pixels in a 900 line window and about 60 at 1080p.
 * Raising the render resolution did not make the character bigger and never
 * will, because the camera is what decides its size. That is sprite territory.
 * Nothing about a face, a belt buckle or a fold of cloth survives at that size;
 * what survives is the outline and the value structure. So the whole design is
 * an outline problem, and every part here earns its place by changing the
 * silhouette:
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
 * fifty pixels; exaggerated ones read as a character.
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
 *       └ pack    bounce
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
 * Secondary motion is a damped spring per degree of freedom. The cloak and the
 * pack chase the body rather than being welded to it, so they arrive late and
 * overshoot when the body stops, which is the whole point.
 *
 * Idle is driven by accumulated time, never by randomness: a weight shift that
 * holds on each foot instead of swinging, a slow breath at a different period,
 * and glances gated off two slow sines whose periods do not divide into each
 * other, so the pattern takes minutes to come back round.
 */

import * as THREE from 'three'
import { toon, toonUnique } from './toon'

const TAU = Math.PI * 2

/**
 * Three masses, three values.
 *
 * At play size the figure is about 26 by 45 pixels and the scene's outline pass
 * is a fixed world-space width, so it eats roughly 3 pixels off every edge and
 * bites irregular wedges out of anything narrow. Under that, a character whose
 * parts differ only in hue collapses into one smear: the previous pass had a
 * hood at luma 194 sitting on a mantle at luma 211 and the head could not be
 * told from the shoulders, which is exactly what happened.
 *
 * So the blocking is value first and everything else second. Head is light,
 * torso is mid, legs are near-black, and the steps between them are about 90
 * points each. That reads as three bands even when the outline has eaten the
 * edges, the frame is desaturated, and every piece of detail is gone.
 *
 * The corollary is that detail below about 3 pixels is not detail, it is noise
 * for the outline to bisect. A lantern, a bedroll, a chest strap, a buckle, hip
 * pouches, boot cuffs and pack lashings were all modelled here and all deleted:
 * individually good ideas, collectively a smear.
 */
const HUE = {
  /**
   * Head. The lightest thing on the character by a wide margin, but held back
   * from white on purpose: the frame's exposure is being lifted about a quarter
   * and a hood already sitting at 220 would clip to flat white and lose its
   * form. At 202 there is still an 80 point step down to the torso.
   */
  head: 0xd8c9a6,
  /** A plane change on the hood brow. Still firmly inside the light band. */
  headShade: 0xc0b28f,
  /**
   * Skin, and the lightest thing on the character.
   *
   * The head used to be ONE pale mass with a small plate stuck on the front,
   * which Max read exactly as what it is: "a jig weird helmet". A human head
   * is two masses, hair and face, and telling them apart is most of what makes
   * a head read as a head rather than as headgear.
   */
  skin: 0xecd2ac,
  /** Turned planes of the face: the nose, the ears. */
  skinShade: 0xd0b087,
  /**
   * Hair. Sandy, and the value is load bearing.
   *
   * Dark hair reads as hair immediately and is wrong here: it lands at the same
   * value as the torso, and it sits directly in front of the pack, which is
   * dark for the express reason that it must not compete with the head. At 159
   * it is a clear step under the skin, a clear step over the pack, and the head
   * stays the light mass the whole value plan is built on.
   */
  hair: 0xc79a5c,
  /** Torso, mantle and sleeves. Mid, and where the red identity now lives. */
  torso: 0xc16a48,
  /** The trailing cloak panel, a step under the torso so it reads as behind. */
  cloak: 0x9c4632,
  /** Legs, boots, mitts and the collar. One near-black mass. */
  legs: 0x241d16,
  /** The pack. Dark, because it sits behind the head and must not compete. */
  pack: 0x5a4630,
  /**
   * The face. Mid, so it separates from the hood without leaving the head's
   * light band: the head has to stay one light mass at a distance and only
   * resolve into a face when you look at it.
   */
  face: 0xc9a078,
  /** Eyes and brow. The darkest thing on the head, by a long way. */
  eye: 0x18131a,
  /** Mouth. A step lighter than the eyes, so the eyes still win the face. */
  mouth: 0x6d3b32,
  /** Lenses. Bright, so worn glasses flip the eye band from dark to light. */
  lens: 0xd7ecf2,
  /** Spectacle frame. Dark enough to hold the lenses apart at four pixels. */
  frame: 0x2b2320,
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

/**
 * A face feature: a small box that the outline pass must not touch.
 *
 * This is the whole reason the header above concluded that "detail below about
 * 3 pixels is not detail, it is noise for the outline to bisect". It is noise
 * only because the outline was drawing round it. The pass is a fixed
 * world-space width, so on a 2-pixel eye the hull is wider than the eye, and on
 * four features 2 pixels apart the four hulls merge into one dark blob — which
 * is exactly what a brow, two eyes, a nose and a mouth turned into on the first
 * try, and is why the face has been two pixels for so long.
 *
 * Excluded from the pass, the same features read as what they are: dark pixels
 * on a lit plate, inside the head's own outline, which is the only outline the
 * head ever needed.
 */
function feature(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = box(w, h, d, color)
  m.userData.noOutline = true
  // Nor a shadow: a 2cm box casting into the face plate 2cm behind it is pure
  // acne at this shadow-map resolution.
  m.castShadow = false
  m.userData.noShadow = true
  return m
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
  private readonly legs: Leg[] = []
  private readonly arms: Arm[] = []
  /** Worn item id to the geometry that shows it. See `setEquipment`. */
  private readonly worn = new Map<string, THREE.Object3D>()

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
  /** Seconds since the player last asked to move. Drives the turn to camera. */
  private still = 0
  /** Facing to settle on when idle. Null leaves the last heading alone. */
  private rest: number | null = null
  /** Smoothed speed. The caller only ever reports 0 or 1, so the ramp is ours. */
  private walk = 0

  private readonly cloakPitch = new Spring(120, 15)
  private readonly cloakRoll = new Spring(105, 13)
  private readonly mantleRoll = new Spring(190, 20)
  private readonly packLift = new Spring(150, 16)

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
      // Half a leg-width apart, so at rest the two legs touch and the lower
      // body is a single dark block. Thin legs with a gap between them do not
      // survive: at 26px wide with 3px of outline on each edge, the previous
      // pair came out as two stray pixels.
      hip.position.set(side * 0.1, 0, 0)

      const thigh = bevel(0.2, 0.24, 0.19, HUE.legs)
      thigh.position.y = -0.12
      hip.add(thigh)

      const knee = new THREE.Group()
      knee.position.y = -0.23
      hip.add(knee)

      const shin = bevel(0.19, 0.2, 0.18, HUE.legs, 0.95)
      shin.position.y = -0.1
      knee.add(shin)

      const ankle = new THREE.Group()
      ankle.position.y = -0.2
      knee.add(ankle)

      const boot = bevel(0.24, 0.16, 0.29, HUE.legs)
      boot.position.set(0, -0.04, 0.045)
      ankle.add(boot)

      this.hips.add(hip)
      this.legs.push({ side, hip, knee, ankle, offset: side < 0 ? 0 : Math.PI })
    }
  }

  private buildTorso(): void {
    const torso = bevel(0.38, 0.44, 0.28, HUE.torso, 1.05)
    torso.position.y = 0.2
    this.chest.add(torso)
  }

  private buildArms(): void {
    for (const side of [-1, 1] as const) {
      const shoulder = new THREE.Group()
      shoulder.position.set(side * 0.17, SHOULDER, 0)

      // The whole arm is dark and tucked inside the mantle's shoulder radius.
      // Only the forearm and mitt clear the hem, so the arm swings inside the
      // lower dark mass rather than leaving a lit sliver beside the torso.
      const upper = bevel(0.13, 0.22, 0.14, HUE.legs)
      upper.position.y = -0.11
      shoulder.add(upper)

      const elbow = new THREE.Group()
      elbow.position.y = -0.2
      shoulder.add(elbow)

      const fore = bevel(0.12, 0.18, 0.13, HUE.legs)
      fore.position.y = -0.09
      elbow.add(fore)

      const mitt = bevel(0.13, 0.12, 0.14, HUE.legs)
      mitt.position.y = -0.215
      elbow.add(mitt)

      this.chest.add(shoulder)
      this.arms.push({ side, shoulder, elbow })
    }
  }

  private buildHead(): void {
    this.head.position.y = NECK
    this.chest.add(this.head)

    // A near-black collar between the light head and the mid torso. The value
    // step already separates them; this makes the join a hard edge rather than
    // a gradient the outline can smudge.
    const collar = bevel(0.3, 0.09, 0.28, HUE.legs)
    collar.position.y = -0.03
    this.head.add(collar)

    /**
     * A head, in two masses.
     *
     * This was one tapered block 0.36 by 0.34 by 0.42 in a single pale colour,
     * with a small darker plate stuck on the front for a face. Deeper than it
     * was wide, uniform in value, and rounded over the top: Max called it a
     * weird helmet, which is precisely what that describes.
     *
     * What makes a head read as a head at forty pixels is not detail, it is the
     * two-mass structure everybody's visual system is tuned for — a cranium
     * with hair on it, and a narrower jaw below the brow carrying a lighter
     * face. Get those two shapes and their values right and the features are
     * confirmation rather than the whole argument.
     *
     * So: cranium wider than deep now rather than the reverse, a jaw that
     * tapers to a chin, hair over the crown and back with a fringe at the brow,
     * and ears where the two masses meet.
     */
    const skull = bevel(0.30, 0.21, 0.285, HUE.skin, 0.94)
    skull.position.set(0, 0.255, -0.015)
    this.head.add(skull)

    // Taper > 1 widens the TOP, so this narrows downward: cheekbones to chin.
    const jaw = bevel(0.272, 0.155, 0.262, HUE.skin, 1.16)
    jaw.position.set(0, 0.132, 0.008)
    this.head.add(jaw)

    const hair = bevel(0.322, 0.155, 0.318, HUE.hair, 0.86)
    hair.position.set(0, 0.30, -0.045)
    this.head.add(hair)

    // The fringe is what stops the hair reading as a cap: a hard dark-over-light
    // edge at the brow line is the single most face-making shape on a head.
    const fringe = box(0.278, 0.05, 0.095, HUE.hair)
    fringe.position.set(0, 0.262, 0.098)
    this.head.add(fringe)

    for (const side of [-1, 1] as const) {
      const ear = feature(0.035, 0.062, 0.055, HUE.skinShade)
      ear.position.set(side * 0.150, 0.196, -0.005)
      this.head.add(ear)
    }

    /**
     * The face, tipped back to meet the camera.
     *
     * The rig looks down at 35 degrees, so a face on a vertical plane is seen
     * 35 degrees off square and loses a third of its height to foreshortening.
     * On a ten pixel face that is three rows, which is most of what there was.
     * Tipping the plane up hands them back and costs nothing, because the
     * character is never seen from below.
     *
     * One group, so the whole face tips together and the spectacles stay on the
     * nose rather than sliding down it.
     */
    const front = new THREE.Group()
    front.rotation.x = -0.3
    front.position.set(0, 0.196, 0.115)
    this.head.add(front)

    /**
     * Brow, eyes, nose, mouth, and none of them outlined.
     *
     * The face was two dark pixels, on the reasoning that anything more becomes
     * "noise for the outline to bisect". The observation was right and the
     * conclusion was backwards: it is noise only BECAUSE the outline was drawing
     * round it. The pass is a fixed world-space width, so on a two-pixel eye the
     * hull is wider than the eye and four features two pixels apart merge into
     * one dark blob. Excluded from the pass, the same four read cleanly.
     *
     * The rows are spaced so that when the face collapses to four pixels of
     * height at distance, what survives is dark-light-dark-light: fringe, brow,
     * eyes, chin. That is the pattern the eye reads as a face when it cannot
     * see a single feature, and it is the real test, not whether the mouth is
     * legible.
     */
    const brow = feature(0.16, 0.022, 0.04, HUE.skinShade)
    brow.position.set(0, 0.044, 0.025)
    front.add(brow)

    for (const side of [-1, 1] as const) {
      const eye = feature(0.04, 0.038, 0.04, HUE.eye)
      eye.position.set(side * 0.05, 0.008, 0.032)
      front.add(eye)
    }

    // A plane, not a lump. Standing the nose out gives it a lit side and a
    // shadowed one, which at this size is worth more than its silhouette: it is
    // what stops the face reading as a sticker printed on the front of a block.
    const nose = feature(0.03, 0.052, 0.042, HUE.skinShade)
    nose.position.set(0, -0.032, 0.036)
    front.add(nose)

    const mouth = feature(0.058, 0.02, 0.035, HUE.mouth)
    mouth.position.set(0, -0.072, 0.026)
    front.add(mouth)

    /**
     * Worn spectacles: two bright lenses in a dark frame, with a bridge.
     *
     * One bright bar was tried first, on the argument that flipping the eye band
     * from dark to light is a change of SIGN and therefore legible where detail
     * is not. True, and it also read as a blindfold. Lenses light, frame dark,
     * and the gap between them held open by the bridge: the sign still flips,
     * and the shape that flips is glasses-shaped.
     */
    const specs = new THREE.Group()
    for (const side of [-1, 1] as const) {
      const rim = feature(0.082, 0.068, 0.028, HUE.frame)
      rim.position.set(side * 0.052, 0.008, 0.042)
      specs.add(rim)
      const lens = feature(0.058, 0.046, 0.022, HUE.lens)
      lens.position.set(side * 0.052, 0.008, 0.052)
      specs.add(lens)
      // Arms, back along the temple. Only a few pixels, but they are what say
      // the glasses are ON the head rather than painted on the front of it.
      const arm = feature(0.02, 0.015, 0.14, HUE.frame)
      arm.position.set(side * 0.096, 0.02, -0.03)
      specs.add(arm)
    }
    const bridge = feature(0.034, 0.016, 0.024, HUE.frame)
    bridge.position.set(0, 0.014, 0.044)
    specs.add(bridge)

    specs.visible = false
    front.add(specs)
    this.worn.set('glasses', specs)
  }

  private buildCloth(): void {
    this.mantle.position.y = 0.35
    this.chest.add(this.mantle)

    // The mantle IS the torso band, so it takes the torso value rather than a
    // separate one. It hangs to just above the knee, which leaves a long dark
    // leg mass below it: the previous hem sat high enough that the legs were
    // barely present at all.
    const mantleGeo = new THREE.CylinderGeometry(0.195, 0.275, 0.32, 8, 1, true)
    mantleGeo.rotateY(Math.PI / 8)
    mantleGeo.translate(0, -0.16, 0)
    const mantleMesh = new THREE.Mesh(
      faceted(mantleGeo),
      toonUnique({ color: HUE.torso, side: THREE.DoubleSide }),
    )
    mantleMesh.castShadow = true
    this.mantle.add(mantleMesh)

    this.cloak.position.set(0, 0.32, -0.03)
    this.chest.add(this.cloak)

    // The long panel behind, and the only piece left that does follow-through.
    const arc = 2.1
    const cloakGeo = new THREE.CylinderGeometry(0.2, 0.32, 0.44, 8, 1, true, Math.PI - arc / 2, arc)
    cloakGeo.translate(0, -0.22, 0)
    const cloakMesh = new THREE.Mesh(
      faceted(cloakGeo),
      toonUnique({ color: HUE.cloak, side: THREE.DoubleSide }),
    )
    cloakMesh.castShadow = true
    this.cloak.add(cloakMesh)
  }

  private buildPack(): void {
    this.pack.position.copy(PACK)
    this.chest.add(this.pack)

    // One mass. The lid, the bedroll, the lashings and the hanging lantern all
    // lived here and all had to go: the bedroll in particular stuck out either
    // side of the hood, which is precisely what made head and shoulders
    // impossible to tell apart.
    const sack = bevel(0.32, 0.38, 0.24, HUE.pack, 0.92)
    sack.position.y = 0.16
    this.pack.add(sack)
  }

  /**
   * Show whatever is currently worn.
   *
   * Takes main.ts's `equipped` map straight, so the caller keeps no extra
   * bookkeeping and can call this every frame: it walks a two-entry table, not
   * the map. Keyed on item id rather than on slot, because a future second
   * item in the same slot must not inherit this one's geometry.
   */
  setEquipment(equipped: ReadonlyMap<string, string>): void {
    for (const [id, obj] of this.worn) obj.visible = false
    for (const id of equipped.values()) {
      const obj = this.worn.get(id)
      if (obj) obj.visible = true
    }
  }

  /**
   * @param speed01 how fast the character is moving, normalised to its top speed
   * @param heading direction of travel in radians, ignored when standing still
   */
  /** Where to look when nobody is steering. See the idle branch of `update`. */
  setRestFacing(yaw: number | null): void {
    this.rest = yaw
  }

  /**
   * Jump straight to the resting pose.
   *
   * For the headless harness, which renders exactly one frame: without this a
   * screenshot always catches the character mid-turn, one sixtieth of a second
   * after spawning, and could never show the steady state. Same reason
   * `fadeOccluders` snaps on its first call.
   */
  settle(): void {
    if (this.rest !== null) this.facing = this.rest
    this.still = 99
    this.group.rotation.y = this.facing
  }

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
      this.still = 0
    } else {
      this.lead -= this.lead * Math.min(1, h * 6)

      /**
       * Stand still long enough and you turn to face the camera.
       *
       * Keeping the heading you last walked in is the usual rule and it was
       * costing the whole face: the player spends most of a session standing
       * somewhere, and wherever that is, they got there by walking, so the
       * character is showing their back. A face and a pair of spectacles that
       * are only visible while walking south-east are not visible.
       *
       * Delayed and slow on purpose. Snapping round the moment you release a
       * key reads as the character being yanked; a second of stillness and then
       * an unhurried turn reads as somebody stopping to look about.
       */
      this.still += h
      if (this.rest !== null && this.still > 0.9) {
        this.facing += wrapPi(this.rest - this.facing) * Math.min(1, h * 2.4)
      }
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
  }
}
