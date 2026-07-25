/**
 * The hand-authored Band 0 catalog.
 *
 * Per PROJECT_STATUS M6 these ~25 items set the quality bar for everything the
 * offline pass will later generate. Properties are assigned by hand and with
 * some care; get these wrong and every derived item inherits the mistake.
 *
 * An item is not a mesh. It is a bag of properties plus a kitbash recipe, and
 * `render/kitbash.ts` turns the recipe into geometry. That indirection is what
 * lets a merge result inherit parts from both parents and actually look like
 * both of them.
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
  /** Local scale, in world units before the item's own scale. */
  scale: [number, number, number]
  /** Offset from the item origin. */
  at: [number, number, number]
  /** Euler rotation in radians. */
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
  /** Generated items carry their lineage so the codex can show it. */
  from?: [string, string]
}

const def = (d: ItemDef): ItemDef => d

export const CATALOG: Record<string, ItemDef> = {}

function add(d: ItemDef): ItemDef {
  CATALOG[d.id] = d
  return d
}

// ---------------------------------------------------------------- raw stock

add(
  def({
    id: 'branch',
    name: 'Oak Branch',
    desc: 'Fallen last winter. Dry all the way through.',
    props: { WOODEN: 0.85, FLAMMABLE: 0.7, RIGID: 0.5, BUOYANT: 0.6 },
    parts: [{ part: 'rod', scale: [0.06, 0.75, 0.06], at: [0, 0, 0], material: 'wood' }],
  }),
)

add(
  def({
    id: 'straw',
    name: 'Straw Bundle',
    desc: 'Catches from a spark. Gone in seconds.',
    props: { PLANT: 0.9, FLAMMABLE: 1, BUOYANT: 0.5 },
    parts: [
      { part: 'rod', scale: [0.05, 0.5, 0.05], at: [0, 0, 0], rot: [0, 0, 0.12], material: 'straw' },
      { part: 'rod', scale: [0.05, 0.5, 0.05], at: [0.05, 0, 0.03], rot: [0, 0, -0.16], material: 'straw' },
      { part: 'rod', scale: [0.05, 0.46, 0.05], at: [-0.04, -0.02, 0.04], rot: [0.1, 0, 0.05], material: 'straw' },
      { part: 'wrap', scale: [0.14, 0.07, 0.14], at: [0, 0, 0], material: 'cloth' },
    ],
  }),
)

add(
  def({
    id: 'flint',
    name: 'Flint Nodule',
    desc: 'Breaks with an edge you could shave with.',
    props: { STONE: 1, SHARP: 0.65, HEAVY: 0.3 },
    parts: [{ part: 'shard', scale: [0.18, 0.22, 0.13], at: [0, 0, 0], material: 'stone' }],
  }),
)

add(
  def({
    id: 'nail',
    name: 'Iron Nail',
    desc: 'Hand forged, square shanked, slightly bent.',
    props: { METAL: 0.9, SHARP: 0.5, RIGID: 0.9 },
    parts: [
      { part: 'rod', scale: [0.02, 0.24, 0.02], at: [0, 0, 0], material: 'steel' },
      { part: 'disc', scale: [0.07, 0.02, 0.07], at: [0, 0.13, 0], material: 'steel' },
    ],
  }),
)

add(
  def({
    id: 'rope',
    name: 'Hemp Rope',
    desc: 'Six feet of it, frayed at one end.',
    props: { CLOTH: 0.5, ROPE_LIKE: 1, FLAMMABLE: 0.55 },
    parts: [
      { part: 'ring', scale: [0.26, 0.09, 0.26], at: [0, 0, 0], material: 'cloth' },
      { part: 'ring', scale: [0.22, 0.08, 0.22], at: [0, 0.07, 0.01], rot: [0.2, 0.4, 0], material: 'cloth' },
    ],
  }),
)

add(
  def({
    id: 'rag',
    name: 'Linen Rag',
    desc: 'Was a shirt. Someone gave up on it.',
    props: { CLOTH: 0.95, FLAMMABLE: 0.7 },
    parts: [{ part: 'wrap', scale: [0.3, 0.1, 0.26], at: [0, 0, 0], rot: [0, 0.5, 0], material: 'cloth' }],
  }),
)

add(
  def({
    id: 'oil',
    name: 'Flask of Oil',
    desc: 'Lamp oil. The stopper does not seat properly.',
    props: { GLASS: 0.5, CONTAINER: 0.6, FLAMMABLE: 1 },
    parts: [
      { part: 'sphere', scale: [0.19, 0.24, 0.19], at: [0, -0.02, 0], material: 'glass' },
      { part: 'rod', scale: [0.06, 0.13, 0.06], at: [0, 0.16, 0], material: 'clay' },
    ],
  }),
)

add(
  def({
    id: 'bucket',
    name: 'Bucket of Water',
    desc: 'Drawn this morning. Still cold.',
    props: { WOODEN: 0.5, CONTAINER: 1, WATER: 1 },
    parts: [
      { part: 'cone', scale: [0.26, 0.3, 0.26], at: [0, 0, 0], material: 'wood' },
      { part: 'disc', scale: [0.23, 0.03, 0.23], at: [0, 0.12, 0], material: 'water' },
      { part: 'ring', scale: [0.3, 0.04, 0.3], at: [0, 0.16, 0], rot: [1.57, 0, 0], material: 'steel' },
    ],
  }),
)

add(
  def({
    id: 'plank',
    name: 'Oak Plank',
    desc: 'Sawn square. Heavier than it looks.',
    props: { WOODEN: 1, FLAMMABLE: 0.65, PLATFORM: 0.8, RIGID: 0.85 },
    parts: [{ part: 'box', scale: [0.9, 0.06, 0.22], at: [0, 0, 0], material: 'wood' }],
  }),
)

add(
  def({
    id: 'apple',
    name: 'Apple',
    desc: 'Windfall. One side is bruised.',
    props: { EDIBLE: 0.9, SEED: 0.25, PLANT: 0.4 },
    parts: [
      { part: 'sphere', scale: [0.2, 0.19, 0.2], at: [0, 0, 0], material: 'leaf' },
      { part: 'rod', scale: [0.015, 0.09, 0.015], at: [0, 0.11, 0], material: 'wood' },
    ],
  }),
)

add(
  def({
    id: 'acorn',
    name: 'Acorn',
    desc: 'An oak, if you are patient.',
    props: { SEED: 1, PLANT: 0.6 },
    parts: [
      { part: 'sphere', scale: [0.11, 0.14, 0.11], at: [0, 0, 0], material: 'wood' },
      { part: 'cone', scale: [0.12, 0.07, 0.12], at: [0, 0.07, 0], rot: [3.14, 0, 0], material: 'wood' },
    ],
  }),
)

add(
  def({
    id: 'ember',
    name: 'Live Ember',
    desc: 'Carried from the hearth. It will not last.',
    props: { HOT: 1, LUMINOUS: 0.7, STONE: 0.2 },
    parts: [{ part: 'shard', scale: [0.14, 0.12, 0.14], at: [0, 0, 0], material: 'ember' }],
  }),
)

add(
  def({
    id: 'crate',
    name: 'Crate',
    desc: 'Empty. Sturdy enough to stand on.',
    props: { WOODEN: 0.9, PLATFORM: 0.7, CONTAINER: 0.8, FLAMMABLE: 0.6, RIGID: 0.7 },
    parts: [
      { part: 'box', scale: [0.5, 0.5, 0.5], at: [0, 0, 0], material: 'wood' },
      { part: 'box', scale: [0.53, 0.06, 0.53], at: [0, 0.24, 0], material: 'wood' },
    ],
  }),
)

add(
  def({
    id: 'coin',
    name: 'Silver Coin',
    desc: 'Worn smooth. The face is gone.',
    props: { METAL: 0.8, VALUABLE: 0.9 },
    parts: [{ part: 'disc', scale: [0.13, 0.02, 0.13], at: [0, 0, 0], material: 'gold' }],
  }),
)

add(
  def({
    id: 'sickle',
    name: 'Sickle',
    desc: 'For wheat. It does not care what it cuts.',
    props: { METAL: 0.8, SHARP: 0.8, TOOL_CUTTING: 0.7, RIGID: 0.7 },
    parts: [
      { part: 'rod', scale: [0.05, 0.3, 0.05], at: [0, -0.16, 0], material: 'wood' },
      { part: 'blade', scale: [0.42, 0.1, 0.05], at: [0.14, 0.06, 0], rot: [0, 0, 0.5], material: 'steel' },
    ],
  }),
)

add(
  def({
    id: 'millstone',
    name: 'Millstone Fragment',
    desc: 'A quarter of one. Takes both arms.',
    props: { STONE: 1, HEAVY: 1, RIGID: 0.9 },
    parts: [{ part: 'disc', scale: [0.5, 0.16, 0.5], at: [0, 0, 0], material: 'stone' }],
  }),
)

add(
  def({
    id: 'fleece',
    name: 'Wool Fleece',
    desc: 'Still smells of the animal.',
    props: { CLOTH: 1, FLAMMABLE: 0.5 },
    parts: [{ part: 'sphere', scale: [0.32, 0.2, 0.28], at: [0, 0, 0], material: 'cloth' }],
  }),
)

add(
  def({
    id: 'lantern',
    name: 'Horn Lantern',
    desc: 'The pane is scraped horn, not glass. It still throws light.',
    props: { METAL: 0.5, GLASS: 0.4, LUMINOUS: 0.8, CONTAINER: 0.3, FLAMMABLE: 0.2 },
    parts: [
      { part: 'box', scale: [0.2, 0.26, 0.2], at: [0, 0, 0], material: 'glass' },
      { part: 'disc', scale: [0.24, 0.04, 0.24], at: [0, 0.15, 0], material: 'steel' },
      { part: 'ring', scale: [0.14, 0.03, 0.14], at: [0, 0.21, 0], rot: [1.57, 0, 0], material: 'steel' },
    ],
  }),
)

add(
  def({
    id: 'sapling',
    name: 'Oak Sapling',
    desc: 'Roots wrapped in wet sacking.',
    props: { PLANT: 0.9, LIVING: 0.8, SEED: 0.4, WET: 0.3 },
    parts: [
      { part: 'rod', scale: [0.035, 0.5, 0.035], at: [0, 0, 0], material: 'wood' },
      { part: 'leafy', scale: [0.3, 0.3, 0.3], at: [0, 0.28, 0], material: 'leaf' },
    ],
  }),
)

add(
  def({
    id: 'jar',
    name: 'Clay Jar',
    desc: 'Fired hard. Empty and echoing.',
    props: { CONTAINER: 0.9, RIGID: 0.5, STONE: 0.4 },
    parts: [
      { part: 'sphere', scale: [0.26, 0.3, 0.26], at: [0, 0, 0], material: 'clay' },
      { part: 'ring', scale: [0.17, 0.05, 0.17], at: [0, 0.17, 0], rot: [1.57, 0, 0], material: 'clay' },
    ],
  }),
)

add(
  def({
    id: 'hoop',
    name: 'Iron Hoop',
    desc: 'Off a barrel. Sprung out of round.',
    props: { METAL: 1, RIGID: 0.8 },
    parts: [{ part: 'ring', scale: [0.4, 0.06, 0.4], at: [0, 0, 0], rot: [1.4, 0, 0], material: 'steel' }],
  }),
)

add(
  def({
    id: 'pitch',
    name: 'Pot of Pitch',
    desc: 'Black, sticky, and eager.',
    props: { FLAMMABLE: 1, CONTAINER: 0.4, STONE: 0.2 },
    parts: [
      { part: 'cone', scale: [0.22, 0.22, 0.22], at: [0, 0, 0], rot: [3.14, 0, 0], material: 'clay' },
      { part: 'disc', scale: [0.19, 0.04, 0.19], at: [0, 0.1, 0], material: 'ember' },
    ],
  }),
)

add(
  def({
    id: 'candle',
    name: 'Tallow Candle',
    desc: 'Smells like dinner. Burns like fat.',
    props: { FLAMMABLE: 0.8, LUMINOUS: 0.4 },
    parts: [
      { part: 'rod', scale: [0.07, 0.3, 0.07], at: [0, 0, 0], material: 'cloth' },
      { part: 'rod', scale: [0.012, 0.06, 0.012], at: [0, 0.18, 0], material: 'wood' },
    ],
  }),
)

add(
  def({
    id: 'whetstone',
    name: 'Whetstone',
    desc: 'Dished in the middle from years of use.',
    props: { STONE: 1, SHARP: 0.2, HEAVY: 0.35 },
    parts: [{ part: 'box', scale: [0.34, 0.09, 0.14], at: [0, 0, 0], material: 'stone' }],
  }),
)

/** Items the region scatters on the ground at generation time. */
export const SCATTER_POOL: string[] = [
  'branch',
  'branch',
  'straw',
  'straw',
  'flint',
  'nail',
  'rope',
  'rag',
  'oil',
  'bucket',
  'plank',
  'plank',
  'apple',
  'acorn',
  'crate',
  'coin',
  'fleece',
  'jar',
  'hoop',
  'pitch',
  'candle',
  'whetstone',
  'sickle',
  'millstone',
  'lantern',
  'sapling',
]
