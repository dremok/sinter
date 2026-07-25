/**
 * Band 0 region: one small, hand-laid clearing.
 *
 * Deliberately much smaller than the first pass, which was 120x120 with 52
 * scattered items and read as an empty field you walked across for a minute
 * before anything happened. This is roughly 36x32 of playable ground with ten
 * items, every one of which does something.
 *
 * Item placement is authored rather than random. At this size a seeded scatter
 * produces clumps and dead corners, and a player cannot tell "procedural" from
 * "careless". Generation earns its place at region scale, not here.
 *
 * Nothing in this file authors a solution to anything. It places facts.
 */

import * as THREE from 'three'
import { createNoise2D } from 'simplex-noise'
import type { Rng } from '../core/rng'
import { world, type Entity } from '../ecs/world'
import { CATALOG } from '../items/catalog'
import { buildItemMesh } from '../render/kitbash'
import { BAND0 } from '../render/palette'
import { toonUnique } from '../render/toon'
import { textures, tiled } from '../render/textures'

/** Where the player may walk. Outside this is tree line. */
export const BOUNDS = { minX: -18, maxX: 18, minZ: -15, maxZ: 17 }

const GROUND_SIZE = 92
const GRID = 92

const POND = { x: -11.5, z: 6.5, r: 4.6 }
export const WATER_LEVEL = -0.55

export interface Region {
  group: THREE.Group
  heightAt: (x: number, z: number) => number
  playerStart: THREE.Vector3
  gate: THREE.Vector3
}

export function buildRegion(rng: Rng, scene: THREE.Scene): Region {
  const group = new THREE.Group()
  scene.add(group)

  const terrainRng = rng.fork('terrain')
  const noise = createNoise2D(() => terrainRng.next())

  // Gentle on purpose. The previous terrain had 3m of relief, which the
  // character controller kept catching on; at this amplitude nothing can wedge.
  const heightAt = (x: number, z: number): number => {
    const roll = noise(x * 0.035, z * 0.035) * 0.75

    const d = Math.hypot(x - POND.x, z - POND.z)
    if (d < POND.r) {
      const t = d / POND.r
      const dish = 1 - t * t * (3 - 2 * t)
      return roll * (1 - dish) - dish * 1.5
    }
    return roll
  }

  // ----------------------------------------------------------------- ground
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GRID, GRID)
  geo.rotateX(-Math.PI / 2)

  const tex = textures(rng)

  const pos = geo.attributes.position!
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)))
  }
  geo.computeVertexNormals()

  // The ground carries a real tiling grass bitmap rather than per-vertex
  // colour bands. Vertex colours gave large soft patches, which is the opposite
  // of what tile art looks like; the detail has to be at texel scale.
  const ground = new THREE.Mesh(geo, toonUnique({ map: tiled(tex.grass, GROUND_SIZE, GROUND_SIZE) }))
  ground.receiveShadow = true
  group.add(ground)

  // ------------------------------------------------------------------ pond
  // Sand shore first, then water on top of it, so the bank reads as wet sand
  // rather than as a hard line between two colours.
  const shoreGeo = new THREE.RingGeometry(POND.r * 0.86, POND.r + 1.4, 34, 6).rotateX(-Math.PI / 2)
  const shorePos = shoreGeo.attributes.position!
  for (let i = 0; i < shorePos.count; i++) {
    const wx = shorePos.getX(i) + POND.x
    const wz = shorePos.getZ(i) + POND.z
    shorePos.setY(i, heightAt(wx, wz) + 0.09)
  }
  shoreGeo.computeVertexNormals()
  const shore = new THREE.Mesh(
    shoreGeo,
    toonUnique({ map: tiled(tex.sand, (POND.r + 1.9) * 2, (POND.r + 1.9) * 2) }),
  )
  shore.position.set(POND.x, 0, POND.z)
  shore.receiveShadow = true
  group.add(shore)

  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(POND.r + 0.5, 26).rotateX(-Math.PI / 2),
    toonUnique({
      map: tiled(tex.water, (POND.r + 0.5) * 2, (POND.r + 0.5) * 2),
      transparent: true,
      opacity: 0.86,
    }),
  )
  pond.position.set(POND.x, WATER_LEVEL, POND.z)
  group.add(pond)

  // ----------------------------------------------------------------- trees
  const trunkGeo = new THREE.CylinderGeometry(0.26, 0.34, 1, 7)
  const canopyGeo = new THREE.ConeGeometry(1, 1, 8)
  const barkMat = toonUnique({ map: tiled(tex.bark, 1.5, 3) })
  const foliageMats = BAND0.leaf.map((hex) =>
    toonUnique({ color: hex, map: tiled(tex.foliage, 3, 3) }),
  )
  const strawMat = toonUnique({ map: tiled(tex.straw, 0.7, 0.7) })
  const stoneMat = toonUnique({ map: tiled(tex.stone, 2.4, 2.4) })

  function plantTree(x: number, z: number, scale: number, inner: boolean, r: Rng): void {
    const h = heightAt(x, z)
    const height = 1.7 * scale

    const tree = new THREE.Group()
    const trunk = new THREE.Mesh(trunkGeo, barkMat)
    trunk.scale.set(scale, height, scale)
    trunk.position.y = height / 2
    trunk.castShadow = true
    tree.add(trunk)

    // Stacked cones. Reads as a broadleaf at this resolution and keeps a hard
    // silhouette, which spheres do not once pixellated.
    const tiers = 3
    for (let t = 0; t < tiers; t++) {
      const canopy = new THREE.Mesh(canopyGeo, foliageMats[t % foliageMats.length]!)
      const rad = (1.3 - t * 0.28) * scale
      canopy.scale.set(rad, 1.25 * scale, rad)
      canopy.position.y = height + t * 0.6 * scale + 0.35
      canopy.castShadow = true
      tree.add(canopy)
    }

    tree.position.set(x, h, z)
    tree.rotation.y = r.range(0, Math.PI * 2)
    group.add(tree)

    if (inner) {
      world.add({
        transform: { pos: new THREE.Vector3(x, h + height * 0.5, z), ry: 0 },
        mesh: tree,
        label: 'Oak',
        props: { WOODEN: 0.9, PLANT: 0.6, FLAMMABLE: 0.5, RIGID: 0.8, HEAVY: 0.5 },
        structure: { hp: 90, maxHp: 90, height, label: 'Oak' },
        blocker: { radius: 0.55 },
      })
    }
  }

  const treeRng = rng.fork('trees')

  // Tree line, forming the walls of the arena. Outside BOUNDS, so the player is
  // clamped before ever reaching them and cannot get tangled in the border.
  for (let i = 0; i < 130; i++) {
    const edge = treeRng.int(0, 3)
    const along = treeRng.range(-1, 1)
    const depth = treeRng.range(0, 6)
    let x = 0
    let z = 0
    if (edge === 0) { x = along * 24; z = BOUNDS.minZ - 1 - depth }
    else if (edge === 1) { x = along * 24; z = BOUNDS.maxZ + 1 + depth }
    else if (edge === 2) { x = BOUNDS.minX - 1 - depth; z = along * 20 }
    else { x = BOUNDS.maxX + 1 + depth; z = along * 20 }
    plantTree(x, z, treeRng.range(0.85, 1.3), false, treeRng)
  }

  // A handful inside, placed clear of the walking lanes so they decorate rather
  // than obstruct. These ones are real entities: they burn and they can be felled.
  for (const [x, z] of [
    [-14, -6],
    [13.5, -3],
    [15, 11],
    [-15.5, 14],
    [8, 15],
  ] as const) {
    plantTree(x, z, treeRng.range(1.0, 1.25), true, treeRng)
  }

  // ------------------------------------------------------------ dry pasture
  const grassRng = rng.fork('grass')
  const tuftGeo = new THREE.ConeGeometry(0.26, 1, 4)

  for (let i = 0; i < 22; i++) {
    const x = grassRng.range(-15, 15)
    const z = grassRng.range(-7, 14)
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 1.5) continue

    const h = heightAt(x, z)
    const clump = new THREE.Group()
    for (let t = 0; t < 3; t++) {
      const tuft = new THREE.Mesh(tuftGeo, strawMat)
      const s = grassRng.range(0.55, 0.85)
      tuft.scale.set(s, s * grassRng.range(1, 1.5), s)
      tuft.position.set(grassRng.range(-0.4, 0.4), s * 0.5, grassRng.range(-0.4, 0.4))
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

  // -------------------------------------------------------------- palisade
  const PAL_Z = -8
  const logGeo = new THREE.CylinderGeometry(0.32, 0.36, 1, 8)
  // Two tints of the same bark bitmap, alternating, so a row of posts has
  // rhythm instead of reading as one extruded ribbon.
  const palisadeA = toonUnique({ map: tiled(tex.bark, 1.4, 3.4) })
  const palisadeB = toonUnique({ color: 0xc9a075, map: tiled(tex.bark, 1.4, 3.4) })
  const capGeo = new THREE.ConeGeometry(0.36, 0.5, 7)

  for (let i = -8; i <= 8; i++) {
    const x = i * 0.78
    const z = PAL_Z
    const h = heightAt(x, z)
    const height = 3.1 + Math.sin(i * 1.7) * 0.14

    const post = new THREE.Group()
    const log = new THREE.Mesh(logGeo, i % 2 === 0 ? palisadeA : palisadeB)
    log.scale.y = height
    log.position.y = height / 2
    log.castShadow = true
    log.receiveShadow = true
    post.add(log)

    const cap = new THREE.Mesh(capGeo, palisadeB)
    cap.position.y = height + 0.25
    cap.castShadow = true
    post.add(cap)

    post.position.set(x, h, z)
    group.add(post)

    world.add({
      transform: { pos: new THREE.Vector3(x, h + height * 0.5, z), ry: 0 },
      mesh: post,
      label: 'Palisade',
      props: { WOODEN: 0.95, FLAMMABLE: 0.62, RIGID: 0.9, HEAVY: 0.7 },
      structure: { hp: 82, maxHp: 82, height, label: 'Palisade' },
      blocker: { radius: 0.62 },
    })
  }

  // Rock spurs at each end, so the palisade cannot simply be walked around.
  // Facts, not invisible walls: they are STONE, so nothing burns or cuts them.
  const rockGeo = new THREE.DodecahedronGeometry(1, 0)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = side * (7.4 + i * 1.9)
      const z = PAL_Z + Math.sin(i) * 0.5
      const h = heightAt(x, z)
      const s = 1.5 + (i % 2) * 0.45

      const rock = new THREE.Mesh(rockGeo, stoneMat)
      rock.scale.set(s, s * 0.85, s)
      rock.position.set(x, h + s * 0.3, z)
      rock.rotation.set(i * 0.7, i * 1.3, i * 0.4)
      rock.castShadow = true
      rock.receiveShadow = true
      group.add(rock)

      world.add({
        transform: { pos: new THREE.Vector3(x, h + s * 0.3, z), ry: 0 },
        mesh: rock,
        label: 'Rock',
        props: { STONE: 1, HEAVY: 1, RIGID: 1 },
        blocker: { radius: s * 0.8 },
      })
    }
  }

  // ------------------------------------------------------------------ gate
  const gateY = heightAt(0, -13)
  const gate = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.2, 6, 16),
    toonUnique({ color: 0xf0e6c8, emissive: new THREE.Color(0x6f9fdf), emissiveIntensity: 0.85 }),
  )
  gate.position.set(0, gateY + 1.8, -13)
  gate.castShadow = true
  group.add(gate)

  const gateGlow = new THREE.PointLight(0x9fc0ff, 14, 14, 2)
  gateGlow.position.set(0, gateY + 1.8, -13)
  group.add(gateGlow)

  // ----------------------------------------------------------------- items
  // Ten items, placed by hand. Between them they afford every route through the
  // palisade: burn it, chop it, climb it, or wet the ground to steer the fire.
  const layout: [string, number, number][] = [
    ['torch', -3.2, 10.8],
    ['flint', 2.8, 9.6],
    ['horseshoe', 5.8, 6.4],
    ['straw', -1.2, 5.4],
    ['rope', -6.6, 8.4],
    ['plank', -8.2, 3.6],
    ['oil', 6.6, 1.6],
    ['apple', 2.2, 3.0],
    ['bucket', -9.0, 11.6],
    ['axe', 9.2, 12.4],
  ]

  const itemRng = rng.fork('items')
  for (const [id, x, z] of layout) {
    const def = CATALOG[id]
    if (!def) continue

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
    playerStart: new THREE.Vector3(0, heightAt(0, 13), 13),
    gate: new THREE.Vector3(0, gateY, -13),
  }
}
