/**
 * Band 0 region generation.
 *
 * A region is bounded and fully in memory (docs/DECISIONS.md D3), which is what
 * makes fire spread and structural collapse tractable. Everything here is
 * driven by a forked seed, so a given seed always produces the same clearing,
 * the same trees, and the same scatter.
 *
 * Nothing in this file authors a solution to anything. It places facts.
 */

import * as THREE from 'three'
import { createNoise2D } from 'simplex-noise'
import type { Rng } from '../core/rng'
import { world, type Entity } from '../ecs/world'
import { CATALOG, SCATTER_POOL } from '../items/catalog'
import { buildItemMesh } from '../render/kitbash'
import { BAND0 } from '../render/palette'

export const REGION_SIZE = 120
const GRID = 96
/** Water sits at this height; terrain is carved below it along the river line. */
export const WATER_LEVEL = -0.9

export interface Region {
  group: THREE.Group
  heightAt: (x: number, z: number) => number
  playerStart: THREE.Vector3
  gate: THREE.Vector3
  /** Column-major heights for the Rapier heightfield collider. */
  heights: Float32Array
  gridSize: number
}

/** The river runs roughly east-west, wandering. Returns its centre z for an x. */
function riverCenter(x: number): number {
  return 6 + Math.sin(x * 0.045) * 7 + Math.sin(x * 0.11) * 2.5
}

const RIVER_HALF = 5.5

export function buildRegion(rng: Rng, scene: THREE.Scene): Region {
  const group = new THREE.Group()
  scene.add(group)

  const terrainRng = rng.fork('terrain')
  const noise = createNoise2D(() => terrainRng.next())
  const detail = createNoise2D(() => terrainRng.next())

  // ------------------------------------------------------------------ height
  const heightAt = (x: number, z: number): number => {
    const rolling = noise(x * 0.018, z * 0.018) * 2.4 + detail(x * 0.06, z * 0.06) * 0.55

    // Carve the river channel. A smoothstep across the bank keeps the edges
    // from reading as a trench cut with a ruler.
    const d = Math.abs(z - riverCenter(x))
    if (d < RIVER_HALF) {
      const t = d / RIVER_HALF
      const carve = 1 - t * t * (3 - 2 * t)
      return rolling * (1 - carve) - carve * 2.4
    }

    // Everything outside the channel is held above the waterline. Without this
    // the water plane spans the whole region and floods every dip the noise
    // happens to put below WATER_LEVEL, which reads as a flooded valley rather
    // than as a river.
    return Math.max(rolling, WATER_LEVEL + 0.45)
  }

  // ----------------------------------------------------------------- terrain
  const geo = new THREE.PlaneGeometry(REGION_SIZE, REGION_SIZE, GRID, GRID)
  geo.rotateX(-Math.PI / 2)

  const pos = geo.attributes.position!
  const colors = new Float32Array(pos.count * 3)
  const c = new THREE.Color()

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const h = heightAt(x, z)
    pos.setY(i, h)

    // Colour by height and by distance from the water, so banks read as mud
    // and the high ground reads as dry pasture.
    const bank = Math.abs(z - riverCenter(x)) - RIVER_HALF
    if (bank < 1.6) {
      c.setHex(BAND0.dirt)
    } else {
      const pick = BAND0.grass[Math.abs(Math.round(h * 3 + x * 0.1)) % BAND0.grass.length]!
      c.setHex(pick)
      c.offsetHSL(0, 0, h * 0.012)
    }
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()

  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
  )
  ground.receiveShadow = true
  group.add(ground)

  // ------------------------------------------------------------------- water
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(REGION_SIZE, REGION_SIZE, 1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: BAND0.water,
      transparent: true,
      opacity: 0.78,
      roughness: 0.08,
      metalness: 0.2,
    }),
  )
  water.position.y = WATER_LEVEL
  group.add(water)

  // ---------------------------------------------- heightfield for the physics
  // Rapier samples column-major over (GRID+1)^2 points spanning the region.
  const n = GRID + 1
  const heights = new Float32Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i / GRID - 0.5) * REGION_SIZE
      const z = (j / GRID - 0.5) * REGION_SIZE
      heights[j * n + i] = heightAt(x, z)
    }
  }

  // ------------------------------------------------------------------- trees
  const treeRng = rng.fork('trees')
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 1, 7)
  const canopyGeo = new THREE.IcosahedronGeometry(1, 0)
  const trunkMat = new THREE.MeshStandardMaterial({ color: BAND0.bark, roughness: 1, flatShading: true })
  const leafMats = BAND0.leaf.map(
    (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 1, flatShading: true }),
  )

  for (let i = 0; i < 90; i++) {
    const x = treeRng.range(-REGION_SIZE / 2 + 6, REGION_SIZE / 2 - 6)
    const z = treeRng.range(-REGION_SIZE / 2 + 6, REGION_SIZE / 2 - 6)

    // Keep the clearing and the crossing clear, and keep trees out of the river.
    if (Math.abs(z - riverCenter(x)) < RIVER_HALF + 2) continue
    if (Math.abs(x) < 16 && z > -6 && z < 26) continue

    const h = heightAt(x, z)
    const height = treeRng.range(3.4, 6.2)

    const tree = new THREE.Group()
    const trunk = new THREE.Mesh(trunkGeo, trunkMat)
    trunk.scale.y = height
    trunk.position.y = height / 2
    trunk.castShadow = true
    tree.add(trunk)

    const layers = treeRng.int(2, 3)
    for (let l = 0; l < layers; l++) {
      const canopy = new THREE.Mesh(canopyGeo, treeRng.pick(leafMats))
      const r = treeRng.range(1.5, 2.3) * (1 - l * 0.18)
      canopy.scale.set(r, r * treeRng.range(0.7, 0.95), r)
      canopy.position.set(treeRng.range(-0.4, 0.4), height + l * 1.15 - 0.3, treeRng.range(-0.4, 0.4))
      canopy.castShadow = true
      tree.add(canopy)
    }

    tree.position.set(x, h, z)
    tree.rotation.y = treeRng.range(0, Math.PI * 2)
    group.add(tree)

    // A tree is not scenery, it is fuel. Fire finds it the same way it finds
    // everything else: by reading FLAMMABLE.
    world.add({
      transform: { pos: new THREE.Vector3(x, h + height * 0.5, z), ry: 0 },
      mesh: tree,
      label: 'Oak',
      props: { WOODEN: 0.9, PLANT: 0.6, FLAMMABLE: 0.55, RIGID: 0.8, HEAVY: 0.5 },
      structure: { hp: 120, maxHp: 120, height, label: 'Oak' },
    })
  }

  // ------------------------------------------------------------- dry pasture
  // Patches of dry grass. These exist so fire has something to travel through,
  // which is what turns a lit torch into a spreading event instead of one
  // burning object.
  const grassRng = rng.fork('grass')
  const tuftGeo = new THREE.ConeGeometry(0.3, 1, 5)
  const tuftMat = new THREE.MeshStandardMaterial({ color: 0xb9a35c, roughness: 1, flatShading: true })

  for (let i = 0; i < 150; i++) {
    const x = grassRng.range(-34, 34)
    const z = grassRng.range(-26, 30)
    if (Math.abs(z - riverCenter(x)) < RIVER_HALF + 1) continue

    const h = heightAt(x, z)
    const clump = new THREE.Group()
    for (let t = 0; t < 3; t++) {
      const tuft = new THREE.Mesh(tuftGeo, tuftMat)
      const s = grassRng.range(0.5, 0.9)
      tuft.scale.set(s, s * grassRng.range(0.8, 1.4), s)
      tuft.position.set(grassRng.range(-0.5, 0.5), s * 0.5, grassRng.range(-0.5, 0.5))
      tuft.castShadow = true
      clump.add(tuft)
    }
    clump.position.set(x, h, z)
    group.add(clump)

    world.add({
      transform: { pos: new THREE.Vector3(x, h + 0.4, z), ry: 0 },
      mesh: clump,
      label: 'Dry grass',
      props: { PLANT: 0.8, FLAMMABLE: 0.85 },
    })
  }

  // ---------------------------------------------------------------- palisade
  // The obstacle. It is a row of facts: wooden, four metres, blocking. No
  // solution is written down anywhere, here or elsewhere.
  const palisadeZ = -14
  const logGeo = new THREE.CylinderGeometry(0.34, 0.4, 1, 8)
  const logMat = new THREE.MeshStandardMaterial({ color: BAND0.barkDark, roughness: 1, flatShading: true })

  for (let i = -14; i <= 14; i++) {
    const x = i * 0.82
    const z = palisadeZ + Math.sin(i * 0.7) * 0.12
    const h = heightAt(x, z)
    const height = 4 + Math.sin(i * 1.7) * 0.25

    const log = new THREE.Mesh(logGeo, logMat)
    log.scale.y = height
    log.position.set(x, h + height / 2, z)
    log.castShadow = true
    log.receiveShadow = true
    group.add(log)

    world.add({
      transform: { pos: new THREE.Vector3(x, h + height * 0.5, z), ry: 0 },
      mesh: log,
      label: 'Palisade',
      props: { WOODEN: 0.95, FLAMMABLE: 0.62, RIGID: 0.9, HEAVY: 0.7 },
      structure: { hp: 100, maxHp: 100, height, label: 'Palisade' },
      blocker: { radius: 0.75 },
    })
  }

  // ------------------------------------------------------------------- gate
  // What is on the other side. Purely a goal marker for the alpha.
  const gateX = 0
  const gateZ = -26
  const gateY = heightAt(gateX, gateZ)
  const gate = new THREE.Mesh(
    new THREE.TorusGeometry(1.8, 0.22, 8, 20),
    new THREE.MeshStandardMaterial({
      color: 0xd8c9a8,
      emissive: new THREE.Color(0x6f8fbf),
      emissiveIntensity: 0.7,
      roughness: 0.6,
    }),
  )
  gate.position.set(gateX, gateY + 2.1, gateZ)
  gate.castShadow = true
  group.add(gate)

  const gateGlow = new THREE.PointLight(0x9fc0ff, 12, 18, 2)
  gateGlow.position.set(gateX, gateY + 2.1, gateZ)
  group.add(gateGlow)

  // ---------------------------------------------------------------- scatter
  const scatterRng = rng.fork('scatter')
  const pool = scatterRng.shuffle([...SCATTER_POOL, ...SCATTER_POOL])

  for (const id of pool) {
    const def = CATALOG[id]
    if (!def) continue

    let x = 0
    let z = 0
    // Rejection sample so nothing spawns in the river or beyond the palisade.
    for (let attempt = 0; attempt < 24; attempt++) {
      x = scatterRng.range(-26, 26)
      z = scatterRng.range(-10, 28)
      if (Math.abs(z - riverCenter(x)) > RIVER_HALF + 1.5) break
    }

    const h = heightAt(x, z)
    const mesh = buildItemMesh(def)
    mesh.position.set(x, h + 0.42, z)
    mesh.rotation.y = scatterRng.range(0, Math.PI * 2)
    group.add(mesh)

    const e: Entity = {
      transform: { pos: new THREE.Vector3(x, h + 0.42, z), ry: mesh.rotation.y },
      mesh,
      props: { ...def.props },
      item: { def },
      bob: { phase: scatterRng.range(0, Math.PI * 2), baseY: h + 0.42 },
    }
    world.add(e)
  }

  const startX = 0
  const startZ = 20

  return {
    group,
    heightAt,
    playerStart: new THREE.Vector3(startX, heightAt(startX, startZ) + 2, startZ),
    gate: new THREE.Vector3(gateX, gateY, gateZ),
    heights,
    gridSize: n,
  }
}
