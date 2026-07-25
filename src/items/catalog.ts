/**
 * The hand-authored Band 0 catalog.
 *
 * Ten items, every one of them a thing a person can name on sight. The earlier
 * set had whetstones, barrel hoops, pots of pitch and horn lanterns, which are
 * period-correct and completely illegible: a player cannot reason about
 * combining two objects they cannot identify.
 *
 * An item is not a mesh. It is a bag of properties, a kitbash recipe, and two
 * words used to name whatever it becomes. `render/kitbash.ts` turns the recipe
 * into geometry, which is what lets a merge result inherit parts from both
 * parents and actually look like both.
 */

import type { Properties } from '../props/registry'

export type PartKind =
  | 'rod'
  | 'blade'
  | 'box'
  | 'sphere'
  | 'disc'
  | 'cone'
  | 'shard'
  | 'wrap'
  | 'ring'
  | 'leafy'

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

export interface ItemDef {
  id: string
  name: string
  /** One line, plain and concrete. Band 0 prose is not clever. */
  desc: string
  props: Properties
  parts: PartSpec[]

  /**
   * Naming parts. A merge is named `<epithet of one parent> <noun of the
   * other>`, which is what guarantees every pair produces a distinctly named
   * result. See `items/merge.ts`.
   */
  epithet: string
  noun: string

  /** Generated items carry their lineage so the codex can show it. */
  from?: [string, string]
}

export const CATALOG: Record<string, ItemDef> = {}

function add(d: ItemDef): ItemDef {
  CATALOG[d.id] = d
  return d
}

add({
  id: 'torch',
  name: 'Torch',
  desc: 'Pitch-soaked rag bound to a shaft. Unlit.',
  props: { WOODEN: 0.6, CLOTH: 0.3, FLAMMABLE: 1, RIGID: 0.45 },
  epithet: 'Tarred',
  noun: 'Torch',
  parts: [
    { part: 'rod', scale: [0.07, 0.8, 0.07], at: [0, -0.1, 0], material: 'wood' },
    { part: 'wrap', scale: [0.22, 0.26, 0.22], at: [0, 0.34, 0], material: 'cloth' },
  ],
})

add({
  id: 'flint',
  name: 'Flint',
  desc: 'Breaks with an edge you could shave with.',
  props: { STONE: 1, SHARP: 0.6, HEAVY: 0.28 },
  epithet: 'Flinted',
  noun: 'Flake',
  parts: [{ part: 'shard', scale: [0.24, 0.28, 0.18], at: [0, 0, 0], material: 'stone' }],
})

add({
  id: 'horseshoe',
  name: 'Iron Horseshoe',
  desc: 'Thrown by somebody’s horse. Still sound.',
  props: { METAL: 1, RIGID: 0.85, HEAVY: 0.35 },
  epithet: 'Iron-shod',
  noun: 'Shoe',
  parts: [
    { part: 'ring', scale: [0.34, 0.1, 0.34], at: [0, 0, 0], rot: [1.57, 0, 0], material: 'steel' },
  ],
})

add({
  id: 'rope',
  name: 'Coil of Rope',
  desc: 'Six feet of hemp, frayed at one end.',
  props: { CLOTH: 0.5, ROPE_LIKE: 1, FLAMMABLE: 0.5 },
  epithet: 'Corded',
  noun: 'Cord',
  parts: [
    { part: 'ring', scale: [0.34, 0.11, 0.34], at: [0, 0, 0], material: 'cloth' },
    { part: 'ring', scale: [0.28, 0.1, 0.28], at: [0.02, 0.09, 0.01], rot: [0.2, 0.4, 0], material: 'cloth' },
  ],
})

add({
  id: 'plank',
  name: 'Wooden Plank',
  desc: 'Sawn square. Heavier than it looks.',
  props: { WOODEN: 1, FLAMMABLE: 0.6, PLATFORM: 0.8, RIGID: 0.85 },
  epithet: 'Planked',
  noun: 'Board',
  parts: [{ part: 'box', scale: [1.05, 0.08, 0.26], at: [0, 0, 0], material: 'wood' }],
})

add({
  id: 'bucket',
  name: 'Bucket of Water',
  desc: 'Drawn this morning. Still cold.',
  props: { WOODEN: 0.5, CONTAINER: 1, WATER: 1 },
  epithet: 'Brimming',
  noun: 'Pail',
  parts: [
    { part: 'cone', scale: [0.32, 0.36, 0.32], at: [0, 0, 0], material: 'wood' },
    { part: 'disc', scale: [0.28, 0.04, 0.28], at: [0, 0.15, 0], material: 'water' },
    { part: 'ring', scale: [0.36, 0.05, 0.36], at: [0, 0.19, 0], rot: [1.57, 0, 0], material: 'steel' },
  ],
})

add({
  id: 'axe',
  name: 'Woodcutter’s Axe',
  desc: 'Notched from use, and still the sharpest thing here.',
  props: { METAL: 0.75, WOODEN: 0.3, SHARP: 0.85, TOOL_CUTTING: 0.8, RIGID: 0.8, HEAVY: 0.4 },
  epithet: 'Keen',
  noun: 'Axe',
  parts: [
    { part: 'rod', scale: [0.08, 0.78, 0.08], at: [0, -0.08, 0], material: 'wood' },
    { part: 'blade', scale: [0.44, 0.34, 0.1], at: [0.16, 0.32, 0], rot: [0, 0, -0.25], material: 'steel' },
  ],
})

add({
  id: 'straw',
  name: 'Bale of Straw',
  desc: 'Catches from a spark. Gone in seconds.',
  props: { PLANT: 0.9, FLAMMABLE: 1, BUOYANT: 0.4 },
  epithet: 'Thatched',
  noun: 'Bale',
  parts: [
    { part: 'box', scale: [0.46, 0.34, 0.34], at: [0, 0, 0], material: 'straw' },
    { part: 'ring', scale: [0.3, 0.07, 0.3], at: [0, 0, 0], rot: [0, 0, 1.57], material: 'cloth' },
  ],
})

add({
  id: 'oil',
  name: 'Flask of Oil',
  desc: 'Lamp oil. The stopper does not seat properly.',
  props: { GLASS: 0.5, CONTAINER: 0.6, FLAMMABLE: 1 },
  epithet: 'Oiled',
  noun: 'Flask',
  parts: [
    { part: 'sphere', scale: [0.24, 0.3, 0.24], at: [0, -0.02, 0], material: 'glass' },
    { part: 'rod', scale: [0.08, 0.16, 0.08], at: [0, 0.2, 0], material: 'clay' },
  ],
})

add({
  id: 'apple',
  name: 'Red Apple',
  desc: 'Windfall. One side is bruised.',
  props: { EDIBLE: 0.9, SEED: 0.25, PLANT: 0.4 },
  epithet: 'Sweet',
  noun: 'Apple',
  parts: [
    { part: 'sphere', scale: [0.26, 0.25, 0.26], at: [0, 0, 0], material: 'ember' },
    { part: 'rod', scale: [0.02, 0.11, 0.02], at: [0, 0.14, 0], material: 'wood' },
  ],
})

/** Everything the region places, in the order it reads best on the ground. */
export const STARTING_ITEMS: string[] = [
  'torch',
  'flint',
  'horseshoe',
  'rope',
  'plank',
  'bucket',
  'axe',
  'straw',
  'oil',
  'apple',
]
