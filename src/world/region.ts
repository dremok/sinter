/**
 * Band 0 region: one small, hand-laid clearing, composed rather than scattered.
 *
 * The first pass placed correct objects on a flat lawn. Everything was legible
 * and nothing was a place. This pass is about composition: ground that rises
 * and falls, a home with a yard worn into it, and tracks leading out of it.
 *
 * Three rules drove the layout.
 *
 *   1. D20 bans quest markers, so the world has to do the guiding. The main
 *      track runs from the hearth, out through the yard gate, north across the
 *      hollow and straight into the palisade gate. A road that stops at a
 *      barred gate is the whole objective, stated without a word of UI.
 *   2. Home is read as inhabited by detail density, not by architecture. Two
 *      cottages are a diorama; two cottages plus a washing line, a vegetable
 *      patch, a chicken run, a chopping block and mud where everyone walks is
 *      somewhere people live.
 *   3. Nothing in nature is a circle and nothing built by hand is straight. The
 *      pond has an irregular shore, the tree line clusters and thins, the
 *      palisade leans, and one section of it has been patched.
 *
 * Item placement is authored rather than random, and every item now sits on a
 * track, at a landmark, or where somebody would have put it down. At this size
 * a seeded scatter produces clumps and dead corners, and a player cannot tell
 * "procedural" from "careless". Generation earns its place at region scale.
 *
 * Nothing in this file authors a solution to anything. It places facts.
 */

import * as THREE from 'three'
import { createNoise2D } from 'simplex-noise'
import { STEP_HEIGHT } from '../core/body'
import { box, circle, distanceTo, type Footprint } from '../core/footprint'
import type { Rng } from '../core/rng'
import { queries, world, type Entity } from '../ecs/world'
import { CATALOG, STARTING_ITEMS } from '../items/catalog'
import { buildItemMesh } from '../render/kitbash'
import { BAND0 } from '../render/palette'
import { toonUnique } from '../render/toon'
import { textures, tiled } from '../render/textures'
import { createSmokeColumn } from '../render/flame'
import { footprintOf } from './measure'

/**
 * Where the player may walk. Outside this is tree line.
 *
 * Deliberately not symmetric. It grew east, to hold the burner's camp
 * downstream of the mill, and it grew a long way north, past the wall, because
 * that side is the only thing the region says about what is out there and
 * fourteen metres of it was a strip rather than a place.
 *
 * Everything that defines the edge is derived from this: the tree line, the
 * bracken fringe, the scatter, and the rock spurs that stop the wall being
 * walked around. Widening the region used to leave a hole at the end of the
 * palisade, because the spur ran to a hardcoded 29.5.
 */
export const BOUNDS = { minX: -28, maxX: 37, minZ: -36, maxZ: 20 }

/**
 * The terrain mesh, which has to stay comfortably larger than anything the
 * player can see from inside BOUNDS. Exported so that growing the region and
 * forgetting this is a failing test rather than a visible edge of the world.
 */
export const GROUND_SIZE = 132
/** Half-unit quads. Coarser than this and the banks read as facets. */
const GRID = 220

/**
 * How many of something to scatter over the whole region, given the count that
 * looked right in the old 56x42 clearing.
 *
 * Ground cover is a density, not a count. A number that reads well at one size
 * is wrong at every other, and this region is going to keep growing: leave the
 * counts literal and the new ground comes out visibly balder than the old.
 */
function perArea(atOldSize: number): number {
  const area = (BOUNDS.maxX - BOUNDS.minX) * (BOUNDS.maxZ - BOUNDS.minZ)
  return Math.round((atOldSize * area) / (56 * 42))
}

/** Pond centre. The radius is a function of angle; see `pondRadius`. */
const POND = { x: -11.8, z: 5.2 }
const POND_DEPTH = 1.6
export const WATER_LEVEL = -0.42

/**
 * The mere, on the far side of the wall. The region's other water, and nothing
 * like it.
 *
 * The pond at home is full to a shelving sand beach with reeds and lilies on
 * it. This one has dropped: the dish is 2.1m deep and the water sits 0.44 of
 * that below the rim, which leaves it standing in the middle of a wide pale
 * margin that used to be under it. Nothing grows at the edge. Fill is a fact
 * about a pool, so this is the fact that says the far side is drying out,
 * without saying anything.
 */
const MERE = { x: 9.4, z: -23.0 }
const MERE_DEPTH = 2.1
/** How far below its own rim the water stands, as a fraction of the depth. */
const MERE_FILL = 0.44

/**
 * The brook. Water leaves the pond and goes somewhere, which is the cheapest
 * way to make a landscape look like it obeys its own rules rather than like a
 * set of props on a lawn. It also gives the region a second axis: the track
 * runs north to the gate, the water runs east to the mill, and they cross.
 */
const BROOK: readonly (readonly [number, number])[] = [
  // Starts INSIDE the pond and ends past the tree line, on purpose. Water that
  // begins and ends in open ground is a puddle stretched thin, and the first
  // version did both: it started a metre and a half short of the pond and then
  // stopped dead in a field.
  [-12.6, 3.6],
  [-11.0, 1.4],
  [-8.4, -0.4],
  [-5.0, -1.8],
  [0.5, -1.2],
  [6.5, 0.8],
  [12.5, 2.2],
  [18.5, 4.6],
  [26.0, 7.4],
  [33.0, 10.4],
  [42.0, 14.5],
]
const BROOK_W = 2.0
const BROOK_D = 0.8

/** Where the brook and the main track meet, and therefore where the plank is. */
const FORD = { x: 0.1, z: -1.25 }

/** The hearth, and the centre everything at home is laid out around. */
const HOME = { x: 0, z: 13.4 }

/**
 * The charcoal burner's kiln, on the rise past the mill.
 *
 * The region grew east and new ground has to be worth walking to, so the far
 * end of the water gets a place rather than more field. What makes it readable
 * from home is the same thing that makes home readable from out here: a column
 * of smoke. There are exactly two fires in this region, and one of them is past
 * everything else, which is a sightline and a reason in the same object.
 */
const KILN = { x: 30.5, z: 0.6 }

/**
 * Everything that is permanently HOT, and therefore everything loose fuel has
 * to stay clear of.
 *
 * Stated once as a rule rather than as a radius typed next to each fire. A
 * kiln and a hearth both burn forever and never burn out, so a clump of dry
 * grass within the fire's reach of either is a wildfire on the first tick of
 * every run at that seed. Home already had this as a hardcoded distance from
 * one coordinate; there are two now and there will be more.
 */
const HEARTHS: readonly { x: number; z: number }[] = [HOME, KILN]

/** Shortest distance from a point to a polyline, on the ground plane. */
function distToPath(x: number, z: number, pts: readonly (readonly [number, number])[]): number {
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const l2 = dx * dx + dz * dz
    let t = l2 > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const d = Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz))
    if (d < best) best = d
  }
  return best
}
/** The palisade line. */
const PAL_Z = -8

/**
 * Where the clearing stops being the clearing, per column of x.
 *
 * Not the wall itself. There is a stretch of ordinary ground on the far side of
 * the palisade so that getting through it does not feel like stepping into a
 * different game; the change happens as you climb, which is slower and reads as
 * the world rather than as a boundary. Anything that belongs to home — bright
 * scrub, flowers — stops here, and the moor starts.
 *
 * Clamped, and that is the whole reason this is a function rather than a sum of
 * sines written inline somewhere. Brown moor showing inside the clearing says
 * the world changed before the player got past the obstacle, and that is the
 * one statement the palisade exists to make; the ground is not allowed to make
 * it first.
 *
 * The band of ordinary ground it leaves past the wall runs from about a metre
 * and a half to about nine, which is what stops the change reading as a line
 * painted along the palisade. The three amplitudes CAN sum past the margin, so
 * the clamp does fire, on the short stretches of x where all three peak at
 * once; take it away and moor appears inside the clearing there.
 */
export function moorEdge(x: number): number {
  const raw =
    -13.2 +
    2.2 * Math.sin(x * 0.21 + 1.3) +
    1.4 * Math.sin(x * 0.47 - 0.6) +
    0.8 * Math.sin(x * 0.93 + 2.1)
  return Math.min(PAL_Z - 1.5, raw)
}

/**
 * A tall opaque thing that can stand between the camera and the player.
 *
 * `radius` and `top` are the horizontal half-extent and the height above the
 * object's own origin. Both are known exactly at build time, which is cheaper
 * and steadier than computing a bounding box from geometry that includes a
 * canopy hanging out over the trunk.
 */
/**
 * A tall opaque thing that can stand between the camera and the player.
 *
 * `radius` and `top` are the horizontal half-extent and the height above the
 * object's own origin. Both are known exactly at build time, which is cheaper
 * and steadier than computing a bounding box from geometry that includes a
 * canopy hanging out over the trunk.
 */
interface Occluder {
  object: THREE.Object3D
  radius: number
  top: number
  /**
   * Never fade this, whatever it covers.
   *
   * For landmarks and buildings. D20 bans quest markers so that the world does
   * the guiding, which makes a landmark that dissolves as you walk up to it
   * actively harmful: the one thing you were aiming at stops being there.
   * Buildings are pinned for a second reason as well — they are assemblies of
   * thirty overlapping boxes with a lit interior behind the wall, and ghosting
   * one shows you all of it at once, which reads as corrupted geometry rather
   * than as transparency.
   */
  pinned?: boolean
  /** Current opacity, eased toward the target. 1 means fully solid. */
  opacity: number
  /** Cloned, transparent-capable materials, made only when one is first needed. */
  faded: { mesh: THREE.Mesh; solid: THREE.Material; ghost: THREE.MeshToonMaterial }[] | null
  /** Outline shells, hidden while ghosting rather than faded. See fadeOccluders. */
  hulls?: THREE.Mesh[] | null
}

/**
 * A flat surface the player can stand on, with the same shape vocabulary as a
 * blocker.
 *
 * A deck is a rectangle. Approximating one with a run of discs overhangs its
 * ends, which is how the plank crossing came to have half a metre of invisible
 * floor sticking out into the stream at each end.
 */
export interface Standable extends Footprint {
  /** World height of the surface. */
  top: number
}

export interface Region {
  group: THREE.Group
  heightAt: (x: number, z: number) => number
  playerStart: THREE.Vector3
  gate: THREE.Vector3
  /**
   * Fade whatever is currently hiding the player. Call once per frame.
   *
   * Camera rotation is unbound, so the player cannot turn to see around a
   * trunk any more, which makes a permanently hidden player a real defect
   * rather than a keypress away. Ghosting to a quarter opacity rather than to
   * nothing, because an invisible tree reads as a bug and a faint one reads as
   * a tree you are behind.
   */
  fadeOccluders: (playerPos: THREE.Vector3, camera: THREE.Camera, dt: number) => void
  /**
   * Flat tops the player can stand on: a felled trunk, the jetty deck, a
   * chopping block, a bench. `top` is the world height of the surface.
   *
   * Separate from `blocker` on purpose, and the split is a property question
   * rather than a per-prop one. Something PLATFORM-ish and low enough to step
   * onto raises the walkable height; everything else stops you. That is rule 2
   * doing the work, and it means a plank the player drops becomes a step
   * without anybody writing that down.
   */
  standables: Standable[]
  /**
   * Every occluder's current opacity, for the flicker check.
   *
   * Exposed because "things flicker when I move" has been reported three times
   * and diagnosed from a still screenshot zero times. A still frame cannot show
   * an object that is toggling; a log of these numbers over a walk can.
   */
  occluderStates: () => { x: number; z: number; radius: number; opacity: number }[]
  /**
   * What is here and what it is for.
   *
   * D22 asks that a region expose its meaning rather than just its geometry, so
   * that systems ask the region instead of knowing the map. Nothing consumes
   * this yet; it exists so that when something does — an NPC who says where the
   * mill is, a generator validating that home has water within reach, a spawn
   * rule that wants somewhere `work` shaped — it asks rather than hardcodes a
   * coordinate that generation would immediately invalidate.
   */
  places: Place[]
}

/**
 * Where the gate ends and the palisade begins.
 *
 * Exported as data, and derived from one number, because the two used to be
 * laid down independently: the run started at +-1.5 and the gate pillars stand
 * at +-1.35 with a 0.45 radius, so the first post on each side was buried
 * whole inside a pillar. Invisible, destructible, and — because `fail` strips
 * a felled thing's blocker — the pillar's collision was coming from it. Chop a
 * post nobody can see and you open a hole through a pillar still standing.
 *
 * That is the general hazard rather than one bad number: where two structures
 * overlap, one may be silently providing the other's collision, and any
 * destructible thing standing in for a permanent one is a hole waiting to be
 * opened. Hence the test.
 */
export const PALISADE = {
  /** Half-width of the gate, and the radius of its blocker. */
  gateHalf: 1.9,
  /** Blocker radius of one post. */
  postRadius: 0.62,
  /** Visual radius of one post. */
  postGirth: 0.36,
  /** Radius of a gate pillar, which stands at +-1.35. */
  pillarRadius: 0.45,
  pillarAt: 1.35,
  /**
   * How far the rock spur at each end has to run, so the wall cannot simply be
   * walked around.
   *
   * This was a hardcoded 29.5 on both sides, which was correct for exactly one
   * pair of bounds and silently wrong the moment the region grew east. A wall
   * that stops short of the edge is not an obstacle, it is a detour, and
   * `verify:collision` cannot see it: that check asks whether there is a gap
   * WITHIN a run of circles, and a run that ends early has no gap in it. So the
   * reach is data, and there is a test.
   */
  spurTo(side: -1 | 1): number {
    return (side < 0 ? -BOUNDS.minX : BOUNDS.maxX) + 2
  },
  /** Post centres, outward from the gate on both sides. */
  posts(): number[] {
    const out: number[] = []
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) out.push(side * (this.gateHalf + 0.38 + i * 0.76))
    }
    return out
  },
} as const

/**
 * How world-up projects under this rig: a point `u` metres above something is
 * `0.816u` higher on screen AND `0.577u` nearer the camera. Both at once, which
 * is precisely what the first version of the occlusion test got wrong.
 */
const VIEW_UP = 0.8165
const VIEW_TOWARD = 0.5774

/** An occluder reduced to what the geometry needs, in view space. */
export interface OccluderInView {
  /** Base of the object, through the camera's inverse world matrix. */
  x: number
  y: number
  z: number
  /** Horizontal half-extent, and height above the base, in world units. */
  radius: number
  top: number
  /** Landmarks and buildings never fade, whatever they cover. */
  pinned?: boolean
}

/** Something that must stay visible, in view space, and where to test it. */
export interface TargetInView {
  x: number
  y: number
  z: number
  /** Row to test: mid-body for a person, near the ground for an item. */
  row: number
}

/**
 * Does this occluder actually hide any of these targets?
 *
 * Exported so it can be tested, and worth testing: it is the only geometry in
 * this file that has been deleted and restored, it is easy to break, and when
 * it breaks nothing crashes. Things simply fade at the wrong moments, which is
 * noticed only by whoever happens to be standing in the wrong place.
 *
 * The middle test is the one that matters. Solve for the height on the occluder
 * that shares the target's row on screen, then ask whether THAT point is nearer
 * the camera. Treating "higher up" and "nearer" as independent conditions hands
 * every tall object a depth bonus proportional to its height, which is why a
 * 3.9m gate faded while the player stood in front of it.
 */
export function occluderHides(o: OccluderInView, targets: readonly TargetInView[]): boolean {
  if (o.pinned) return false

  for (const t of targets) {
    const u = (t.y + t.row - o.y) / VIEW_UP
    // The target's row is below this object's base, or above its top.
    if (u < 0 || u > o.top) continue
    // That part of the object is behind the target, so it cannot cover it.
    if (o.z + u * VIEW_TOWARD <= t.z + 0.35) continue
    // The target's centre must be inside the silhouette, not merely touching
    // it. Clipping someone's shoulder is not hiding them.
    if (Math.abs(o.x - t.x) >= o.radius) continue
    return true
  }
  return false
}

/**
 * How see-through a tree gets when it is in the way.
 *
 * Not zero, on purpose: an invisible tree reads as a bug, a faint one reads as
 * a tree you are behind. Nudged up from a quarter after looking at it, because
 * once the outline pass stopped drawing over it the ghost was disappearing
 * almost completely against bright ground.
 */
const FADE_TO = 0.34
const FADE_IN_RATE = 1 / 0.15
const FADE_OUT_RATE = 1 / 0.3

export interface Place {
  id: string
  kind: 'home' | 'water' | 'work' | 'landmark' | 'exit'
  at: THREE.Vector3
  /**
   * Straight-line metres from home.
   *
   * `kind` alone is not enough to place anything against, and this is the gap
   * that showed it: the mill and the burner's camp are both `work`, and they
   * are twenty metres apart in what they mean. Something strange found beside
   * the hearth spends the whole effect at once; the same object found at the
   * far edge is the genre gradient doing its job. That rule needs a number.
   *
   * Straight line rather than walking distance, deliberately. Walking distance
   * would fold in whether the palisade is still standing, which changes during
   * a run, and a placement rule evaluated at generation time must not depend on
   * something the player can burn down.
   */
  distance: number
  /**
   * The same fact as a fraction: 0 at home, 1 at the furthest place in this
   * region.
   *
   * Both are here because they answer different questions and only one of them
   * survives generation. Metres are the fact, and a rule written in metres
   * ("past 30m") silently means something different in a region twice the size,
   * which D22 says is exactly the kind of thing that must not be baked in. A
   * rule written as "the outer third" means the same thing in every region
   * this generator will ever produce.
   */
  remoteness: number
}

/**
 * The camera azimuth is fixed now, so what is hidden is decidable at build
 * time. These are the three components of the isometric projection for
 * AZIMUTHS[0], the direction the camera actually sits in.
 *
 *   sx  across the screen        sy  up the screen        depth  toward camera
 *
 * Used only by the build-time item check. The runtime fade goes through the
 * real camera matrix instead, so it stays correct if rotation ever comes back.
 */
const ISO_SX = Math.SQRT1_2
const ISO_SY_GROUND = 0.4082
const ISO_SY_UP = 0.8165


function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Distance from the pond centre to its rim, as a function of bearing. */
function pondRadius(a: number): number {
  return 4.3 + 0.85 * Math.sin(a * 2 + 0.7) + 0.5 * Math.sin(a * 3 - 1.9) + 0.28 * Math.sin(a * 5 + 2.4)
}

/**
 * The same, for the mere. Wider and lumpier, and out of phase with the pond, so
 * the two do not read as one shape used twice.
 */
function mereRadius(a: number): number {
  return 6.0 + 1.15 * Math.sin(a * 2 - 2.2) + 0.62 * Math.sin(a * 3 + 1.1) + 0.3 * Math.sin(a * 5 - 0.4)
}

export function buildRegion(rng: Rng, scene: THREE.Scene): Region {
  const group = new THREE.Group()
  scene.add(group)

  const terrainRng = rng.fork('terrain')
  const noise = createNoise2D(() => terrainRng.next())

  const bump = (x: number, z: number, cx: number, cz: number, sigma: number, amp: number): number =>
    amp * Math.exp(-(((x - cx) ** 2 + (z - cz) ** 2) / (2 * sigma * sigma)))

  /**
   * The land, before any water is cut into it.
   *
   * Split out from `heightAt` so that a basin can be sunk relative to the
   * ground it sits in rather than to an absolute number. The far side stands
   * five metres above the clearing, so a pool cut to a fixed depth below zero
   * out there is a crater; a pool cut to a fixed depth below ITS OWN rim is a
   * pool wherever the generator eventually decides to put it.
   *
   * Six features carry the composition:
   *
   *   - a knoll east of home, so the great oak stands above everything
   *   - a hollow between home and the wall, so the wall is revealed by walking
   *   - a levelled terrace under the yard, because people flatten what they
   *     live on, and because huts on a slope float at one corner
   *   - ground that climbs beyond the palisade, so the road out goes uphill
   *   - and keeps climbing, so the far side is a hill with a crest on it and
   *     the road disappears over the top rather than stopping in a field
   *   - a rise downstream of the mill, to stand the burner's camp on
   */
  const landAt = (x: number, z: number): number => {
    let h = noise(x * 0.033, z * 0.033) * 0.62 + noise(x * 0.095, z * 0.095) * 0.2

    h += bump(x, z, 10.6, 8.4, 4.6, 1.6)
    h -= bump(x, z, -3.0, 1.0, 5.6, 1.0)
    h += bump(x, z, -15.0, -0.5, 4.2, 0.9)
    h += bump(x, z, KILN.x, KILN.z, 4.6, 1.7)
    h += smoothstep(-5, -22, z) * 3.0
    // Purely additive past the old edge, so nothing at z > -22 moves. The
    // palisade, the crossing and everything derived from a bank are all on the
    // near side of that line, and terrain is shared: a change here is never
    // local.
    h += smoothstep(-22, -34, z) * 2.6

    // Reaches far enough to hold the widened holding and no further. Pushed out
    // to 13.4 once, which reached the brook twelve metres away and lifted its
    // south bank, which lifted the crossing that is derived from the bank,
    // which put the deck out of stepping range from the water. Terrain is
    // shared: a radius here is not a local decision.
    const yard = 1 - smoothstep(7.6, 11.9, Math.hypot((x - HOME.x) * 0.82, z - HOME.z))
    return h * (1 - yard) + 0.42 * yard
  }

  /**
   * The rim the dead pool is sunk from, measured rather than typed. See MERE.
   */
  const MERE_RIM = landAt(MERE.x, MERE.z)

  const heightAt = (x: number, z: number): number => {
    let h = landAt(x, z)

    // The brook, cut before the pond so that where the two meet the pond wins
    // and the channel simply runs out into it. Shallow on purpose: this is
    // scenery and a sightline, not an obstacle, and you wade it anywhere.
    const bd = distToPath(x, z, BROOK)
    if (bd < BROOK_W) {
      const t = bd / BROOK_W
      h -= BROOK_D * (1 - t * t) ** 1.2
    }

    const dx = x - POND.x
    const dz = z - POND.z
    const d = Math.hypot(dx, dz)
    const r = pondRadius(Math.atan2(dz, dx))
    if (d < r) {
      // Exponent chosen so the ground crosses WATER_LEVEL at about 0.55 of the
      // radius. That leaves a wide, gently shelving beach rather than a rim you
      // fall off, and the waterline ends up wherever the terrain crosses the
      // water plane, which is irregular for free.
      const t = d / r
      h = h * (t * t) - POND_DEPTH * (1 - t) ** 1.34
    }

    // The mere. Same flatten-and-sink shape, but referenced to MERE_RIM instead
    // of to zero, so the floor is deterministic wherever the dish is put and
    // the waterline lands exactly where the dish crosses MERE_LEVEL.
    const mx = x - MERE.x
    const mz = z - MERE.z
    const md = Math.hypot(mx, mz)
    const mr = mereRadius(Math.atan2(mz, mx))
    if (md < mr) {
      const t = md / mr
      h = h * (t * t) + MERE_RIM * (1 - t * t) - MERE_DEPTH * (1 - t) ** 1.35
    }
    return h
  }

  /** Where the mere's surface sits. Derived, so it can never miss the dish. */
  const MERE_LEVEL = MERE_RIM - MERE_DEPTH * MERE_FILL

  /** Everything that can hide the player. Filled in as the world is built. */
  const occluders: Occluder[] = []
  const standables: Standable[] = []

  /** A round surface to walk on: a stump, a chopping block, a barrel top. */
  const stand = (x: number, z: number, radius: number, top: number): void => {
    standables.push({ ...circle(x, z, radius), top })
  }

  /**
   * A rectangular surface to walk on: a deck, a jetty, a fallen trunk.
   *
   * `w` and `dep` are full extents and `turn` is the mesh's own `rotation.y`,
   * so a caller passes the numbers it already used to build the thing and the
   * collision cannot end up a different shape from the object.
   */
  const standDeck = (
    x: number,
    z: number,
    w: number,
    dep: number,
    turn: number,
    top: number,
  ): void => {
    standables.push({ ...box(x, z, w / 2, dep / 2, turn), top })
  }

  /**
   * The HIGHEST ground anywhere under a rectangle, in the same frame a
   * footprint uses.
   *
   * Anything long laid on a slope meets the ground higher at one end than at
   * its middle, so a surface height taken from the centre is buried at that
   * end and the player walks through it. That is exactly how the plank
   * crossing came to sit 0.26m under its own bank, and it is not a fact about
   * bridges: a fallen beam and a toppled stone have the same problem at a
   * twentieth of the size.
   */
  const groundUnder = (x: number, z: number, hx: number, hz: number, ry: number): number => {
    const c = Math.cos(ry)
    const s = Math.sin(ry)
    let high = -Infinity
    for (const lx of [-hx, 0, hx]) {
      for (const lz of [-hz, 0, hz]) {
        high = Math.max(high, heightAt(x + lx * c + lz * s, z - lx * s + lz * c))
      }
    }
    return high
  }

  /**
   * Solid scenery. Anything a player can bump into needs one of these or they
   * walk through it, which was the whole of the lakeside bug: the logs and the
   * jetty looked solid and were not there at all as far as movement was
   * concerned.
   *
   * There are exactly two, and neither takes a size. See `world/measure.ts`.
   */
  /**
   * A round thing, blocked by a circle measured from it.
   *
   * The other half of `solidBuilt`. A barrel, a boulder and a standing stone
   * are genuinely round, and a box round them puts 17cm of invisible wall on
   * each corner; a coop and a drying rack are genuinely rectangular, and a
   * circle round them either misses the ends or bulges past the sides. So the
   * choice between these two is a fact about the object's shape, which cannot
   * drift, rather than a number, which can.
   */
  const solidRound = (
    mesh: THREE.Object3D,
    y: number,
    label: string,
    props: Entity['props'],
  ): void => {
    const f = footprintOf(mesh)
    if (!f) return
    world.add({
      transform: { pos: new THREE.Vector3(f.x, y, f.z), ry: 0 },
      mesh,
      label,
      props,
      blocker: circle(f.x, f.z, Math.max(f.hx, f.hz)),
    })
  }

  /**
   * A built thing, blocked by the shape of the thing.
   *
   * Nothing is typed here. The footprint is MEASURED from the meshes, in the
   * band between the player's knee and their shoulder, which is the only part
   * of an object that can stop them walking. See `world/measure.ts`.
   *
   * Two rounds of collision bugs came out of doing it any other way. First a
   * run of ~30 overlapping circles round each perimeter, because a circle
   * cannot be a rectangle — thirty entities per building and every wall subtly
   * lumpy. Then one honest oriented box per building, from hand-typed width
   * and depth, which is exact right up until somebody adds a chimney standing
   * 0.53m proud of the west wall and does not also change two numbers eighty
   * lines away. Max walked through the stack the day after.
   *
   * Hand-typed extents are a second description of the building, and a second
   * description drifts. So there is only one now.
   */
  function solidBuilt(
    mesh: THREE.Object3D,
    y: number,
    label: string,
    props: Entity['props'],
  ): void {
    const f = footprintOf(mesh)
    if (!f) return
    world.add({
      transform: { pos: new THREE.Vector3(f.x, y, f.z), ry: f.ry },
      mesh,
      label,
      props,
      blocker: f,
    })
  }
  const occluder = (
    object: THREE.Object3D,
    radius: number,
    top: number,
    pinned = false,
  ): Occluder => ({ object, radius, top, opacity: 1, faded: null, pinned })


  const tex = textures(rng)

  // Surfaces whose UVs are authored in world units, 3.2 of them per tile, which
  // matches the ground's texel density. `tiled(_, 3.2, 3.2)` is exactly repeat 1.
  const worldUv = (x: number, z: number): [number, number] => [x / 3.2, z / 3.2]
  const flatMat = (t: THREE.CanvasTexture, color?: number): THREE.MeshToonMaterial =>
    toonUnique({ ...(color === undefined ? {} : { color }), map: tiled(t, 3.2, 3.2), side: THREE.DoubleSide })

  const M = {
    track: flatMat(tex.sand, 0xbb9160),
    yard: flatMat(tex.sand, 0x9c7a4e),
    rut: flatMat(tex.sand, 0x836444),
    ash: flatMat(tex.stone, 0x6a5949),
    parched: flatMat(tex.grass, 0xd9c67e),
    wheat: flatMat(tex.straw, 0xe7d296),
    tilled: flatMat(tex.sand, 0xa07d55),
    shore: flatMat(tex.sand, 0xd9bf8e),

    /**
     * Beyond the wall.
     *
     * The first attempt at this was a dull green, and it read as grass in
     * shadow rather than as different ground: at this distance the eye reads
     * hue before value, and anything green next to green is the same place.
     * These moved off green entirely. Moorland genuinely is brown, and brown
     * next to that clearing is unmistakable from across the region.
     */
    // Built on the DRY ground tile, not the meadow one. A tint multiplies the
    // texture, so tinting the meadow brown only ever gives dark olive, which is
    // what green in shadow looks like and therefore says nothing at all. The
    // dry tile is already the colour of dead grass, so a grey-brown over it
    // lands where it was aimed.
    moor: flatMat(tex.grassDry, 0x96896c),
    // Lightened from near-black. Dark ground with a hard edge does not read as
    // wet, it reads as a hole punched in the terrain, which is the same fault
    // the contact-shadow blobs had.
    peat: flatMat(tex.sand, 0x6a5e49),
    dryMoor: flatMat(tex.grassDry, 0xbcb08d),
    /** The margin the mere left behind when it dropped. */
    bleach: flatMat(tex.sand, 0xbcb6a2),
    /**
     * The road past the wall: pale grit rather than the warm dirt of the tracks
     * at home.
     *
     * Pushed a long way clear of the moor's own tone, because the first attempt
     * at this sat at 0x94886d against a moor at 0x96896c and the two were the
     * same colour. The road out is the ONLY guidance on that side, D20 having
     * removed every other kind, and it was invisible against the ground it
     * crossed for the whole length of the climb.
     */
    oldTrack: flatMat(tex.sand, 0xcbc1a2),
    // Darker than the mud it sits in. Water lighter than its own bank inverts
    // the natural relationship and reads as a hole punched in the render.
    water: toonUnique({
      color: 0x8fb6c4,
      map: tiled(tex.water, 3.2, 3.2),
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
    }),
    deep: toonUnique({
      color: 0x5d8496,
      map: tiled(tex.water, 3.2, 3.2),
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    }),
    // Standing water rather than running water. Nearly opaque, and greyed off
    // the blue, so it reads as a lid rather than as something you can see into.
    still: toonUnique({
      color: 0x4a5a58,
      map: tiled(tex.water, 3.2, 3.2),
      transparent: true,
      opacity: 0.93,
      side: THREE.DoubleSide,
    }),

    bark: toonUnique({ map: tiled(tex.bark, 1.5, 3) }),
    barkDark: toonUnique({ color: 0x9a7250, map: tiled(tex.bark, 1.5, 3) }),
    barkPale: toonUnique({ color: 0xd9d2bc, map: tiled(tex.bark, 1.5, 3) }),
    barkDead: toonUnique({ color: 0x9d9484, map: tiled(tex.bark, 1.5, 3) }),
    log: toonUnique({ map: tiled(tex.bark, 1.5, 0.9) }),
    charred: toonUnique({ color: 0x33291f, map: tiled(tex.bark, 1.5, 0.9) }),
    plank: toonUnique({ color: 0xdcb079, map: tiled(tex.plank, 2.4, 1.6) }),
    plankDark: toonUnique({ color: 0x8c6038, map: tiled(tex.plank, 2.4, 1.6) }),
    stone: toonUnique({ map: tiled(tex.stone, 2.4, 2.4) }),
    stoneDark: toonUnique({ color: 0x8a8c92, map: tiled(tex.stone, 2.4, 2.4) }),
    // Set stone, not fallen stone. Darker and warmer than the boulders so a
    // menhir does not read as one more rock, and tiled tall so the grain runs
    // up it rather than round it.
    menhir: toonUnique({ color: 0x8b8477, map: tiled(tex.stone, 1.1, 3.0) }),
    // Warm grey. The lighting ramp turns anything neutral bright blue on its
    // shadow side, and a blue plinth under a cottage reads as painted plastic.
    rubbleWall: toonUnique({ color: 0xb2a08a, map: tiled(tex.stone, 1.4, 1.4) }),
    lashing: toonUnique({ color: 0xd8c08a, map: tiled(tex.cloth, 0.4, 0.4) }),
    // Openings have to be nearly black or they read as a panel of paint. The
    // eave band is the shadow the overhang ought to be throwing on the wall and
    // does not, because at this pitch the real one lands on the ground.
    doorway: toonUnique({ color: 0x140f0b }),
    eaveShade: toonUnique({ color: 0x4a3423 }),
    thatch: toonUnique({ color: 0xd7bd8a, map: tiled(tex.straw, 2.2, 2.2) }),
    thatchOld: toonUnique({ color: 0xbca471, map: tiled(tex.straw, 2.2, 2.2) }),
    moss: toonUnique({ color: 0x6f8a4a, map: tiled(tex.foliage, 1.2, 1.2) }),
    sooted: toonUnique({ color: 0x6d6152, map: tiled(tex.straw, 2.2, 2.2) }),
    straw: toonUnique({ map: tiled(tex.straw, 0.7, 0.7) }),
    reed: toonUnique({ color: 0xa2b27a, map: tiled(tex.straw, 0.6, 0.6) }),
    tuft: toonUnique({ color: 0xa8b268, vertexColors: true }),
    tuftPale: toonUnique({ color: 0xc0bd83, vertexColors: true }),
    wheatStalk: toonUnique({ color: 0xecd68c, map: tiled(tex.straw, 0.6, 0.6) }),
    cloth: toonUnique({ map: tiled(tex.cloth, 1.2, 1.2) }),
    clothBlue: toonUnique({ color: 0x8fa8c4, map: tiled(tex.cloth, 1.2, 1.2) }),
    clothRed: toonUnique({ color: 0xc48b7a, map: tiled(tex.cloth, 1.2, 1.2) }),
    steel: toonUnique({ map: tiled(tex.steel, 0.8, 0.8) }),
    clay: toonUnique({ map: tiled(tex.clay, 1, 1) }),
    lily: toonUnique({ color: 0x5e8f52, map: tiled(tex.foliage, 1, 1) }),
    hen: toonUnique({ color: 0xf0e4d0, map: tiled(tex.cloth, 0.5, 0.5) }),
    henDark: toonUnique({ color: 0xb08a5e, map: tiled(tex.cloth, 0.5, 0.5) }),
    comb: toonUnique({ color: 0xd05040 }),
  }

  const foliage = BAND0.leaf.map((hex) => toonUnique({ color: hex, map: tiled(tex.foliage, 3, 3) }))
  // Species read by silhouette first and colour second, so the tints are pushed
  // much further apart than is natural. At 12 texels to the unit and this much
  // fog, three greens a shade apart are one green.
  const pineMats = [0x1f5230, 0x1a4628, 0x27603a].map((hex) =>
    toonUnique({ color: hex, map: tiled(tex.foliage, 3, 3) }),
  )
  const birchMats = [0xaecb83, 0xbfd797].map((hex) =>
    toonUnique({ color: hex, map: tiled(tex.foliage, 3, 3) }),
  )

  // ---------------------------------------------------------------- ground
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GRID, GRID)
  geo.rotateX(-Math.PI / 2)

  const pos = geo.attributes.position!
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)))
  geo.computeVertexNormals()

  const ground = new THREE.Mesh(geo, toonUnique({ map: tiled(tex.grass, GROUND_SIZE, GROUND_SIZE) }))
  ground.receiveShadow = true
  group.add(ground)

  // ------------------------------------------------------- ground overlays
  // Dirt, mud and sand are laid as separate ribbons and patches a few
  // centimetres above the terrain, sampling the same height function so they
  // follow every slope. Hard edges are correct here: this is tile art, and a
  // soft alpha falloff would read as a blur rather than as worn ground.

  /** Every sample point of every track, so scatter can keep off them. */
  const trackPoints: THREE.Vector2[] = []

  function nearTrack(x: number, z: number, r: number): boolean {
    for (const p of trackPoints) {
      if ((p.x - x) ** 2 + (p.y - z) ** 2 < r * r) return true
    }
    return false
  }

  function surface(
    verts: number[],
    uvs: number[],
    idx: number[],
    mat: THREE.Material,
  ): THREE.Mesh {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    const m = new THREE.Mesh(g, mat)
    m.receiveShadow = true
    group.add(m)
    return m
  }

  /**
   * A worn ribbon along a curve. Width wobbles per sample, so the edge is a
   * desire line rather than a road marking.
   */
  function layTrack(
    ctrl: readonly (readonly [number, number])[],
    halfWidth: number,
    mat: THREE.Material,
    r: Rng,
    lift = 0.07,
    record = true,
  ): void {
    const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)))
    const steps = Math.max(10, Math.round(curve.getLength() / 0.5))
    const verts: number[] = []
    const uvs: number[] = []
    const idx: number[] = []

    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const p = curve.getPointAt(t)
      const tan = curve.getTangentAt(t)
      const nx = -tan.z
      const nz = tan.x
      if (record) trackPoints.push(new THREE.Vector2(p.x, p.z))

      for (const side of [-1, 1]) {
        const w = halfWidth * r.range(0.76, 1.26)
        const x = p.x + nx * side * w
        const z = p.z + nz * side * w
        verts.push(x, heightAt(x, z) + lift, z)
        uvs.push(...worldUv(x, z))
      }
    }
    for (let i = 0; i < steps; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    surface(verts, uvs, idx, mat)
  }

  /**
   * A whole area of different ground, as a subdivided sheet.
   *
   * `layPatch` is a fan from one centre vertex, which is fine at three metres
   * and wrong at seven: a single triangle spanning that far is a flat chord,
   * and over concave ground the chord rises well above the terrain it is
   * supposed to be lying on. Six metre moor patches at a 0.04 lift were
   * therefore poking up through a track laid at 0.07, so the road out came out
   * in pieces. A grid keeps every cell about a metre, so the sheet follows the
   * ground and stays underneath everything laid on top of it.
   *
   * The near edge is a function of x, so the boundary between two kinds of
   * ground wanders instead of being a straight line across the region.
   */
  function layField(
    x0: number,
    x1: number,
    zFar: number,
    edgeAt: (x: number) => number,
    mat: THREE.Material,
    lift: number,
  ): void {
    const cols = Math.max(2, Math.round((x1 - x0) / 1.6))
    const rows = 26
    const verts: number[] = []
    const uvs: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= cols; i++) {
      const x = x0 + ((x1 - x0) * i) / cols
      const zNear = edgeAt(x)
      for (let j = 0; j <= rows; j++) {
        const z = zNear + ((zFar - zNear) * j) / rows
        verts.push(x, heightAt(x, z) + lift, z)
        uvs.push(...worldUv(x, z))
      }
    }
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const a = i * (rows + 1) + j
        const b = a + rows + 1
        idx.push(a, b, a + 1, a + 1, b, b + 1)
      }
    }
    surface(verts, uvs, idx, mat)
  }

  /** An irregular trodden patch: a fan with a jittered rim. */
  function layPatch(
    cx: number,
    cz: number,
    radius: number,
    mat: THREE.Material,
    r: Rng,
    wobble = 0.3,
    segments = 26,
    lift = 0.065,
  ): void {
    const verts: number[] = [cx, heightAt(cx, cz) + lift, cz]
    const uvs: number[] = [...worldUv(cx, cz)]
    const idx: number[] = []
    const jitter: number[] = []
    for (let i = 0; i < segments; i++) jitter.push(r.range(1 - wobble, 1 + wobble))

    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      // Average neighbours so the rim wanders instead of spiking.
      const j0 = jitter[i % segments]!
      const j1 = jitter[(i + 1) % segments]!
      const rad = radius * (j0 * 0.6 + j1 * 0.4)
      const x = cx + Math.cos(a) * rad
      const z = cz + Math.sin(a) * rad
      verts.push(x, heightAt(x, z) + lift, z)
      uvs.push(...worldUv(x, z))
    }
    for (let i = 1; i <= segments; i++) idx.push(0, i, i + 1)
    surface(verts, uvs, idx, mat)
  }

  // ------------------------------------------------------------------ pond
  const pondRng = rng.fork('pond')

  {
    // The whole basin is sand, from the middle out to a ragged line above the
    // waterline. Water is transparent, so the part under it reads as a bottom
    // you can see, which is most of what stops a pond looking like a decal.
    const seg = 48
    const rings = [0, 0.28, 0.5, 0.7, 0.9]
    const verts: number[] = []
    const uvs: number[] = []
    const idx: number[] = []
    const ragged: number[] = []
    for (let i = 0; i <= seg; i++) ragged.push(pondRng.range(-0.3, 0.5))

    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      const rad = pondRadius(a)
      for (const f of rings) {
        const rr = rad * f + (f === 0.9 ? ragged[i % seg]! : 0)
        const x = POND.x + Math.cos(a) * rr
        const z = POND.z + Math.sin(a) * rr
        verts.push(x, heightAt(x, z) + 0.045, z)
        uvs.push(...worldUv(x, z))
      }
    }
    const n = rings.length
    for (let i = 0; i < seg; i++) {
      for (let k = 0; k < n - 1; k++) {
        const a = i * n + k
        idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n)
      }
    }
    surface(verts, uvs, idx, M.shore)
  }

  {
    // Water drawn generously past the true shoreline. The terrain rises above
    // WATER_LEVEL well inside the rim and hides the surplus, so the waterline
    // is wherever the ground crosses the water plane: irregular, and free.
    const seg = 56
    const verts: number[] = [POND.x, WATER_LEVEL, POND.z]
    const uvs: number[] = [...worldUv(POND.x, POND.z)]
    const idx: number[] = []
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      const rad = pondRadius(a) * 0.82
      const x = POND.x + Math.cos(a) * rad
      const z = POND.z + Math.sin(a) * rad
      verts.push(x, WATER_LEVEL, z)
      uvs.push(...worldUv(x, z))
    }
    for (let i = 1; i <= seg; i++) idx.push(0, i, i + 1)
    const water = surface(verts, uvs, idx, M.water)
    water.receiveShadow = false
    water.renderOrder = 1
  }

  // Reeds, in clumps on two sides only. Nothing sells a natural edge like
  // vegetation standing in the shallows.
  const reedGeo = new THREE.ConeGeometry(0.065, 1, 4)
  for (const a0 of [2.1, 2.8, 3.5, -2.1, 4.7]) {
    const a = a0 + pondRng.range(-0.15, 0.15)
    const rad = pondRadius(a) * pondRng.range(0.52, 0.66)
    const cx = POND.x + Math.cos(a) * rad
    const cz = POND.z + Math.sin(a) * rad
    for (let i = 0; i < pondRng.int(5, 9); i++) {
      const x = cx + pondRng.range(-0.8, 0.8)
      const z = cz + pondRng.range(-0.8, 0.8)
      const hgt = pondRng.range(0.6, 1.1)
      const reed = new THREE.Mesh(reedGeo, pondRng.chance(0.75) ? M.reed : M.straw)
      reed.scale.set(1, hgt, 1)
      reed.position.set(x, Math.max(heightAt(x, z), WATER_LEVEL - 0.1) + hgt * 0.44, z)
      reed.rotation.z = pondRng.range(-0.2, 0.2)
      reed.castShadow = true
      group.add(reed)
    }
  }

  // Lily pads, only where the water is open.
  const padGeo = new THREE.CircleGeometry(0.3, 7).rotateX(-Math.PI / 2)
  for (let i = 0; i < 14; i++) {
    const a = pondRng.range(0, Math.PI * 2)
    const rad = pondRadius(a) * pondRng.range(0.15, 0.6)
    const pad = new THREE.Mesh(padGeo, M.lily)
    pad.position.set(POND.x + Math.cos(a) * rad, WATER_LEVEL + 0.03, POND.z + Math.sin(a) * rad)
    pad.scale.setScalar(pondRng.range(0.7, 1.3))
    pad.rotation.y = pondRng.range(0, Math.PI)
    group.add(pad)
  }

  /**
   * A fallen trunk half in the water. You walk along this rather than through
   * it: it is low, it is flat on top once it has settled, and a log lying at
   * the water's edge invites exactly one thing.
   *
   * This is the object that read as a beam floating in mid-air in the ordinary
   * home view, and the diagnosis is worth keeping because the obvious fix was
   * the wrong one. It was not floating a metre up. Its shadow was welded to it
   * with no lit ground in the gap, which a body a metre up under this sun could
   * not do. It was 0.11m clear at one end and 0.27m BURIED at the other, and it
   * read as airborne for three separate reasons:
   *
   *   - one height sample, taken at the middle, for a 5.4m log, plus a
   *     hard-coded 0.12 rad tilt that had nothing to do with the ground under
   *     it. That is 0.65m of rise laid across ground level to within 0.26m, and
   *     it is the plank crossing's bug at a twentieth of the size.
   *   - it sat TANGENT to the terrain, so its underside was a single unbroken
   *     straight line for most of a screen width with no point of contact
   *     anywhere along it. The log seats at the hearth already carry this note
   *     and it was never applied here.
   *   - its top was the palest surface in that part of the frame, so it read as
   *     a lit object in front of a background rather than as something lying in
   *     one.
   *
   * So: the tilt comes from the two ends, the log is bedded rather than rested,
   * and the top is broken up. Lowering it would have fixed none of that.
   */
  {
    const a = 0.55
    const rad = pondRadius(a)
    const bx = POND.x + Math.cos(a) * rad - 0.6
    const bz = POND.z + Math.sin(a) * rad - 0.4
    const LEN = 5.4
    const GIRTH = 0.31
    const yaw = a + 0.3

    // The long axis on the ground plane, in the frame a footprint uses: local
    // +x maps to (cos ry, -sin ry).
    const ax = Math.cos(yaw)
    const az = -Math.sin(yaw)
    const half = LEN / 2 - GIRTH
    const groundAt = (t: number): number => heightAt(bx + ax * t, bz + az * t)

    const h0 = groundAt(-half)
    const h1 = groundAt(half)
    /**
     * Sunk by half its own radius, everywhere along it.
     *
     * This is the part that actually stops it reading as airborne. A cylinder
     * resting exactly on the terrain touches along a mathematical line and the
     * renderer draws that line as a hard edge with grass on one side and lit
     * wood on the other; sink it and the terrain cuts the wood the whole way,
     * so there is no edge left to read as a gap. It also means the log cannot
     * hover at one end when the ground turns out not to be flat.
     */
    const BED = GIRTH * 0.5
    const by = (h0 + h1) / 2 - BED

    // Rotating about Z by (PI/2 - phi) lays the cylinder down and gives its
    // axis a rise of sin(phi). phi comes from the drop between the two ends.
    const phi = Math.atan2(h0 - h1, 2 * half)
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, LEN, 7), M.log)
    trunk.rotation.set(0, yaw, Math.PI / 2 - phi)
    trunk.position.set(bx, by, bz)
    trunk.castShadow = true
    trunk.receiveShadow = true
    group.add(trunk)

    /** Height of the log's own axis at a point along it. */
    const axisAt = (t: number): number => by + (t * (h1 - h0)) / (2 * half)

    // Damp and moss along the top, thickest at the end that lies in the water.
    // The pale unbroken top was a third of why this read as a lit object rather
    // than as something lying in the grass.
    for (const [t, w, wet] of [
      [-half * 0.72, 1.5, true],
      [-half * 0.1, 1.0, true],
      [half * 0.55, 0.8, false],
    ] as const) {
      const patch = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, GIRTH * 1.5), wet ? M.moss : M.thatchOld)
      patch.position.set(bx + ax * t, axisAt(t) + GIRTH * 0.86, bz + az * t)
      patch.rotation.y = yaw
      group.add(patch)
    }

    /**
     * Three rectangles rather than one, because the log follows a slope now.
     *
     * A single flat surface over a tilted 5.4m log is either buried at the high
     * end or floating at the low one. Each third takes its height from the log
     * where it actually is, and is then floored at the highest ground beneath
     * it, so the checked failure — a walkable surface under the terrain — is
     * impossible by construction rather than by luck.
     */
    for (const t of [-half * (2 / 3), 0, half * (2 / 3)]) {
      const sx = bx + ax * t
      const sz = bz + az * t
      const seg = half / 3
      standables.push({
        ...box(sx, sz, seg, 0, yaw, GIRTH * 1.5),
        top: Math.max(axisAt(t) + GIRTH, groundUnder(sx, sz, seg, GIRTH * 1.5, yaw) + 0.06),
      })
    }
  }

  const boulderGeo = new THREE.DodecahedronGeometry(1, 0)
  const rubbleGeo = new THREE.IcosahedronGeometry(1, 0)
  for (let i = 0; i < 12; i++) {
    const a = pondRng.range(0, Math.PI * 2)
    const rad = pondRadius(a) * pondRng.range(0.92, 1.14)
    const x = POND.x + Math.cos(a) * rad
    const z = POND.z + Math.sin(a) * rad
    const s = pondRng.range(0.16, 0.42)
    const rock = new THREE.Mesh(pondRng.chance(0.5) ? boulderGeo : rubbleGeo, M.stoneDark)
    rock.scale.set(s, s * 0.7, s * pondRng.range(0.8, 1.3))
    rock.position.set(x, heightAt(x, z) + s * 0.3, z)
    rock.rotation.set(pondRng.range(0, 3), pondRng.range(0, 3), pondRng.range(0, 3))
    rock.castShadow = true
    group.add(rock)
  }

  // ----------------------------------------------------------------- brook
  /**
   * Running water, as a ribbon that steps downhill.
   *
   * Both edge vertices of a cross-section take the CENTRELINE height, not their
   * own, so each section is level across the channel while the whole thing
   * descends along its length. Sampling per-vertex the way a track does gives a
   * wrinkled sheet, because the bed is a trench and the edges of it are higher
   * than the middle.
   */
  {
    const curve = new THREE.CatmullRomCurve3(BROOK.map(([x, z]) => new THREE.Vector3(x, 0, z)))
    const steps = Math.max(24, Math.round(curve.getLength() / 0.6))
    const verts: number[] = []
    const uvs: number[] = []
    const idx: number[] = []

    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const p = curve.getPointAt(t)
      const tan = curve.getTangentAt(t)
      const y = heightAt(p.x, p.z) + BROOK_D * 0.52
      for (const side of [-1, 1]) {
        const w = BROOK_W * 0.72 * pondRng.range(0.82, 1.1)
        const x = p.x + -tan.z * side * w
        const z = p.z + tan.x * side * w
        verts.push(x, y, z)
        uvs.push(...worldUv(x, z))
      }
    }
    for (let i = 0; i < steps; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const brook = surface(verts, uvs, idx, M.water)
    brook.receiveShadow = false
    brook.renderOrder = 1

    // Wet stones along the channel, thickest where it runs shallow.
    for (let i = 0; i < 40; i++) {
      const t = pondRng.next()
      const p = curve.getPointAt(t)
      const off = pondRng.range(-BROOK_W, BROOK_W)
      const tan = curve.getTangentAt(t)
      const x = p.x + -tan.z * off
      const z = p.z + tan.x * off
      const s = pondRng.range(0.14, 0.4)
      const stone = new THREE.Mesh(pondRng.chance(0.5) ? boulderGeo : rubbleGeo, M.stoneDark)
      stone.scale.set(s, s * 0.6, s * pondRng.range(0.8, 1.3))
      stone.position.set(x, heightAt(x, z) + s * 0.2, z)
      stone.rotation.set(pondRng.range(0, 3), pondRng.range(0, 3), pondRng.range(0, 3))
      stone.castShadow = true
      group.add(stone)
    }
  }

  /**
   * The plank crossing, where the track meets the water. Two things at once: a
   * reason the track bends here, and the only place in the region where the
   * player is told, without words, that planks span things.
   */
  {
    const bed = heightAt(FORD.x, FORD.z)
    const turn = -0.28
    const SPAN = 4.6

    /**
     * The deck is derived from the banks it lands on, not authored.
     *
     * It used to be `bed + clearance`, which put it 0.26m BELOW the south bank,
     * because the two sides of the brook are not the same height. Max walked
     * across the green moss strip at that end rather than over it, and the
     * handrail came out of the ground at knee height. No amount of care with
     * the constant fixes that, because the constant cannot know what the
     * terrain does: a crossing has to be measured against what it crosses.
     */
    const WIDE = 2.36
    const abut = ([-1, 1] as const).map((side) => {
      const ax = FORD.x + Math.sin(turn) * side * (SPAN / 2)
      const az = FORD.z + Math.cos(turn) * side * (SPAN / 2)
      // Across the whole width, not just the middle. A deck 2.36m wide landing
      // on a bank that slopes across it meets the ground higher at one corner
      // than at the centre, and both numbers matter for different reasons:
      // the HIGHEST is what the deck must clear or it buries itself in the
      // bank, and the LOWEST is where the player will be standing when they
      // try to step up, so it is what decides whether they can.
      //
      // Using the high one for both is what made the crossing unclimbable from
      // home the moment burying was fixed.
      let high = -Infinity
      let low = Infinity
      for (const across of [-WIDE / 2, 0, WIDE / 2]) {
        const h = heightAt(ax + Math.cos(turn) * across, az - Math.sin(turn) * across)
        high = Math.max(high, h)
        low = Math.min(low, h)
      }
      // A stride further out as well: the ground the player actually walks in
      // from, which on a cut bank keeps dropping past the end of the deck.
      const ox = FORD.x + Math.sin(turn) * side * (SPAN / 2 + 0.7)
      const oz = FORD.z + Math.cos(turn) * side * (SPAN / 2 + 0.7)
      low = Math.min(low, heightAt(ox, oz))

      return { side, x: ax, z: az, high, low }
    })
    const deck = Math.max(bed + BROOK_D * 0.52 + 0.34, ...abut.map((a) => a.high + 0.05))

    const g = new THREE.Group()

    // Deck. Five narrower boards rather than three wide ones, because the joins
    // are what say "laid by hand" at this size, and one of them is newer than
    // the rest: something got replaced and nobody matched the timber.
    for (let i = 0; i < 5; i++) {
      const plankMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.44, 0.11, SPAN),
        i === 3 ? M.plank : M.plankDark,
      )
      plankMesh.position.set(-0.96 + i * 0.48, 0, pondRng.range(-0.05, 0.05))
      plankMesh.rotation.y = pondRng.range(-0.02, 0.02)
      plankMesh.castShadow = true
      plankMesh.receiveShadow = true
      g.add(plankMesh)
    }

    // The strip down the middle where everyone actually walks.
    const worn = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.03, SPAN - 0.5), M.track)
    worn.position.set(-0.05, 0.07, 0)
    g.add(worn)

    // Bearers under the deck, and the abutments they land on. The deck used to
    // simply stop at each end, which is most of why it read as a plank lying in
    // a stream rather than as a bridge: a crossing is the thing at its ends.
    for (const side of [-1, 1]) {
      const bearer = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.18, 2.7, 7).rotateZ(Math.PI / 2),
        M.log,
      )
      bearer.position.set(0, -0.17, side * 1.75)
      bearer.castShadow = true
      g.add(bearer)

      const sill = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.34, 0.7), M.rubbleWall)
      sill.position.set(0, -0.42, side * (SPAN / 2 - 0.1))
      sill.castShadow = true
      sill.receiveShadow = true
      g.add(sill)

      // Packed stone at the foot of each abutment, so the bank does not just
      // stop being grass at a straight line.
      for (let i = 0; i < 5; i++) {
        const st = new THREE.Mesh(pondRng.chance(0.5) ? boulderGeo : rubbleGeo, M.stoneDark)
        const sc = pondRng.range(0.2, 0.42)
        st.scale.set(sc, sc * 0.7, sc)
        st.position.set(pondRng.range(-1.5, 1.5), -0.55, side * (SPAN / 2 + pondRng.range(-0.2, 0.5)))
        st.rotation.set(pondRng.range(0, 3), pondRng.range(0, 3), pondRng.range(0, 3))
        st.castShadow = true
        g.add(st)
      }
    }

    // A handrail on the downstream side only. One rail is enough to turn a
    // board into a structure, and it gives the eye something vertical to read
    // against a horizontal deck.
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, SPAN - 0.3, 6), M.log)
    rail.position.set(1.42, 0.72, 0)
    rail.rotation.x = Math.PI / 2
    rail.rotation.z = pondRng.range(-0.02, 0.02)
    rail.castShadow = true
    g.add(rail)
    for (const dz of [-1.75, -0.6, 0.6, 1.75]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6), M.log)
      post.position.set(1.42, 0.22, dz)
      post.rotation.set(pondRng.range(-0.05, 0.05), 0, pondRng.range(-0.06, 0.06))
      post.castShadow = true
      g.add(post)
      // Lashed, like the palisade. Same hands built both.
      const lash = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 7), M.lashing)
      lash.position.set(1.42, 0.72, dz)
      lash.rotation.x = Math.PI / 2
      g.add(lash)
    }

    // Damp and moss at the ends, where it meets the ground and stays wet.
    for (const side of [-1, 1]) {
      const damp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 0.6), M.moss)
      damp.position.set(0, 0.08, side * (SPAN / 2 - 0.45))
      g.add(damp)
    }

    g.position.set(FORD.x, deck, FORD.z)
    g.rotation.y = turn
    group.add(g)

    // The deck, as the rectangle it is. Five discs laid along it used to
    // overhang each end by 0.6m, so you stepped up onto open water before you
    // reached the boards.
    standDeck(FORD.x, FORD.z, WIDE, SPAN, turn, deck + 0.06)

    /**
     * Abutments, which is what a bridge has at its ends, and what the stonework
     * here is already drawn as.
     *
     * Walked outward from the deck rather than divided up in advance: each
     * tread is one comfortable step below the last, and never below the ground
     * it sits on. Dividing the total rise into equal parts sounds equivalent
     * and is not, because the ground under the treads is not a straight line —
     * the first version put a tread 0.13m INTO the bank, which is the same
     * "walked through the thing" bug the deck itself had.
     *
     * Ends as soon as the ground has come up to meet it, so a crossing over
     * level banks generates nothing at all.
     */
    const RISER = STEP_HEIGHT * 0.8
    /** Highest ground anywhere under a tread of this width, not just its middle. */
    const under = (sx: number, sz: number): number => {
      let h = -Infinity
      for (const across of [-WIDE / 2, 0, WIDE / 2]) {
        h = Math.max(h, heightAt(sx + Math.cos(turn) * across, sz - Math.sin(turn) * across))
      }
      return h
    }
    for (const a of abut) {
      let top = deck + 0.06
      for (let i = 0; i < 4; i++) {
        const out = SPAN / 2 + 0.28 + i * 0.62
        const sx = FORD.x + Math.sin(turn) * a.side * out
        const sz = FORD.z + Math.cos(turn) * a.side * out
        const ground = under(sx, sz)
        if (top - ground <= RISER) break

        top = Math.max(top - RISER, ground + 0.12)
        standDeck(sx, sz, WIDE, 0.78, turn, top)

        const tread = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.3, 0.86), M.rubbleWall)
        tread.position.set(sx, top - 0.15, sz)
        tread.rotation.y = turn
        tread.castShadow = true
        tread.receiveShadow = true
        group.add(tread)
      }
    }

    // Worn dirt running onto the deck from both banks, so the track arrives at
    // the bridge instead of stopping a stride short of it.
    for (const a of abut) {
      const ax = FORD.x + Math.sin(turn) * a.side * (SPAN / 2 + 0.5)
      const az = FORD.z + Math.cos(turn) * a.side * (SPAN / 2 + 0.5)
      layPatch(ax, az, 1.15, M.track, pondRng, 0.28, 14, 0.075)
    }
  }

  // ----------------------------------------------------------------- tracks
  const trackRng = rng.fork('tracks')

  /**
   * The main track. It starts at the hearth, leaves the yard by the gate,
   * crosses the hollow and ends at the palisade gate, then picks up again on
   * the far side and climbs out of the region. This is the navigation system
   * now that markers are banned, so it is the widest, most worn thing here.
   */
  const MAIN_TRACK = [
    [0.3, 13.0],
    [1.0, 11.4],
    [0.9, 9.2],
    [1.6, 6.2],
    [1.0, 2.6],
    [0.1, -1.25],
    [0.1, -4.8],
    [0.0, -7.6],
  ] as const

  /**
   * The same road, on the other side, and it does not stop.
   *
   * It used to end in a field at z = -21, which says the world ends there. It
   * now climbs over the crest and leaves the region, which says the opposite
   * with the same amount of geometry. That is the whole of the guidance out
   * here: D20 bans markers, so the road has to be the argument.
   */
  const BEYOND_TRACK = [
    [0.0, -8.4],
    [-0.3, -10.6],
    [-0.9, -13.4],
    [-1.9, -17.0],
    [-3.4, -21.0],
    [-4.4, -25.2],
    [-4.2, -29.4],
    [-3.4, -33.2],
    [-3.2, -37.0],
  ] as const

  layTrack(MAIN_TRACK, 1.05, M.track, trackRng)
  // Paler, and laid higher than the moor sheet it crosses. Same road, but
  // nobody on this side has put a barrow of gravel on it in a long time.
  layTrack(BEYOND_TRACK, 0.95, M.oldTrack, trackRng, 0.09)

  // Cart ruts, only on the busy stretch near home.
  for (const off of [-0.42, 0.42]) {
    layTrack(
      MAIN_TRACK.slice(0, 5).map(([x, z]) => [x + off, z] as const),
      0.16,
      M.rut,
      trackRng,
      0.078,
      false,
    )
  }

  // To the pond, for water. Narrow, because one person walks it at a time.
  layTrack(
    [
      [-2.4, 13.6],
      [-5.6, 12.8],
      [-7.8, 11.3],
      [-8.2, 8.8],
      [-7.8, 6.4],
      [-8.0, 5.3],
    ],
    0.62,
    M.track,
    trackRng,
  )

  // To the chopping block and the wood east of the yard.
  layTrack(
    [
      [2.2, 12.9],
      [5.6, 12.4],
      [8.4, 11.8],
      [10.6, 10.6],
    ],
    0.6,
    M.track,
    trackRng,
  )

  // The yard itself: trodden bare where everyone crosses, ash at the hearth.
  // Deliberately smaller than the fenced plot. Bare ground everywhere inside
  // the fence reads as a building site; grass surviving between the worn parts
  // is what makes the worn parts read as feet.
  layPatch(0.3, 13.1, 4.3, M.yard, trackRng, 0.34, 30, 0.06)
  layPatch(-6.6, 16.0, 3.0, M.yard, trackRng, 0.36, 20, 0.06)
  layPatch(8.2, 16.0, 2.3, M.yard, trackRng, 0.36, 18, 0.06)
  layPatch(HOME.x + 0.1, HOME.z - 0.3, 1.75, M.ash, trackRng, 0.24, 20, 0.07)

  // ----------------------------------------------------------------- trees
  const trunkGeo = new THREE.CylinderGeometry(0.26, 0.34, 1, 7)
  const canopyGeo = new THREE.ConeGeometry(1, 1, 8)
  const branchGeo = new THREE.CylinderGeometry(0.06, 0.13, 1, 5)

  type Species = 'oak' | 'pine' | 'birch' | 'dead' | 'scrub'

  /**
   * One tree. Five silhouettes rather than one, because a ring of identical
   * cones reads as a hedge and a hedge has no depth. Pines carry the far side
   * of the wall, birches lighten the near edge, dead trunks break the rhythm.
   */
  function plantTree(x: number, z: number, species: Species, scale: number, r: Rng): THREE.Group {
    const h = heightAt(x, z)
    const tree = new THREE.Group()

    const trunkH =
      species === 'pine' ? 3.1 * scale : species === 'birch' ? 2.3 * scale : 1.7 * scale

    if (species !== 'scrub') {
      const mat =
        species === 'pine'
          ? M.barkDark
          : species === 'birch'
            ? M.barkPale
            : species === 'dead'
              ? M.barkDead
              : M.bark
      const trunk = new THREE.Mesh(trunkGeo, mat)
      const girth = species === 'birch' ? scale * 0.7 : scale
      trunk.scale.set(girth, trunkH, girth)
      trunk.position.y = trunkH / 2
      trunk.castShadow = true
      tree.add(trunk)
    }

    if (species === 'dead') {
      // Long, thin, steeply angled. Short fat branches read as antlers.
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(branchGeo, M.barkDead)
        const len = scale * r.range(1.4, 2.6)
        b.scale.set(scale * 0.55, len, scale * 0.55)
        b.position.y = trunkH * r.range(0.4, 0.95)
        b.rotation.z = r.range(0.28, 0.7) * (i % 2 === 0 ? 1 : -1)
        b.rotation.y = r.range(0, Math.PI * 2)
        b.translateY(len * 0.45)
        b.castShadow = true
        // Same argument as a canopy, and the same word for it: a branch is
        // thin wood you push past, and the trunk is what stops you. Stated
        // here because a dead tree's branches reach 2.5m out from the trunk at
        // chest height, so a footprint measured with them in it is a two metre
        // invisible wall around every snag on the moor.
        b.userData.noCollide = true
        tree.add(b)
      }
      // Snapped off rather than tapering to a point.
      const snap = new THREE.Mesh(trunkGeo, M.barkDead)
      snap.scale.set(scale * 0.7, scale * 0.5, scale * 0.7)
      snap.position.y = trunkH + scale * 0.2
      snap.rotation.z = r.range(-0.3, 0.3)
      snap.castShadow = true
      tree.add(snap)
    } else {
      const tiers = species === 'pine' ? 5 : species === 'birch' ? 2 : 3
      const mats = species === 'pine' ? pineMats : species === 'birch' ? birchMats : foliage
      const base = species === 'pine' ? 0.88 : species === 'birch' ? 1.0 : 1.3
      const step = species === 'pine' ? 0.13 : 0.28
      const rise = species === 'pine' ? 0.46 : 0.6
      const tint = r.int(0, mats.length - 1)

      for (let t = 0; t < tiers; t++) {
        const canopy = new THREE.Mesh(canopyGeo, mats[(t + tint) % mats.length]!)
        const rad = (base - t * step) * scale
        canopy.scale.set(rad, (species === 'pine' ? 1.5 : 1.25) * scale, rad)
        canopy.position.y = (species === 'scrub' ? 0.2 : trunkH) + t * rise * scale + 0.35 * scale
        canopy.castShadow = true
        // Foliage is not solid: you walk under a canopy, and the trunk is what
        // stops you. Stated here rather than inferred, because a cone's bounding
        // box is as wide at its tip as at its base and any measurement taken
        // from that box claims the canopy reaches the ground.
        canopy.userData.noCollide = true
        tree.add(canopy)
      }
    }

    tree.position.set(x, h, z)
    tree.rotation.y = r.range(0, Math.PI * 2)
    group.add(tree)

    // Canopy half-width and total height, both known here. Scrub is too short
    // to hide anything, so it is not worth a per-frame test.
    if (species !== 'scrub') {
      const spread = species === 'pine' ? 0.95 : species === 'dead' ? 0.9 : 1.45
      const height =
        species === 'dead' ? trunkH + scale * 0.9 : trunkH + (species === 'pine' ? 3.4 : 2.6) * scale
      occluders.push(occluder(tree, spread * scale, height))
    }
    return tree
  }

  function treeEntity(mesh: THREE.Object3D, x: number, z: number, scale: number, label: string): void {
    const h = heightAt(x, z)
    const height = 1.7 * scale
    world.add({
      transform: { pos: new THREE.Vector3(x, h + height * 0.5, z), ry: 0 },
      mesh,
      label,
      props: { WOODEN: 0.9, PLANT: 0.6, FLAMMABLE: 0.5, RIGID: 0.8, HEAVY: 0.5 },
      structure: { hp: 90 * scale, maxHp: 90 * scale, height, label },
      blocker: circle(x, z, 0.38 * scale),
    })
  }

  const treeRng = rng.fork('trees')

  /**
   * The tree line, walked along rather than scattered. Spacing, depth and
   * species all vary, and the mix differs by side: broadleaf and birch behind
   * home, black pine and dead trunks beyond the palisade, which is the only
   * statement made about what is out there.
   */
  function treeWall(
    from: number,
    to: number,
    place: (t: number, depth: number) => readonly [number, number],
    mix: readonly Species[],
    r: Rng,
  ): void {
    let t = from
    while (t < to) {
      // Clumps and thin places, rather than an even hedge. A wood that is
      // uniformly dense has no depth in it; the gaps are what make the mass
      // read as mass.
      const n = r.chance(0.22) ? 0 : r.int(1, 3)
      for (let i = 0; i < n; i++) {
        const depth = r.range(0, 1) ** 1.6 * 9
        const [x, z] = place(t + r.range(-1.4, 1.4), depth)
        const far = depth > 3.5
        plantTree(x, z, r.pick(mix), r.range(far ? 1.0 : 0.7, far ? 1.7 : 1.25), r)
      }
      t += r.range(1.9, 3.4)
    }
  }

  const SOUTH: readonly Species[] = ['oak', 'birch', 'oak', 'scrub', 'birch', 'dead', 'pine']
  const FLANK: readonly Species[] = ['oak', 'pine', 'oak', 'birch', 'scrub']
  // Past the wall the wood is older and half of it is standing dead. Pines still
// carry the mass, because a tree line made only of bare trunks is see-through
// and stops enclosing anything.
const NORTH: readonly Species[] = ['pine', 'dead', 'dead', 'pine', 'dead']

  // Behind home the wood is held back, so the huts have air around them. Every
  // run overshoots its own corner, so the four walls meet rather than leaving a
  // notch of open ground at each corner of the region.
  treeWall(BOUNDS.minX - 12, BOUNDS.maxX + 12, (t, d) => [t, BOUNDS.maxZ + 4.6 + d] as const, SOUTH, treeRng)
  treeWall(BOUNDS.minX - 6, BOUNDS.maxX + 6, (t, d) => [t, BOUNDS.minZ - 1.2 - d] as const, NORTH, treeRng)
  treeWall(BOUNDS.minZ - 5, BOUNDS.maxZ + 7, (t, d) => [BOUNDS.minX - 1.4 - d, t] as const, FLANK, treeRng)
  treeWall(BOUNDS.minZ - 5, BOUNDS.maxZ + 7, (t, d) => [BOUNDS.maxX + 1.4 + d, t] as const, FLANK, treeRng)

  // Trees inside the clearing. These ones are real entities: they burn and
  // they can be felled. Placed off the tracks so they decorate rather than
  // obstruct, and in twos and threes rather than evenly.
  for (const [x, z, s] of [
    [-14.2, -5.4, 1.15],
    [-12.6, -6.8, 0.95],
    [13.8, -3.2, 1.2],
    [15.2, 10.8, 1.1],
    [-15.8, 13.6, 1.05],
    [8.2, 15.4, 1.0],
    [-9.6, -2.2, 0.9],
  ] as const) {
    const mesh = plantTree(x, z, 'oak', s, treeRng)
    treeEntity(mesh, x, z, s, 'Oak')
  }

  // The great oak on the knoll. The one thing visible from everywhere in the
  // clearing, and the reason the knoll is there.
  {
    const x = 10.6
    const z = 8.8
    const mesh = plantTree(x, z, 'oak', 2.1, treeRng)
    treeEntity(mesh, x, z, 2.1, 'The old oak')
  }

  // Scrub scattered inside, to soften the step from lawn to wall. Kept low and
  // well off the tracks: anything tall in the middle of the clearing breaks the
  // sightline from the hearth to the gate, which is the one line that matters.
  for (let i = 0; i < perArea(44); i++) {
    const x = treeRng.range(BOUNDS.minX + 0.5, BOUNDS.maxX - 0.5)
    const z = treeRng.range(BOUNDS.minZ + 0.5, BOUNDS.maxZ - 0.5)
    if (distToPath(x, z, BROOK) < 2.6) continue
    // Scrub is bright, soft and green, and it is the clearing's. The far side
    // gets its own low cover, which is grey.
    if (z < moorEdge(x)) continue
    if (Math.hypot(x - HOME.x, z - HOME.z) < 13.5) continue
    if (Math.hypot(x - POND.x, z - POND.z) < pondRadius(Math.atan2(z - POND.z, x - POND.x)) + 0.6) continue
    if (Math.abs(z - PAL_Z) < 2.5) continue
    if (nearTrack(x, z, 4.5)) continue
    plantTree(x, z, 'scrub', treeRng.range(0.4, 0.72), treeRng)
  }

  // Patches where the grass has gone over to straw. The clearing is one hue
  // otherwise, and a single hue at this size reads as a lawn however good the
  // texture is. These are pasture, not decoration.
  for (const [x, z, r] of [
    [6.6, 3.4, 3.1],
    [-4.4, -3.8, 3.6],
    [12.2, 6.0, 2.6],
    [-13.0, -6.6, 3.0],
    [4.2, -6.0, 2.4],
    [-9.0, 12.6, 2.0],
    [14.0, 14.2, 2.8],
  ] as const) {
    layPatch(x, z, r, M.parched, trackRng, 0.42, 22, 0.05)
  }

  // A fringe of bracken along the foot of the tree line. Two jobs: it hides the
  // hard line where trunks meet lawn, and it is the only warm hue in the middle
  // distance, so the clearing stops reading as one flat green.
  const brackenGeo = new THREE.ConeGeometry(0.5, 0.7, 5)
  const brackenMats = [0x8a7a3a, 0x9c6f34, 0x6f7a34].map((c) =>
    toonUnique({ color: c, map: tiled(tex.foliage, 1.4, 1.4) }),
  )
  // Count comes from the length of the edge it dresses, so widening the region
  // thickens the fringe instead of stretching the same 52 clumps thinner.
  const MID_X = (BOUNDS.minX + BOUNDS.maxX) / 2
  const MID_Z = (BOUNDS.minZ + BOUNDS.maxZ) / 2
  const SPAN_X = (BOUNDS.maxX - BOUNDS.minX) / 2 + 4
  const SPAN_Z = (BOUNDS.maxZ - BOUNDS.minZ) / 2 + 2
  const perimeter = 4 * (SPAN_X + SPAN_Z)
  for (let c = 0; c < Math.round(perimeter * 0.265); c++) {
    const side = treeRng.int(0, 3)
    const along = treeRng.range(-1, 1)
    const inset = treeRng.range(-1.5, 2.6)
    let cx = 0
    let cz = 0
    if (side === 0) { cx = MID_X + along * SPAN_X; cz = BOUNDS.maxZ + 3.2 - inset }
    else if (side === 1) { cx = MID_X + along * SPAN_X; cz = BOUNDS.minZ - 0.4 + inset }
    else if (side === 2) { cx = BOUNDS.minX - 0.6 + inset; cz = MID_Z + along * SPAN_Z }
    else { cx = BOUNDS.maxX + 0.6 - inset; cz = MID_Z + along * SPAN_Z }

    for (let k = 0; k < treeRng.int(3, 7); k++) {
      const x = cx + treeRng.range(-1.5, 1.5)
      const z = cz + treeRng.range(-1.5, 1.5)
      if (Math.hypot(x - POND.x, z - POND.z) < pondRadius(Math.atan2(z - POND.z, x - POND.x)) + 0.5) continue
      const s = treeRng.range(0.45, 0.95)
      const b = new THREE.Mesh(brackenGeo, treeRng.pick(brackenMats))
      b.scale.set(s, s * treeRng.range(0.7, 1.2), s)
      b.position.set(x, heightAt(x, z) + s * 0.28, z)
      b.rotation.set(treeRng.range(-0.12, 0.12), treeRng.range(0, 3), treeRng.range(-0.12, 0.12))
      b.castShadow = true
      group.add(b)
    }
  }

  // ------------------------------------------------------------ ground cover
  const grassRng = rng.fork('grass')
  /**
   * One blade. Thin, three-sided, and vertex-coloured dark at the root to light
   * at the tip, which is the read the critic wanted and the only way to get it
   * without an alpha-cut texture. The old version was a squat four-sided cone
   * that outlined into a solid pyramid: caltrops, not grass.
   */
  const tuftGeo = new THREE.ConeGeometry(0.055, 1, 3)
  {
    const pos = tuftGeo.attributes.position!
    const shade = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) + 0.5
      shade[i * 3] = 0.45 + t * 0.6
      shade[i * 3 + 1] = 0.5 + t * 0.6
      shade[i * 3 + 2] = 0.38 + t * 0.55
    }
    tuftGeo.setAttribute('color', new THREE.BufferAttribute(shade, 3))
  }

  /** Dry grass, in clumps. FLAMMABLE, so this is also the fire's road. */
  for (let c = 0; c < perArea(20); c++) {
    const cx = grassRng.range(BOUNDS.minX + 2, BOUNDS.maxX - 2)
    const cz = grassRng.range(BOUNDS.minZ + 2, BOUNDS.maxZ - 2)
    for (let k = 0; k < grassRng.int(2, 4); k++) {
      const x = cx + grassRng.range(-2.4, 2.4)
      const z = cz + grassRng.range(-2.4, 2.4)
      if (Math.hypot(x - POND.x, z - POND.z) < pondRadius(Math.atan2(z - POND.z, x - POND.x)) + 0.8) continue
      // Not within a permanent fire's reach. See HEARTHS.
      if (HEARTHS.some((c) => Math.hypot(x - c.x, z - c.z) < 8.5)) continue
      if (nearTrack(x, z, 1.3)) continue

      const h = heightAt(x, z)
      const clump = new THREE.Group()
      // Two to five blades, leaning different ways, in two dulled greens rather
      // than one saturated tan. These were the only warm high-value thing on a
      // green field, so they pulled the eye harder than dressing ever should.
      for (let t = 0; t < grassRng.int(4, 9); t++) {
        const tuft = new THREE.Mesh(tuftGeo, grassRng.chance(0.6) ? M.tuft : M.tuftPale)
        const len = grassRng.range(0.5, 1.25)
        tuft.scale.set(grassRng.range(0.7, 1.4), len, grassRng.range(0.7, 1.4))
        tuft.position.set(grassRng.range(-0.42, 0.42), len * 0.46, grassRng.range(-0.42, 0.42))
        // Splayed, not upright. A clump of parallel blades is a hairbrush.
        tuft.rotation.set(
          grassRng.range(-0.5, 0.5),
          grassRng.range(0, Math.PI * 2),
          grassRng.range(-0.5, 0.5),
        )
        tuft.castShadow = true
        clump.add(tuft)
      }
      clump.position.set(x, h, z)
      group.add(clump)

      world.add({
        transform: { pos: new THREE.Vector3(x, h + 0.35, z), ry: 0 },
        mesh: clump,
        label: 'Dry grass',
        props: { PLANT: 0.8, FLAMMABLE: 0.85 },
      })
    }
  }

  // Flowers, pebbles, fallen sticks and mushrooms. None of them are entities;
  // they exist because a field with nothing at texel scale reads as a lawn.
  // A flat five-lobed head rather than a ball, plus a pair of leaves. A sphere
  // on a stick is a lollipop, and lollipops were pulling more attention than
  // ground dressing has any business pulling.
  const petalGeo = new THREE.ConeGeometry(0.11, 0.05, 5).rotateX(Math.PI)
  const eyeGeo = new THREE.SphereGeometry(0.035, 5, 4)
  const leafGeo = new THREE.ConeGeometry(0.045, 0.16, 3)
  const stemGeo = new THREE.CylinderGeometry(0.016, 0.02, 0.3, 4)
  const stickGeo = new THREE.CylinderGeometry(0.05, 0.07, 1, 5)
  const capGeo = new THREE.SphereGeometry(0.12, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2)
  // Pulled down from near-white. These are the brightest small things in the
  // frame and they should whisper.
  const flowerMats = [0xd9cd86, 0xd8d2c6, 0xc09cb0, 0xd3a469].map((c) => toonUnique({ color: c }))
  const stemMat = toonUnique({ color: 0x5f9c38 })

  for (let c = 0; c < perArea(38); c++) {
    const cx = grassRng.range(BOUNDS.minX + 1, BOUNDS.maxX - 1)
    const cz = grassRng.range(BOUNDS.minZ + 1, BOUNDS.maxZ - 1)
    const kind = grassRng.next()
    for (let k = 0; k < grassRng.int(3, 9); k++) {
      const x = cx + grassRng.range(-1.6, 1.6)
      const z = cz + grassRng.range(-1.6, 1.6)
      if (Math.hypot(x - POND.x, z - POND.z) < pondRadius(Math.atan2(z - POND.z, x - POND.x)) + 0.4) continue
      const h = heightAt(x, z)

      // Nothing flowers past the wall. Everything else — pebbles, sticks,
      // mushrooms — is as at home, because the ground itself has not stopped
      // being ground.
      if (kind < 0.45 && z < moorEdge(x)) continue

      if (kind < 0.45) {
        const mat = flowerMats[grassRng.int(0, flowerMats.length - 1)]!
        const stem = new THREE.Mesh(stemGeo, stemMat)
        stem.position.set(x, h + 0.15, z)
        const head = new THREE.Mesh(petalGeo, mat)
        head.position.set(x, h + 0.31, z)
        head.rotation.set(grassRng.range(-0.4, 0.4), grassRng.range(0, 2), grassRng.range(-0.4, 0.4))
        head.scale.setScalar(grassRng.range(0.65, 1.15))
        const eye = new THREE.Mesh(eyeGeo, stemMat)
        eye.position.set(x, h + 0.335, z)
        for (let l = 0; l < 2; l++) {
          const leaf = new THREE.Mesh(leafGeo, stemMat)
          leaf.position.set(x, h + 0.11, z)
          leaf.rotation.set(1.1, l * 2.4 + grassRng.range(0, 1), 0)
          leaf.translateY(0.07)
          group.add(leaf)
        }
        group.add(stem, head, eye)
      } else if (kind < 0.72) {
        const s = grassRng.range(0.1, 0.26)
        const pebble = new THREE.Mesh(grassRng.chance(0.5) ? boulderGeo : rubbleGeo, M.stoneDark)
        pebble.scale.set(s, s * 0.6, s * grassRng.range(0.7, 1.3))
        pebble.position.set(x, h + s * 0.25, z)
        pebble.rotation.set(grassRng.range(0, 3), grassRng.range(0, 3), grassRng.range(0, 3))
        pebble.castShadow = true
        group.add(pebble)
      } else if (kind < 0.9) {
        const stick = new THREE.Mesh(stickGeo, M.log)
        const len = grassRng.range(0.5, 1.3)
        stick.scale.set(0.6, len, 0.6)
        stick.rotation.set(Math.PI / 2, 0, grassRng.range(0, Math.PI))
        stick.position.set(x, h + 0.05, z)
        stick.castShadow = true
        group.add(stick)
      } else {
        const cap = new THREE.Mesh(capGeo, toonUnique({ color: 0xd8c8a8 }))
        cap.scale.setScalar(grassRng.range(0.6, 1.2))
        cap.position.set(x, h + 0.08, z)
        group.add(cap)
      }
    }
  }

  // Something to walk past. The ground between home and the wall was an empty
  // lawn, and an empty lawn gives the eye nothing to measure distance against:
  // a boulder group on the lip of the hollow, and one thorn standing alone.
  {
    const midRng = rng.fork('midfield')
    for (const [cx, cz, n] of [
      [-6.6, 0.4, 5],
      [7.2, -4.2, 3],
    ] as const) {
      for (let i = 0; i < n; i++) {
        const x = cx + midRng.range(-2.2, 2.2)
        const z = cz + midRng.range(-1.8, 1.8)
        const s = midRng.range(0.6, 1.9)
        const rock = new THREE.Mesh(midRng.chance(0.5) ? boulderGeo : rubbleGeo, M.stone)
        rock.scale.set(s, s * midRng.range(0.55, 0.85), s * midRng.range(0.8, 1.3))
        rock.position.set(x, heightAt(x, z) + s * 0.24, z)
        rock.rotation.set(midRng.range(0, 3), midRng.range(0, 3), midRng.range(0, 3))
        rock.castShadow = true
        rock.receiveShadow = true
        group.add(rock)
        if (s > 1.2) {
          occluders.push(occluder(rock, s * 0.9, s * 0.9))
          world.add({
            transform: { pos: new THREE.Vector3(x, heightAt(x, z) + s * 0.3, z), ry: 0 },
            mesh: rock,
            label: 'Rock',
            props: { STONE: 1, HEAVY: 1, RIGID: 1 },
            blocker: circle(x, z, s * 0.75),
          })
        }
      }
    }

    for (const [x, z, s] of [
      [5.4, -1.8, 0.95],
      [-9.4, -7.2, 0.8],
    ] as const) {
      plantTree(x, z, 'oak', s, midRng)
    }
  }

  // Stumps, where the wood has been worked.
  for (const [x, z] of [
    [11.4, 10.2],
    [12.6, 8.4],
    [6.4, 0.6],
    [-13.4, -2.4],
    [12.0, 12.6],
  ] as const) {
    const h = heightAt(x, z)
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.55, 9), M.log)
    stump.position.set(x, h + 0.26, z)
    stump.castShadow = true
    stump.receiveShadow = true
    group.add(stump)
    stand(x, z, 0.46, h + 0.53)
  }

  // -------------------------------------------------------------- palisade
  // Built by hand and it should look it: every post a different height, every
  // post leaning slightly, two lashed rails behind them, and one section that
  // came down once and was patched with whatever was to hand.
  const palRng = rng.fork('palisade')
  const logGeo = new THREE.CylinderGeometry(0.32, 0.36, 1, 8)
  const capGeoPost = new THREE.ConeGeometry(0.36, 0.5, 7)
  const palA = toonUnique({ map: tiled(tex.bark, 1.4, 3.4) })
  const palB = toonUnique({ color: 0xc9a075, map: tiled(tex.bark, 1.4, 3.4) })
  const palC = toonUnique({ color: 0x8f6a48, map: tiled(tex.bark, 1.4, 3.4) })

  /**
   * Posts run outward from the gate on both sides, starting where the gate
   * ends rather than where the gate begins.
   *
   * The two used to be laid down independently and hoped to miss: the run
   * started at +-1.5 and the gate pillars stand at +-1.35 with a 0.45 radius,
   * so the first post on each side was buried entirely inside a pillar. It was
   * invisible, it was destructible, and the pillar's collision was coming from
   * it, so felling a post nobody could see opened a hole through a pillar that
   * was still standing. Authored together now: GATE_HALF is the one number
   * both the gate and the run are measured from.
   */
  const GATE_HALF = PALISADE.gateHalf
  const postX: number[] = PALISADE.posts()

  for (const x of postX) {
    const z = PAL_Z + palRng.range(-0.16, 0.16)
    const h = heightAt(x, z)
    // The patched section is the three posts west of the gate: shorter, newer.
    const patched = x < -2.9 && x > -4.9
    const height = patched ? palRng.range(2.1, 2.5) : palRng.range(2.9, 3.5)

    const post = new THREE.Group()
    const log = new THREE.Mesh(logGeo, patched ? palC : palRng.chance(0.5) ? palA : palB)
    log.scale.set(palRng.range(0.88, 1.12), height, palRng.range(0.88, 1.12))
    log.position.y = height / 2
    log.castShadow = true
    log.receiveShadow = true
    post.add(log)

    const cap = new THREE.Mesh(capGeoPost, palB)
    cap.position.y = height + 0.25
    cap.castShadow = true
    post.add(cap)

    post.position.set(x, h, z)
    post.rotation.set(palRng.range(-0.05, 0.05), palRng.range(0, 3), palRng.range(-0.06, 0.06))
    group.add(post)
    occluders.push(occluder(post, 0.42, height + 0.5))

    world.add({
      transform: { pos: new THREE.Vector3(x, h + height * 0.5, z), ry: 0 },
      mesh: post,
      label: 'Palisade',
      props: { WOODEN: 0.95, FLAMMABLE: 0.62, RIGID: 0.9, HEAVY: 0.7 },
      structure: { hp: 82, maxHp: 82, height, label: 'Palisade' },
      blocker: circle(x, z, PALISADE.postRadius),
    })
  }

  // Rails behind the posts, and rope lashings where they cross.
  const railGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 5).rotateZ(Math.PI / 2)
  const lashGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.14, 8)
  for (const side of [-1, 1]) {
    for (const y of [1.15, 2.05]) {
      const x0 = side * (GATE_HALF + 0.1)
      const x1 = side * 6.3
      const mid = (x0 + x1) / 2
      const rail = new THREE.Mesh(railGeo, M.log)
      rail.scale.set(Math.abs(x1 - x0), 1, 1)
      rail.position.set(mid, heightAt(mid, PAL_Z) + y, PAL_Z + 0.3)
      rail.rotation.y = palRng.range(-0.02, 0.02)
      rail.castShadow = true
      group.add(rail)
    }
    for (let i = 0; i < 6; i += 2) {
      const x = side * (GATE_HALF + 0.38 + i * 0.76)
      for (const y of [1.15, 2.05]) {
        const lash = new THREE.Mesh(lashGeo, M.lashing)
        lash.position.set(x, heightAt(x, PAL_Z) + y, PAL_Z + 0.12)
        lash.rotation.x = Math.PI / 2
        group.add(lash)
      }
    }
  }

  // The patch itself: two boards nailed across the short posts at an angle.
  for (const [y, tilt] of [
    [1.5, 0.16],
    [2.2, -0.1],
  ] as const) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.24, 0.1), M.plankDark)
    board.position.set(-3.4, heightAt(-3.4, PAL_Z) + y, PAL_Z + 0.42)
    board.rotation.z = tilt
    board.castShadow = true
    group.add(board)
  }

  // The gate. The track runs straight into it, which is the entire point: a
  // road that stops is an objective, and it needs no marker to say so.
  const gateH = heightAt(0, PAL_Z)
  {
    const g = new THREE.Group()

    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(logGeo, palA)
      p.scale.set(1.25, 3.6, 1.25)
      p.position.set(side * 1.35, 1.8, 0)
      p.castShadow = true
      g.add(p)
      const cap = new THREE.Mesh(capGeoPost, palB)
      cap.scale.setScalar(1.2)
      cap.position.set(side * 1.35, 3.7, 0)
      g.add(cap)
    }

    // Lintel across the top, so the gate reads as a threshold from a distance.
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.34, 0.34), M.log)
    lintel.position.set(0, 3.35, 0)
    lintel.castShadow = true
    g.add(lintel)

    const leaf = new THREE.Group()
    for (let i = 0; i < 4; i++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.42, 0.12), M.plank)
      board.position.set(0, 0.42 + i * 0.58, 0)
      board.rotation.z = palRng.range(-0.02, 0.02)
      board.castShadow = true
      leaf.add(board)
    }
    for (const side of [-1, 1]) {
      const stile = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.5, 0.16), M.plankDark)
      stile.position.set(side * 1.0, 1.3, 0.02)
      stile.castShadow = true
      leaf.add(stile)
    }
    const brace = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.2, 0.12), M.plankDark)
    brace.position.set(0, 1.3, 0.14)
    brace.rotation.z = 0.82
    brace.castShadow = true
    leaf.add(brace)
    // The bar. Somebody closed this and nobody has opened it since.
    const bar = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.2, 0.18), M.log)
    bar.position.set(0, 1.75, 0.26)
    bar.castShadow = true
    leaf.add(bar)

    g.add(leaf)
    g.position.set(0, gateH, PAL_Z)
    group.add(g)
    occluders.push(occluder(g, 1.8, 3.9, true))

    world.add({
      transform: { pos: new THREE.Vector3(0, gateH + 1.3, PAL_Z), ry: 0 },
      mesh: g,
      label: 'The gate',
      props: { WOODEN: 0.95, FLAMMABLE: 0.7, RIGID: 0.85, HEAVY: 0.6 },
      structure: { hp: 70, maxHp: 70, height: 2.6, label: 'The gate' },
      // Measured, like everything else. The gate is a wall: as wide as the
      // pillars stand apart and as thin as the leaf is deep. It used to be a
      // CIRCLE of half-width GATE_HALF, which is a 1.9m bubble in front of a
      // 0.17m plank, so the one landmark the whole region points at could not
      // be walked up to. Nothing else is load-bearing for it, and when it
      // falls this goes with it.
      blocker: footprintOf(g) ?? box(0, PAL_Z, GATE_HALF, 0.3),
    })
  }

  // Rock spurs at each end, running all the way to the bounds so the wall
  // cannot be walked around. Facts, not invisible walls: they are STONE, so
  // nothing burns or cuts them.
  // Each side runs to ITS OWN bound, because the bounds are no longer
  // symmetric. A single hardcoded limit here is a hole at the end of the wall
  // the moment the region grows on one side, and a wall you can walk around is
  // not an obstacle at all.
  for (const side of [-1, 1] as const) {
    const limit = PALISADE.spurTo(side)
    let x = side * 7.6
    while (Math.abs(x) < limit) {
      const z = PAL_Z + palRng.range(-0.4, 0.4)
      const h = heightAt(x, z)
      const s = palRng.range(1.35, 2.15)

      const rock = new THREE.Mesh(palRng.chance(0.5) ? boulderGeo : rubbleGeo, M.stone)
      rock.scale.set(s, s * palRng.range(0.7, 1.0), s * palRng.range(0.75, 1.25))
      rock.position.set(x, h + s * 0.28, z)
      rock.rotation.set(palRng.range(0, 3), palRng.range(0, 3), palRng.range(0, 3))
      rock.castShadow = true
      rock.receiveShadow = true
      group.add(rock)
      occluders.push(occluder(rock, s * 0.9, s * 0.9))

      world.add({
        transform: { pos: new THREE.Vector3(x, h + s * 0.3, z), ry: 0 },
        mesh: rock,
        label: 'Rock',
        props: { STONE: 1, HEAVY: 1, RIGID: 1 },
        blocker: circle(x, z, s * 0.8),
      })

      // Smaller rubble at the foot, so the spur reads as an outcrop.
      for (let k = 0; k < palRng.int(1, 3); k++) {
        const rx = x + palRng.range(-1.4, 1.4)
        const rz = z + palRng.range(-1.8, 1.8)
        const rs = palRng.range(0.22, 0.6)
        const small = new THREE.Mesh(palRng.chance(0.5) ? boulderGeo : rubbleGeo, M.stone)
        small.scale.set(rs, rs * 0.7, rs)
        small.position.set(rx, heightAt(rx, rz) + rs * 0.3, rz)
        small.rotation.set(palRng.range(0, 3), palRng.range(0, 3), palRng.range(0, 3))
        small.castShadow = true
        group.add(small)
      }

      x += side * palRng.range(1.3, 1.65)
    }
  }

  // ------------------------------------------------------------ beyond the wall
  // The old marker here was a glowing torus, which is a waypoint wearing a hat
  // and contradicts D20. What replaces it is diegetic: the track carries on,
  // through two leaning waystones and a fallen arch, uphill, into older wood.
  const beyondRng = rng.fork('beyond')

  for (const [x, z, tilt] of [
    [-1.5, -10.9, 0.16],
    [1.1, -10.4, -0.22],
  ] as const) {
    const h = heightAt(x, z)
    const stoneMesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.4, 0.45), M.stone)
    stoneMesh.position.set(x, h + 1.1, z)
    stoneMesh.rotation.set(beyondRng.range(-0.08, 0.08), beyondRng.range(0, 3), tilt)
    stoneMesh.castShadow = true
    group.add(stoneMesh)
    solidRound(stoneMesh, h + 1.1, 'Waystone', { STONE: 1, HEAVY: 1, RIGID: 1 })
  }

  {
    // A gateway that stopped being one. One pier still stands, the other is
    // broken off, and the lintel came down across the road.
    const ax = -1.2
    const az = -13.6
    const h = heightAt(ax, az)

    const tall = new THREE.Mesh(new THREE.BoxGeometry(0.95, 4.2, 0.95), M.stone)
    tall.position.set(ax - 1.9, h + 2.1, az)
    tall.rotation.y = 0.12
    tall.castShadow = true
    group.add(tall)
    solidRound(tall, h + 2.1, 'Broken arch', { STONE: 1, HEAVY: 1, RIGID: 1 })

    const stub = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.3, 0.95), M.stone)
    stub.position.set(ax + 1.9, h + 1.15, az + 0.2)
    stub.rotation.set(0.06, -0.2, 0.05)
    stub.castShadow = true
    group.add(stub)
    solidRound(stub, h + 1.15, 'Broken arch', { STONE: 1, HEAVY: 1, RIGID: 1 })

    const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.8, 0.9), M.stone)
    lintel.position.set(ax + 1.1, h + 2.6, az - 0.1)
    lintel.rotation.set(0.1, 0.05, -0.42)
    lintel.castShadow = true
    group.add(lintel)

    for (let i = 0; i < 7; i++) {
      const rx = ax + beyondRng.range(-3.4, 3.4)
      const rz = az + beyondRng.range(-1.8, 1.8)
      const s = beyondRng.range(0.25, 0.7)
      const rubble = new THREE.Mesh(beyondRng.chance(0.5) ? boulderGeo : rubbleGeo, M.stone)
      rubble.scale.set(s, s * 0.65, s)
      rubble.position.set(rx, heightAt(rx, rz) + s * 0.3, rz)
      rubble.rotation.set(beyondRng.range(0, 3), beyondRng.range(0, 3), beyondRng.range(0, 3))
      rubble.castShadow = true
      group.add(rubble)
    }
  }

  // A waymarker beside the road, worn past reading.
  {
    const x = 1.6
    const z = -12.2
    const h = heightAt(x, z)
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 1.1, 6), M.stone)
    marker.position.set(x, h + 0.55, z)
    marker.rotation.set(0.1, 0.4, 0.09)
    marker.castShadow = true
    group.add(marker)
  }

  // A ruined tower above the far tree line. Only visible once the wall is
  // behind you, which makes getting past it worth something on its own.
  {
    const x = -8.6
    const z = -17.5
    const h = heightAt(x, z)
    const t = new THREE.Group()
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.3, 3.2, 8), M.stone)
    base.position.y = 1.6
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.85, 2.8, 8), M.stone)
    mid.position.y = 4.4
    // Broken off: a shorter half-cylinder gives a torn silhouette for free.
    const brokenGeo = new THREE.CylinderGeometry(1.5, 1.6, 2.2, 8, 1, false, 0, Math.PI * 1.25)
    const broken = new THREE.Mesh(brokenGeo, M.stone)
    broken.position.y = 6.6
    broken.rotation.y = 0.8
    for (const m of [base, mid, broken]) {
      m.castShadow = true
      t.add(m)
    }
    t.position.set(x, h, z)
    group.add(t)
    // Registered, and deliberately NOT pinned. It is the tallest thing past the
    // wall by three metres and it was not in this list at all, so standing
    // anywhere behind it left the player completely invisible with no way to
    // turn the camera and no way for anything to fade. A screenshot taken at
    // the holding is a screenshot of a tower with nobody in it.
    //
    // Pinning is for landmarks whose whole job is to be aimed at from far off,
    // and for buildings, which ghost into an unreadable pile of overlapping
    // boxes. Three solid cylinders ghost cleanly, and being unable to see your
    // own character is worse than a tower going faint for a moment.
    occluders.push(occluder(t, 2.3, 7.7))
    solidRound(t, h + 2, 'The tower', { STONE: 1, HEAVY: 1, RIGID: 1 })
  }

  // Dead trunks either side of the road out. The wood on the far side is older.
  for (const [x, z, s] of [
    [-4.4, -11.8, 1.3],
    [3.6, -13.0, 1.15],
    [-6.2, -14.6, 1.4],
    [4.8, -10.2, 1.0],
  ] as const) {
    plantTree(x, z, 'dead', s, beyondRng)
  }

  // ------------------------------------------------------------------- moor
  /**
   * The ground past the wall.
   *
   * The far side used to be the same bright lawn as home with a tower on it,
   * which is why it read as more of the same however much was put on it. This
   * is the fix, and it is ground rather than props: dull cold green over most
   * of it, wet dark peat in the low places, and no flowers.
   *
   * Laid at a lower lift than a track (0.07) on purpose, so the road stays on
   * top of the moor rather than being buried by it wherever a patch happens to
   * fall across it. Same trick the parched pasture uses at home.
   */
  {
    // One sheet, not a scatter of patches. The far side is a different ground
    // and it has to cover; patches over grass read as patches on grass, which
    // is what the first attempt at this looked like.
    // Reaches well past the bounds on every side, not just to them. The tree
    // line is clumped on purpose and you see between the clumps, so a sheet
    // that stops at the edge leaves bright green clearing showing through the
    // trunks on the far side of the wall, which is the one place it must not.
    layField(BOUNDS.minX - 12, BOUNDS.maxX + 14, BOUNDS.minZ - 12, moorEdge, M.moor, 0.038)

    // Wet ground in the low places and bleached grass on the exposed ones. Kept
    // small enough that a fan's chord still hugs the terrain.
    for (let i = 0; i < 30; i++) {
      const x = beyondRng.range(BOUNDS.minX, BOUNDS.maxX)
      // Biased outward, so the ground keeps changing as you climb rather than
      // changing once at a line.
      const t = beyondRng.next() ** 0.6
      const edge = moorEdge(x)
      const z = edge - t * (edge - (BOUNDS.minZ - 1))
      // Not on top of the mere: the pale margin there is the point of it.
      if (Math.hypot(x - MERE.x, z - MERE.z) < mereRadius(Math.atan2(z - MERE.z, x - MERE.x)) + 1) continue
      const wet = beyondRng.chance(0.45)
      layPatch(x, z, beyondRng.range(1.8, 3.2), wet ? M.peat : M.dryMoor, beyondRng, 0.4, 18, 0.052)
    }
  }

  /**
   * Low cover, in place of the scrub that stops at the moor edge. Grey, woody
   * and knee high: the same silhouette as the bracken at home, in a colour that
   * is nobody's idea of spring.
   */
  const heathMats = [0x6d6a58, 0x7b6f66, 0x5f6553].map((c) =>
    toonUnique({ color: c, map: tiled(tex.foliage, 1.4, 1.4) }),
  )
  for (let c = 0; c < 60; c++) {
    const cx = beyondRng.range(BOUNDS.minX, BOUNDS.maxX)
    const cz = beyondRng.range(BOUNDS.minZ, moorEdge(cx))
    if (nearTrack(cx, cz, 2.2)) continue
    for (let k = 0; k < beyondRng.int(3, 8); k++) {
      const x = cx + beyondRng.range(-1.7, 1.7)
      const z = cz + beyondRng.range(-1.7, 1.7)
      if (Math.hypot(x - MERE.x, z - MERE.z) < mereRadius(Math.atan2(z - MERE.z, x - MERE.x)) - 0.5) continue
      const s = beyondRng.range(0.32, 0.7)
      const b = new THREE.Mesh(brackenGeo, beyondRng.pick(heathMats))
      b.scale.set(s, s * beyondRng.range(0.6, 1.0), s)
      b.position.set(x, heightAt(x, z) + s * 0.24, z)
      b.rotation.set(beyondRng.range(-0.1, 0.1), beyondRng.range(0, 3), beyondRng.range(-0.1, 0.1))
      b.castShadow = true
      group.add(b)
    }
  }

  // ------------------------------------------------------------------- mere
  /**
   * Water that has dropped.
   *
   * The one water feature out here, and it is built to be read against the pond
   * at home rather than on its own. The pond is full, blue, shelving into sand,
   * with reeds standing in it and lilies on it. This is a dish two metres deep
   * with the water sitting nearly half of that below the rim, so most of what
   * you see is the pale floor it used to cover. Nothing grows at the edge.
   *
   * Everything about it is derived from MERE_RIM, so the whole thing can be
   * moved by moving one pair of numbers, which is what D22 asks of a feature
   * that a generator will eventually be placing.
   */
  {
    // The dish, drawn from the middle out past the waterline, so the part under
    // the water reads as a bottom you can see.
    const seg = 44
    const rings = [0, 0.3, 0.52, 0.74, 0.94]
    const verts: number[] = []
    const uvs: number[] = []
    const idx: number[] = []
    const ragged: number[] = []
    for (let i = 0; i <= seg; i++) ragged.push(beyondRng.range(-0.45, 0.6))

    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      const rad = mereRadius(a)
      for (const f of rings) {
        const rr = rad * f + (f === 0.94 ? ragged[i % seg]! : 0)
        const x = MERE.x + Math.cos(a) * rr
        const z = MERE.z + Math.sin(a) * rr
        // Well clear of the moor sheet at 0.038. The dish is two metres deep,
        // so a fan ring and a grid cell disagree by more than a millimetre
        // across it, and the loser flickers.
        verts.push(x, heightAt(x, z) + 0.08, z)
        uvs.push(...worldUv(x, z))
      }
    }
    const n = rings.length
    for (let i = 0; i < seg; i++) {
      for (let k = 0; k < n - 1; k++) {
        const a = i * n + k
        idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n)
      }
    }
    surface(verts, uvs, idx, M.bleach)
  }

  {
    // The water itself, drawn generously past its own edge. The dish rises
    // above MERE_LEVEL at 0.46 of the radius and hides the surplus, so the
    // waterline is wherever the ground crosses the plane and is irregular for
    // nothing.
    const seg = 40
    const verts: number[] = [MERE.x, MERE_LEVEL, MERE.z]
    const uvs: number[] = [...worldUv(MERE.x, MERE.z)]
    const idx: number[] = []
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      const rad = mereRadius(a) * 0.62
      const x = MERE.x + Math.cos(a) * rad
      const z = MERE.z + Math.sin(a) * rad
      verts.push(x, MERE_LEVEL, z)
      uvs.push(...worldUv(x, z))
    }
    for (let i = 1; i <= seg; i++) idx.push(0, i, i + 1)
    const water = surface(verts, uvs, idx, M.still)
    water.receiveShadow = false
    water.renderOrder = 1
  }

  // Trunks standing in it, snapped off at about the height the water used to
  // be. A wood does not grow in a pond; it grows and then the pond arrives.
  for (let i = 0; i < 7; i++) {
    const a = beyondRng.range(0, Math.PI * 2)
    const rad = mereRadius(a) * beyondRng.range(0.1, 0.42)
    const x = MERE.x + Math.cos(a) * rad
    const z = MERE.z + Math.sin(a) * rad
    const hgt = beyondRng.range(0.7, 2.2)
    const snag = new THREE.Mesh(trunkGeo, M.barkDead)
    const girth = beyondRng.range(0.5, 0.85)
    snag.scale.set(girth, hgt, girth)
    snag.position.set(x, heightAt(x, z) + hgt / 2, z)
    snag.rotation.set(beyondRng.range(-0.12, 0.12), beyondRng.range(0, 3), beyondRng.range(-0.14, 0.14))
    snag.castShadow = true
    group.add(snag)
    solidRound(snag, heightAt(x, z) + hgt / 2, 'Snag', { WOODEN: 0.8, FLAMMABLE: 0.2, RIGID: 0.7 })
  }

  // Pale stones on the margin, sitting where the water put them.
  for (let i = 0; i < 16; i++) {
    const a = beyondRng.range(0, Math.PI * 2)
    const rad = mereRadius(a) * beyondRng.range(0.5, 0.92)
    const x = MERE.x + Math.cos(a) * rad
    const z = MERE.z + Math.sin(a) * rad
    const s = beyondRng.range(0.14, 0.4)
    const rock = new THREE.Mesh(beyondRng.chance(0.5) ? boulderGeo : rubbleGeo, M.stone)
    rock.scale.set(s, s * 0.55, s * beyondRng.range(0.8, 1.4))
    rock.position.set(x, heightAt(x, z) + s * 0.22, z)
    rock.rotation.set(beyondRng.range(0, 3), beyondRng.range(0, 3), beyondRng.range(0, 3))
    rock.castShadow = true
    group.add(rock)
  }

  /**
   * A fence walking into the water and not coming out.
   *
   * Somebody enclosed this before there was a mere here. It is one line of
   * posts, it does not turn a corner, and the last four of it are standing in
   * the pool with their tops at about the old waterline. Nothing says the land
   * changed more cheaply than a boundary that is still where it was.
   */
  {
    const from = new THREE.Vector2(MERE.x - 3.4, MERE.z - 11.0)
    const to = new THREE.Vector2(MERE.x + 1.1, MERE.z + 2.6)
    for (let i = 0; i <= 13; i++) {
      if (beyondRng.chance(0.14)) continue
      const t = i / 13
      const x = from.x + (to.x - from.x) * t + beyondRng.range(-0.12, 0.12)
      const z = from.y + (to.y - from.y) * t + beyondRng.range(-0.12, 0.12)
      const ground = heightAt(x, z)
      const hgt = beyondRng.range(0.85, 1.15)
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, hgt, 6), M.barkDead)
      post.position.set(x, ground + hgt / 2, z)
      post.rotation.set(beyondRng.range(-0.14, 0.14), 0, beyondRng.range(-0.16, 0.16))
      post.castShadow = true
      group.add(post)
    }
  }

  // ------------------------------------------------------- the empty holding
  /**
   * Footings, a cold hearth, and a gap where a door was.
   *
   * This is the far side's argument, and it is made against home rather than on
   * its own: the same plan, the same size, the same stone under it, with the
   * timber gone and grass in the fire. Nobody explains it and nothing here is
   * takeable. It is a landmark and a statement, in that order.
   *
   * Each wall is its own solid, so the doorway gap is a gap the player can walk
   * through. One footprint around the whole rectangle would have sealed it, and
   * a ruin you cannot get into is a box.
   */
  {
    // Well clear of the tower. At its first position, nine metres from it, the
    // tower stood between the camera and the whole ruin from the one angle the
    // player ever gets, so the place was a screenshot of a tower. Two landmarks
    // need room between them or the nearer one eats the further one.
    const cx = -20.5
    const cz = -26.5
    const turn = 0.42
    const W = 5.6
    const D = 3.8
    const WALL = 0.85
    const c = Math.cos(turn)
    const s = Math.sin(turn)
    /** Local (right, forward) in the holding's own frame, to world. */
    const at = (lx: number, lz: number): [number, number] => [cx + lx * c + lz * s, cz - lx * s + lz * c]

    layPatch(cx, cz, 4.6, M.peat, beyondRng, 0.3, 20, 0.055)

    // Four runs of low rubble wall, with the south one broken for the doorway.
    const walls: [number, number, number, number][] = [
      [0, -D / 2, W, 0.5],
      [-W / 2, 0, 0.5, D],
      [W / 2, 0, 0.5, D],
      [-W / 2 + 1.05, D / 2, 2.1, 0.5],
      [W / 2 - 0.85, D / 2, 1.7, 0.5],
    ]
    for (const [lx, lz, w, d] of walls) {
      const [x, z] = at(lx, lz)
      const g = new THREE.Group()
      // Two courses, not three. Three of them at 0.28m each is a stack of thin
      // bands and from 35 degrees above it reads as slats, which is what the
      // first version of this looked like: a venetian blind lying in a field.
      // One solid mass with a shorter, narrower course on top is a wall that
      // has lost its height, which is what a footing is.
      const low = WALL * beyondRng.range(0.6, 0.72)
      const base = new THREE.Mesh(new THREE.BoxGeometry(w, low, d), M.rubbleWall)
      base.position.y = low / 2
      base.castShadow = true
      base.receiveShadow = true
      g.add(base)

      const capW = w * beyondRng.range(0.5, 0.86)
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(capW, WALL - low, d * 0.88),
        M.rubbleWall,
      )
      cap.position.set(beyondRng.range(-1, 1) * (w - capW) * 0.4, low + (WALL - low) / 2, 0)
      cap.castShadow = true
      cap.receiveShadow = true
      g.add(cap)

      // Individual stones along the top, so the line the eye follows is the
      // ragged one rather than the box's.
      for (let i = 0; i < Math.round(Math.max(w, d) * 2.2); i++) {
        const along = beyondRng.range(-0.5, 0.5)
        const sc = beyondRng.range(0.16, 0.3)
        const st = new THREE.Mesh(beyondRng.chance(0.5) ? boulderGeo : rubbleGeo, M.rubbleWall)
        st.scale.set(sc, sc * 0.7, sc)
        st.position.set(along * w, low + beyondRng.range(-0.06, 0.12), along * d)
        st.rotation.set(beyondRng.range(0, 3), beyondRng.range(0, 3), beyondRng.range(0, 3))
        st.castShadow = true
        g.add(st)
      }
      g.position.set(x, heightAt(x, z), z)
      g.rotation.y = turn
      group.add(g)
      solidBuilt(g, heightAt(x, z) + WALL / 2, 'Footings', { STONE: 1, HEAVY: 1, RIGID: 1 })
    }

    // Fallen stone off the walls, so the rectangle sits in its own rubble.
    for (let i = 0; i < 18; i++) {
      const [x, z] = at(beyondRng.range(-W / 2 - 1.4, W / 2 + 1.4), beyondRng.range(-D / 2 - 1.2, D / 2 + 1.2))
      const sc = beyondRng.range(0.14, 0.36)
      const st = new THREE.Mesh(beyondRng.chance(0.5) ? boulderGeo : rubbleGeo, M.rubbleWall)
      st.scale.set(sc, sc * 0.6, sc)
      st.position.set(x, heightAt(x, z) + sc * 0.25, z)
      st.rotation.set(beyondRng.range(0, 3), beyondRng.range(0, 3), beyondRng.range(0, 3))
      st.castShadow = true
      group.add(st)
    }

    // The hearth, which is the point of the whole thing: the same ring of set
    // stones as at home, with no bowl, no coals and no smoke. Cold is stated by
    // what is missing rather than by anything added.
    {
      const [hx, hz] = at(-0.4, 0.3)
      const hy = heightAt(hx, hz)
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2
        const sc = beyondRng.range(0.24, 0.38)
        const st = new THREE.Mesh(beyondRng.chance(0.5) ? boulderGeo : rubbleGeo, M.stoneDark)
        st.scale.set(sc, sc * 0.75, sc)
        const x = hx + Math.cos(a) * 0.8
        const z = hz + Math.sin(a) * 0.8
        st.position.set(x, heightAt(x, z) + sc * 0.28, z)
        st.rotation.set(beyondRng.range(0, 3), beyondRng.range(0, 3), beyondRng.range(0, 3))
        st.castShadow = true
        group.add(st)
      }
      const ash = new THREE.Mesh(
        new THREE.CircleGeometry(0.8, 13).rotateX(-Math.PI / 2),
        toonUnique({ color: 0x4b463c, map: tiled(tex.stone, 1.8, 1.8) }),
      )
      ash.position.set(hx, hy + 0.03, hz)
      group.add(ash)
      // Growing in it.
      for (let i = 0; i < 5; i++) {
        const x = hx + beyondRng.range(-0.55, 0.55)
        const z = hz + beyondRng.range(-0.55, 0.55)
        const len = beyondRng.range(0.4, 0.8)
        const tuft = new THREE.Mesh(tuftGeo, M.tuftPale)
        tuft.scale.set(1, len, 1)
        tuft.position.set(x, heightAt(x, z) + len * 0.46, z)
        tuft.rotation.set(beyondRng.range(-0.3, 0.3), beyondRng.range(0, 3), beyondRng.range(-0.3, 0.3))
        group.add(tuft)
      }
    }

    // The ridge beam, down across its own floor. A capsule, like the log at the
    // pond: a segment grown by its own girth, sat on the highest ground it
    // touches rather than on the ground at its middle.
    {
      const [bx, bz] = at(0.5, -0.2)
      const yaw = turn + 0.7
      const LEN = 4.6
      const GIRTH = 0.22
      const y = groundUnder(bx, bz, LEN / 2 - GIRTH, 0, yaw) + 0.18
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, LEN, 7), M.barkDead)
      beam.rotation.set(0, yaw, Math.PI / 2 - 0.05)
      beam.position.set(bx, y, bz)
      beam.castShadow = true
      group.add(beam)
      standables.push({ ...box(bx, bz, LEN / 2 - GIRTH, 0, yaw, GIRTH * 1.4), top: y + GIRTH })
    }
  }

  // ------------------------------------------------------------- the stones
  /**
   * A row of standing stones over the crest, and the far side's landmark.
   *
   * D20 makes this load-bearing rather than decorative. There is no marker
   * saying the region continues past the hill, so something tall and pale has
   * to stand on the skyline and be worth walking toward, and it has to still be
   * there when you arrive, which is what `pinned` means on an occluder.
   *
   * They ignore the road completely, because they are older than it. Where the
   * two meet, the stone is down and the road goes over it.
   */
  const STONE_ROW = { x0: -14.5, z0: -28.4, x1: 8.0, z1: -31.4, count: 8 }
  {
    for (let i = 0; i < STONE_ROW.count; i++) {
      const t = i / (STONE_ROW.count - 1)
      const x = STONE_ROW.x0 + (STONE_ROW.x1 - STONE_ROW.x0) * t + beyondRng.range(-0.7, 0.7)
      const z = STONE_ROW.z0 + (STONE_ROW.z1 - STONE_ROW.z0) * t + beyondRng.range(-0.9, 0.9)
      const h = heightAt(x, z)
      const w = beyondRng.range(0.9, 1.35)
      const thick = beyondRng.range(0.5, 0.7)

      // The one the road runs through is lying down. Measured against the track
      // rather than counted out, so moving either does not silently bury a
      // three metre stone in the middle of the way out.
      if (nearTrack(x, z, 2.6)) {
        const len = beyondRng.range(2.2, 2.9)
        const yaw = beyondRng.range(0, 3)
        // Bedded on the highest ground it covers, so no corner of a stone this
        // long ends up under the hill it fell on.
        const y = groundUnder(x, z, w / 2, len / 2, yaw)
        const down = new THREE.Mesh(new THREE.BoxGeometry(w, thick, len), M.menhir)
        down.position.set(x, y + thick * 0.45, z)
        down.rotation.set(beyondRng.range(-0.06, 0.06), yaw, beyondRng.range(-0.05, 0.05))
        down.castShadow = true
        down.receiveShadow = true
        group.add(down)
        standables.push({ ...box(x, z, w / 2, len / 2, yaw, 0), top: y + thick * 0.9 })
        continue
      }

      const hgt = beyondRng.range(2.4, 3.7)
      const g = new THREE.Group()
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, thick), M.menhir)
      slab.position.y = hgt / 2
      slab.rotation.set(beyondRng.range(-0.09, 0.09), 0, beyondRng.range(-0.13, 0.13))
      slab.castShadow = true
      slab.receiveShadow = true
      g.add(slab)
      // A darker cap where it has weathered, so the top edge is not one flat
      // plane across eight stones.
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.16, thick * 0.96), M.stoneDark)
      cap.position.y = hgt - 0.05
      cap.rotation.copy(slab.rotation)
      g.add(cap)
      g.position.set(x, h, z)
      g.rotation.y = beyondRng.range(0, Math.PI)
      group.add(g)
      occluders.push(occluder(g, Math.max(w, thick) * 0.7, hgt, true))
      solidBuilt(g, h + hgt / 2, 'Standing stone', { STONE: 1, HEAVY: 1, RIGID: 1 })

      // Packing stones at the foot, which is how one of these is actually set.
      for (let k = 0; k < beyondRng.int(2, 5); k++) {
        const px = x + beyondRng.range(-0.8, 0.8)
        const pz = z + beyondRng.range(-0.8, 0.8)
        const sc = beyondRng.range(0.16, 0.32)
        const st = new THREE.Mesh(rubbleGeo, M.stoneDark)
        st.scale.set(sc, sc * 0.6, sc)
        st.position.set(px, heightAt(px, pz) + sc * 0.25, pz)
        st.rotation.set(beyondRng.range(0, 3), beyondRng.range(0, 3), beyondRng.range(0, 3))
        group.add(st)
      }
    }
  }

  /**
   * Cairns beside the road, getting bigger as it climbs. Somebody was counting
   * something, and nobody says what.
   */
  for (const [x, z, n] of [
    [-2.5, -19.2, 7],
    [-6.0, -24.4, 11],
    [-2.4, -31.0, 16],
  ] as const) {
    const h = heightAt(x, z)
    const g = new THREE.Group()
    for (let i = 0; i < n; i++) {
      const t = i / n
      const rad = 0.62 * (1 - t) + 0.06
      const a = beyondRng.range(0, Math.PI * 2)
      const sc = beyondRng.range(0.2, 0.42) * (1.05 - t * 0.4)
      const st = new THREE.Mesh(beyondRng.chance(0.5) ? boulderGeo : rubbleGeo, M.stone)
      st.scale.set(sc, sc * 0.62, sc * beyondRng.range(0.85, 1.2))
      st.position.set(Math.cos(a) * rad * beyondRng.range(0, 1), 0.12 + t * 1.05, Math.sin(a) * rad * beyondRng.range(0, 1))
      st.rotation.set(beyondRng.range(0, 3), beyondRng.range(0, 3), beyondRng.range(0, 3))
      st.castShadow = true
      st.receiveShadow = true
      g.add(st)
    }
    g.position.set(x, h, z)
    group.add(g)
    solidRound(g, h + 0.5, 'Cairn', { STONE: 1, HEAVY: 1, RIGID: 1 })
  }

  /**
   * The wood past the crest, and it leans.
   *
   * Every trunk out here is dead, and they all lean the same way, which nothing
   * at home does. Trees lean into shelter or away from wind and a clearing full
   * of them agreeing is the quietest wrong thing available: it is only visible
   * once you notice you are not looking at a wood, you are looking at a
   * direction.
   */
  /**
   * Kept small, and the reason is collision rather than taste. `footprintOf`
   * measures in the object's OWN frame, so a lean folds out of the measurement
   * entirely and the trunk's blocker stays upright underneath it. At 0.11 the
   * wood is about 13cm off its own footprint at chest height, against 3-13cm of
   * slack in the circle, so the worst case is clipping the edge of a trunk. Any
   * further and it would need measure.ts to measure in a level frame, which is
   * its own change.
   */
  const LEAN = 0.11
  const LEAN_YAW = 2.2
  for (const [cx, cz, n] of [
    [-11.5, -20.5, 4],
    [7.5, -16.5, 3],
    [-19.0, -30.5, 5],
    [3.5, -27.0, 4],
    [16.5, -29.5, 5],
    [24.5, -19.5, 4],
    [-24.0, -16.0, 3],
    [30.0, -27.0, 4],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const x = cx + beyondRng.range(-3.2, 3.2)
      const z = cz + beyondRng.range(-2.6, 2.6)
      if (nearTrack(x, z, 2.4)) continue
      if (Math.hypot(x - MERE.x, z - MERE.z) < mereRadius(Math.atan2(z - MERE.z, x - MERE.x)) + 1.2) continue
      const s = beyondRng.range(0.85, 1.6)
      const t = plantTree(x, z, 'dead', s, beyondRng)
      t.rotation.set(0, LEAN_YAW + beyondRng.range(-0.18, 0.18), LEAN + beyondRng.range(-0.03, 0.03))
      treeEntity(t, x, z, s, 'Dead trunk')
    }
  }

  // ------------------------------------------------------------------ home
  // The permanent home base (D21). Hand-placed, because the player sees it
  // every run and it has to reward recognition rather than novelty. What makes
  // it read as inhabited is not the buildings, it is everything around them:
  // the fence, the washing, the vegetables, the birds, and the mud.
  const homeRng = rng.fork('home')

  /**
   * The longhouse. One building, not a pair of matching boxes: it is long, it
   * is the tallest thing at home, and it is the only one with a door.
   *
   * Four details do most of the work of stopping it reading as a printed
   * carton. Notched log ends at every corner, so the walls are built out of
   * something. A near-black doorway with a warm sliver behind it, so there is
   * an inside. A painted shadow band under the eave, because at this pitch the
   * overhang's real shadow lands on the ground rather than on the wall. And
   * horizontal battens across the thatch, which is what stops the straw texture
   * reading as a checked tablecloth.
   */
  function longhouse(x: number, z: number, turn: number, w: number, dep: number): void {
    const h = heightAt(x, z)
    const g = new THREE.Group()
    const wallH = 2.55

    const footing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.3, dep + 0.3), M.rubbleWall)
    footing.position.y = 0.15
    footing.castShadow = true
    footing.receiveShadow = true
    g.add(footing)

    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, dep), M.plank)
    walls.position.y = 0.3 + wallH / 2
    walls.castShadow = true
    walls.receiveShadow = true
    g.add(walls)

    // Notched log ends. Six short cylinders per corner, alternating which axis
    // they run along, exactly as a corner-notched log wall stacks.
    const endGeo = new THREE.CylinderGeometry(0.14, 0.15, 0.5, 7).rotateZ(Math.PI / 2)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let i = 0; i < 6; i++) {
          const end = new THREE.Mesh(endGeo, M.log)
          const y = 0.42 + i * 0.34
          if (i % 2 === 0) end.position.set((sx * w) / 2 + sx * 0.12, y, (sz * dep) / 2 - sz * 0.16)
          else {
            end.rotation.y = Math.PI / 2
            end.position.set((sx * w) / 2 - sx * 0.16, y, (sz * dep) / 2 + sz * 0.12)
          }
          end.castShadow = true
          g.add(end)
        }
      }
    }

    // The ridge runs along X, so the roof slopes in Z and the triangular gable
    // ends are the walls at x = +-w/2. Stepped rather than triangular: a real
    // triangle needs its own UVs, and five boxes read the same at this size.
    const pitch = 0.72
    const eave = 0.3 + wallH
    // Small overhang on purpose. The camera looks down at 35 degrees, so every
    // centimetre of eave hides 1.4 of the wall below it; at the half metre this
    // started with, the door and both windows were invisible from every angle.
    const run = dep / 2 + 0.22
    const ridge = eave + run * Math.tan(pitch)
    const steps = 5
    for (const sx of [-1, 1]) {
      for (let i = 0; i < steps; i++) {
        const f = 1 - (i + 0.5) / steps
        const step = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, (ridge - eave) / steps + 0.03, dep * f),
          M.plank,
        )
        step.position.set((sx * w) / 2, eave + ((i + 0.5) * (ridge - eave)) / steps, 0)
        g.add(step)
      }
    }

    const slope = run / Math.cos(pitch)
    for (const sz of [-1, 1]) {
      const half = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.18, slope), M.thatch)
      half.position.set(0, (eave + ridge) / 2, (sz * run) / 2)
      half.rotation.x = sz * pitch
      half.castShadow = true
      half.receiveShadow = true
      g.add(half)

      // Battens: thatch is laid in courses and pinned, and the horizontal lines
      // are what tell you the strands run down-slope.
      for (let i = 1; i <= 3; i++) {
        const t = i / 4
        const batten = new THREE.Mesh(new THREE.BoxGeometry(w + 0.54, 0.07, 0.09), M.plankDark)
        batten.position.set(
          0,
          eave + (ridge - eave) * t + 0.11 * Math.cos(pitch),
          sz * (run * (1 - t) + 0.11 * Math.sin(pitch)),
        )
        g.add(batten)
      }

      // A ragged, darker eave edge, and the shadow it should be throwing.
      const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.52, 0.2, 0.14), M.thatchOld)
      edge.position.set(0, eave - 0.02, sz * run)
      edge.rotation.x = sz * pitch
      g.add(edge)

      const band = new THREE.Mesh(new THREE.BoxGeometry(w - 0.05, 0.34, 0.04), M.eaveShade)
      band.position.set(0, eave - 0.22, (sz * dep) / 2 + sz * 0.03)
      g.add(band)
    }

    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.32, 0.24, 0.4), M.thatchOld)
    cap.position.y = ridge + 0.02
    cap.castShadow = true
    g.add(cap)

    // Break the roof up. It was the largest bright plane in the frame and it
    // was out-competing the fire, the well and the player for attention, which
    // is the wrong thing for a roof to win. Moss where it stays damp, a patch
    // of newer thatch where it was mended, and a soot stain off the chimney.
    for (const [mx, mz, mw, md] of [
      [-w * 0.28, 0.62, 1.05, 0.7],
      [w * 0.18, -0.5, 0.75, 0.55],
      [w * 0.36, 0.75, 0.6, 0.45],
    ] as const) {
      const sz = mz > 0 ? 1 : -1
      const t = Math.abs(mz)
      const patch = new THREE.Mesh(new THREE.BoxGeometry(mw, 0.06, md), M.moss)
      patch.position.set(
        mx,
        eave + (ridge - eave) * (1 - t) + 0.12 * Math.cos(pitch),
        sz * (run * t + 0.1 * Math.sin(pitch)),
      )
      patch.rotation.x = sz * pitch
      g.add(patch)
    }
    const mend = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 1.0), M.thatchOld)
    mend.position.set(w * 0.06, eave + (ridge - eave) * 0.55 + 0.12, run * 0.45)
    mend.rotation.x = pitch
    g.add(mend)
    const stain = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.07, 1.5), M.sooted)
    stain.position.set(-w / 2 + 0.42, eave + (ridge - eave) * 0.5 + 0.13, run * 0.5)
    stain.rotation.x = pitch
    g.add(stain)

    // The doorway. Near black, with one warm plane behind it: somebody is in.
    const doorX = -w * 0.24
    // Pale surrounds. The opening is near-black and the wall is dark timber,
    // so on its own the door was dark on dark and simply did not read from the
    // one angle the player ever gets. A light frame is what separates them.
    const jambMat = M.rubbleWall
    for (const sx of [-1, 1]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.35, 0.3), jambMat)
      jamb.position.set(doorX + sx * 0.73, 1.17, dep / 2 + 0.06)
      jamb.castShadow = true
      g.add(jamb)
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.26, 0.34), jambMat)
    head.position.set(doorX, 2.42, dep / 2 + 0.08)
    head.castShadow = true
    g.add(head)

    const opening = new THREE.Mesh(new THREE.BoxGeometry(1.26, 2.2, 0.16), M.doorway)
    opening.position.set(doorX, 1.35, dep / 2 + 0.02)
    g.add(opening)
    const inside = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.8),
      toonUnique({ color: 0xffb066, emissive: new THREE.Color(0xff8a34), emissiveIntensity: 0.9 }),
    )
    inside.position.set(doorX, 1.16, dep / 2 + 0.045)
    g.add(inside)
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.2, 0.26), M.log)
    lintel.position.set(doorX, 2.62, dep / 2 + 0.06)
    lintel.castShadow = true
    g.add(lintel)
    // The leaf, standing open against the wall beside it.
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.84, 0.1), M.plankDark)
    leaf.position.set(doorX + 0.94, 1.22, dep / 2 + 0.36)
    leaf.rotation.y = -0.75
    leaf.castShadow = true
    g.add(leaf)
    const stepStone = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.16, 0.55), M.rubbleWall)
    stepStone.position.set(doorX, 0.08, dep / 2 + 0.42)
    stepStone.receiveShadow = true
    g.add(stepStone)

    for (const wx of [w * 0.24, -w * 0.42]) {
      const surround = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.86, 0.1), M.rubbleWall)
      surround.position.set(wx, 1.78, dep / 2 + 0.04)
      g.add(surround)
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.62, 0.08), M.doorway)
      win.position.set(wx, 1.78, dep / 2 + 0.07)
      g.add(win)
      const sill = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.1, 0.2), M.log)
      sill.position.set(wx, 1.4, dep / 2 + 0.1)
      sill.castShadow = true
      g.add(sill)
      for (const s of [-1, 1]) {
        const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.7, 0.07), M.plankDark)
        shutter.position.set(wx + s * 0.62, 1.78, dep / 2 + 0.1)
        shutter.rotation.y = s * 0.4
        g.add(shutter)
      }
    }

    const cx = -w / 2 - 0.18
    const top = ridge + 0.6
    const stack = new THREE.Mesh(new THREE.BoxGeometry(0.7, top, 0.74), M.rubbleWall)
    stack.position.set(cx, top / 2, 0)
    stack.castShadow = true
    g.add(stack)
    const crown = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.24, 0.94), M.stoneDark)
    crown.position.set(cx, top + 0.11, 0)
    crown.castShadow = true
    g.add(crown)

    // Somebody is in. Parented to the building, so it goes wherever the
    // building goes and needs no coordinate of its own. Drifting the same way
    // the washing line leans. Nothing to tick: main.ts advances every column.
    const smoke = createSmokeColumn({ scale: 0.8, seed: 17, drift: [-0.35, -0.2] })
    smoke.object3D.position.set(cx, top + 0.3, 0)
    g.add(smoke.object3D)

    g.position.set(x, h, z)
    g.rotation.y = turn
    group.add(g)
    occluders.push(occluder(g, Math.max(w, dep) * 0.62, ridge + 0.9, true))

    solidBuilt(g, h + 0.9, 'Home', {
      WOODEN: 0.8,
      FLAMMABLE: 0.3,
      RIGID: 0.9,
    })
  }

  /**
   * The other building is not a second house. It is a low open-sided shed:
   * four posts, a mono-pitch roof, one half wall, and everything that lives
   * outdoors stacked underneath it. Two identical huts read as a diorama; a
   * house and the shed it needs read as a holding.
   */
  function shed(x: number, z: number, turn: number, w: number, dep: number): void {
    const h = heightAt(x, z)
    const g = new THREE.Group()
    const front = 2.0
    const back = 2.0

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, back, 7), M.log)
        post.position.set((sx * w) / 2, back / 2, (sz * dep) / 2)
        post.castShadow = true
        g.add(post)
      }
    }

    // Half wall along the high side, where the weather comes from.
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 1.5, 0.14), M.plank)
    backWall.position.set(0, 0.75, -dep / 2)
    backWall.castShadow = true
    backWall.receiveShadow = true
    g.add(backWall)
    for (let i = 0; i < 4; i++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(w + 0.24, 0.1, 0.06), M.plankDark)
      board.position.set(0, 0.3 + i * 0.42, -dep / 2 - 0.09)
      g.add(board)
    }

    // Gabled, not mono-pitch. A single sloping plane seen from 35 degrees above
    // is a rectangle, and a rectangle on legs reads as a table however it is
    // textured. Two planes meeting at a ridge read as a roof from any angle,
    // which is the whole reason the longhouse reads and the first shed did not.
    const pitch = 0.66
    const eave = back
    const run = dep / 2 + 0.24
    const ridge = eave + run * Math.tan(pitch)
    const slopeLen = run / Math.cos(pitch)

    for (const sz of [-1, 1]) {
      const half = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.15, slopeLen), M.thatch)
      half.position.set(0, (eave + ridge) / 2, (sz * run) / 2)
      half.rotation.x = sz * pitch
      half.castShadow = true
      half.receiveShadow = true
      g.add(half)

      const batten = new THREE.Mesh(new THREE.BoxGeometry(w + 0.44, 0.06, 0.08), M.plankDark)
      batten.position.set(0, eave + (ridge - eave) * 0.45, sz * run * 0.55)
      g.add(batten)
    }
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.26, 0.18, 0.3), M.thatchOld)
    cap.position.y = ridge + 0.02
    cap.castShadow = true
    g.add(cap)

    // Rafters, visible because there is no ceiling.
    for (const dx of [-0.7, 0, 0.7]) {
      const rafter = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, dep + 0.3), M.log)
      rafter.position.set(dx * (w / 2), eave - 0.12, 0)
      g.add(rafter)
    }
    const tie = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.1, 0.1), M.log)
    tie.position.set(0, eave - 0.12, dep / 2)
    tie.castShadow = true
    g.add(tie)

    // A shelf along the back wall, which is where a jar of something ends up.
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.08, 0.42), M.plank)
    shelf.position.set(0, 1.15, -dep / 2 + 0.28)
    shelf.castShadow = true
    g.add(shelf)

    g.position.set(x, h, z)
    g.rotation.y = turn
    group.add(g)
    occluders.push(occluder(g, Math.max(w, dep) * 0.5, ridge + 0.3, true))

    solidBuilt(g, h + 0.8, 'The shed', {
      WOODEN: 0.9,
      FLAMMABLE: 0.45,
      RIGID: 0.8,
    })
  }

  /**
   * Pushed apart, and the whole holding with them.
   *
   * Max: "the home base is too crammed with stuff, makes it hard to move, and
   * in general there is too much stuff going on in a small area, the game
   * should feel more open". The props were right and the spacing was not: the
   * house, the shed, the store, the coop and the woodpile all sat inside about
   * eleven metres, so the east side of the yard was one continuous six-metre
   * wall of building with no grass showing between any of it.
   *
   * Everything below moves OUTWARD from the hearth rather than being deleted.
   * A holding is supposed to have this much in it; it is supposed to have room
   * between the parts as well, and room is what says somebody lives here
   * rather than that somebody is storing scenery here.
   */
  longhouse(-7.0, 16.4, 1.83, 5.0, 3.2)
  shed(8.4, 16.4, -0.34, 3.2, 2.4)

  // The three lines a person actually walks at home: door to fire, fire to
  // shed, fire to well. These are laid last so they sit on top of the yard, and
  // they are the reason the ground under the buildings is not unbroken lawn.
  layTrack(
    [
      [-4.5, 17.2],
      [-2.7, 15.7],
      [-1.0, 14.3],
      [0.2, 13.7],
    ],
    0.52,
    M.track,
    trackRng,
    0.075,
  )
  layTrack(
    [
      [0.9, 13.4],
      [3.4, 14.3],
      [6.0, 15.5],
      [8.1, 16.1],
    ],
    0.46,
    M.track,
    trackRng,
    0.075,
  )
  layTrack(
    [
      [0.6, 12.6],
      [2.4, 11.6],
      [4.1, 10.6],
    ],
    0.42,
    M.track,
    trackRng,
    0.075,
  )

  /** The hearth. Always lit, never consumed. */
  {
    const hx = HOME.x
    const hz = HOME.z
    const h = heightAt(hx, hz)

    // A ring of set stones rather than a torus, which read as a pipe.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2
      const s = homeRng.range(0.26, 0.4)
      const st = new THREE.Mesh(homeRng.chance(0.5) ? boulderGeo : rubbleGeo, M.stone)
      st.scale.set(s, s * 0.8, s)
      st.position.set(hx + Math.cos(a) * 0.82, h + s * 0.3, hz + Math.sin(a) * 0.82)
      st.rotation.set(homeRng.range(0, 3), homeRng.range(0, 3), homeRng.range(0, 3))
      st.castShadow = true
      st.receiveShadow = true
      group.add(st)
    }

    // A dark bowl first, so the glow sits down inside something. A bright disc
    // laid flat on the grass is a puddle of paint; ash around it and charred
    // wood over it is what makes it a fire that has been burning a while.
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.86, 0.62, 0.34, 14, 1, true),
      toonUnique({ color: 0x2a231c, map: tiled(tex.stone, 1.6, 1.6), side: THREE.BackSide }),
    )
    bowl.position.set(hx, h - 0.02, hz)
    group.add(bowl)

    const ash = new THREE.Mesh(
      new THREE.CircleGeometry(0.84, 14).rotateX(-Math.PI / 2),
      toonUnique({ color: 0x3b332b, map: tiled(tex.stone, 1.8, 1.8) }),
    )
    ash.position.set(hx, h - 0.03, hz)
    group.add(ash)

    const coals = new THREE.Mesh(
      new THREE.CircleGeometry(0.56, 12).rotateX(-Math.PI / 2),
      toonUnique({ map: tiled(tex.ember, 1.2, 1.2), emissive: new THREE.Color(0xff5a1a), emissiveIntensity: 0.9 }),
    )
    coals.position.set(hx, h - 0.08, hz)
    group.add(coals)

    // Charred logs laid across the pit, burnt through in the middle. The tint
    // runs from bark at the ends to near black where they cross the coals.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI + homeRng.range(-0.2, 0.2)
      const burnt = i % 2 === 0
      const log = new THREE.Mesh(
        new THREE.CylinderGeometry(0.085, 0.11, homeRng.range(0.95, 1.35), 6),
        burnt ? M.charred : M.log,
      )
      log.rotation.set(Math.PI / 2, 0, a)
      log.position.set(
        hx + Math.cos(a + 1.57) * homeRng.range(0, 0.22),
        h + 0.06 + homeRng.range(0, 0.11),
        hz + Math.sin(a + 1.57) * homeRng.range(0, 0.22),
      )
      log.rotation.x = Math.PI / 2 + homeRng.range(-0.12, 0.12)
      log.castShadow = true
      group.add(log)
    }

    // Cooking tripod and pot. One object, and the fire stops being scenery.
    const tri = new THREE.Group()
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 2.1, 5), M.log)
      leg.position.set(Math.cos(a) * 0.42, 1.0, Math.sin(a) * 0.42)
      leg.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4)
      leg.castShadow = true
      tri.add(leg)
    }
    const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4), M.steel)
    hook.position.y = 1.6
    tri.add(hook)
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.4, 10), toonUnique({ color: 0x3a3a3c }))
    pot.position.y = 1.15
    pot.castShadow = true
    tri.add(pot)
    tri.position.set(hx, h, hz)
    group.add(tri)

    // Log seats, worn smooth and bedded into the ground rather than resting on
    // it. Anything cylindrical sitting exactly tangent to the terrain reads as
    // a prop dropped in from a menu.
    for (const [dx, dz, ry, len, rad] of [
      [1.55, 0.95, 0.5, 1.6, 0.3],
      [-1.35, 1.25, -0.86, 1.15, 0.26],
    ] as const) {
      const seat = new THREE.Mesh(
        new THREE.CylinderGeometry(rad, rad * 1.08, len, 9).rotateZ(Math.PI / 2),
        M.log,
      )
      const sx = hx + dx
      const sz = hz + dz
      seat.position.set(sx, heightAt(sx, sz) + rad * 0.72, sz)
      seat.rotation.set(homeRng.range(-0.05, 0.05), ry, homeRng.range(-0.06, 0.06))
      seat.castShadow = true
      seat.receiveShadow = true
      group.add(seat)
      standables.push({
        ...box(sx, sz, len * 0.32, 0, ry, rad * 1.4),
        top: heightAt(sx, sz) + rad * 1.5,
      })
    }

    // HOT but not FLAMMABLE, so the fire sim treats it as a permanent ignition
    // source that never burns out. This is what makes "go home and light your
    // torch" a real move rather than a hint.
    world.add({
      transform: { pos: new THREE.Vector3(hx, h + 0.3, hz), ry: 0 },
      mesh: coals,
      label: 'The hearth',
      props: { HOT: 1, LUMINOUS: 0.9, STONE: 0.8 },
    })
  }

  /** The well: free WATER, so water is a tool rather than a lucky find. */
  {
    const wx = 4.4
    const wz = 11.3
    const h = heightAt(wx, wz)
    const g = new THREE.Group()

    const kerb = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.72, 0.8, 10), M.stone)
    kerb.position.y = 0.4
    kerb.castShadow = true
    kerb.receiveShadow = true
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.52, 12).rotateX(-Math.PI / 2), M.water)
    water.position.y = 0.66
    g.add(kerb, water)

    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 0.14), M.log)
      post.position.set(s * 0.6, 1.15, 0)
      post.castShadow = true
      g.add(post)
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.16, 1.1), M.thatch)
    roof.position.y = 1.95
    roof.rotation.z = 0.1
    roof.castShadow = true
    g.add(roof)
    const winch = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 7).rotateZ(Math.PI / 2), M.log)
    winch.position.y = 1.6
    g.add(winch)
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4), M.lashing)
    rope.position.set(0.2, 1.2, 0)
    g.add(rope)
    const pail = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.24, 8), M.plankDark)
    pail.position.set(0.2, 0.72, 0)
    pail.castShadow = true
    g.add(pail)

    g.position.set(wx, h, wz)
    g.rotation.y = 0.3
    group.add(g)

    solidRound(g, h + 0.4, 'The well', { WATER: 1, CONTAINER: 0.8, STONE: 0.9 })
  }

  /**
   * Woodpile, stacked against the east hut. Renewable fuel, and a silhouette.
   *
   * One group, not thirty loose meshes with the collision hung off whichever
   * upright happened to be built last. That arrangement gave the entity a mesh
   * the size of one post and a footprint the size of the whole stack, so a
   * 0.9m circle sat 1.9m outside anything the player could see.
   */
  {
    const bx = 8.4
    const bz = 16.1
    const base = heightAt(bx, bz)
    const pile = new THREE.Group()
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 5 - Math.floor(row / 2); i++) {
        const lz = -0.9 + i * 0.36 + (row % 2) * 0.16
        const ly = heightAt(bx, bz + lz) - base + 0.19 + row * 0.33
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.6, 8).rotateZ(Math.PI / 2), M.log)
        log.position.set(homeRng.range(-0.07, 0.07), ly, lz)
        log.rotation.y = homeRng.range(-0.05, 0.05)
        log.castShadow = true
        log.receiveShadow = true
        pile.add(log)
      }
    }
    // Two uprights holding the stack in.
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.7, 0.13), M.log)
      post.position.set(0, heightAt(bx, bz + s * 1.1) - base + 0.85, s * 1.1)
      post.castShadow = true
      pile.add(post)
    }
    // On the ground, like every other built thing here: `footprintOf` measures
    // the band between knee and shoulder in the object's OWN frame, so an
    // object whose origin is not its base measures the wrong slice of itself.
    pile.position.set(bx, base, bz)
    group.add(pile)
    solidBuilt(pile, base + 0.7, 'Woodpile', {
      WOODEN: 1,
      FLAMMABLE: 0.75,
      RIGID: 0.6,
      HEAVY: 0.6,
    })
  }

  /** The yard fence. Low, leaning, and missing a rail in two places. */
  {
    const rx = 10.6
    const rz = 6.4
    // Gaps are in the parametric angle of the ellipse, and each one has to line
    // up with a track or the track walks through the fence.
    const gaps = [
      [-1.82, -1.3], // the main track, leaving for the gate
      [-2.95, -2.4], // the pond path, leaving west
      [-0.62, -0.12], // east, to the chopping block
    ]
    const postGeo = new THREE.CylinderGeometry(0.085, 0.1, 1, 6)
    let prev: THREE.Vector3 | null = null

    for (let i = 0; i <= 44; i++) {
      const a = (i / 44) * Math.PI * 2 - Math.PI / 2
      const inGap = gaps.some(([lo, hi]) => {
        const t = Math.atan2(Math.sin(a), Math.cos(a))
        return t >= lo! && t <= hi!
      })
      const x = HOME.x + Math.cos(a) * rx + homeRng.range(-0.14, 0.14)
      const z = HOME.z + Math.sin(a) * rz + homeRng.range(-0.14, 0.14)
      const h = heightAt(x, z)
      if (inGap) {
        prev = null
        continue
      }

      // Skip anywhere a building already stands. The fence is an ellipse and
      // knows nothing about the longhouse's rotated footprint, so without this
      // its posts grow out of the wall.
      if (Math.hypot(x + 4.9, z - 15.5) < 3.4 || Math.hypot(x - 6.2, z - 15.5) < 2.3) {
        prev = null
        continue
      }

      const height = homeRng.range(0.82, 1.05)
      const post = new THREE.Mesh(postGeo, M.log)
      post.scale.set(1, height, 1)
      post.position.set(x, h + height / 2, z)
      post.rotation.set(homeRng.range(-0.08, 0.08), 0, homeRng.range(-0.08, 0.08))
      post.castShadow = true
      group.add(post)

      const here = new THREE.Vector3(x, h, z)
      if (prev) {
        const span = here.distanceTo(prev)
        for (const y of [0.34, 0.68]) {
          if (homeRng.chance(0.09)) continue
          const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 0.09, 0.07), M.plankDark)
          rail.position.set((here.x + prev.x) / 2, (here.y + prev.y) / 2 + y, (here.z + prev.z) / 2)
          rail.rotation.y = -Math.atan2(here.z - prev.z, here.x - prev.x)
          rail.rotation.z = Math.atan2(here.y - prev.y, span)
          rail.castShadow = true
          group.add(rail)
        }
      }
      prev = here
    }

    // A hurdle gate standing open where the main track leaves.
    {
      const gx = 1.6
      const gz = 9.0
      const h = heightAt(gx, gz)
      const leaf = new THREE.Group()
      for (let i = 0; i < 3; i++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.09, 0.06), M.plankDark)
        bar.position.set(0.75, 0.3 + i * 0.28, 0)
        leaf.add(bar)
      }
      for (let i = 0; i < 2; i++) {
        const stile = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.95, 0.06), M.plankDark)
        stile.position.set(0.06 + i * 1.38, 0.5, 0)
        leaf.add(stile)
      }
      leaf.position.set(gx, h, gz)
      leaf.rotation.y = 1.15
      group.add(leaf)
    }
  }

  /** Kitchen garden. Tilled rows, cabbages, and beans up sticks. */
  {
    const gx = -4.2
    const gz = 9.2
    layPatch(gx, gz, 1.9, M.tilled, homeRng, 0.12, 14, 0.075)

    const cabbageGeo = new THREE.SphereGeometry(0.2, 6, 5)
    const cabbageMat = toonUnique({ color: 0x87a767, map: tiled(tex.foliage, 0.7, 0.7) })
    for (let row = 0; row < 4; row++) {
      const z = gz - 1.35 + row * 0.85
      for (let i = 0; i < 6; i++) {
        const x = gx - 1.5 + i * 0.6
        const h = heightAt(x, z)
        if (row < 2) {
          const c = new THREE.Mesh(cabbageGeo, cabbageMat)
          c.scale.setScalar(homeRng.range(0.7, 1.15))
          c.position.set(x, h + 0.14, z)
          c.castShadow = true
          group.add(c)
        } else if (i % 2 === 0) {
          const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.15, 4), M.log)
          stick.position.set(x, h + 0.57, z)
          stick.rotation.z = homeRng.range(-0.14, 0.14)
          stick.castShadow = true
          group.add(stick)
          const vine = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.7, 5), cabbageMat)
          vine.position.set(x, h + 0.5, z)
          group.add(vine)
        }
      }
    }
    // A low woven edge, so it reads as tended rather than as a mud puddle.
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2
      const x = gx + Math.cos(a) * 2.1
      const z = gz + Math.sin(a) * 2.1
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.42, 4), M.log)
      stake.position.set(x, heightAt(x, z) + 0.2, z)
      stake.rotation.set(homeRng.range(-0.1, 0.1), 0, homeRng.range(-0.1, 0.1))
      group.add(stake)
    }
  }

  /** Washing line. Two forked poles, a sag, and three things drying. */
  {
    // South of the house, not into it. The house moved west and the line did
    // not, which put the far pole inside the gable wall.
    const a = new THREE.Vector3(-9.4, 0, 10.4)
    const b = new THREE.Vector3(-8.9, 0, 13.2)
    a.y = heightAt(a.x, a.z)
    b.y = heightAt(b.x, b.z)

    for (const p of [a, b]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.1, 6), M.log)
      pole.position.set(p.x, p.y + 1.05, p.z)
      pole.rotation.z = homeRng.range(-0.06, 0.06)
      pole.castShadow = true
      group.add(pole)
      const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 5), M.log)
      fork.position.set(p.x, p.y + 2.05, p.z)
      fork.rotation.x = 0.6
      group.add(fork)
    }

    const segs = 8
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs
      const t1 = (i + 1) / segs
      const sag = (t: number) => 1.95 - Math.sin(t * Math.PI) * 0.28
      const p0 = new THREE.Vector3(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0 + sag(t0), a.z + (b.z - a.z) * t0)
      const p1 = new THREE.Vector3(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1 + sag(t1), a.z + (b.z - a.z) * t1)
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, p0.distanceTo(p1), 4), M.lashing)
      seg.position.copy(p0).lerp(p1, 0.5)
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize())
      group.add(seg)
    }

    const shirts: [number, number, number, THREE.Material][] = [
      [0.2, 0.9, 1.0, M.cloth],
      [0.48, 0.76, 0.85, M.clothBlue],
      [0.76, 1.0, 0.9, M.clothRed],
    ]
    for (const [t, w, hh, mat] of shirts) {
      const x = a.x + (b.x - a.x) * t
      const z = a.z + (b.z - a.z) * t
      const y = a.y + (b.y - a.y) * t + 1.95 - Math.sin(t * Math.PI) * 0.28
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.06, hh, w), mat)
      cloth.position.set(x, y - hh / 2 - 0.03, z)
      cloth.rotation.set(0, 0, homeRng.range(-0.09, 0.09))
      cloth.castShadow = true
      group.add(cloth)
    }
  }

  /** Drying rack: an A-frame with strips hanging off it. */
  {
    const rx = -2.6
    const rz = 19.2
    const h = heightAt(rx, rz)
    const g = new THREE.Group()
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 5), M.log)
        leg.position.set(sx * 0.7, 0.82, sz * 0.32)
        leg.rotation.set(sz * -0.22, 0, sx * -0.28)
        leg.castShadow = true
        g.add(leg)
      }
    }
    for (const y of [1.5, 1.15]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.7, 5).rotateZ(Math.PI / 2), M.log)
      bar.position.set(0, y, 0)
      bar.castShadow = true
      g.add(bar)
    }
    for (let i = 0; i < 7; i++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.05), M.clothRed)
      strip.position.set(-0.66 + i * 0.22, 1.26, homeRng.range(-0.05, 0.05))
      strip.rotation.z = homeRng.range(-0.12, 0.12)
      strip.castShadow = true
      g.add(strip)
    }
    g.position.set(rx, h, rz)
    g.rotation.y = 0.4
    group.add(g)
    solidBuilt(g, h + 0.8, 'Drying rack', { WOODEN: 0.9, FLAMMABLE: 0.6, RIGID: 0.5 })
  }

  /** Chicken coop, a run, and three birds. Living things sell habitation. */
  {
    const cx = 4.6
    const cz = 18.6
    const h = heightAt(cx, cz)
    const g = new THREE.Group()

    const box = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.8, 0.95), M.plankDark)
    box.position.y = 0.55
    box.castShadow = true
    g.add(box)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 1.2), M.thatchOld)
    roof.position.set(0, 1.02, 0.05)
    roof.rotation.x = -0.22
    roof.castShadow = true
    g.add(roof)
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.16, 8), toonUnique({ color: 0x241c14 }))
    hole.position.set(0.2, 0.42, 0.48)
    g.add(hole)
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.9), M.plank)
    ramp.position.set(0.2, 0.28, 0.86)
    ramp.rotation.x = 0.42
    g.add(ramp)
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), M.log)
      leg.position.set(i < 2 ? -0.48 : 0.48, 0.15, i % 2 === 0 ? -0.38 : 0.38)
      g.add(leg)
    }
    g.position.set(cx, h, cz)
    g.rotation.y = -0.5
    group.add(g)
    solidBuilt(g, h + 0.5, 'The coop', { WOODEN: 0.9, FLAMMABLE: 0.6, RIGID: 0.7 })

    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2
      const x = cx + 0.4 + Math.cos(a) * 1.7
      const z = cz + 0.6 + Math.sin(a) * 1.5
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.62, 4), M.log)
      stake.position.set(x, heightAt(x, z) + 0.3, z)
      stake.rotation.set(homeRng.range(-0.12, 0.12), 0, homeRng.range(-0.12, 0.12))
      group.add(stake)
    }

    const bodyGeo = new THREE.SphereGeometry(0.17, 7, 5)
    const headGeo = new THREE.SphereGeometry(0.09, 6, 5)
    for (const [x, z, dark] of [
      [1.7, 15.2, false],
      [3.2, 14.4, true],
      [1.0, 17.2, false],
    ] as const) {
      const y = heightAt(x, z)
      const mat = dark ? M.henDark : M.hen
      const body = new THREE.Mesh(bodyGeo, mat)
      body.scale.set(1, 0.9, 1.3)
      body.position.set(x, y + 0.2, z)
      body.castShadow = true
      const head = new THREE.Mesh(headGeo, mat)
      head.position.set(x, y + 0.38, z - 0.16)
      const comb = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.09, 4), M.comb)
      comb.position.set(x, y + 0.47, z - 0.17)
      group.add(body, head, comb)
    }
  }

  /** Crates, barrels, tools: the clutter of somebody who works outdoors. */
  {
    const crateGeo = new THREE.BoxGeometry(0.62, 0.56, 0.6)
    for (const [x, z, y, ry] of [
      [8.5, 14.3, 0, 0.3],
      [9.05, 14.05, 0.56, -0.4],
      [9.5, 14.6, 0, 0.9],
    ] as const) {
      const crate = new THREE.Mesh(crateGeo, M.plank)
      crate.position.set(x, heightAt(x, z) + 0.28 + y, z)
      crate.rotation.y = ry
      crate.castShadow = true
      crate.receiveShadow = true
      group.add(crate)
      if (y === 0) {
        solidBuilt(crate, heightAt(x, z) + 0.28, 'Crate', { WOODEN: 0.85, FLAMMABLE: 0.55, CONTAINER: 0.6, RIGID: 0.7 })
      }
    }

    for (const [x, z] of [
      [-2.3, 12.5],
      [4.2, 13.9],
    ] as const) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.32, 0.85, 10), M.plankDark)
      barrel.position.set(x, heightAt(x, z) + 0.43, z)
      barrel.castShadow = true
      group.add(barrel)
      solidRound(barrel, heightAt(x, z) + 0.43, 'Barrel', { WOODEN: 0.9, FLAMMABLE: 0.4, CONTAINER: 0.7, RIGID: 0.7 })
      for (const y of [0.2, 0.66]) {
        const hoop = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.07, 10), M.steel)
        hoop.position.set(x, heightAt(x, z) + y, z)
        group.add(hoop)
      }
    }

    // Tools leaning where somebody left them.
    const leaning: [number, number, number, 'rake' | 'fork' | 'broom'][] = [
      [-2.2, 13.0, 0.4, 'rake'],
      [-7.4, 13.6, -0.5, 'fork'],
      [3.4, 14.0, 0.9, 'broom'],
    ]
    for (const [x, z, ry, kind] of leaning) {
      const h = heightAt(x, z)
      const g = new THREE.Group()
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.8, 5), M.log)
      shaft.position.y = 0.9
      shaft.castShadow = true
      g.add(shaft)
      if (kind === 'rake') {
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.07), M.log)
        head.position.y = 1.76
        g.add(head)
        for (let i = 0; i < 5; i++) {
          const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 4), M.log)
          tine.position.set(-0.2 + i * 0.1, 1.66, 0)
          g.add(tine)
        }
      } else if (kind === 'fork') {
        for (let i = 0; i < 3; i++) {
          const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 4), M.steel)
          tine.position.set(-0.12 + i * 0.12, 1.92, 0)
          g.add(tine)
        }
      } else {
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 6), M.straw)
        head.position.y = 1.72
        head.rotation.x = Math.PI
        g.add(head)
      }
      g.position.set(x, h, z)
      g.rotation.set(0.28, ry, 0.12)
      group.add(g)
    }

    // A handcart by the yard gate, tipped forward onto its handles.
    {
      const x = 3.7
      const z = 9.7
      const h = heightAt(x, z)
      const g = new THREE.Group()
      const bed = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 0.9), M.plank)
      bed.position.y = 0.55
      bed.castShadow = true
      g.add(bed)
      for (const s of [-1, 1]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 10), M.log)
        wheel.rotation.z = Math.PI / 2
        wheel.position.set(0.1, 0.36, s * 0.52)
        wheel.castShadow = true
        g.add(wheel)
      }
      for (const s of [-1, 1]) {
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 5), M.log)
        handle.position.set(-1.0, 0.3, s * 0.33)
        handle.rotation.z = Math.PI / 2 - 0.3
        g.add(handle)
      }
      g.position.set(x, h, z)
      g.rotation.y = 0.9
      group.add(g)
      solidBuilt(g, h + 0.5, 'Handcart', {
        WOODEN: 0.9,
        FLAMMABLE: 0.5,
        PLATFORM: 0.5,
        RIGID: 0.7,
      })
    }
  }

  /** Chopping block, split logs and a woodshed roof, east of the yard. */
  {
    const bx = 12.6
    const bz = 10.3
    const h = heightAt(bx, bz)
    layPatch(bx, bz, 1.5, M.yard, homeRng, 0.3, 16, 0.062)

    const block = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.8, 10), M.log)
    block.position.set(bx, h + 0.4, bz)
    block.castShadow = true
    block.receiveShadow = true
    group.add(block)
    stand(bx, bz, 0.48, h + 0.8)

    for (let i = 0; i < 9; i++) {
      const x = bx + homeRng.range(-1.5, 1.5)
      const z = bz + homeRng.range(-1.4, 1.4)
      const split = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, homeRng.range(0.4, 0.7), 6), M.log)
      split.position.set(x, heightAt(x, z) + 0.1, z)
      split.rotation.set(Math.PI / 2 + homeRng.range(-0.3, 0.3), homeRng.range(0, 3), homeRng.range(0, 3))
      split.castShadow = true
      group.add(split)
    }
  }

  /**
   * A bench outside the gate, facing down the track. Somebody sits here and
   * looks at the way out, which is the only comment this region makes on it.
   */
  {
    const bx = 3.2
    const bz = 7.3
    const g = new THREE.Group()
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.34), M.log)
      leg.position.set(sx * 0.62, 0.21, 0)
      leg.castShadow = true
      g.add(leg)
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.13, 0.42), M.plank)
    seat.position.y = 0.48
    seat.castShadow = true
    seat.receiveShadow = true
    g.add(seat)
    g.position.set(bx, heightAt(bx, bz), bz)
    g.rotation.y = -0.55
    group.add(g)
    standDeck(bx, bz, 1.75, 0.42, -0.55, heightAt(bx, bz) + 0.55)
  }

  /** A second bed outside the fence, where the things that need sun go. */
  {
    const bx = -6.0
    const bz = 7.5
    layPatch(bx, bz, 1.3, M.tilled, homeRng, 0.14, 12, 0.075)
    const podGeo = new THREE.ConeGeometry(0.13, 0.5, 5)
    const podMat = toonUnique({ color: 0x7e9d61, map: tiled(tex.foliage, 0.7, 0.7) })
    for (let i = 0; i < 9; i++) {
      const x = bx + homeRng.range(-0.95, 0.95)
      const z = bz + homeRng.range(-0.95, 0.95)
      const pod = new THREE.Mesh(podGeo, podMat)
      pod.scale.setScalar(homeRng.range(0.8, 1.3))
      pod.position.set(x, heightAt(x, z) + 0.24, z)
      pod.rotation.set(homeRng.range(-0.15, 0.15), homeRng.range(0, 3), homeRng.range(-0.15, 0.15))
      pod.castShadow = true
      group.add(pod)
    }
  }

  /** A lean-to store by the chopping block, with a shelf nobody keeps tidy. */
  {
    const sx = 13.8
    const sz = 13.6
    const h = heightAt(sx, sz)
    const g = new THREE.Group()
    for (const dx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.9, 6), M.log)
      post.position.set(dx * 0.85, 0.95, 0.55)
      post.castShadow = true
      g.add(post)
      const rear = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.3, 6), M.log)
      rear.position.set(dx * 0.85, 1.15, -0.55)
      rear.castShadow = true
      g.add(rear)
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.6, 0.1), M.plank)
    back.position.set(0, 0.8, -0.6)
    back.castShadow = true
    back.receiveShadow = true
    g.add(back)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.13, 1.5), M.thatchOld)
    roof.position.set(0, 2.15, 0)
    roof.rotation.x = -0.26
    roof.castShadow = true
    g.add(roof)
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.36), M.plank)
    shelf.position.set(0, 1.05, -0.42)
    shelf.castShadow = true
    g.add(shelf)
    g.position.set(sx, h, sz)
    g.rotation.y = -0.3
    group.add(g)
    occluders.push(occluder(g, 1.2, 2.3, true))
    solidBuilt(g, h + 1, 'The store', {
      WOODEN: 0.9,
      FLAMMABLE: 0.5,
      RIGID: 0.8,
    })
  }

  /**
   * The grave marker, up on the knoll under the old oak. Nobody explains it.
   * (IDEAS A1: progress made visible with no UI.)
   */
  {
    const mx = 9.3
    const mz = 10.0
    const h = heightAt(mx, mz)
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.0, 0.12), M.plankDark)
    marker.position.set(mx, h + 0.5, mz)
    marker.rotation.set(0.09, 0.5, -0.13)
    marker.castShadow = true
    group.add(marker)
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.13, 0.1), M.plankDark)
    cross.position.set(mx, h + 0.86, mz)
    cross.rotation.set(0, 0.5, -0.13)
    group.add(cross)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      const s = homeRng.range(0.18, 0.3)
      const st = new THREE.Mesh(boulderGeo, M.stoneDark)
      st.scale.set(s, s * 0.7, s)
      const x = mx + Math.cos(a) * 0.55
      const z = mz + Math.sin(a) * 0.55
      st.position.set(x, heightAt(x, z) + s * 0.3, z)
      st.rotation.set(homeRng.range(0, 3), homeRng.range(0, 3), homeRng.range(0, 3))
      group.add(st)
    }
  }

  /**
   * A dipping platform where the pond path meets the water. A deck: you stand
   * on it. This is the prop the lakeside bug was really about, since a plank
   * floor you sink through is the least convincing thing in a region.
   */
  {
    const px = -8.5
    const pz = 5.2
    const h = heightAt(px, pz)
    const deckY = Math.max(h, WATER_LEVEL) + 0.33
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.2, 6), M.log)
      post.position.set(px - 0.7, WATER_LEVEL - 0.1, pz + s * 0.5)
      post.castShadow = true
      group.add(post)
    }
    for (let i = 0; i < 3; i++) {
      const plankMesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.09, 0.34), M.plank)
      plankMesh.position.set(px - 0.55, deckY - 0.05, pz - 0.36 + i * 0.36)
      plankMesh.rotation.y = 0.06
      plankMesh.castShadow = true
      plankMesh.receiveShadow = true
      group.add(plankMesh)
    }
    standDeck(px - 0.55, pz, 1.7, 1.08, 0.06, deckY)
  }

  /**
   * Ghost anything standing between the camera and the player.
   *
   * Everything is done in camera space, where the test is exact and costs two
   * vector transforms per candidate: an occluder hides the player when it is
   * nearer the camera in view depth, overlaps him horizontally within its own
   * radius, and its vertical span crosses his. The projection is orthographic,
   * so world size maps to view size one to one and there is no perspective term
   * to worry about. No raycast, no bounding-box rebuild, nothing per-frame that
   * allocates.
   *
   * Materials are shared through the toon cache, so writing opacity onto one
   * tree's material would fade every tree in the region. Each occluder gets its
   * own clones, made the first time it actually needs to fade and kept
   * afterwards. Most never fade, so this stays close to free.
   */
  // ------------------------------------------------------------ occlusion
  /**
   * Ghost anything standing between the camera and the player.
   *
   * Everything is done in camera space, where the test is exact and costs two
   * vector transforms per candidate: an occluder hides the player when it is
   * nearer the camera in view depth, overlaps him horizontally within its own
   * radius, and its vertical span crosses his. The projection is orthographic,
   * so world size maps to view size one to one and there is no perspective term
   * to worry about. No raycast, no bounding-box rebuild, nothing per-frame that
   * allocates.
   *
   * Materials are shared through the toon cache, so writing opacity onto one
   * tree's material would fade every tree in the region. Each occluder gets its
   * own clones, made the first time it actually needs to fade and kept
   * afterwards. Most never fade, so this stays close to free.
   */
  const viewObject = new THREE.Vector3()
  /**
   * What must not be hidden: the player, plus the few items nearest him.
   *
   * The player alone is not enough, and the reason is structural rather than a
   * tuning miss. An item never moves, and the player may simply never stand
   * behind the one tree covering it, so a player-only test can leave a thing
   * invisible for an entire run. Capped at three items so the number of things
   * fading at once stays bounded, which matters now that outlines added a
   * second pass and stacked transparency is the largest GPU cost here.
   */
  const viewTargets = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  // Same three, in the plain shape `occluderHides` takes. Reused every frame so
  // the per-frame path allocates nothing.
  const rows: TargetInView[] = [
    { x: 0, y: 0, z: 0, row: 0.72 },
    { x: 0, y: 0, z: 0, row: 0.3 },
    { x: 0, y: 0, z: 0, row: 0.3 },
  ]
  const inView: OccluderInView = { x: 0, y: 0, z: 0, radius: 0, top: 0 }
  const REVEAL_RADIUS = 3
  /**
   * The first call snaps instead of easing. Two reasons: the player spawns
   * already standing behind whatever is behind them, so easing in from solid on
   * frame one is a visible pop; and the headless harness renders exactly one
   * frame, so without this a screenshot would only ever catch the fade 11% of
   * the way in and could never show the steady state.
   */
  let settled = false

  function fadeOccluders(playerPos: THREE.Vector3, camera: THREE.Camera, dt: number): void {
    viewTargets[0]!.copy(playerPos).applyMatrix4(camera.matrixWorldInverse)
    // The player is about 1.7 tall. Items sit at knee height and bob.
    let count = 1

    rows[0]!.x = viewTargets[0]!.x
    rows[0]!.y = viewTargets[0]!.y
    rows[0]!.z = viewTargets[0]!.z

    for (const e of queries.items) {
      if (count >= viewTargets.length) break
      const at = e.transform.pos
      const dx = at.x - playerPos.x
      const dz = at.z - playerPos.z
      if (dx * dx + dz * dz > REVEAL_RADIUS * REVEAL_RADIUS) continue
      viewTargets[count]!.copy(at).applyMatrix4(camera.matrixWorldInverse)
      rows[count]!.x = viewTargets[count]!.x
      rows[count]!.y = viewTargets[count]!.y
      rows[count]!.z = viewTargets[count]!.z
      count++
    }

    for (const o of occluders) {
      if (o.pinned) continue
      o.object.getWorldPosition(viewObject).applyMatrix4(camera.matrixWorldInverse)

      // The geometry itself lives in `occluderHides`, which is pure and tested.
      // Everything here is bookkeeping: transforms, easing and materials.
      inView.x = viewObject.x
      inView.y = viewObject.y
      inView.z = viewObject.z
      inView.radius = o.radius
      inView.top = o.top
      const hiding = occluderHides(inView, rows.slice(0, count))

      const target = hiding ? FADE_TO : 1
      if (o.opacity === target) continue

      if (settled) {
        const rate = hiding ? FADE_IN_RATE : FADE_OUT_RATE
        const step = rate * dt
        o.opacity =
          Math.abs(target - o.opacity) <= step
            ? target
            : o.opacity + Math.sign(target - o.opacity) * step
      } else {
        o.opacity = target
      }

      if (!o.faded) {
        o.faded = []
        o.hulls = []
        o.object.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (!mesh.isMesh) return

          // Outline hulls are collected separately and HIDDEN while ghosting
          // rather than faded with everything else.
          //
          // An inverted hull is a slightly larger shell drawn with BackSide, so
          // what you normally see of it is the rim poking past the body. The
          // body being opaque is what hides the rest of it. Ghost the body with
          // depthWrite off and the hull's interior back faces are suddenly
          // visible, and they fill the entire silhouette with flat dark. The
          // tree went transparent and the player still could not be seen
          // through it, because they were behind the outline rather than
          // behind the tree.
          //
          // Fading the hull too does not fix it; two translucent dark layers
          // still read as a dark shape. An outline around something you are
          // deliberately seeing through has no job to do, so it goes away.
          if (mesh.userData.outlineHull === true) {
            o.hulls!.push(mesh)
            return
          }

          const solid = mesh.material as THREE.Material
          const ghost = (solid as THREE.MeshToonMaterial).clone()
          ghost.transparent = true
          // Depth write stays ON. With it off, every overlapping part of the
          // same object blends against every other in draw order, which on a
          // stack of cones is muddy and on a building is the diagonal-streak
          // mess that read as a screen tear. Writing depth makes an object
          // ghost as one silhouette instead of as its own parts list.
          ghost.depthWrite = true
          ghost.alphaHash = false
          ghost.alphaTest = 0
          o.faded!.push({ mesh, solid, ghost })
        })
      }

      // Hulls follow the body: gone the moment it starts ghosting, back the
      // moment it is fully solid again.
      if (o.hulls) for (const h of o.hulls) h.visible = o.opacity >= 0.999

      const solid = o.opacity > 0.995
      for (const f of o.faded) {
        if (solid) {
          f.mesh.material = f.solid
        } else {
          f.ghost.opacity = o.opacity
          f.mesh.material = f.ghost
        }
      }
    }

    settled = true
  }

  // ------------------------------------------------------------------ mill
  /**
   * The mill, downstream. The region got bigger because there were too many
   * items in too little space, and the answer to that is more PLACES, not more
   * lawn: somewhere at the far end of a line you can already see, with a reason
   * to walk it. The brook is the reason, and the wheel is visible from most of
   * the clearing.
   */
  const millRng = rng.fork('mill')
  const MILL = { x: 18.9, z: 4.75 }
  {
    const h = heightAt(MILL.x, MILL.z - 3.0)
    const g = new THREE.Group()

    const base = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.5, 3.6), M.rubbleWall)
    base.position.y = 0.75
    base.castShadow = true
    base.receiveShadow = true
    g.add(base)

    const upper = new THREE.Mesh(new THREE.BoxGeometry(4.1, 2.2, 3.3), M.plank)
    upper.position.y = 2.6
    upper.castShadow = true
    upper.receiveShadow = true
    g.add(upper)

    // Exposed frame: three uprights and a rail, which is most of what says
    // "timber" rather than "box" at this resolution.
    for (const dx of [-1.5, 0, 1.5]) {
      const stud = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.2, 0.12), M.plankDark)
      stud.position.set(dx, 2.6, 1.68)
      g.add(stud)
    }
    const brace = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.16, 0.12), M.plankDark)
    brace.position.set(0, 3.6, 1.68)
    g.add(brace)

    const pitch = 0.7
    const run = 3.3 / 2 + 0.3
    const eave = 3.7
    const ridge = eave + run * Math.tan(pitch)
    for (const sz of [-1, 1]) {
      const half = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.18, run / Math.cos(pitch)), M.thatch)
      half.position.set(0, (eave + ridge) / 2, (sz * run) / 2)
      half.rotation.x = sz * pitch
      half.castShadow = true
      g.add(half)
    }
    const cap = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.2, 0.36), M.thatchOld)
    cap.position.y = ridge + 0.02
    cap.castShadow = true
    g.add(cap)

    const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.75, 0.14), M.doorway)
    door.position.set(1.0, 0.95, 1.82)
    g.add(door)
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.18, 0.22), M.log)
    doorFrame.position.set(1.0, 1.92, 1.86)
    g.add(doorFrame)
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.1), M.doorway)
    hatch.position.set(-1.2, 2.9, 1.7)
    g.add(hatch)
    // The hoist beam a mill uses to lift sacks, sticking out over the hatch.
    const hoist = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.7), M.log)
    hoist.position.set(-1.2, 3.75, 2.3)
    hoist.castShadow = true
    g.add(hoist)

    g.position.set(MILL.x, h, MILL.z - 3.0)
    g.rotation.y = -0.22
    group.add(g)
    occluders.push(occluder(g, 2.4, ridge + 0.4, true))
    solidBuilt(g, h + 1.5, 'The mill', {
      WOODEN: 0.6,
      STONE: 0.5,
      FLAMMABLE: 0.35,
      RIGID: 0.9,
    })

    // The wheel, standing in the water where the brook actually runs.
    const wheelY = heightAt(MILL.x - 0.5, MILL.z - 0.9) + BROOK_D * 0.52 + 0.6
    const wheel = new THREE.Group()
    for (const r of [1.5, 1.15]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.11, 5, 14), M.log)
      rim.castShadow = true
      wheel.add(rim)
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.5, 0.09), M.log)
      spoke.position.set(Math.cos(a) * 0.75, Math.sin(a) * 0.75, 0)
      spoke.rotation.z = a - Math.PI / 2
      wheel.add(spoke)
      const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.9), M.plank)
      paddle.position.set(Math.cos(a) * 1.35, Math.sin(a) * 1.35, 0)
      paddle.rotation.z = a
      paddle.castShadow = true
      wheel.add(paddle)
    }
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 8).rotateX(Math.PI / 2), M.log)
    wheel.add(axle)
    wheel.position.set(MILL.x - 0.5, wheelY, MILL.z - 0.9)
    wheel.rotation.y = -0.22
    group.add(wheel)

    // A millstone nobody has moved in years, and sacks against the wall.
    const stoneWheel = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.26, 14), M.stone)
    const sx = MILL.x + 2.7
    const sz = MILL.z - 1.5
    stoneWheel.position.set(sx, heightAt(sx, sz) + 0.16, sz)
    stoneWheel.rotation.set(0.05, 0.4, 0.08)
    stoneWheel.castShadow = true
    stoneWheel.receiveShadow = true
    group.add(stoneWheel)
    stand(sx, sz, 0.95, heightAt(sx, sz) + 0.29)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.34, 8), M.doorway)
    hub.position.set(sx, heightAt(sx, sz) + 0.2, sz)
    group.add(hub)

    for (let i = 0; i < 4; i++) {
      const x = MILL.x - 2.5 + millRng.range(-0.5, 0.5)
      const z = MILL.z - 2.3 + i * 0.5 + millRng.range(-0.2, 0.2)
      const sack = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.72, 8), M.cloth)
      sack.position.set(x, heightAt(x, z) + 0.36, z)
      sack.rotation.set(millRng.range(-0.12, 0.12), millRng.range(0, 3), millRng.range(-0.12, 0.12))
      sack.castShadow = true
      group.add(sack)
    }
  }

  // ------------------------------------------------------------ wheat field
  /**
   * Band 0 is wheat fields and oak woods, and a field is the cheapest honest
   * way to fill new ground with something that is not lawn. Mostly a ground
   * overlay with rows dithered into it, plus a thin scatter of standing stalks
   * for parallax: at this camera the ground does the reading and the geometry
   * only has to catch the light.
   */
  const fieldRng = rng.fork('field')
  const FIELD = { x: -19.5, z: 9.0, rx: 7.2, rz: 7.8 }
  {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      layPatch(
        FIELD.x + Math.cos(a) * FIELD.rx * 0.45,
        FIELD.z + Math.sin(a) * FIELD.rz * 0.45,
        FIELD.rx * 0.62,
        M.wheat,
        fieldRng,
        0.3,
        16,
        0.05,
      )
    }

    const stalkGeo = new THREE.ConeGeometry(0.085, 1, 4)
    // Rows, because a crop is planted and a meadow is not, and the rows are
    // most of what tells them apart from above.
    for (let row = -8; row <= 8; row++) {
      const along = row * 0.92
      for (let k = 0; k < 26; k++) {
        const t = (k / 25 - 0.5) * 2
        const x = FIELD.x + along * 0.94 + t * 1.2
        const z = FIELD.z + t * FIELD.rz * 0.95 + along * 0.18
        const inside =
          ((x - FIELD.x) / FIELD.rx) ** 2 + ((z - FIELD.z) / FIELD.rz) ** 2 < 0.92
        if (!inside) continue
        if (!fieldRng.chance(0.8)) continue
        const hgt = fieldRng.range(0.55, 0.9)
        const stalk = new THREE.Mesh(stalkGeo, fieldRng.chance(0.7) ? M.wheatStalk : M.tuftPale)
        stalk.scale.set(1, hgt, 1)
        stalk.position.set(x, heightAt(x, z) + hgt * 0.46, z)
        stalk.rotation.set(fieldRng.range(-0.14, 0.14), fieldRng.range(0, 3), fieldRng.range(-0.14, 0.14))
        stalk.castShadow = true
        group.add(stalk)
      }
    }

    // A scarecrow, which is the one thing that makes a field read as tended.
    {
      const x = FIELD.x + 1.2
      const z = FIELD.z - 1.4
      const h = heightAt(x, z)
      const g = new THREE.Group()
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.3, 6), M.log)
      post.position.y = 1.15
      post.castShadow = true
      g.add(post)
      const arms = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.11, 0.11), M.log)
      arms.position.y = 1.65
      arms.rotation.z = 0.09
      arms.castShadow = true
      g.add(arms)
      const coat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.24), M.clothRed)
      coat.position.y = 1.42
      coat.castShadow = true
      g.add(coat)
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 7, 6), M.straw)
      head.position.y = 2.05
      head.castShadow = true
      g.add(head)
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.34, 8), M.thatchOld)
      hat.position.y = 2.28
      hat.rotation.z = 0.2
      g.add(hat)
      g.position.set(x, h, z)
      g.rotation.y = 0.5
      group.add(g)
      solidRound(g, h + 1.2, 'Scarecrow', { WOODEN: 0.5, CLOTH: 0.5, FLAMMABLE: 0.8, RIGID: 0.4 })
    }
  }

  /**
   * The barn at the top of the field. Big, plain, and shut: a doorway you can
   * see into from a long way off is what makes a building worth walking to.
   */
  const BARN = { x: -22.6, z: 16.4 }
  {
    const h = heightAt(BARN.x, BARN.z)
    const g = new THREE.Group()
    const w = 6.4
    const dep = 4.4
    const wallH = 3.0

    const footing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.3, dep + 0.3), M.rubbleWall)
    footing.position.y = 0.15
    footing.receiveShadow = true
    g.add(footing)
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, dep), M.plank)
    walls.position.y = 0.3 + wallH / 2
    walls.castShadow = true
    walls.receiveShadow = true
    g.add(walls)
    for (let i = 0; i < 7; i++) {
      const stud = new THREE.Mesh(new THREE.BoxGeometry(0.16, wallH, 0.1), M.plankDark)
      stud.position.set(-w / 2 + 0.5 + i * ((w - 1) / 6), 0.3 + wallH / 2, dep / 2 + 0.03)
      g.add(stud)
    }

    const pitch = 0.68
    const eave = 0.3 + wallH
    const run = dep / 2 + 0.3
    const ridge = eave + run * Math.tan(pitch)
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const f = 1 - (i + 0.5) / 5
        const step = new THREE.Mesh(new THREE.BoxGeometry(0.16, (ridge - eave) / 5 + 0.03, dep * f), M.plank)
        step.position.set((sx * w) / 2, eave + ((i + 0.5) * (ridge - eave)) / 5, 0)
        g.add(step)
      }
    }
    for (const sz of [-1, 1]) {
      const half = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.18, run / Math.cos(pitch)), M.thatchOld)
      half.position.set(0, (eave + ridge) / 2, (sz * run) / 2)
      half.rotation.x = sz * pitch
      half.castShadow = true
      half.receiveShadow = true
      g.add(half)
    }
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.22, 0.38), M.thatch)
    cap.position.y = ridge + 0.02
    cap.castShadow = true
    g.add(cap)

    // Cart doors, one hanging open on a broken hinge.
    const opening = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 0.16), M.doorway)
    opening.position.set(0.4, 1.55, dep / 2 + 0.02)
    g.add(opening)
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.45, 0.12), M.plank)
    leaf.position.set(-0.95, 1.55, dep / 2 + 0.42)
    leaf.rotation.y = -0.62
    leaf.castShadow = true
    g.add(leaf)
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.24, 0.3), M.log)
    lintel.position.set(0.4, 2.92, dep / 2 + 0.1)
    lintel.castShadow = true
    g.add(lintel)
    // Shutters, nailed over. Nobody has been inside in a while.
    for (const dx of [-2.2, 2.4]) {
      const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.09), M.plank)
      shutter.position.set(dx, 2.3, dep / 2 + 0.06)
      g.add(shutter)
      const nailed = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.06), M.plankDark)
      nailed.position.set(dx, 2.3, dep / 2 + 0.11)
      nailed.rotation.z = 0.32
      g.add(nailed)
    }

    g.position.set(BARN.x, h, BARN.z)
    g.rotation.y = 0.34
    group.add(g)
    occluders.push(occluder(g, 3.4, ridge + 0.4, true))
    solidBuilt(g, h + 1.5, 'The barn', {
      WOODEN: 0.9,
      FLAMMABLE: 0.5,
      RIGID: 0.85,
    })

    // Bales stacked against the gable, and a cart shaft leaning on them.
    for (const [dx, dz, dy] of [
      [4.6, -1.0, 0],
      [4.6, 0.2, 0],
      [4.7, -0.4, 0.72],
    ] as const) {
      const x = BARN.x + dx
      const z = BARN.z + dz
      const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.0, 10).rotateZ(Math.PI / 2), M.straw)
      bale.position.set(x, heightAt(x, z) + 0.55 + dy, z)
      bale.rotation.y = 0.34
      bale.castShadow = true
      bale.receiveShadow = true
      group.add(bale)
      if (dy > 0) stand(x, z, 0.6, heightAt(x, z) + 1.65)
    }
  }

  // ------------------------------------------------------- the burner's camp
  /**
   * Where the region's charcoal comes from, and the far end of the one line the
   * eye can already follow: the water runs east from the pond, through the
   * ford, past the mill, and this is what is at the end of it.
   *
   * The camp is a set of facts about a working trade and nothing here is a
   * solution to anything. A kiln that is alight is permanently HOT, the same
   * way the hearth is, because a smouldering earth kiln does not go out; that
   * makes fire obtainable at the far side of the region as well as at home,
   * which is a consequence of building a charcoal camp rather than a shortcut
   * anybody wrote down. HEARTHS is what keeps loose fuel out of its reach.
   *
   * Two kilns on purpose: one alight under its turf, one still being built with
   * the billets bare. Between them they explain what the place is without a
   * word, which is the whole job now that D20 has taken the words away.
   */
  const campRng = rng.fork('camp')
  // On the dry ground tile again, and for the same reason the moor is: a
  // brown tint over the meadow texture stays green, and a five metre green
  // dome is a hill with a chimney in it rather than a kiln under turf.
  const turfMat = toonUnique({ color: 0x7c7350, map: tiled(tex.grassDry, 1.4, 1.4) })
  const earthMat = toonUnique({ color: 0x7a6449, map: tiled(tex.sand, 1.2, 1.2) })
  {
    const base = heightAt(KILN.x, KILN.z)

    // The working floor: years of ash and charcoal dust, trodden flat.
    layPatch(KILN.x, KILN.z, 6.0, M.yard, campRng, 0.32, 26, 0.05)
    layPatch(KILN.x, KILN.z, 3.9, M.ash, campRng, 0.34, 24, 0.062)
    layPatch(KILN.x - 4.6, KILN.z + 3.4, 1.9, M.ash, campRng, 0.36, 16, 0.058)

    // The lit kiln. A stack of billets sealed under turf, with the smoke
    // leaving through the crown and nothing else showing.
    {
      const g = new THREE.Group()
      const R = 2.3
      const TOP = 1.9

      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2
        const hgt = campRng.range(0.42, 0.6)
        const billet = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, hgt, 6), M.log)
        billet.position.set(Math.cos(a) * (R - 0.12), hgt / 2, Math.sin(a) * (R - 0.12))
        billet.rotation.set(Math.cos(a) * 0.1, campRng.range(0, 3), -Math.sin(a) * 0.1)
        billet.castShadow = true
        g.add(billet)
      }

      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(R, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
        turfMat,
      )
      dome.scale.set(1, TOP / R, 1)
      dome.castShadow = true
      dome.receiveShadow = true
      g.add(dome)

      // The earth collar rammed round the foot, which is what seals it.
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.16, R + 0.34, 0.42, 14), earthMat)
      collar.position.y = 0.21
      collar.castShadow = true
      collar.receiveShadow = true
      g.add(collar)

      // Vent holes round the base, and the crown open at the top.
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.3
        const vent = new THREE.Mesh(new THREE.CircleGeometry(0.11, 6), M.doorway)
        vent.position.set(Math.cos(a) * (R + 0.26), 0.3, Math.sin(a) * (R + 0.26))
        vent.rotation.y = -a + Math.PI / 2
        g.add(vent)
      }
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.26, 9), M.doorway)
      crown.position.y = TOP - 0.06
      g.add(crown)

      g.position.set(KILN.x, base, KILN.z)
      group.add(g)
      // Not pinned. The smoke is the landmark and it is a separate object, so
      // the mound may go faint without taking the thing you were walking
      // toward with it. A 2m dome five metres wide hides a player completely,
      // and a screenshot of a kiln with nobody in it is the tower's mistake.
      occluders.push(occluder(g, R + 0.3, TOP + 0.2))
      solidBuilt(g, base + 0.9, 'The kiln', {
        HOT: 0.9,
        LUMINOUS: 0.2,
        HEAVY: 1,
        RIGID: 0.5,
      })

      // Deliberately NOT parented to the kiln, unlike the one on the house.
      // That one is on a pinned building and can never fade; this mound can,
      // and a column of smoke that dissolves along with it takes the only
      // long-range guidance in the east with it.
      const smoke = createSmokeColumn({ scale: 1.15, seed: 41, drift: [0.34, -0.22] })
      smoke.object3D.position.set(KILN.x, base + TOP + 0.1, KILN.z)
      group.add(smoke.object3D)
    }

    /**
     * The next one, half built: billets stood on end against a centre pole,
     * with no turf on it yet. This is the lit kiln with its lid off, and it is
     * the only explanation of the place there is going to be.
     */
    {
      const cx = KILN.x - 5.2
      const cz = KILN.z + 2.6
      const h = heightAt(cx, cz)
      const g = new THREE.Group()

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.4, 6), M.log)
      pole.position.y = 1.2
      pole.castShadow = true
      g.add(pole)

      for (let ring = 0; ring < 2; ring++) {
        const rad = 0.58 + ring * 0.5
        const lean = 0.2 + ring * 0.16
        const n = 12 + ring * 9
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + campRng.range(-0.06, 0.06)
          const len = 2.1 - ring * 0.3
          const billet = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, len, 6), M.log)
          billet.position.set(Math.cos(a) * rad, len * 0.47, Math.sin(a) * rad)
          billet.rotation.set(Math.sin(a) * lean, campRng.range(0, 3), -Math.cos(a) * lean)
          billet.castShadow = true
          g.add(billet)
        }
      }

      g.position.set(cx, h, cz)
      group.add(g)
      occluders.push(occluder(g, 1.6, 2.2))
      solidBuilt(g, h + 0.9, 'A raised stack', {
        WOODEN: 1,
        FLAMMABLE: 0.7,
        RIGID: 0.6,
        HEAVY: 0.6,
      })
    }

    /** Somebody sleeps out here for the week a kiln takes. */
    {
      // East of the kiln, not north of it. At its first offset the shelter sat
      // at z = -7.1, which is inside the rock spur that seals the east end of
      // the palisade: a hut built into a wall of boulders, invisible from the
      // one angle the player gets. Nothing in the collision checks can see
      // that, because neither object is destructible and each is correct on its
      // own; only the picture shows it.
      const sx = KILN.x + 2.8
      const sz = KILN.z - 3.6
      const h = heightAt(sx, sz)
      const g = new THREE.Group()

      /**
       * Two slopes to a ridge, not one lean-to plane.
       *
       * The lean-to version of this is in the history of this file twice now:
       * the first shed was a mono-pitch and the comment on `shed` says exactly
       * why it was replaced. A single plane at this pitch either faces the sun
       * or it does not, and the toon ramp has no middle, so it comes out as one
       * flat slab of blue-grey slate whatever it is textured with. Two slopes
       * always give the eye a lit face and a dark one, which is what reads as a
       * roof rather than as a panel lying on some sticks.
       */
      const RIDGE_Y = 1.55
      const HALF = 1.15
      const PITCH = Math.atan2(RIDGE_Y, HALF)
      const SLOPE = Math.hypot(RIDGE_Y, HALF)

      for (const s of [-1, 1]) {
        const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, RIDGE_Y + 0.2, 6), M.log)
        fork.position.set(0, (RIDGE_Y + 0.2) / 2, s * 1.5)
        fork.castShadow = true
        g.add(fork)
      }
      const ridge = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 3.4, 6).rotateX(Math.PI / 2),
        M.log,
      )
      ridge.position.set(0, RIDGE_Y + 0.1, 0)
      ridge.castShadow = true
      g.add(ridge)

      for (const s of [-1, 1]) {
        const half = new THREE.Mesh(new THREE.BoxGeometry(SLOPE, 0.16, 3.2), turfMat)
        half.position.set((s * HALF) / 2, RIDGE_Y / 2, 0)
        // -s * PITCH, and the sign matters. Rotating about Z maps local +X to
        // (cos, sin), and the direction from the ridge down to the eave is
        // (HALF, -RIDGE_Y), whose angle is -PITCH. The complement tilts both
        // halves UP and outward instead, which builds a table with a slab on
        // it: exactly what the first version of this looked like.
        half.rotation.z = -s * PITCH
        half.castShadow = true
        half.receiveShadow = true
        g.add(half)

        // Rafter ends showing under the eave, which is the whole reason a
        // turf roof reads as built rather than as a heap.
        for (let i = 0; i < 5; i++) {
          const rz = -1.3 + i * 0.65
          const rafter = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, SLOPE + 0.2, 5), M.log)
          rafter.position.set((s * HALF) / 2, RIDGE_Y / 2 - 0.08, rz)
          rafter.rotation.z = -s * PITCH
          rafter.castShadow = true
          g.add(rafter)
        }
      }

      // Turf lumps along the ridge, holding it down.
      for (let i = 0; i < 6; i++) {
        const sod = new THREE.Mesh(rubbleGeo, turfMat)
        const sc = campRng.range(0.16, 0.28)
        sod.scale.set(sc, sc * 0.6, sc)
        sod.position.set(campRng.range(-0.12, 0.12), RIDGE_Y + 0.16, -1.4 + i * 0.56)
        sod.rotation.set(campRng.range(0, 3), campRng.range(0, 3), campRng.range(0, 3))
        g.add(sod)
      }

      // Bracken to lie on, at the open end.
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(brackenGeo, campRng.pick(brackenMats))
        const s = campRng.range(0.4, 0.7)
        b.scale.set(s, s * 0.5, s)
        b.position.set(campRng.range(-0.5, 0.5), 0.12, campRng.range(0.6, 1.4))
        b.rotation.set(1.3, campRng.range(0, 3), 0)
        g.add(b)
      }

      g.position.set(sx, h, sz)
      g.rotation.y = -0.42
      group.add(g)
      occluders.push(occluder(g, 1.7, 1.9))
      solidBuilt(g, h + 0.8, 'The shelter', {
        WOODEN: 0.8,
        FLAMMABLE: 0.5,
        RIGID: 0.6,
      })
    }

    /** Cordwood, cut to length and stacked to season. Well clear of the kiln. */
    for (const [dx, dz, turn] of [
      [-3.0, -4.2, 0.26],
      [-5.4, -2.4, 1.02],
    ] as const) {
      const bx = KILN.x + dx
      const bz = KILN.z + dz
      const foot = heightAt(bx, bz)
      const pile = new THREE.Group()
      for (let row = 0; row < 4; row++) {
        for (let i = 0; i < 4 - Math.floor(row / 3); i++) {
          const lz = -0.55 + i * 0.34 + (row % 2) * 0.15
          const log = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.16, 1.35, 8).rotateZ(Math.PI / 2),
            M.log,
          )
          log.position.set(campRng.range(-0.06, 0.06), 0.18 + row * 0.31, lz)
          log.rotation.y = campRng.range(-0.05, 0.05)
          log.castShadow = true
          log.receiveShadow = true
          pile.add(log)
        }
      }
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), M.log)
        post.position.set(0, 0.75, s * 0.8)
        post.castShadow = true
        pile.add(post)
      }
      pile.position.set(bx, foot, bz)
      pile.rotation.y = turn
      group.add(pile)
      solidBuilt(pile, foot + 0.7, 'Cordwood', {
        WOODEN: 1,
        FLAMMABLE: 0.75,
        RIGID: 0.6,
        HEAVY: 0.6,
      })
    }

    /**
     * A butt of water beside the kiln. Not a fire extinguisher and not put here
     * as one: it is what a burner keeps to damp a hole that has opened up.
     * WATER at the far end of the region is a fact, and what a player does with
     * it is not this file's business.
     */
    {
      const wx = KILN.x - 2.9
      const wz = KILN.z - 3.3
      const h = heightAt(wx, wz)
      const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.42, 1.0, 12), M.plankDark)
      butt.position.set(wx, h + 0.5, wz)
      butt.castShadow = true
      group.add(butt)
      for (const y of [0.22, 0.8]) {
        const hoop = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.08, 12), M.steel)
        hoop.position.set(wx, h + y, wz)
        group.add(hoop)
      }
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.4, 12).rotateX(-Math.PI / 2), M.water)
      top.position.set(wx, h + 0.94, wz)
      group.add(top)
      solidRound(butt, h + 0.5, 'The water butt', { WATER: 1, CONTAINER: 0.8, WOODEN: 0.7 })
    }

    /** Charcoal, drawn from the last burn and heaped where it fell. */
    {
      const hx = KILN.x + 4.4
      const hz = KILN.z + 1.9
      const h = heightAt(hx, hz)
      const heap = new THREE.Group()
      for (let i = 0; i < 22; i++) {
        const a = campRng.range(0, Math.PI * 2)
        const rad = campRng.range(0, 1) ** 0.6 * 0.95
        const s = campRng.range(0.13, 0.3)
        const lump = new THREE.Mesh(campRng.chance(0.5) ? boulderGeo : rubbleGeo, M.charred)
        lump.scale.set(s, s * 0.7, s * campRng.range(0.8, 1.5))
        lump.position.set(
          Math.cos(a) * rad,
          0.1 + (1 - rad / 0.95) * 0.34,
          Math.sin(a) * rad,
        )
        lump.rotation.set(campRng.range(0, 3), campRng.range(0, 3), campRng.range(0, 3))
        lump.castShadow = true
        heap.add(lump)
      }
      heap.position.set(hx, h, hz)
      group.add(heap)
      solidRound(heap, h + 0.3, 'Charcoal', { WOODEN: 0.3, FLAMMABLE: 0.9, HEAVY: 0.3 })

      // Sacks of it, ready to go down to the mill track.
      for (let i = 0; i < 3; i++) {
        const x = hx + 1.5 + campRng.range(-0.4, 0.4)
        const z = hz - 0.7 + i * 0.55
        const sack = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.68, 8), M.cloth)
        sack.position.set(x, heightAt(x, z) + 0.34, z)
        sack.rotation.set(campRng.range(-0.1, 0.1), campRng.range(0, 3), campRng.range(-0.1, 0.1))
        sack.castShadow = true
        group.add(sack)
      }
    }

    // Loose lumps and scorched ground across the floor, so the ash patch is not
    // a flat decal with objects standing on it.
    for (let i = 0; i < 34; i++) {
      const a = campRng.range(0, Math.PI * 2)
      const rad = campRng.range(1.2, 5.6)
      const x = KILN.x + Math.cos(a) * rad
      const z = KILN.z + Math.sin(a) * rad
      const s = campRng.range(0.07, 0.19)
      const lump = new THREE.Mesh(campRng.chance(0.5) ? boulderGeo : rubbleGeo, M.charred)
      lump.scale.set(s, s * 0.65, s * campRng.range(0.7, 1.4))
      lump.position.set(x, heightAt(x, z) + s * 0.3, z)
      lump.rotation.set(campRng.range(0, 3), campRng.range(0, 3), campRng.range(0, 3))
      group.add(lump)
    }

    // A rake and a long shovel, stood against the shelter end.
    for (const [dx, dz, ry, long] of [
      [3.9, -2.6, 0.5, true],
      [4.3, -2.2, -0.3, false],
    ] as const) {
      const x = KILN.x + dx
      const z = KILN.z + dz
      const h = heightAt(x, z)
      const g = new THREE.Group()
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, long ? 2.2 : 1.7, 5), M.log)
      shaft.position.y = long ? 1.1 : 0.85
      shaft.castShadow = true
      g.add(shaft)
      if (long) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.05), M.steel)
        blade.position.y = 2.28
        g.add(blade)
      } else {
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.06), M.log)
        head.position.y = 1.66
        g.add(head)
      }
      g.position.set(x, h, z)
      g.rotation.set(0.3, ry, 0.1)
      group.add(g)
    }
  }

  /**
   * The coup: the stretch of wood they are cutting, between the mill and the
   * camp. Stumps, brash and a couple of trunks still on the ground.
   *
   * This is what makes the camp read as part of the region instead of a prop
   * dropped in the corner. Charcoal comes from somewhere, and the somewhere is
   * on the way.
   */
  for (let i = 0; i < 17; i++) {
    // West of the kiln and short of the wall. The first range overlapped the
    // camp's own exclusion radius by most of its width, so nearly every stump
    // was rejected and the coup was three stumps in a corner.
    const x = campRng.range(19.5, 27.5)
    const z = campRng.range(-6.0, 2.0)
    if (distToPath(x, z, BROOK) < BROOK_W + 1.2) continue
    if (Math.hypot(x - KILN.x, z - KILN.z) < 5.5) continue
    if (nearTrack(x, z, 1.6)) continue
    const h = heightAt(x, z)
    const s = campRng.range(0.7, 1.15)

    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.36 * s, 0.44 * s, 0.5, 9), M.log)
    stump.position.set(x, h + 0.24, z)
    stump.rotation.set(campRng.range(-0.05, 0.05), campRng.range(0, 3), campRng.range(-0.05, 0.05))
    stump.castShadow = true
    stump.receiveShadow = true
    group.add(stump)
    stand(x, z, 0.4 * s, h + 0.49)

    // Brash: the tops, dragged aside and left.
    for (let k = 0; k < campRng.int(2, 5); k++) {
      const bx = x + campRng.range(-1.6, 1.6)
      const bz = z + campRng.range(-1.6, 1.6)
      const len = campRng.range(0.7, 1.6)
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, len, 5), M.log)
      stick.position.set(bx, heightAt(bx, bz) + 0.07, bz)
      stick.rotation.set(Math.PI / 2, campRng.range(0, 3), campRng.range(-0.2, 0.2))
      stick.castShadow = true
      group.add(stick)
    }
  }

  // The track out to the field and the barn, and the one down to the mill.
  layTrack(
    [
      [-8.0, 12.6],
      [-12.5, 12.0],
      [-16.5, 12.6],
      [-20.0, 14.4],
      [-22.0, 15.0],
    ],
    0.62,
    M.track,
    trackRng,
  )
  layTrack(
    [
      [10.8, 10.4],
      [14.0, 8.6],
      [17.2, 7.4],
      [18.4, 6.6],
    ],
    0.58,
    M.track,
    trackRng,
  )
  // On past the mill to the camp. Narrower, because what comes back along it is
  // sacks rather than carts, and it is the line the eye follows east.
  layTrack(
    [
      [19.8, 5.4],
      [22.6, 3.4],
      [25.4, 1.4],
      [28.2, 0.2],
      [30.0, 0.0],
    ],
    0.5,
    M.track,
    trackRng,
  )

  /**
   * Distance from home, measured rather than declared.
   *
   * Every place is written below as id, kind and position, and the two distance
   * fields are derived from the `home` place afterwards. Typing them would be a
   * second description of where things are, and a second description drifts:
   * that is the same argument `world/measure.ts` makes about collision, and it
   * is why the mill's distance is not a number anybody can get wrong by moving
   * the mill.
   */
  function withDistance(raw: Omit<Place, 'distance' | 'remoteness'>[]): Place[] {
    const home = raw.find((pl) => pl.kind === 'home') ?? raw[0]!
    const flat = (pl: { at: THREE.Vector3 }): number =>
      Math.hypot(pl.at.x - home.at.x, pl.at.z - home.at.z)
    // On the ground plane, not through the air. Height here is terrain, and a
    // place on a five metre rise is not five metres further away.
    const furthest = Math.max(1e-6, ...raw.map(flat))
    return raw.map((pl) => ({ ...pl, distance: flat(pl), remoteness: flat(pl) / furthest }))
  }

  const places: Place[] = withDistance([
      { id: 'hearth', kind: 'home', at: new THREE.Vector3(HOME.x, heightAt(HOME.x, HOME.z), HOME.z) },
      { id: 'well', kind: 'water', at: new THREE.Vector3(3.0, heightAt(3.0, 11.3), 11.3) },
      { id: 'pond', kind: 'water', at: new THREE.Vector3(POND.x, WATER_LEVEL, POND.z) },
      { id: 'ford', kind: 'water', at: new THREE.Vector3(FORD.x, heightAt(FORD.x, FORD.z), FORD.z) },
      { id: 'mill', kind: 'work', at: new THREE.Vector3(MILL.x, heightAt(MILL.x, MILL.z), MILL.z) },
      { id: 'barn', kind: 'work', at: new THREE.Vector3(BARN.x, heightAt(BARN.x, BARN.z), BARN.z) },
      { id: 'field', kind: 'work', at: new THREE.Vector3(FIELD.x, heightAt(FIELD.x, FIELD.z), FIELD.z) },
      { id: 'block', kind: 'work', at: new THREE.Vector3(10.4, heightAt(10.4, 10.9), 10.9) },
      { id: 'oldoak', kind: 'landmark', at: new THREE.Vector3(10.6, heightAt(10.6, 8.8), 8.8) },
      { id: 'grave', kind: 'landmark', at: new THREE.Vector3(9.3, heightAt(9.3, 10.0), 10.0) },
      { id: 'arch', kind: 'landmark', at: new THREE.Vector3(-1.2, heightAt(-1.2, -13.6), -13.6) },
      { id: 'tower', kind: 'landmark', at: new THREE.Vector3(-8.6, heightAt(-8.6, -17.5), -17.5) },
      { id: 'gate', kind: 'exit', at: new THREE.Vector3(0, gateH, PAL_Z) },

      // Added with the expansion. Every one of these is somewhere the world now
      // points at, and D22 asks that the region say so rather than leaving a
      // system to guess from geometry.
      { id: 'kiln', kind: 'work', at: new THREE.Vector3(KILN.x, heightAt(KILN.x, KILN.z), KILN.z) },
      { id: 'coup', kind: 'work', at: new THREE.Vector3(25.5, heightAt(25.5, -1.5), -1.5) },
      { id: 'butt', kind: 'water', at: new THREE.Vector3(KILN.x - 2.9, heightAt(KILN.x - 2.9, KILN.z - 3.3), KILN.z - 3.3) },
      { id: 'mere', kind: 'water', at: new THREE.Vector3(MERE.x, MERE_LEVEL, MERE.z) },
      { id: 'holding', kind: 'landmark', at: new THREE.Vector3(-20.5, heightAt(-20.5, -26.5), -26.5) },
      {
        id: 'stones',
        kind: 'landmark',
        at: new THREE.Vector3(
          (STONE_ROW.x0 + STONE_ROW.x1) / 2,
          heightAt((STONE_ROW.x0 + STONE_ROW.x1) / 2, (STONE_ROW.z0 + STONE_ROW.z1) / 2),
          (STONE_ROW.z0 + STONE_ROW.z1) / 2,
        ),
      },
      /**
       * The road off the north edge, and the second exit.
       *
       * The gate is a way THROUGH the obstacle; this is the way OUT of the
       * region. D22 forbids assuming exactly one way out, and until now there
       * was one, so anything reading this list would have concluded the world
       * ended at the palisade.
       */
      {
        id: 'road',
        kind: 'exit',
        at: new THREE.Vector3(
          BEYOND_TRACK[BEYOND_TRACK.length - 1]![0],
          heightAt(BEYOND_TRACK[BEYOND_TRACK.length - 1]![0], BOUNDS.minZ),
          BOUNDS.minZ,
        ),
      },
  ])

  // ----------------------------------------------------------------- items
  // Ten items, placed by hand, every one of them somewhere a person would have
  // left it or lost it: on the track, at the block, by the water. All outside
  // the yard fence, and all clear of blockers.
  const PLACED: Record<string, [number, number]> = {
    torch: [1.5, 8.2],
    flint: [4.9, 5.2],
    horseshoe: [3.6, -3.4],
    straw: [-6.6, 9.5],
    rope: [15.8, 8.6],
    bucket: [-6.2, 4.3],
    plank: [-2.6, -3.6],
    oil: [22.2, 3.4],
    apple: [9.4, 6.2],
    axe: [10.0, 12.1],

    // On the verge of the main track, within sight of the yard gate. Whatever
    // else a player does in the first minute, they walk past this.
    rock: [2.4, 6.8],
    // On the bench outside the fence, where somebody sat down and forgot them.
    glasses: [3.55, 7.85],
    // In the bed outside the fence, with the rest of what grows there.
    chili: [-3.6, 8.0],
    // By the chopping block, with the axe.
    knife: [8.6, 12.8],
    // On the lean-to shelf, which is where a jar you do not want indoors goes.
    poison: [11.6, 13.6],
    // Dropped at the water's edge and never found. Nowhere near the mill.
    key: [-9.2, 1.2],
    // Left in the barn, at the far end of the field track. The one thing in
    // Band 0 worth going to look for rather than tripping over.
    sword: [-25.6, 18.6],
  }

  /**
   * Iterating the catalog rather than a literal list, so an item added to Band
   * 0 cannot silently fail to exist in the world. Positions stay hand-authored;
   * anything without one lands on the verge of the main track, which is ugly
   * and obvious, which is the point.
   */
  const itemRng = rng.fork('items')
  let spare = 0
  const layout: [string, number, number][] = STARTING_ITEMS.map((id) => {
    const at = PLACED[id]
    if (at) return [id, at[0], at[1]]
    spare++
    return [id, 1.9 + spare * 0.55, 4.6 - spare * 0.35]
  })

  /**
   * The things that do not belong here, placed by rule rather than by
   * coordinate.
   *
   * The spine of this game is that the further you wander the stranger it gets,
   * so where these land is not decoration. A glossy magazine about people
   * nobody here has heard of, found forty metres from the hearth, spends the
   * whole effect in one go; found in the footings of a farmstead nobody has
   * lived in for years, it is the gradient doing its job with no words at all.
   *
   * So this is a rule and not a list of positions. Each row asks for a KIND of
   * place, the rule takes the most remote one still free, and the coordinates
   * come out of the region. Move the mill, widen the region, or generate the
   * whole thing from a seed and the rule still means what it meant. Hand-typed
   * positions for these would have to be found and rewritten every time, which
   * is exactly what D22 says must not spread into the code.
   */
  const STRANGE: readonly { id: string; kind: Place['kind'] }[] = [
    { id: 'magazine', kind: 'landmark' },
    { id: 'crossbow', kind: 'work' },
    { id: 'banana', kind: 'water' },
    { id: 'rubber_band', kind: 'work' },
  ]
  /**
   * The outer half of the region, as a fraction rather than as metres, so the
   * rule survives the region changing size. See `Place.remoteness`.
   */
  const STRANGE_FROM = 0.55
  {
    const used = new Set<string>()
    /** Most remote free place of a kind, or failing that, of any kind. */
    const pick = (kind: Place['kind']): Place | undefined => {
      const free = places.filter((pl) => !used.has(pl.id) && pl.remoteness >= STRANGE_FROM)
      const byKind = free.filter((pl) => pl.kind === kind)
      // Falls back to the far end rather than dropping the item, for the same
      // reason a Band 0 item with no authored position lands on the verge of
      // the main track: an item that silently fails to exist is invisible, and
      // one in an obviously odd place gets noticed and fixed.
      return [...(byKind.length > 0 ? byKind : free)].sort((x, y) => y.remoteness - x.remoteness)[0]
    }

    for (const { id, kind } of STRANGE) {
      if (!CATALOG[id]) continue
      const spot = pick(kind)
      if (!spot) continue
      used.add(spot.id)
      // A stride off the middle of the place, not on top of its landmark.
      // `findVisible` does the rest, so this can sit inside a ruin and still
      // come out somewhere the player can reach and see.
      const a = itemRng.range(0, Math.PI * 2)
      const r = itemRng.range(1.4, 2.6)
      layout.push([id, spot.at.x + Math.cos(a) * r, spot.at.z + Math.sin(a) * r])
    }
  }

  /**
   * Is this spot hidden from the camera by something solid?
   *
   * The camera azimuth is fixed, so this is decidable here rather than
   * mitigated at runtime, and an item nobody can ever see is a level design
   * bug rather than a rendering one. Same three projection components as the
   * runtime test, written against the fixed basis instead of a camera matrix.
   */
  function hiddenFromCamera(x: number, y: number, z: number): boolean {
    const sx = (x - z) * ISO_SX
    const sy = -(x + z) * ISO_SY_GROUND + y * ISO_SY_UP
    const depth = x + y + z

    for (const o of occluders) {
      const p = o.object.position
      // Only things standing between this point and the camera can hide it.
      if (p.x + p.y + o.top * 0.5 + p.z <= depth) continue
      if (Math.abs((p.x - p.z) * ISO_SX - sx) > o.radius + 0.3) continue
      const base = -(p.x + p.z) * ISO_SY_GROUND + p.y * ISO_SY_UP
      if (base > sy + 0.3) continue
      if (base + o.top * ISO_SY_UP < sy) continue
      return true
    }
    return false
  }

  /**
   * Push a hidden item out until the camera can see it. The offsets walk
   * outward along the screen-horizontal axis first, because sliding sideways
   * clears a trunk in the fewest metres and keeps the item near where it was
   * authored to be.
   */
  function reachable(x: number, z: number): boolean {
    if (x < BOUNDS.minX + 1 || x > BOUNDS.maxX - 1) return false
    if (z < BOUNDS.minZ + 1 || z > BOUNDS.maxZ - 1) return false
    // Not in the pond, and not in the brook. The pond has a fixed water level
    // so a height test catches it; the brook's surface follows the ground
    // downhill, so the only honest test is "is it in the channel at all".
    // Missing this is what put things to pick up in the middle of the river.
    if (heightAt(x, z) < WATER_LEVEL + 0.1) return false
    if (distToPath(x, z, BROOK) < BROOK_W + 0.7) return false
    for (const b of queries.blockers) {
      if (distanceTo(b.blocker, x, z) < 0.5) return false
    }
    return true
  }

  /** Somewhere an item must not be: in water, unreachable, or never visible. */
  function badSpot(x: number, z: number): boolean {
    return !reachable(x, z) || hiddenFromCamera(x, heightAt(x, z) + 0.3, z)
  }

  const OFFSETS = [
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1.4, 0],
    [0, 1.4],
  ] as const

  /**
   * Two passes, because the two constraints are not equally important.
   *
   * The first asks for somewhere both reachable and visible. The second drops
   * visibility and asks only for somewhere reachable, because an item you can
   * see but cannot pick up is worse than one you have to walk around a trunk to
   * spot. Falling back to the authored position without that second pass is
   * what could still leave something standing in the river.
   */
  function findVisible(x: number, z: number): [number, number] {
    if (!badSpot(x, z)) return [x, z]

    for (let step = 1; step <= 7; step++) {
      for (const [ax, az] of OFFSETS) {
        const nx = x + ax * step * 0.55
        const nz = z + az * step * 0.55
        if (!badSpot(nx, nz)) return [nx, nz]
      }
    }
    for (let step = 1; step <= 10; step++) {
      for (const [ax, az] of OFFSETS) {
        const nx = x + ax * step * 0.55
        const nz = z + az * step * 0.55
        if (reachable(nx, nz)) return [nx, nz]
      }
    }
    return [x, z]
  }

  for (const [id, ax, az] of layout) {
    const def = CATALOG[id]
    if (!def) continue
    const [x, z] = findVisible(ax, az)

    const y = heightAt(x, z) + 0.3
    const mesh = buildItemMesh(def)
    mesh.position.set(x, y, z)
    mesh.rotation.y = itemRng.range(0, Math.PI * 2)
    group.add(mesh)

    const e: Entity = {
      transform: { pos: new THREE.Vector3(x, y, z), ry: mesh.rotation.y },
      mesh,
      props: { ...def.props },
      item: { def },
      bob: { phase: itemRng.range(0, Math.PI * 2), baseY: y },
    }
    world.add(e)
  }

  return {
    group,
    heightAt,
    playerStart: new THREE.Vector3(0.8, heightAt(0.8, 10.8), 10.8),
    gate: new THREE.Vector3(0, gateH, PAL_Z),
    fadeOccluders,
    occluderStates: () =>
      occluders
        .filter((o) => !o.pinned)
        .map((o) => {
          const at = o.object.getWorldPosition(new THREE.Vector3())
          return { x: at.x, z: at.z, radius: o.radius, opacity: o.opacity }
        }),
    standables,
    places,
  }
}
