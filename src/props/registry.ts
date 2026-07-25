/**
 * The property vocabulary.
 *
 * This is the language the entire game is written in. Nothing in `sim/` or
 * `world/` is allowed to branch on an item id; it reads these instead. Adding a
 * property here is cheap and correct. Adding a special case is neither.
 *
 * Values are scalars in [0,1], not booleans, because a soaked plank is
 * FLAMMABLE(0.2) and a dry one is FLAMMABLE(0.9) and that difference is the
 * whole point.
 */

/** How a property's value is derived when two items are merged. */
export type Combine =
  /** The result is at least as capable as its best parent. Most things. */
  | 'max'
  /** Quantities that genuinely accumulate, clamped at 1. */
  | 'sum'
  /** Materials, which dilute when mixed with something else. */
  | 'blend'

export interface PropertyMeta {
  /** Group, used for UI chips and for the inventory filter. */
  group: 'material' | 'physical' | 'energetic' | 'biological' | 'social' | 'functional'
  combine: Combine
  /** UI color for the property chip. */
  color: string
  /** Shown in the codex and on hover. */
  blurb: string
}

export const PROPERTIES = {
  // ---------------------------------------------------------------- material
  WOODEN: { group: 'material', combine: 'blend', color: '#a9784a', blurb: 'burns, floats, can be cut' },
  METAL: { group: 'material', combine: 'blend', color: '#9aa7b4', blurb: 'conducts, holds an edge' },
  STONE: { group: 'material', combine: 'blend', color: '#8d8b86', blurb: 'heavy, will not burn' },
  CLOTH: { group: 'material', combine: 'blend', color: '#c2a68c', blurb: 'soaks, tears, burns fast' },
  GLASS: { group: 'material', combine: 'blend', color: '#9fd0d6', blurb: 'transparent and fragile' },
  PLANT: { group: 'material', combine: 'blend', color: '#7fa757', blurb: 'living matter' },
  // Deliberately `max`, not `blend`, unlike every other material. Wood mixed
  // with stone is half as wooden, but a bucket of water poured over straw does
  // not make the straw half-wet, it soaks it. Water is a quantity that arrives,
  // not a fraction of the mixture.
  WATER: { group: 'material', combine: 'max', color: '#5aa9d6', blurb: 'wets, quenches, flows' },

  // ---------------------------------------------------------------- physical
  FLAMMABLE: { group: 'physical', combine: 'max', color: '#e2733a', blurb: 'will catch and carry fire' },
  HEAVY: { group: 'physical', combine: 'sum', color: '#7a7268', blurb: 'hard to move, hits hard' },
  SHARP: { group: 'physical', combine: 'max', color: '#d8d3c4', blurb: 'cuts what it touches' },
  RIGID: { group: 'physical', combine: 'max', color: '#b0a894', blurb: 'holds its shape under load' },
  BUOYANT: { group: 'physical', combine: 'max', color: '#8fc7e8', blurb: 'floats' },
  WET: { group: 'physical', combine: 'max', color: '#6fb2d8', blurb: 'resists fire until it dries' },

  // --------------------------------------------------------------- energetic
  HOT: { group: 'energetic', combine: 'max', color: '#ff7a3d', blurb: 'ignites flammable things nearby' },
  LUMINOUS: { group: 'energetic', combine: 'max', color: '#ffd98a', blurb: 'gives light' },
  EXPLOSIVE: { group: 'energetic', combine: 'sum', color: '#ff5252', blurb: 'releases all of it at once' },

  // -------------------------------------------------------------- biological
  EDIBLE: { group: 'biological', combine: 'blend', color: '#c9d67a', blurb: 'food' },
  SEED: { group: 'biological', combine: 'max', color: '#a8c46a', blurb: 'grows, given water and time' },
  LIVING: { group: 'biological', combine: 'blend', color: '#86c17a', blurb: 'alive, for now' },

  // ------------------------------------------------------------------ social
  VALUABLE: { group: 'social', combine: 'sum', color: '#e6c35c', blurb: 'someone would want this' },
  SACRED: { group: 'social', combine: 'max', color: '#d8b3e8', blurb: 'means something to someone' },

  // -------------------------------------------------------------- functional
  CONTAINER: { group: 'functional', combine: 'max', color: '#b8a67e', blurb: 'holds things' },
  ROPE_LIKE: { group: 'functional', combine: 'max', color: '#c4a578', blurb: 'ties, spans, hangs' },
  LADDER_LIKE: { group: 'functional', combine: 'max', color: '#c9b083', blurb: 'gets you up things' },
  PLATFORM: { group: 'functional', combine: 'max', color: '#a89878', blurb: 'stand on it, span with it' },
  TOOL_CUTTING: { group: 'functional', combine: 'max', color: '#cfd6dd', blurb: 'chops and fells' },
  TOOL_STRIKING: { group: 'functional', combine: 'max', color: '#b4bcc4', blurb: 'breaks and drives' },
} as const satisfies Record<string, PropertyMeta>

export type PropertyId = keyof typeof PROPERTIES
export type Properties = Partial<Record<PropertyId, number>>

export const ALL_PROPERTIES = Object.keys(PROPERTIES) as PropertyId[]

export function meta(id: PropertyId): PropertyMeta {
  return PROPERTIES[id]
}

/** Read a property, treating absent as zero. */
export function p(props: Properties, id: PropertyId): number {
  return props[id] ?? 0
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Drop zeroes so entities stay legible in the inspector and the UI. */
export function prune(props: Properties): Properties {
  const out: Properties = {}
  for (const key of Object.keys(props) as PropertyId[]) {
    const v = props[key]
    if (v !== undefined && v > 0.02) out[key] = Math.round(clamp01(v) * 100) / 100
  }
  return out
}

/** Sorted for stable display: strongest first, then alphabetical. */
export function ranked(props: Properties): { id: PropertyId; value: number }[] {
  return (Object.keys(props) as PropertyId[])
    .map((id) => ({ id, value: props[id]! }))
    .filter((e) => e.value > 0.02)
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
}
