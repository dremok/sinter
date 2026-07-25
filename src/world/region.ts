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
import type { Rng } from '../core/rng'
import { queries, world, type Entity } from '../ecs/world'
import { CATALOG, STARTING_ITEMS } from '../items/catalog'
import { buildItemMesh } from '../render/kitbash'
import { BAND0 } from '../render/palette'
import { toonUnique } from '../render/toon'
import { textures, tiled } from '../render/textures'
import { createSmokeColumn } from '../render/flame'

/** Where the player may walk. Outside this is tree line. */
export const BOUNDS = { minX: -28, maxX: 28, minZ: -22, maxZ: 20 }

const GROUND_SIZE = 132
/** Half-unit quads. Coarser than this and the banks read as facets. */
const GRID = 220

/** Pond centre. The radius is a function of angle; see `pondRadius`. */
const POND = { x: -11.8, z: 5.2 }
const POND_DEPTH = 1.6
export const WATER_LEVEL = -0.42

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
  standables: { x: number; z: number; radius: number; top: number }[]
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

export function buildRegion(rng: Rng, scene: THREE.Scene): Region {
  const group = new THREE.Group()
  scene.add(group)

  const terrainRng = rng.fork('terrain')
  const noise = createNoise2D(() => terrainRng.next())

  const bump = (x: number, z: number, cx: number, cz: number, sigma: number, amp: number): number =>
    amp * Math.exp(-(((x - cx) ** 2 + (z - cz) ** 2) / (2 * sigma * sigma)))

  /**
   * Gentle on purpose, but no longer flat. Movement is analytic and simply
   * samples this, so a slope can never wedge the player; the only limit is what
   * reads well. Four features carry the composition:
   *
   *   - a knoll east of home, so the great oak stands above everything
   *   - a hollow between home and the wall, so the wall is revealed by walking
   *   - a levelled terrace under the yard, because people flatten what they
   *     live on, and because huts on a slope float at one corner
   *   - ground that climbs beyond the palisade, so the road out goes uphill
   */
  const heightAt = (x: number, z: number): number => {
    let h = noise(x * 0.033, z * 0.033) * 0.62 + noise(x * 0.095, z * 0.095) * 0.2

    h += bump(x, z, 10.6, 8.4, 4.6, 1.6)
    h -= bump(x, z, -3.0, 1.0, 5.6, 1.0)
    h += bump(x, z, -15.0, -0.5, 4.2, 0.9)
    h += smoothstep(-5, -22, z) * 3.0

    const yard = 1 - smoothstep(6.4, 11.0, Math.hypot((x - HOME.x) * 0.82, z - HOME.z))
    h = h * (1 - yard) + 0.42 * yard

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
    return h
  }

  /** Everything that can hide the player. Filled in as the world is built. */
  const occluders: Occluder[] = []
  const standables: { x: number; z: number; radius: number; top: number }[] = []

  /** A surface to walk on. Long props get several, laid along their length. */
  const stand = (x: number, z: number, radius: number, top: number): void => {
    standables.push({ x, z, radius, top })
  }

  /**
   * Solid scenery. Anything a player can bump into needs one of these or they
   * walk through it, which was the whole of the lakeside bug: the logs and the
   * jetty looked solid and were not there at all as far as movement was
   * concerned.
   */
  const solid = (
    mesh: THREE.Object3D,
    at: THREE.Vector3,
    label: string,
    props: Entity['props'],
    radius: number,
  ): void => {
    world.add({ transform: { pos: at, ry: 0 }, mesh, label, props, blocker: { radius } })
  }

  /** Radius of one collision segment, and how far apart their centres sit. */
  const SEG_R = 0.55
  const SEG_STEP = 0.95

  /**
   * A rectangular thing, blocked with a run of overlapping circles round its
   * footprint instead of one circle at its middle.
   *
   * A circle cannot be a rectangle. Small enough not to bulge past the short
   * walls and it never reaches the ends of the long ones; big enough to cover
   * the length and it stops people well outside the corners. Either way there
   * are gaps, and the barn, being the longest building, failed worst: you could
   * walk in through the middle of a wall.
   *
   * Same answer as the one already used for long standables. Centres sit
   * `SEG_STEP` apart with radius `SEG_R`, so neighbours overlap by 0.15 before
   * the player's own radius is counted, and nothing can squeeze between them.
   * Only the perimeter is covered: nothing can reach the inside without
   * crossing the edge first, and filling the middle would triple the count for
   * no gain.
   */
  function solidFootprint(
    mesh: THREE.Object3D,
    cx: number,
    cz: number,
    w: number,
    dep: number,
    turn: number,
    y: number,
    label: string,
    props: Entity['props'],
  ): void {
    const nx = Math.max(2, Math.ceil(w / SEG_STEP))
    const nz = Math.max(2, Math.ceil(dep / SEG_STEP))
    const local: [number, number][] = []

    for (let i = 0; i <= nx; i++) {
      const lx = -w / 2 + (i / nx) * w
      local.push([lx, -dep / 2], [lx, dep / 2])
    }
    for (let j = 1; j < nz; j++) {
      const lz = -dep / 2 + (j / nz) * dep
      local.push([-w / 2, lz], [w / 2, lz])
    }

    const c = Math.cos(turn)
    const s = Math.sin(turn)
    for (const [lx, lz] of local) {
      const x = cx + lx * c + lz * s
      const z = cz - lx * s + lz * c
      world.add({
        transform: { pos: new THREE.Vector3(x, y, z), ry: 0 },
        mesh,
        label,
        props,
        blocker: { radius: SEG_R },
      })
    }
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

  // A fallen trunk half in the water. You walk along this rather than through
  // it: it is low, it is flat on top once it has settled, and a log lying at
  // the water's edge invites exactly one thing.
  {
    const a = 0.55
    const rad = pondRadius(a)
    const bx = POND.x + Math.cos(a) * rad - 0.6
    const bz = POND.z + Math.sin(a) * rad - 0.4
    const len = 5.4
    const girth = 0.31
    const yaw = a + 0.3
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, len, 7), M.log)
    trunk.rotation.set(0, yaw, Math.PI / 2 - 0.12)
    const by = heightAt(bx, bz) + 0.2
    trunk.position.set(bx, by, bz)
    trunk.castShadow = true
    group.add(trunk)

    // Several footprints along its length, because one disc around the middle
    // of a five metre log is not the shape of a five metre log.
    const dx = Math.cos(yaw)
    const dz = -Math.sin(yaw)
    for (let i = -3; i <= 3; i++) {
      const t = (i / 3) * (len / 2 - girth)
      stand(bx + dx * t, bz + dz * t, girth * 1.5, by + girth)
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
    const deck = bed + BROOK_D * 0.52 + 0.34
    const turn = -0.28
    const SPAN = 4.6
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

    for (let i = -2; i <= 2; i++) {
      stand(FORD.x + Math.sin(turn) * i * 0.9, FORD.z + Math.cos(turn) * i * 0.9, 1.0, deck + 0.06)
    }

    // Worn dirt running onto the deck from both banks, so the track arrives at
    // the bridge instead of stopping a stride short of it.
    for (const side of [-1, 1]) {
      const ax = FORD.x + Math.sin(turn) * side * (SPAN / 2 + 0.5)
      const az = FORD.z + Math.cos(turn) * side * (SPAN / 2 + 0.5)
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

  const BEYOND_TRACK = [
    [0.0, -8.4],
    [-0.3, -10.6],
    [-0.9, -13.4],
    [-1.9, -17.0],
    [-3.4, -21.0],
  ] as const

  layTrack(MAIN_TRACK, 1.05, M.track, trackRng)
  layTrack(BEYOND_TRACK, 0.95, M.track, trackRng)

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
  layPatch(0.3, 13.1, 3.9, M.yard, trackRng, 0.34, 30, 0.06)
  layPatch(-4.7, 15.2, 3.0, M.yard, trackRng, 0.36, 20, 0.06)
  layPatch(6.1, 15.2, 2.3, M.yard, trackRng, 0.36, 18, 0.06)
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
      blocker: { radius: 0.38 * scale },
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
  const NORTH: readonly Species[] = ['pine', 'pine', 'dead', 'pine', 'oak']

  // Behind home the wood is held back, so the huts have air around them.
  treeWall(-40, 40, (t, d) => [t, BOUNDS.maxZ + 4.6 + d] as const, SOUTH, treeRng)
  treeWall(-34, 34, (t, d) => [t, BOUNDS.minZ - 1.2 - d] as const, NORTH, treeRng)
  treeWall(-27, 27, (t, d) => [BOUNDS.minX - 1.4 - d, t] as const, FLANK, treeRng)
  treeWall(-27, 27, (t, d) => [BOUNDS.maxX + 1.4 + d, t] as const, FLANK, treeRng)

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
  for (let i = 0; i < 44; i++) {
    const x = treeRng.range(BOUNDS.minX + 0.5, BOUNDS.maxX - 0.5)
    const z = treeRng.range(BOUNDS.minZ + 0.5, BOUNDS.maxZ - 0.5)
    if (distToPath(x, z, BROOK) < 2.6) continue
    if (Math.hypot(x - HOME.x, z - HOME.z) < 11) continue
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
  for (let c = 0; c < 52; c++) {
    const side = treeRng.int(0, 3)
    const along = treeRng.range(-1, 1)
    const inset = treeRng.range(-1.5, 2.6)
    let cx = 0
    let cz = 0
    if (side === 0) { cx = along * 32; cz = BOUNDS.maxZ + 3.2 - inset }
    else if (side === 1) { cx = along * 28; cz = BOUNDS.minZ - 0.4 + inset }
    else if (side === 2) { cx = BOUNDS.minX - 0.6 + inset; cz = along * 24 }
    else { cx = BOUNDS.maxX + 0.6 - inset; cz = along * 24 }

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
  for (let c = 0; c < 20; c++) {
    const cx = grassRng.range(-26, 26)
    const cz = grassRng.range(-20, 18)
    for (let k = 0; k < grassRng.int(2, 4); k++) {
      const x = cx + grassRng.range(-2.4, 2.4)
      const z = cz + grassRng.range(-2.4, 2.4)
      if (Math.hypot(x - POND.x, z - POND.z) < pondRadius(Math.atan2(z - POND.z, x - POND.x)) + 0.8) continue
      if (Math.hypot(x - HOME.x, z - HOME.z) < 6.5) continue
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

  for (let c = 0; c < 38; c++) {
    const cx = grassRng.range(-27, 27)
    const cz = grassRng.range(-21, 19)
    const kind = grassRng.next()
    for (let k = 0; k < grassRng.int(3, 9); k++) {
      const x = cx + grassRng.range(-1.6, 1.6)
      const z = cz + grassRng.range(-1.6, 1.6)
      if (Math.hypot(x - POND.x, z - POND.z) < pondRadius(Math.atan2(z - POND.z, x - POND.x)) + 0.4) continue
      const h = heightAt(x, z)

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
            blocker: { radius: s * 0.75 },
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
      blocker: { radius: PALISADE.postRadius },
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
      // Wide enough to cover both pillars and the leaf between them, so
      // nothing else is load-bearing for it. It overlaps the first post on
      // each side, and when the gate falls this goes with it.
      blocker: { radius: GATE_HALF },
    })
  }

  // Rock spurs at each end, running all the way to the bounds so the wall
  // cannot be walked around. Facts, not invisible walls: they are STONE, so
  // nothing burns or cuts them.
  for (const side of [-1, 1]) {
    let x = side * 6.9
    while (Math.abs(x) < 29.5) {
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
        blocker: { radius: s * 0.8 },
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
    solid(stoneMesh, new THREE.Vector3(x, h + 1.1, z), 'Waystone', { STONE: 1, HEAVY: 1, RIGID: 1 }, 0.46)
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
    solid(tall, new THREE.Vector3(ax - 1.9, h + 2.1, az), 'Broken arch', { STONE: 1, HEAVY: 1, RIGID: 1 }, 0.62)

    const stub = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.3, 0.95), M.stone)
    stub.position.set(ax + 1.9, h + 1.15, az + 0.2)
    stub.rotation.set(0.06, -0.2, 0.05)
    stub.castShadow = true
    group.add(stub)
    solid(stub, new THREE.Vector3(ax + 1.9, h + 1.15, az + 0.2), 'Broken arch', { STONE: 1, HEAVY: 1, RIGID: 1 }, 0.62)

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
    solid(t, new THREE.Vector3(x, h + 2, z), 'The tower', { STONE: 1, HEAVY: 1, RIGID: 1 }, 2.1)
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

    solidFootprint(g, x, z, w, dep, turn, h + 0.9, 'Home', {
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

    solidFootprint(g, x, z, w, dep, turn, h + 0.8, 'The shed', {
      WOODEN: 0.9,
      FLAMMABLE: 0.45,
      RIGID: 0.8,
    })
  }

  longhouse(-4.9, 15.5, 1.83, 5.0, 3.2)
  shed(6.2, 15.5, -0.34, 3.2, 2.4)

  // The three lines a person actually walks at home: door to fire, fire to
  // shed, fire to well. These are laid last so they sit on top of the yard, and
  // they are the reason the ground under the buildings is not unbroken lawn.
  layTrack(
    [
      [-2.64, 16.14],
      [-1.7, 15.1],
      [-0.6, 14.1],
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
      [3.0, 14.0],
      [5.0, 14.8],
      [6.0, 15.2],
    ],
    0.46,
    M.track,
    trackRng,
    0.075,
  )
  layTrack(
    [
      [0.5, 12.7],
      [1.8, 12.0],
      [2.8, 11.5],
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
      for (let k = -1; k <= 1; k++) {
        stand(sx + Math.cos(ry) * k * len * 0.32, sz - Math.sin(ry) * k * len * 0.32, rad * 1.4, heightAt(sx, sz) + rad * 1.5)
      }
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
    const wx = 3.0
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

    world.add({
      transform: { pos: new THREE.Vector3(wx, h + 0.4, wz), ry: 0 },
      mesh: g,
      label: 'The well',
      props: { WATER: 1, CONTAINER: 0.8, STONE: 0.9 },
      blocker: { radius: 0.78 },
    })
  }

  /** Woodpile, stacked against the east hut. Renewable fuel, and a silhouette. */
  {
    const bx = 6.2
    const bz = 15.2
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 5 - Math.floor(row / 2); i++) {
        const lz = bz - 0.9 + i * 0.36 + (row % 2) * 0.16
        const ly = heightAt(bx, lz) + 0.19 + row * 0.33
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.6, 8).rotateZ(Math.PI / 2), M.log)
        log.position.set(bx + homeRng.range(-0.07, 0.07), ly, lz)
        log.rotation.y = homeRng.range(-0.05, 0.05)
        log.castShadow = true
        log.receiveShadow = true
        group.add(log)
      }
    }
    // Two uprights holding the stack in.
    let last: THREE.Mesh | null = null
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.7, 0.13), M.log)
      post.position.set(bx, heightAt(bx, bz + s * 1.1) + 0.85, bz + s * 1.1)
      post.castShadow = true
      group.add(post)
      last = post
    }
    if (last) {
      solid(last, new THREE.Vector3(bx, heightAt(bx, bz) + 0.7, bz), 'Woodpile', { WOODEN: 1, FLAMMABLE: 0.75, RIGID: 0.6, HEAVY: 0.6 }, 0.9)
    }
  }

  /** The yard fence. Low, leaning, and missing a rail in two places. */
  {
    const rx = 8.4
    const rz = 4.7
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
    const gx = -2.4
    const gz = 10.2
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
    const a = new THREE.Vector3(-8.6, 0, 11.4)
    const b = new THREE.Vector3(-7.9, 0, 14.5)
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
    const rx = -0.9
    const rz = 17.3
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
    solid(g, new THREE.Vector3(rx, h + 0.8, rz), 'Drying rack', { WOODEN: 0.9, FLAMMABLE: 0.6, RIGID: 0.5 }, 0.72)
  }

  /** Chicken coop, a run, and three birds. Living things sell habitation. */
  {
    const cx = 2.6
    const cz = 16.4
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
    solid(g, new THREE.Vector3(cx, h + 0.5, cz), 'The coop', { WOODEN: 0.9, FLAMMABLE: 0.6, RIGID: 0.7 }, 0.72)

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
        solid(crate, new THREE.Vector3(x, heightAt(x, z) + 0.28, z), 'Crate', { WOODEN: 0.85, FLAMMABLE: 0.55, CONTAINER: 0.6, RIGID: 0.7 }, 0.42)
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
      solid(barrel, new THREE.Vector3(x, heightAt(x, z) + 0.43, z), 'Barrel', { WOODEN: 0.9, FLAMMABLE: 0.4, CONTAINER: 0.7, RIGID: 0.7 }, 0.42)
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
      solidFootprint(g, x, z, 2.4, 1.0, 0.9, h + 0.5, 'Handcart', {
        WOODEN: 0.9,
        FLAMMABLE: 0.5,
        PLATFORM: 0.5,
        RIGID: 0.7,
      })
    }
  }

  /** Chopping block, split logs and a woodshed roof, east of the yard. */
  {
    const bx = 10.4
    const bz = 10.9
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
    const bx = 3.0
    const bz = 8.4
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
    for (let k = -1; k <= 1; k++) {
      stand(bx + Math.cos(-0.55) * k * 0.6, bz - Math.sin(-0.55) * k * 0.6, 0.36, heightAt(bx, bz) + 0.55)
    }
  }

  /** A second bed outside the fence, where the things that need sun go. */
  {
    const bx = -3.6
    const bz = 8.2
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
    const sx = 11.5
    const sz = 13.4
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
    solidFootprint(g, sx, sz, 1.9, 1.3, -0.3, h + 1, 'The store', {
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
    for (let i = -1; i <= 1; i++) {
      stand(px - 0.55 + i * 0.6, pz, 0.5, deckY)
    }
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
    solidFootprint(g, MILL.x, MILL.z - 3.0, 4.4, 3.6, -0.22, h + 1.5, 'The mill', {
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
      solid(g, new THREE.Vector3(x, h + 1.2, z), 'Scarecrow', { WOODEN: 0.5, CLOTH: 0.5, FLAMMABLE: 0.8, RIGID: 0.4 }, 0.4)
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
    solidFootprint(g, BARN.x, BARN.z, w, dep, 0.34, h + 1.5, 'The barn', {
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
      const dx = b.transform.pos.x - x
      const dz = b.transform.pos.z - z
      const r = b.blocker.radius + 0.5
      if (dx * dx + dz * dz < r * r) return false
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
    standables,
    places: [
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
    ],
  }
}
