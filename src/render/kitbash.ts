/**
 * Parametric kitbash assembly.
 *
 * An item is a list of parts with scales, offsets and materials; this turns
 * that into geometry. Per docs/DECISIONS.md D6 the payoff is that a merge
 * result inherits parts from both parents and therefore LOOKS like both, which
 * is what makes merging readable instead of arbitrary.
 *
 * Geometry and materials are shared across every instance of a part kind, so a
 * hundred loose items on the ground cost a hundred cheap meshes, not a hundred
 * geometry allocations.
 */

import * as THREE from 'three'
import type { ItemDef, MaterialKind, PartSpec } from '../items/catalog'
import { MATERIAL_COLOR } from './palette'
import { toonUnique } from './toon'
import { loadedTextures, tiled } from './textures'
import { partGeometry } from './parts'

const materials = new Map<MaterialKind, THREE.MeshToonMaterial>()

/**
 * Cel-shaded to match everything else. These were MeshStandardMaterial with
 * roughness and metalness, which is invisible at 240p: physically based
 * shading spends all its detail on gradients that the pixel buffer throws away.
 * Flat banded colour is what actually survives downsampling.
 */
function materialFor(kind: MaterialKind): THREE.MeshToonMaterial {
  const hit = materials.get(kind)
  if (hit) return hit

  const t = loadedTextures()
  const color = MATERIAL_COLOR[kind]

  // Items are small, so they need a much finer tiling than terrain does or a
  // single texel covers the whole flask.
  const map = tiled(
    {
      wood: t.plank,
      steel: t.steel,
      stone: t.stone,
      cloth: t.cloth,
      glass: t.glass,
      leaf: t.foliage,
      water: t.water,
      ember: t.ember,
      gold: t.gold,
      straw: t.straw,
      clay: t.clay,
    }[kind],
    0.55,
    0.55,
  )

  const m =
    kind === 'ember'
      ? toonUnique({ map, emissive: new THREE.Color(0xff4d1a), emissiveIntensity: 1.5 })
      : kind === 'glass' || kind === 'water'
        ? toonUnique({ map, color, transparent: true, opacity: 0.82 })
        : toonUnique({ map })

  materials.set(kind, m)
  return m
}

function buildPart(spec: PartSpec): THREE.Mesh {
  const mesh = new THREE.Mesh(partGeometry(spec.part), materialFor(spec.material))
  mesh.scale.set(spec.scale[0], spec.scale[1], spec.scale[2])
  mesh.position.set(spec.at[0], spec.at[1], spec.at[2])
  if (spec.rot) mesh.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2])
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/**
 * Loose items are rendered larger than their nominal size. At true scale a nail
 * is a few pixels from the isometric camera and reads as noise on the ground.
 * This is a legibility decision, not a physical one, so it lives in the render
 * layer and nothing in `sim/` sees it.
 */
const DISPLAY_SCALE = 1.9

/** Assemble a whole item. The group's origin sits at the item's centre. */
export function buildItemMesh(def: ItemDef): THREE.Group {
  const group = new THREE.Group()
  for (const spec of def.parts) group.add(buildPart(spec))
  group.scale.setScalar(DISPLAY_SCALE)
  group.name = def.id
  return group
}

/**
 * A flat icon-ish render of the same assembly, used by the inventory grid.
 * Rendering icons from the assembled mesh is free and perfectly consistent,
 * which docs/ASSET_PIPELINE.md prefers over generating them.
 */
export function itemSilhouette(def: ItemDef): string {
  const kinds = new Set(def.parts.map((s) => s.material))
  const colors = [...kinds].map((k) => `#${MATERIAL_COLOR[k].toString(16).padStart(6, '0')}`)
  if (colors.length === 1) return colors[0]!
  return `linear-gradient(135deg, ${colors.join(', ')})`
}
