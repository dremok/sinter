/**
 * The hand-authored Band 0 catalog.
 *
 * Seventeen items, every one of them a thing a person can name on sight. The
 * earlier set had whetstones, barrel hoops, pots of pitch and horn lanterns,
 * which are period-correct and completely illegible: a player cannot reason
 * about combining two objects they cannot identify.
 *
 * An item is not a mesh. It is a bag of properties and a kitbash recipe.
 * `render/kitbash.ts` turns the recipe into geometry, which is what lets a
 * merge result inherit parts from both parents and actually look like both.
 *
 * Revised 2026-07-25 for D18. Two things changed here:
 *
 *   - `noMerge`. Some items never combine, and the field holds the line the
 *     bench says when you try. A key that becomes a hybrid is just a worse key.
 *   - `epithet` and `noun` are gone. They existed to auto-name the result of
 *     any pair, and merging is no longer total, so every result now has an
 *     authored name in `items/merge.ts` and the generated ones are not missed.
 */

import type { Properties } from '../props/registry'

/**
 * Part names from `assets/parts/parts.glb`, authored by
 * `tools/blender/build_parts.py`. Adding one means adding a builder there and
 * re-running the script; the game throws at load if a recipe names a part the
 * library does not have, which is deliberate.
 */
export type PartKind =
  | 'haft_short'
  | 'haft_long'
  | 'blade_axe'
  | 'blade_knife'
  | 'head_hammer'
  | 'bucket_body'
  | 'flask_body'
  | 'jar_body'
  | 'plank_board'
  | 'crate_box'
  | 'ring_band'
  | 'horseshoe'
  | 'rope_coil'
  | 'stone_shard'
  | 'apple_body'
  | 'straw_bale'
  | 'rag_wrap'
  | 'torch_head'
  | 'leaf_cluster'
  | 'stopper'
  | 'nail_spike'
  | 'disc_flat'
  | 'bar_stock'

export type MaterialKind =
  | 'wood'
  | 'steel'
  | 'stone'
  | 'cloth'
  | 'glass'
  | 'leaf'
  | 'water'
  | 'ember'
  | 'gold'
  | 'straw'
  | 'clay'

export interface PartSpec {
  part: PartKind
  scale: [number, number, number]
  at: [number, number, number]
  rot?: [number, number, number]
  material: MaterialKind
}

/** Distance from home. The genre gradient in `docs/DESIGN.md` is this axis. */
export type Band = 0 | 1 | 2 | 3

export interface ItemDef {
  id: string
  name: string
  /** One line, plain and concrete. Band 0 prose is not clever. */
  desc: string
  props: Properties
  parts: PartSpec[]

  /** Where it belongs. Absent means Band 0. */
  band?: Band

  /**
   * Set on things that never merge, per D18. The value is what the bench says
   * when you try, and it should be about the object rather than about the
   * rule. Nothing is consumed by the refusal.
   */
  noMerge?: string

  /** Merge results carry their lineage so the codex can show it. */
  from?: [string, string]
}

export const CATALOG: Record<string, ItemDef> = {}

function add(d: ItemDef): ItemDef {
  CATALOG[d.id] = d
  return d
}

// ---------------------------------------------------------------- the found

add({
  id: 'torch',
  name: 'Torch',
  desc: 'Pitch-soaked rag bound to a shaft. Unlit.',
  props: { WOODEN: 0.6, CLOTH: 0.3, FLAMMABLE: 1, RIGID: 0.45 },
  parts: [
    { part: 'haft_short', scale: [1, 1, 1], at: [0, -0.26, 0], material: 'wood' },
    { part: 'torch_head', scale: [1.15, 1.15, 1.15], at: [0, 0.2, 0], material: 'cloth' },
  ],
})

add({
  id: 'flint',
  name: 'Flint',
  desc: 'Breaks with an edge you could shave with.',
  props: { STONE: 1, SHARP: 0.6, HEAVY: 0.28 },
  parts: [{ part: 'stone_shard', scale: [1.15, 1.05, 1.15], at: [0, -0.1, 0], material: 'stone' }],
})

add({
  id: 'rock',
  name: 'Rock',
  desc: 'A rock. It has been here longer than the village.',
  props: { STONE: 1, HEAVY: 0.5 },
  parts: [
    { part: 'stone_shard', scale: [1.55, 1.3, 1.5], at: [0, -0.14, 0], material: 'stone' },
    { part: 'stone_shard', scale: [0.7, 0.6, 0.75], at: [0.14, 0.02, -0.1], rot: [0.6, 1.1, 0.3], material: 'stone' },
  ],
})

add({
  id: 'horseshoe',
  name: 'Iron Horseshoe',
  desc: 'Thrown by somebody’s horse. Still sound.',
  props: { METAL: 1, RIGID: 0.85, HEAVY: 0.35 },
  parts: [
    { part: 'horseshoe', scale: [1.3, 1.3, 1.3], at: [0, 0, 0], rot: [1.57, 0, 0], material: 'steel' },
  ],
})

add({
  id: 'rope',
  name: 'Coil of Rope',
  desc: 'Six feet of hemp, frayed at one end.',
  props: { CLOTH: 0.5, ROPE_LIKE: 1, FLAMMABLE: 0.5 },
  parts: [
    { part: 'rope_coil', scale: [1, 1, 1], at: [0, -0.04, 0], material: 'cloth' },
    { part: 'rope_coil', scale: [0.82, 0.82, 0.82], at: [0.02, 0.06, 0.01], rot: [0.25, 0.5, 0], material: 'cloth' },
  ],
})

add({
  id: 'plank',
  name: 'Wooden Plank',
  desc: 'Sawn square. Heavier than it looks.',
  props: { WOODEN: 1, FLAMMABLE: 0.6, PLATFORM: 0.8, RIGID: 0.85 },
  parts: [{ part: 'plank_board', scale: [1.15, 1, 1.15], at: [0, 0, 0], material: 'wood' }],
})

add({
  id: 'bucket',
  name: 'Bucket of Water',
  desc: 'Drawn this morning. Still cold.',
  props: { WOODEN: 0.5, CONTAINER: 1, WATER: 1 },
  parts: [
    { part: 'bucket_body', scale: [1.1, 1.1, 1.1], at: [0, -0.16, 0], material: 'wood' },
    { part: 'disc_flat', scale: [1.25, 1, 1.25], at: [0, 0.11, 0], material: 'water' },
    { part: 'ring_band', scale: [1.3, 1, 1.3], at: [0, 0.13, 0], rot: [1.57, 0, 0], material: 'steel' },
  ],
})

add({
  id: 'axe',
  name: 'Woodcutter’s Axe',
  desc: 'Notched from use, and still the sharpest thing here.',
  props: { METAL: 0.75, WOODEN: 0.3, SHARP: 0.85, TOOL_CUTTING: 0.8, RIGID: 0.8, HEAVY: 0.4 },
  parts: [
    { part: 'haft_long', scale: [1, 1, 1], at: [0, -0.46, 0], material: 'wood' },
    { part: 'blade_axe', scale: [1.15, 1.15, 1.15], at: [0.09, 0.32, 0], rot: [0, 0, -0.16], material: 'steel' },
  ],
})

add({
  id: 'knife',
  name: 'Knife',
  desc: 'A kitchen knife with a worn handle. Quick, and no use on a wall.',
  props: { METAL: 0.8, SHARP: 0.9, TOOL_CUTTING: 0.6, RIGID: 0.7, HEAVY: 0.12 },
  parts: [
    { part: 'haft_short', scale: [0.62, 0.62, 0.62], at: [0, -0.2, 0], material: 'wood' },
    { part: 'blade_knife', scale: [1.05, 1.05, 1.05], at: [0, 0.02, 0], material: 'steel' },
  ],
})

add({
  id: 'sword',
  name: 'Sword',
  desc: 'Somebody kept this oiled for years, then left it in a barn.',
  props: {
    METAL: 0.9,
    SHARP: 0.95,
    TOOL_CUTTING: 0.7,
    RIGID: 0.85,
    HEAVY: 0.3,
    VALUABLE: 0.5,
    FRIGHTENING: 0.6,
  },
  parts: [
    { part: 'haft_short', scale: [0.55, 0.7, 0.55], at: [0, -0.34, 0], material: 'wood' },
    { part: 'disc_flat', scale: [0.75, 0.55, 0.22], at: [0, -0.14, 0], material: 'steel' },
    { part: 'blade_knife', scale: [1.1, 2.35, 1.1], at: [0, -0.1, 0], material: 'steel' },
  ],
})

add({
  id: 'straw',
  name: 'Bale of Straw',
  desc: 'Catches from a spark. Gone in seconds.',
  props: { PLANT: 0.9, FLAMMABLE: 1, BUOYANT: 0.4 },
  parts: [
    { part: 'straw_bale', scale: [1.25, 1.25, 1.25], at: [0, -0.14, 0], material: 'straw' },
    { part: 'ring_band', scale: [0.9, 1, 0.9], at: [0, 0.02, 0], rot: [0, 0, 1.57], material: 'cloth' },
  ],
})

add({
  id: 'oil',
  name: 'Flask of Oil',
  desc: 'Lamp oil. The stopper does not seat properly.',
  props: { GLASS: 0.5, CONTAINER: 0.6, FLAMMABLE: 1 },
  parts: [
    { part: 'flask_body', scale: [1, 1, 1], at: [0, -0.15, 0], material: 'glass' },
    { part: 'stopper', scale: [1, 1, 1], at: [0, 0.14, 0], material: 'clay' },
  ],
})

add({
  id: 'apple',
  name: 'Red Apple',
  desc: 'Windfall. One side is bruised.',
  props: { EDIBLE: 0.9, SEED: 0.25, PLANT: 0.4 },
  parts: [
    { part: 'apple_body', scale: [1.15, 1.15, 1.15], at: [0, -0.11, 0], material: 'ember' },
    { part: 'nail_spike', scale: [0.5, 0.45, 0.5], at: [0, 0.09, 0], material: 'wood' },
  ],
})

add({
  id: 'chili',
  name: 'Chili Fruit',
  desc: 'Small, red, and hotter than it has any right to be.',
  props: { EDIBLE: 0.6, PLANT: 0.7, TOXIC: 0.3 },
  parts: [
    { part: 'apple_body', scale: [0.55, 1.35, 0.55], at: [0, -0.16, 0], material: 'ember' },
    { part: 'leaf_cluster', scale: [0.45, 0.45, 0.45], at: [0, 0.15, 0], material: 'leaf' },
  ],
})

add({
  id: 'poison',
  name: 'Rat Poison',
  desc: 'Kept in the barn for the barn’s problem. A grey powder, no smell.',
  props: { TOXIC: 0.9, EDIBLE: 0.2 },
  parts: [
    { part: 'jar_body', scale: [0.85, 0.9, 0.85], at: [0, -0.16, 0], material: 'clay' },
    { part: 'stopper', scale: [0.9, 0.9, 0.9], at: [0, 0.12, 0], material: 'wood' },
  ],
})

add({
  id: 'glasses',
  name: 'Spectacles',
  desc: 'Wire frames, one arm bent. Somebody misses these.',
  props: { GLASS: 0.9, FRAGILE: 0.8, VALUABLE: 0.2 },
  parts: [
    { part: 'ring_band', scale: [0.5, 0.5, 0.5], at: [-0.16, 0, 0], rot: [0, 1.57, 0], material: 'steel' },
    { part: 'ring_band', scale: [0.5, 0.5, 0.5], at: [0.16, 0, 0], rot: [0, 1.57, 0], material: 'steel' },
    { part: 'disc_flat', scale: [0.42, 0.1, 0.42], at: [-0.16, 0, 0], rot: [0, 0, 1.57], material: 'glass' },
    { part: 'disc_flat', scale: [0.42, 0.1, 0.42], at: [0.16, 0, 0], rot: [0, 0, 1.57], material: 'glass' },
    { part: 'bar_stock', scale: [0.5, 0.09, 0.09], at: [0, 0.02, 0], rot: [0, 0, 1.57], material: 'steel' },
  ],
})

/**
 * The flagship for D18. It opens one door and it does nothing else, and fusing
 * it into a hybrid would only ever make it worse at the one thing it does.
 * See `items/interactions.ts` for the door, and for the three ways past that
 * door which do not involve holding this.
 */
add({
  id: 'key',
  name: 'Iron Key',
  desc: 'Long in the shaft, three wards. It fits one lock somewhere.',
  props: { METAL: 0.7, VALUABLE: 0.15 },
  noMerge: 'The key stays a key. Whatever you made of it would open nothing.',
  parts: [
    { part: 'ring_band', scale: [0.62, 0.62, 0.62], at: [0, 0.2, 0], rot: [1.57, 0, 0], material: 'gold' },
    { part: 'bar_stock', scale: [0.3, 0.9, 0.3], at: [0, -0.24, 0], material: 'gold' },
    { part: 'nail_spike', scale: [0.55, 0.5, 0.55], at: [0.07, -0.28, 0], rot: [0, 0, 1.57], material: 'gold' },
  ],
})

/**
 * Everything the region places, in the order it reads best on the ground.
 *
 * Derived rather than listed, so an item added above without a band lands here
 * automatically and one pushed out to Band 1 leaves without a second edit.
 */
export const STARTING_ITEMS: string[] = itemsInBand(0).map((d) => d.id)

/**
 * Every item AUTHORED for a band. The `from` test excludes merge results, which
 * `items/merge.ts` also writes into the catalog so that chains can name their
 * inputs.
 */
export function itemsInBand(band: Band): ItemDef[] {
  return Object.values(CATALOG).filter((d) => d.from === undefined && (d.band ?? 0) === band)
}
