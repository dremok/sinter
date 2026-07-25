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

/** Where the player may walk. Outside this is tree line. */
export const BOUNDS = { minX: -18, maxX: 18, minZ: -15, maxZ: 17 }

const GROUND_SIZE = 92
/** Half-unit quads. Coarser than this and the banks read as facets. */
const GRID = 184

/** Pond centre. The radius is a function of angle; see `pondRadius`. */
const POND = { x: -11.8, z: 5.2 }
const POND_DEPTH = 1.6
export const WATER_LEVEL = -0.42

/** The hearth, and the centre everything at home is laid out around. */
const HOME = { x: 0, z: 13.4 }
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
interface Occluder {
  object: THREE.Object3D
  radius: number
  top: number
  /** Current opacity, eased toward the target. 1 means fully solid. */
  opacity: number
  /** Cloned, transparent-capable materials, made only when one is first needed. */
  faded: { mesh: THREE.Mesh; solid: THREE.Material; ghost: THREE.MeshToonMaterial }[] | null
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

/** How see-through a tree gets when it is in the way. Not zero, on purpose. */
const FADE_TO = 0.26
const FADE_IN_RATE = 1 / 0.15
const FADE_OUT_RATE = 1 / 0.3

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
    h += smoothstep(-5, -17, z) * 2.3

    const yard = 1 - smoothstep(6.4, 11.0, Math.hypot((x - HOME.x) * 0.82, z - HOME.z))
    h = h * (1 - yard) + 0.42 * yard

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
  const occluder = (object: THREE.Object3D, radius: number, top: number): Occluder => ({
    object,
    radius,
    top,
    opacity: 1,
    faded: null,
  })

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
    tilled: flatMat(tex.sand, 0x6f5237),
    shore: flatMat(tex.sand, 0xd9bf8e),
    water: toonUnique({
      map: tiled(tex.water, 3.2, 3.2),
      transparent: true,
      opacity: 0.7,
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
    // Openings have to be nearly black or they read as a panel of paint. The
    // eave band is the shadow the overhang ought to be throwing on the wall and
    // does not, because at this pitch the real one lands on the ground.
    doorway: toonUnique({ color: 0x140f0b }),
    eaveShade: toonUnique({ color: 0x4a3423 }),
    thatch: toonUnique({ color: 0xf2dda6, map: tiled(tex.straw, 2.2, 2.2) }),
    thatchOld: toonUnique({ color: 0xd9be82, map: tiled(tex.straw, 2.2, 2.2) }),
    straw: toonUnique({ map: tiled(tex.straw, 0.7, 0.7) }),
    reed: toonUnique({ color: 0x9fb862, map: tiled(tex.straw, 0.6, 0.6) }),
    tuft: toonUnique({ color: 0x8a9354, map: tiled(tex.straw, 0.7, 0.7) }),
    tuftPale: toonUnique({ color: 0xa9a271, map: tiled(tex.straw, 0.7, 0.7) }),
    cloth: toonUnique({ map: tiled(tex.cloth, 1.2, 1.2) }),
    clothBlue: toonUnique({ color: 0x8fa8c4, map: tiled(tex.cloth, 1.2, 1.2) }),
    clothRed: toonUnique({ color: 0xc48b7a, map: tiled(tex.cloth, 1.2, 1.2) }),
    steel: toonUnique({ map: tiled(tex.steel, 0.8, 0.8) }),
    clay: toonUnique({ map: tiled(tex.clay, 1, 1) }),
    lily: toonUnique({ color: 0x4f9c3c, map: tiled(tex.foliage, 1, 1) }),
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
  const birchMats = [0xa8d465, 0xbadf7c].map((hex) =>
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
    [-0.5, -1.4],
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
  treeWall(-28, 28, (t, d) => [t, BOUNDS.maxZ + 4.6 + d] as const, SOUTH, treeRng)
  treeWall(-22, 22, (t, d) => [t, BOUNDS.minZ - 1.2 - d] as const, NORTH, treeRng)
  treeWall(-16, 20, (t, d) => [BOUNDS.minX - 1.4 - d, t] as const, FLANK, treeRng)
  treeWall(-16, 20, (t, d) => [BOUNDS.maxX + 1.4 + d, t] as const, FLANK, treeRng)

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
  for (let i = 0; i < 26; i++) {
    const x = treeRng.range(BOUNDS.minX + 0.5, BOUNDS.maxX - 0.5)
    const z = treeRng.range(BOUNDS.minZ + 0.5, BOUNDS.maxZ - 0.5)
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
  for (let c = 0; c < 34; c++) {
    const side = treeRng.int(0, 3)
    const along = treeRng.range(-1, 1)
    const inset = treeRng.range(-1.5, 2.6)
    let cx = 0
    let cz = 0
    if (side === 0) { cx = along * 22; cz = BOUNDS.maxZ + 3.2 - inset }
    else if (side === 1) { cx = along * 18; cz = BOUNDS.minZ - 0.4 + inset }
    else if (side === 2) { cx = BOUNDS.minX - 0.6 + inset; cz = along * 16 }
    else { cx = BOUNDS.maxX + 0.6 - inset; cz = along * 16 }

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
  const tuftGeo = new THREE.ConeGeometry(0.26, 1, 4)

  /** Dry grass, in clumps. FLAMMABLE, so this is also the fire's road. */
  for (let c = 0; c < 11; c++) {
    const cx = grassRng.range(-16, 16)
    const cz = grassRng.range(-13, 15)
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
      for (let t = 0; t < grassRng.int(2, 5); t++) {
        const tuft = new THREE.Mesh(tuftGeo, grassRng.chance(0.6) ? M.tuft : M.tuftPale)
        const s = grassRng.range(0.42, 0.95)
        tuft.scale.set(s * grassRng.range(0.7, 1.1), s * grassRng.range(1.1, 2.0), s)
        tuft.position.set(grassRng.range(-0.5, 0.5), s * 0.5, grassRng.range(-0.5, 0.5))
        tuft.rotation.set(
          grassRng.range(-0.28, 0.28),
          grassRng.range(0, Math.PI * 2),
          grassRng.range(-0.28, 0.28),
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
  const petalGeo = new THREE.SphereGeometry(0.09, 5, 4)
  const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4)
  const stickGeo = new THREE.CylinderGeometry(0.05, 0.07, 1, 5)
  const capGeo = new THREE.SphereGeometry(0.12, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2)
  const flowerMats = [0xf0e08a, 0xe8e4ee, 0xd7a3c4, 0xf2b45c].map((c) => toonUnique({ color: c }))
  const stemMat = toonUnique({ color: 0x5f9c38 })

  for (let c = 0; c < 22; c++) {
    const cx = grassRng.range(-17, 17)
    const cz = grassRng.range(-14, 16)
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
        head.position.set(x, h + 0.32, z)
        head.scale.setScalar(grassRng.range(0.7, 1.2))
        group.add(stem, head)
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
  const lashMat = toonUnique({ color: 0xd8c08a, map: tiled(tex.cloth, 0.4, 0.4) })

  /** Posts run outward from the gate on both sides. */
  const postX: number[] = []
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 7; i++) postX.push(side * (1.5 + i * 0.76))
  }

  for (const x of postX) {
    const z = PAL_Z + palRng.range(-0.16, 0.16)
    const h = heightAt(x, z)
    // The patched section is the three posts west of the gate: shorter, newer.
    const patched = x < -2.2 && x > -4.6
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
      blocker: { radius: 0.62 },
    })
  }

  // Rails behind the posts, and rope lashings where they cross.
  const railGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 5).rotateZ(Math.PI / 2)
  const lashGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.14, 8)
  for (const side of [-1, 1]) {
    for (const y of [1.15, 2.05]) {
      const x0 = side * 1.4
      const x1 = side * 6.3
      const mid = (x0 + x1) / 2
      const rail = new THREE.Mesh(railGeo, M.log)
      rail.scale.set(Math.abs(x1 - x0), 1, 1)
      rail.position.set(mid, heightAt(mid, PAL_Z) + y, PAL_Z + 0.3)
      rail.rotation.y = palRng.range(-0.02, 0.02)
      rail.castShadow = true
      group.add(rail)
    }
    for (let i = 0; i < 7; i += 2) {
      const x = side * (1.5 + i * 0.76)
      for (const y of [1.15, 2.05]) {
        const lash = new THREE.Mesh(lashGeo, lashMat)
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
    occluders.push(occluder(g, 1.8, 3.9))

    world.add({
      transform: { pos: new THREE.Vector3(0, gateH + 1.3, PAL_Z), ry: 0 },
      mesh: g,
      label: 'The gate',
      props: { WOODEN: 0.95, FLAMMABLE: 0.7, RIGID: 0.85, HEAVY: 0.6 },
      structure: { hp: 70, maxHp: 70, height: 2.6, label: 'The gate' },
      blocker: { radius: 0.98 },
    })
  }

  // Rock spurs at each end, running all the way to the bounds so the wall
  // cannot be walked around. Facts, not invisible walls: they are STONE, so
  // nothing burns or cuts them.
  for (const side of [-1, 1]) {
    let x = side * 6.9
    while (Math.abs(x) < 19.5) {
      const z = PAL_Z + palRng.range(-1.1, 1.1)
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

      x += side * palRng.range(1.35, 1.75)
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

    // The doorway. Near black, with one warm plane behind it: somebody is in.
    const doorX = -w * 0.24
    const opening = new THREE.Mesh(new THREE.BoxGeometry(1.06, 1.9, 0.16), M.doorway)
    opening.position.set(doorX, 1.25, dep / 2 + 0.02)
    g.add(opening)
    const inside = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 1.5),
      toonUnique({ color: 0xff9a48, emissive: new THREE.Color(0xff7a2a), emissiveIntensity: 0.55 }),
    )
    inside.position.set(doorX, 1.06, dep / 2 + 0.045)
    g.add(inside)
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.2, 0.26), M.log)
    lintel.position.set(doorX, 2.28, dep / 2 + 0.06)
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
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.46, 0.08), M.doorway)
      win.position.set(wx, 1.72, dep / 2 + 0.05)
      g.add(win)
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.16), M.log)
      sill.position.set(wx, 1.46, dep / 2 + 0.08)
      g.add(sill)
      for (const s of [-1, 1]) {
        const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.52, 0.07), M.plankDark)
        shutter.position.set(wx + s * 0.4, 1.72, dep / 2 + 0.08)
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

    g.position.set(x, h, z)
    g.rotation.y = turn
    group.add(g)
    occluders.push(occluder(g, Math.max(w, dep) * 0.62, ridge + 0.9))

    world.add({
      transform: { pos: new THREE.Vector3(x, h + 0.9, z), ry: turn },
      mesh: g,
      label: 'Home',
      props: { WOODEN: 0.8, FLAMMABLE: 0.3, RIGID: 0.9 },
      blocker: { radius: Math.max(w, dep) * 0.6 },
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
    occluders.push(occluder(g, Math.max(w, dep) * 0.5, ridge + 0.3))

    world.add({
      transform: { pos: new THREE.Vector3(x, h + 0.8, z), ry: turn },
      mesh: g,
      label: 'The shed',
      props: { WOODEN: 0.9, FLAMMABLE: 0.45, RIGID: 0.8 },
      blocker: { radius: Math.max(w, dep) * 0.5 },
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
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4), lashMat)
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
    const cabbageMat = toonUnique({ color: 0x7fb04e, map: tiled(tex.foliage, 0.7, 0.7) })
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
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, p0.distanceTo(p1), 4), lashMat)
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
      solid(g, new THREE.Vector3(x, h + 0.5, z), 'Handcart', { WOODEN: 0.9, FLAMMABLE: 0.5, PLATFORM: 0.5, RIGID: 0.7 }, 0.85)
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
    const podMat = toonUnique({ color: 0x76a54a, map: tiled(tex.foliage, 0.7, 0.7) })
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
    occluders.push(occluder(g, 1.2, 2.3))
    solid(g, new THREE.Vector3(sx, h + 1, sz), 'The store', { WOODEN: 0.9, FLAMMABLE: 0.5, RIGID: 0.8 }, 1.05)
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
  const viewTargets = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]
  const REVEAL_RADIUS = 7
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
    const heights = [1.4 * 0.816, 0.5, 0.5, 0.5]
    let count = 1

    for (const e of queries.items) {
      if (count >= viewTargets.length) break
      const at = e.transform.pos
      const dx = at.x - playerPos.x
      const dz = at.z - playerPos.z
      if (dx * dx + dz * dz > REVEAL_RADIUS * REVEAL_RADIUS) continue
      viewTargets[count]!.copy(at).applyMatrix4(camera.matrixWorldInverse)
      count++
    }

    for (const o of occluders) {
      o.object.getWorldPosition(viewObject).applyMatrix4(camera.matrixWorldInverse)

      let hiding = false
      for (let i = 0; i < count && !hiding; i++) {
        const t = viewTargets[i]!
        // View space looks down -z, so a larger z is nearer the camera. Half
        // the object's height is added because a world-vertical leans toward
        // the camera under this projection: a trunk's base can be behind the
        // target while its canopy is squarely in front of it.
        const nearer = viewObject.z + o.top * 0.29 > t.z + 0.4
        if (!nearer) continue
        if (Math.abs(viewObject.x - t.x) >= o.radius + 0.45) continue
        const headY = t.y + heights[i]!
        if (viewObject.y >= headY + 0.3) continue
        if (viewObject.y + o.top * 0.816 <= t.y) continue
        hiding = true
      }

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
        o.object.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (!mesh.isMesh) return
          const solid = mesh.material as THREE.Material
          const ghost = (solid as THREE.MeshToonMaterial).clone()
          ghost.transparent = true
          ghost.depthWrite = false
          o.faded!.push({ mesh, solid, ghost })
        })
      }

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

  // ----------------------------------------------------------------- items
  // Ten items, placed by hand, every one of them somewhere a person would have
  // left it or lost it: on the track, at the block, by the water. All outside
  // the yard fence, and all clear of blockers.
  const PLACED: Record<string, [number, number]> = {
    torch: [1.5, 8.2],
    flint: [4.9, 5.2],
    horseshoe: [-1.1, 3.4],
    straw: [-6.6, 9.5],
    rope: [-7.7, 9.9],
    bucket: [-6.2, 4.3],
    plank: [-14.0, -1.2],
    oil: [6.2, 1.0],
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
    // Dropped at the water's edge and never found. Not near any door.
    key: [-9.2, 1.2],
    // Well into the west wood, off every track. The one thing in Band 0 worth
    // going to look for rather than tripping over.
    sword: [-13.4, -8.6],
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
  function findVisible(x: number, z: number): [number, number] {
    if (!hiddenFromCamera(x, heightAt(x, z) + 0.45, z)) return [x, z]
    for (let step = 1; step <= 7; step++) {
      const d = step * 0.55
      for (const [ax, az] of [
        [1, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1.4, 0],
        [0, 1.4],
      ] as const) {
        const nx = x + ax * d
        const nz = z + az * d
        if (nx < BOUNDS.minX + 1 || nx > BOUNDS.maxX - 1) continue
        if (nz < BOUNDS.minZ + 1 || nz > BOUNDS.maxZ - 1) continue
        if (!hiddenFromCamera(nx, heightAt(nx, nz) + 0.45, nz)) return [nx, nz]
      }
    }
    return [x, z]
  }

  for (const [id, ax, az] of layout) {
    const def = CATALOG[id]
    if (!def) continue
    const [x, z] = findVisible(ax, az)

    const y = heightAt(x, z) + 0.45
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
  }
}
