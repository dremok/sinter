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

  /**
   * The part that IS the item, for anything asking "what does this look like".
   * Optional; without it the largest part by scale product wins, which is right
   * for most items and wrong for anything whose identity is a solid body next
   * to something wide and thin.
   *
   * The bucket is the case that proved it. Its hoop is 1.3 by 1 by 1.3 and its
   * body is 1.1 cubed, so the hoop scored higher and every merge involving a
   * bucket inherited a steel band and a disc of water without the bucket. D6
   * says a merge result should visibly contain its parents, and it did not.
   * Scale alone cannot know that a hoop is a thin ring and a body is a volume,
   * because the intrinsic size lives in the glb.
   */
  signature?: true
}

/** Distance from home. The genre gradient in `docs/DESIGN.md` is this axis. */
export type Band = 0 | 1 | 2 | 3

/**
 * Named landing effects, defined in `LANDINGS` in `items/interactions.ts`.
 *
 * Declared here rather than there so the compiler checks both ends: a projected
 * item cannot name a landing that does not exist, and the table cannot forget
 * one. Same reasoning as `PartKind` being a union instead of a string.
 */
export type LandingId =
  | 'shatter_burning'
  | 'thrown_flame'
  | 'oil_spill'
  | 'water_burst'
  | 'tainted_splash'
  | 'focused_sunlight'

/** Where a worn item sits. One item per slot. */
export type WearSlot = 'eyes' | 'head' | 'body' | 'hands' | 'feet'

/**
 * What pressing USE does with this item. Four modes, from A11 in
 * `docs/IDEAS.md`, and the rule underneath them is:
 *
 *     The verb is authored. The consequences are simulated.
 *
 * Throwing a fire flask is an authored action belonging to one item. Where it
 * lands, what catches, whether the fire reaches the tree behind it, whether the
 * grass carries it to the palisade, whether rain already soaked the ground:
 * none of that is here. It falls out of `sim/fire.ts` reading FLAMMABLE and
 * WET, exactly as it does today. An authored action that also authors its
 * outcome is a cutscene. One that hands off to the simulation is a tool.
 *
 * `projected` is the mode the game was missing entirely, and it is the one that
 * matters most, because it decouples acting from standing next to.
 *
 * IMPORTANT, and easy to get backwards: `use` describes the USE keypress only.
 * It never removes a property-driven affordance. A bucket marked `projected`
 * can still be chosen from the affordance list of a fire you are facing,
 * because that list asks about WATER and has never known what an item id is.
 * Rule 1 survives this field precisely because the two are independent.
 */
export type Use =
  /** Acts on whatever you face. The affordance table decides, as it always has. */
  | { mode: 'contextual' }
  /** Usable anywhere; opens its own panel. `hud` names one in `ui/huds/`. */
  | { mode: 'panel'; hud: string }
  /**
   * Usable anywhere, aimed at a point, and it leaves your hands. `onLand` names
   * a landing rather than a function, so throwing stays data.
   */
  | { mode: 'projected'; range: number; onLand: LandingId; leaves: 'shatters' | 'lands' }
  /** Equipped, then always on. No use keypress; it changes what other things do. */
  | { mode: 'worn'; slot: WearSlot }

const CONTEXTUAL: Use = { mode: 'contextual' }

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
   * What the USE key does with it. Absent means `{ mode: 'contextual' }`, which
   * is the common case and the reason it is optional. Read it through
   * `useOf()` so a caller never has to handle the undefined.
   */
  use?: Use

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
  // Thrown water is the cheapest proof that mode 3 is worth having: it reaches
  // a fire you cannot walk up to. Dousing what you are facing still works
  // through the affordance list, which asks about WATER and not about this.
  use: { mode: 'projected', range: 6, onLand: 'water_burst', leaves: 'lands' },
  parts: [
    { part: 'bucket_body', scale: [1.1, 1.1, 1.1], at: [0, -0.16, 0], material: 'wood', signature: true },
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
  // Throw it to lay fuel somewhere, then light it from where you are standing.
  // Two actions, neither of which authors what burns.
  use: { mode: 'projected', range: 8, onLand: 'oil_spill', leaves: 'shatters' },
  parts: [
    // Ties with the stopper on scale product, and a tie is decided by sort
    // order, which is not a thing to leave to chance.
    { part: 'flask_body', scale: [1, 1, 1], at: [0, -0.15, 0], material: 'glass', signature: true },
    { part: 'stopper', scale: [1, 1, 1], at: [0, 0.14, 0], material: 'clay' },
  ],
})

add({
  id: 'apple',
  name: 'Red Apple',
  desc: 'Windfall. One side is bruised.',
  props: { EDIBLE: 0.9, SEED: 0.25, PLANT: 0.4 },
  // `clay` is a holding position, not the intended colour. This was `ember`,
  // which is the fire ramp AND emissive at intensity 1.5, so the apple was not
  // merely the wrong orange, it was a light source, and every merge inheriting
  // apple_body glowed too. `clay` is matte and closer to red. The real answer
  // is the `fruit` ramp that already exists in palette.ts and textures.ts and
  // needs two lines to reach kitbash's material map; this becomes `fruit` the
  // day those land.
  parts: [
    { part: 'apple_body', scale: [1.15, 1.15, 1.15], at: [0, -0.11, 0], material: 'clay', signature: true },
    { part: 'nail_spike', scale: [0.5, 0.45, 0.5], at: [0, 0.09, 0], material: 'wood' },
  ],
})

add({
  id: 'chili',
  name: 'Chili Fruit',
  desc: 'Green, thin, and hotter than it has any right to be.',
  props: { EDIBLE: 0.6, PLANT: 0.7, TOXIC: 0.3 },
  // Green rather than red, which is a design call and not a limitation. Both
  // this and the apple were on `ember`, so they were the same pumpkin orange at
  // near the same size, and picking the wrong one at the bench costs an item
  // permanently. Silhouette alone will not save it at 240p, so the hue has to
  // differ too. A green chili is just as recognisable as a red one and the
  // collision cannot come back. The woody stem is there for internal contrast,
  // since a green pod on a green cap reads as one flat blob.
  parts: [
    { part: 'apple_body', scale: [0.5, 1.45, 0.5], at: [0, -0.16, 0], material: 'leaf' },
    { part: 'leaf_cluster', scale: [0.4, 0.4, 0.4], at: [0, 0.16, 0], material: 'wood' },
  ],
})

add({
  id: 'poison',
  name: 'Rat Poison',
  desc: 'Kept in the barn for the barn’s problem. A grey powder, no smell.',
  props: { TOXIC: 0.9, EDIBLE: 0.2 },
  parts: [
    { part: 'jar_body', scale: [0.85, 0.9, 0.85], at: [0, -0.16, 0], material: 'clay', signature: true },
    { part: 'stopper', scale: [0.9, 0.9, 0.9], at: [0, 0.12, 0], material: 'wood' },
  ],
})

add({
  id: 'glasses',
  name: 'Spectacles',
  desc: 'Wire frames, one arm bent. Somebody misses these.',
  props: { GLASS: 0.9, FRAGILE: 0.8, VALUABLE: 0.2 },
  // Mode 4, and the reason the mode exists: worn things change what OTHER
  // things do rather than doing anything themselves. Small print becomes
  // legible, and the sun becomes a way to start a fire.
  use: { mode: 'worn', slot: 'eyes' },
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

/** The item's use mode, with the default filled in. Never returns undefined. */
export function useOf(def: ItemDef): Use {
  return def.use ?? CONTEXTUAL
}

/**
 * One line answering "what happens if I press use right now?".
 *
 * A11 is firm that the answer must never be a silent nothing, so every mode has
 * a sentence, including the contextual case where the answer depends on what
 * you are standing in front of. Suggested glyphs for the pack, if the UI wants
 * them: hand for contextual, screen for panel, arc for projected, dot for worn.
 */
export function useSummary(def: ItemDef): string {
  const use = useOf(def)
  switch (use.mode) {
    case 'contextual':
      return 'Use it on whatever you are facing.'
    case 'panel':
      return 'Use it anywhere. It opens.'
    case 'projected':
      return `Throw it, up to ${use.range} paces.`
    case 'worn':
      return 'Wear it. It works while you have it on.'
  }
}
