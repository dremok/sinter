/**
 * Merging. Two in, one out, both inputs destroyed, always yields.
 *
 * Guarantees this module owes the rest of the game:
 *   - commutative:   merge(a, b) is identical to merge(b, a)
 *   - deterministic: the same pair produces the same item in every run forever
 *   - total:         every pair produces something, never "nothing happens"
 *
 * There is no RNG in here at all. Names and parts are pure functions of the
 * inputs, which is what makes the results globally stable without a bake step.
 * The properties come from `props/derive.ts` by rule; only the *presentation*
 * is decided here, exactly the split described in docs/DESIGN.md.
 */

import { deriveProperties } from '../props/derive'
import { p, ranked, type Properties, type PropertyId } from '../props/registry'
import { CATALOG, type ItemDef, type PartSpec } from './catalog'

export function mergeId(a: string, b: string): string {
  return [a, b].sort().join('+')
}

/**
 * Authored highlights.
 *
 * These exist for flavor, not for mechanics: the properties are still derived
 * by rule, and removing an entry here changes only the name and the blurb. A
 * pair that is not listed still merges, and still works.
 */
const NAMED: Record<string, { name: string; desc: string }> = {
  'branch+flint': { name: 'Hand Axe', desc: 'A flake of flint lashed into a split branch. Crude and effective.' },
  'branch+rag': { name: 'Bound Brand', desc: 'Cloth wound tight around one end. It wants a light.' },
  'branch+rope': { name: 'Lashed Pole', desc: 'Two arm-lengths, bound at the middle. It flexes but holds.' },
  'oil+rag': { name: 'Oiled Rag', desc: 'Heavy with lamp oil. Handle it away from the hearth.' },
  'branch+oil': { name: 'Pitch Torch', desc: 'Soaked end, dry handle. It has one purpose.' },
  'ember+straw': { name: 'Burning Tinder', desc: 'Already going. It will not wait for you.' },
  'flint+nail': { name: 'Striker', desc: 'Iron on flint throws a hot spark. That is the whole trick.' },
  'plank+rope': { name: 'Rope Ladder', desc: 'Rungs at uneven spacing. Nobody measured.' },
  'crate+rope': { name: 'Slung Crate', desc: 'You can drag it now, or hang it from something.' },
  'acorn+bucket': { name: 'Sprouting Acorn', desc: 'Soaked overnight. The shell has split.' },
  'flint+whetstone': { name: 'Honed Flake', desc: 'Ground to an edge that will part wool.' },
  'nail+plank': { name: 'Studded Board', desc: 'Nails driven through, points out. Someone was frightened.' },
  'coin+rag': { name: 'Purse', desc: 'Knotted cloth with a weight in the corner.' },
  'candle+lantern': { name: 'Lit Lantern', desc: 'Warm and steady. It throws a circle about four paces wide.' },
  'bucket+ember': { name: 'Quenched Ember', desc: 'Black, wet, and useless. Some merges are a loss.' },
  'millstone+rope': { name: 'Deadweight', desc: 'A stone on a line. It will fall through most things.' },
  'apple+nail': { name: 'Spiked Apple', desc: 'Nobody should eat this. It is still food, technically.' },
  'pitch+branch': { name: 'Tarred Stave', desc: 'Black to the elbow. It will burn for a long time.' },
  'fleece+oil': { name: 'Greased Fleece', desc: 'Wool that has stopped being wool and started being fuel.' },
  'hoop+plank': { name: 'Cart Wheel', desc: 'Iron tyre, oak spokes. It rolls, more or less true.' },
}

/** Adjectives keyed to the property that most defines the result. */
const ADJECTIVE: Partial<Record<PropertyId, string>> = {
  HOT: 'Burning',
  WET: 'Sodden',
  LUMINOUS: 'Guttering',
  EXPLOSIVE: 'Charged',
  VALUABLE: 'Silvered',
  SHARP: 'Keen',
  HEAVY: 'Heavy',
  METAL: 'Iron',
  STONE: 'Stone',
  WOODEN: 'Oaken',
  CLOTH: 'Bound',
  GLASS: 'Glazed',
  PLANT: 'Green',
  WATER: 'Brimming',
  SEED: 'Seeded',
  LIVING: 'Quick',
  EDIBLE: 'Sweet',
  RIGID: 'Braced',
  BUOYANT: 'Light',
  SACRED: 'Blessed',
}

/** Nouns keyed to what the result can DO, which matters more than what it is. */
const FORM: { id: PropertyId; noun: string; min: number }[] = [
  { id: 'LADDER_LIKE', noun: 'Ladder', min: 0.45 },
  { id: 'TOOL_CUTTING', noun: 'Axe', min: 0.45 },
  { id: 'TOOL_STRIKING', noun: 'Maul', min: 0.45 },
  { id: 'EXPLOSIVE', noun: 'Charge', min: 0.35 },
  { id: 'ROPE_LIKE', noun: 'Cord', min: 0.5 },
  { id: 'CONTAINER', noun: 'Vessel', min: 0.5 },
  { id: 'PLATFORM', noun: 'Board', min: 0.5 },
  { id: 'LUMINOUS', noun: 'Lamp', min: 0.5 },
  { id: 'SEED', noun: 'Cutting', min: 0.5 },
  { id: 'EDIBLE', noun: 'Ration', min: 0.5 },
  { id: 'SHARP', noun: 'Shiv', min: 0.45 },
  { id: 'HEAVY', noun: 'Weight', min: 0.6 },
]

function procedural(a: ItemDef, b: ItemDef, props: Properties): { name: string; desc: string } {
  const top = ranked(props)

  const form = FORM.find((f) => p(props, f.id) >= f.min)
  const noun = form?.noun ?? 'Bundle'

  // The adjective comes from the strongest property that is not the one that
  // already chose the noun, so we never produce "Keen Shiv".
  const adjSource = top.find((e) => e.id !== form?.id && ADJECTIVE[e.id] !== undefined)
  const adj = adjSource ? ADJECTIVE[adjSource.id]! : 'Fused'

  const strongest = top[0]
  const desc =
    strongest !== undefined
      ? `${a.name} and ${b.name}, and neither of them any more. Mostly ${strongest.id.toLowerCase().replace(/_/g, ' ')} now.`
      : `${a.name} and ${b.name}, and neither of them any more.`

  return { name: `${adj} ${noun}`, desc }
}

/** Volume proxy, used to find each parent's signature part. */
function bulk(s: PartSpec): number {
  return s.scale[0] * s.scale[1] * s.scale[2]
}

/**
 * Parts inherit from both parents.
 *
 * This is the payoff called out in docs/DECISIONS.md D6: a merge result that
 * visibly contains its parents makes the whole system readable. The player can
 * often guess what something was made from by looking at it.
 */
function inheritParts(a: ItemDef, b: ItemDef): PartSpec[] {
  const pick = (d: ItemDef, n: number) => [...d.parts].sort((x, y) => bulk(y) - bulk(x)).slice(0, n)

  const primary = pick(a, 2).map(
    (s): PartSpec => ({ ...s, scale: [s.scale[0] * 0.92, s.scale[1] * 0.92, s.scale[2] * 0.92] }),
  )
  const secondary = pick(b, 1).map(
    (s): PartSpec => ({
      ...s,
      scale: [s.scale[0] * 0.72, s.scale[1] * 0.72, s.scale[2] * 0.72],
      at: [s.at[0] + 0.1, s.at[1] + 0.17, s.at[2] + 0.05],
      rot: [(s.rot?.[0] ?? 0) + 0.35, s.rot?.[1] ?? 0, (s.rot?.[2] ?? 0) + 0.45],
    }),
  )

  return [...primary, ...secondary]
}

const cache = new Map<string, ItemDef>()

/**
 * The only way to make a new item. Always returns something.
 */
export function merge(aId: string, bId: string): ItemDef {
  const key = mergeId(aId, bId)
  const hit = cache.get(key)
  if (hit) return hit

  const a = CATALOG[aId]
  const b = CATALOG[bId]
  if (!a || !b) throw new Error(`merge on unknown item: ${aId} + ${bId}`)

  // Sort the parents so parts inheritance is commutative too, not just the
  // property math. Without this, merge(a,b) and merge(b,a) would look different
  // while claiming to be the same item.
  const [first, second] = aId <= bId ? [a, b] : [b, a]

  const props = deriveProperties(a.props, b.props)
  const authored = NAMED[key]
  const { name, desc } = authored ?? procedural(first, second, props)

  const result: ItemDef = {
    id: key,
    name,
    desc,
    props,
    parts: inheritParts(first, second),
    from: [first.id, second.id],
  }

  CATALOG[key] = result
  cache.set(key, result)
  return result
}

/** True if this exact pair has been merged before, anywhere, ever. */
export function isDiscovered(aId: string, bId: string, codex: Set<string>): boolean {
  return codex.has(mergeId(aId, bId))
}
