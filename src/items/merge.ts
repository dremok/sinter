/**
 * Merging. Two in, one out, both inputs destroyed, always yields.
 *
 * Guarantees this module owes the rest of the game:
 *   - commutative:   merge(a, b) is identical to merge(b, a)
 *   - deterministic: the same pair produces the same item in every run forever
 *   - total:         every pair produces something, never "nothing happens"
 *   - DISTINCT:      no two different pairs produce the same name
 *
 * That last one is new, and it was a real complaint: the previous namer picked
 * an adjective and a noun from two small pools keyed on the result's dominant
 * properties, so wildly different merges kept coming out as "Fused Bundle".
 * Mechanically they were different items, but a player has only the name and
 * the icon to go on, so they read as the same thing and merging felt pointless.
 *
 * The fix is structural rather than a bigger word list. Parents are sorted, and
 * the result is named `<epithet of the first> <noun of the second>`. Since each
 * catalog item owns a unique epithet and a unique noun, that mapping is a
 * bijection: distinct pairs cannot collide. `merge.test.ts` asserts it over
 * every pair rather than trusting the argument.
 *
 * There is no RNG in here at all. The properties come from `props/derive.ts` by
 * rule; only presentation is decided here.
 */

import { deriveProperties } from '../props/derive'
import { p, ranked, type Properties, type PropertyId } from '../props/registry'
import { CATALOG, type ItemDef, type PartSpec } from './catalog'

export function mergeId(a: string, b: string): string {
  return [a, b].sort().join('+')
}

/**
 * Authored highlights, for pairs a player is likely to try early. These change
 * the name and the blurb only; the properties are still derived by rule, so
 * deleting an entry costs flavour and nothing else.
 */
const NAMED: Record<string, { name: string; desc: string }> = {
  // Apple
  'apple+axe': { name: 'Quartered Apple', desc: 'Four clean pieces. A waste of a good axe.' },
  'apple+bucket': { name: 'Bobbing Apple', desc: 'It floats. This is not obviously worth two items.' },
  'apple+flint': { name: 'Cored Apple', desc: 'Opened with a stone edge. The pips are still in there.' },
  'apple+horseshoe': { name: 'Horse Treat', desc: 'An apple and a shoe. Somewhere there is a horse missing both.' },
  'apple+oil': { name: 'Glazed Apple', desc: 'Coated and sticky. It will not rot for a while.' },
  'apple+plank': { name: 'Apple Press', desc: 'Board, weight, and fruit. Cider is a matter of patience.' },
  'apple+rope': { name: 'Baited Snare', desc: 'A loop and something a hungry animal wants.' },
  'apple+straw': { name: 'Winter Fodder', desc: 'Packed in straw so it keeps. Animals will follow this.' },
  'apple+torch': { name: 'Roast Apple', desc: 'Blackened on one side, hot all the way through.' },

  // Axe
  'axe+bucket': { name: "Cooper's Axe", desc: 'Wet-shaved staves. This is how the bucket was made.' },
  'axe+flint': { name: 'Honed Axe', desc: 'Ground back to an edge that will part wool.' },
  'axe+horseshoe': { name: 'Felling Wedge', desc: 'Iron driven into the split to keep it open.' },
  'axe+oil': { name: 'Slick Axe', desc: 'Oiled head, oiled haft. It bites and it does not stick.' },
  'axe+plank': { name: 'Splitting Wedge', desc: 'Board split down the grain and driven to a point.' },
  'axe+rope': { name: 'Lashed Poleaxe', desc: 'Head bound higher up the haft. More reach, less control.' },
  'axe+straw': { name: 'Chaff', desc: 'Straw chopped to pieces. It catches even faster now.' },
  'axe+torch': { name: 'Fire Axe', desc: 'A blade and a brand on one haft. Cut it or burn it.' },

  // Bucket
  'bucket+flint': { name: 'Wet Whetstone', desc: 'Stone kept wet. It takes an edge back in minutes.' },
  'bucket+horseshoe': { name: 'Quenching Trough', desc: 'Hot iron and cold water. That hiss is the whole craft.' },
  'bucket+oil': { name: 'Oil Slick', desc: 'They refuse to mix. The oil sits on top, waiting.' },
  'bucket+plank': { name: 'Sluice Board', desc: 'A board and a pail. Water goes where you point it.' },
  'bucket+rope': { name: 'Well Bucket', desc: 'Rope through the handle. Now it reaches the bottom.' },
  'bucket+straw': { name: 'Sodden Bale', desc: 'Straw that has given up any ambition of burning.' },
  'bucket+torch': { name: 'Drowned Torch', desc: 'Black, wet, and useless. Some merges are a loss.' },

  // Flint
  'flint+horseshoe': { name: 'Fire Striker', desc: 'Iron on flint throws a hot spark. That is the whole trick.' },
  'flint+oil': { name: 'Fire Flask', desc: 'Oil, glass, and something to light it with. Throw it and run.' },
  'flint+plank': { name: 'Flint Adze', desc: 'Stone edge set crosswise into a board. It hollows and it hacks.' },
  'flint+rope': { name: 'Stone Bolas', desc: 'A weight on a cord. It goes further than your arm can throw.' },
  'flint+straw': { name: 'Tinder Kit', desc: 'Dry straw and a striking stone. Fire, if you are patient.' },
  'flint+torch': { name: 'Struck Torch', desc: 'Scraped alight on the second try. It is going now.' },

  // Horseshoe
  'horseshoe+oil': { name: 'Oiled Iron', desc: 'It will not rust now. It also will not stay in your grip.' },
  'horseshoe+plank': { name: 'Studded Board', desc: 'Iron nailed through, points out. Someone was frightened.' },
  'horseshoe+rope': { name: 'Grapple', desc: 'Iron on a line. It catches on most things.' },
  'horseshoe+straw': { name: 'Stable Bedding', desc: 'Straw, iron, and the smell of a barn.' },
  'horseshoe+torch': { name: 'Iron-Bound Torch', desc: 'Collared in iron so the head cannot work loose.' },

  // Oil
  'oil+plank': { name: 'Oiled Decking', desc: 'Sealed against the weather. Also against your footing.' },
  'oil+rope': { name: 'Fuse', desc: 'Cord drawn through oil. It carries a flame along its length.' },
  'oil+straw': { name: 'Firebrand Bundle', desc: 'Straw drenched in oil. It will go up like paper.' },
  'oil+torch': { name: 'Pitch Torch', desc: 'Soaked end, dry handle. It has one purpose.' },

  // Plank
  'plank+rope': { name: 'Rope Ladder', desc: 'Rungs at uneven spacing. Nobody measured.' },
  'plank+straw': { name: 'Straw Pallet', desc: 'A board, a heap of straw. Somewhere to sleep.' },
  'plank+torch': { name: 'Kindling Stack', desc: 'Split board against a soaked brand. Built to catch.' },

  // Rope
  'rope+straw': { name: 'Straw Doll', desc: 'Bound at the neck and the waist. It has no face.' },
  'rope+torch': { name: 'Fire Flail', desc: 'A brand on a cord. Swing it and the whole arc burns.' },

  // Straw
  'straw+torch': { name: 'Tinder Torch', desc: 'Straw packed around the head. It lights on the first touch.' },
}

/**
 * Nouns keyed to what the result can DO. Used only for the description, so a
 * player is told what they gained even when the name is a compound.
 */
const CAPABILITY: { id: PropertyId; min: number; says: string }[] = [
  { id: 'LADDER_LIKE', min: 0.45, says: 'You could get over something with this.' },
  { id: 'TOOL_CUTTING', min: 0.45, says: 'It cuts.' },
  { id: 'TOOL_STRIKING', min: 0.45, says: 'It breaks things.' },
  { id: 'HOT', min: 0.35, says: 'It is hot enough to set light to things.' },
  { id: 'WATER', min: 0.5, says: 'It carries water.' },
  { id: 'ROPE_LIKE', min: 0.6, says: 'It ties and it spans.' },
  { id: 'PLATFORM', min: 0.6, says: 'You could stand on it, or bridge with it.' },
  { id: 'FLAMMABLE', min: 0.75, says: 'It is eager to burn.' },
  { id: 'EDIBLE', min: 0.5, says: 'You could eat it.' },
]

function describe(a: ItemDef, b: ItemDef, props: Properties, gained: PropertyId[]): string {
  const cap = CAPABILITY.find((c) => gained.includes(c.id) && p(props, c.id) >= c.min)
  const lead = `${a.name} and ${b.name}, and neither of them any more.`
  if (cap) return `${lead} ${cap.says}`

  const top = ranked(props)[0]
  return top ? `${lead} Mostly ${top.id.toLowerCase().replace(/_/g, ' ')} now.` : lead
}

/** Volume proxy, used to find each parent's signature part. */
function bulk(s: PartSpec): number {
  return s.scale[0] * s.scale[1] * s.scale[2]
}

/**
 * Parts inherit from both parents, the payoff called out in DECISIONS D6: a
 * result that visibly contains its parents makes merging readable.
 */
function inheritParts(a: ItemDef, b: ItemDef): PartSpec[] {
  const pick = (d: ItemDef, n: number) => [...d.parts].sort((x, y) => bulk(y) - bulk(x)).slice(0, n)

  const primary = pick(a, 2).map(
    (s): PartSpec => ({ ...s, scale: [s.scale[0] * 0.92, s.scale[1] * 0.92, s.scale[2] * 0.92] }),
  )
  const secondary = pick(b, 1).map(
    (s): PartSpec => ({
      ...s,
      scale: [s.scale[0] * 0.78, s.scale[1] * 0.78, s.scale[2] * 0.78],
      at: [s.at[0] + 0.12, s.at[1] + 0.2, s.at[2] + 0.06],
      rot: [(s.rot?.[0] ?? 0) + 0.35, s.rot?.[1] ?? 0, (s.rot?.[2] ?? 0) + 0.5],
    }),
  )

  return [...primary, ...secondary]
}

const cache = new Map<string, ItemDef>()

/** The only way to make a new item. Always returns something. */
export function merge(aId: string, bId: string): ItemDef {
  const key = mergeId(aId, bId)
  const hit = cache.get(key)
  if (hit) return hit

  const a = CATALOG[aId]
  const b = CATALOG[bId]
  if (!a || !b) throw new Error(`merge on unknown item: ${aId} + ${bId}`)

  // Sort the parents so parts and naming are commutative too, not just the
  // property maths. Without this, merge(a,b) and merge(b,a) would differ while
  // claiming to be the same item.
  const [first, second] = aId <= bId ? [a, b] : [b, a]

  const props = deriveProperties(a.props, b.props)

  // Capabilities present in the result that neither parent had. This is the
  // interesting part of a merge and it is what the description leads with.
  const gained = (Object.keys(props) as PropertyId[]).filter(
    (id) => p(props, id) > 0.02 && p(a.props, id) < 0.02 && p(b.props, id) < 0.02,
  )

  const authored = NAMED[key]
  const name = authored?.name ?? `${first.epithet} ${second.noun}`
  const desc = authored?.desc ?? describe(first, second, props, gained)

  const result: ItemDef = {
    id: key,
    name,
    desc,
    props,
    parts: inheritParts(first, second),
    // Carry naming parts forward so merges of merges stay distinguishable.
    epithet: authored?.name.split(' ')[0] ?? first.epithet,
    noun: authored?.name.split(' ').pop() ?? second.noun,
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
