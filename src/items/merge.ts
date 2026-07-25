/**
 * Merging. Two in, one out, both inputs destroyed, and NOT every pair yields.
 *
 * Revised 2026-07-25 for D18, which reverses D5's "always yields". A pair
 * either has an authored result in `RECIPES` below, or it does not combine.
 * Refusing is free: nothing is consumed, nothing is lost, so experimenting
 * costs nothing and there is no reason to hoard. The old total merge produced
 * six hundred derived results, most of them filler, and filler reads as noise
 * rather than as discovery.
 *
 * Guarantees this module still owes the rest of the game:
 *   - commutative:   merge(a, b) is identical to merge(b, a)
 *   - deterministic: the same pair produces the same item in every run forever
 *   - DISTINCT:      no two recipes share a name or a result id
 *   - PURE:          asking is free. Nothing here mutates the player's pack,
 *                    and a refusal has no side effect at all.
 *
 * There is no RNG in here. Properties come from `props/derive.ts` by rule and
 * are never overridden by a recipe: only the EXISTENCE of a result, its id and
 * its prose are authored. That is what keeps a result mechanically explicable,
 * and it is why "Burning Lens" is not simply flagged HOT. It starts fires
 * through the authored interaction in `items/interactions.ts` instead.
 *
 * ---------------------------------------------------------------------------
 * UI CONTRACT, for whoever owns `src/ui/interface.ts`
 *
 *   canMerge(a, b)  -> boolean. Cheap, safe to call on every bench render.
 *   tryMerge(a, b)  -> ItemDef | null. `null` means these do not combine.
 *   refusal(a, b)   -> the line to show the player when tryMerge returns null.
 *   merge(a, b)     -> ItemDef, and THROWS if the pair does not combine.
 *
 * The bench must call `tryMerge`, and on `null` it must show `refusal(a, b)`
 * and consume NOTHING: both items stay in the pack, both stay in their slots,
 * and no codex entry is written. Only call `merge` where a result is already
 * known to exist, such as previewing a pair the codex has recorded.
 *
 * `merge` was left throwing on purpose rather than quietly returning a
 * placeholder, so the two existing call sites fail loudly during the port
 * instead of shipping a bench that silently eats items.
 * ---------------------------------------------------------------------------
 */

import { deriveProperties } from '../props/derive'
import { CATALOG, type ItemDef, type PartSpec, type Use } from './catalog'

export function mergeId(a: string, b: string): string {
  return [a, b].sort().join('+')
}

/**
 * One authored result.
 *
 * `id` is a readable slug rather than the pair key, which is what lets chains
 * name their inputs: `fire_striker + straw` reads as a recipe, and
 * `flint+horseshoe + straw` reads as an implementation detail.
 */
export interface Recipe {
  /** The two inputs, in either order. Either may be the id of another result. */
  inputs: [string, string]
  /** Stable id of the result. Chains reference this. */
  id: string
  name: string
  /** One line, plain and concrete, same voice as the catalog. */
  desc: string
  /**
   * What USE does with the result. Absent means contextual.
   *
   * Deliberately authored rather than inherited from the parents, and it is the
   * one thing besides the name and the id that a recipe is allowed to state.
   * A11's rule is that the VERB is authored, so a recipe naming the verb of its
   * own result is exactly right, while the properties underneath it stay
   * derived. Inheriting instead would mean guessing that oil plus straw is
   * still throwable, which happens to be true here and would not stay true.
   */
  use?: Use
}

/**
 * The recipe book. It is a designed object now, not a generated one, so every
 * row has to be worth finding: a tool you did not have, a way past something,
 * a joke, or an honest loss.
 *
 * Written as chains wherever possible. A pair is a fact; a chain is a subject
 * the player can get good at. `flint + horseshoe` opens six further rows on its
 * own, which is why it is the first thing most runs should stumble into.
 */
export const RECIPES: Recipe[] = [
  // ------------------------------------------------------------------- fire
  {
    inputs: ['flint', 'horseshoe'],
    id: 'fire_striker',
    name: 'Fire Striker',
    desc: 'Iron on flint throws a hot spark. That is the whole trick.',
  },
  {
    inputs: ['fire_striker', 'straw'],
    id: 'tinder_kit',
    name: 'Tinder Kit',
    desc: 'Dry straw and a striking stone, kept together so neither goes missing.',
  },
  {
    inputs: ['fire_striker', 'torch'],
    id: 'lit_torch',
    name: 'Lit Torch',
    desc: 'Caught on the second try. It is going now.',
    use: { mode: 'projected', range: 7, onLand: 'thrown_flame', leaves: 'lands' },
  },
  {
    inputs: ['torch', 'oil'],
    id: 'pitch_torch',
    name: 'Pitch Torch',
    desc: 'Soaked end, dry handle. It has one purpose.',
  },
  {
    inputs: ['fire_striker', 'pitch_torch'],
    id: 'burning_brand',
    name: 'Burning Brand',
    desc: 'Lit, and it will stay lit long enough to cross a field at night.',
    use: { mode: 'projected', range: 7, onLand: 'thrown_flame', leaves: 'lands' },
  },
  {
    inputs: ['burning_brand', 'rope'],
    id: 'fire_flail',
    name: 'Fire Flail',
    desc: 'A brand on a cord. Swing it and the whole arc burns.',
  },
  {
    inputs: ['fire_striker', 'oil'],
    id: 'fire_flask',
    name: 'Fire Flask',
    desc: 'Oil, glass, and a striker bound to the neck. Throw it and get back.',
    // The molotov, and the example A11 is written around. The verb is throwing.
    // Everything after the glass breaks belongs to sim/fire.ts, including the
    // tree behind it that nobody thought about.
    use: { mode: 'projected', range: 9, onLand: 'shatter_burning', leaves: 'shatters' },
  },
  {
    inputs: ['oil', 'rope'],
    id: 'fuse',
    name: 'Fuse',
    desc: 'Cord drawn through oil. It carries a flame along its length.',
  },
  {
    inputs: ['fire_striker', 'fuse'],
    id: 'slow_match',
    name: 'Slow Match',
    desc: 'A cord that carries fire at walking pace. Light it and be elsewhere.',
  },
  {
    inputs: ['oil', 'straw'],
    id: 'firebrand_bundle',
    name: 'Firebrand Bundle',
    desc: 'Straw drenched in oil. It will go up like paper.',
    use: { mode: 'projected', range: 7, onLand: 'oil_spill', leaves: 'lands' },
  },
  {
    inputs: ['straw', 'torch'],
    id: 'tinder_torch',
    name: 'Tinder Torch',
    desc: 'Straw packed around the head. It will take the first spark it gets.',
  },
  {
    inputs: ['plank', 'torch'],
    id: 'kindling_stack',
    name: 'Kindling Stack',
    desc: 'Split board leaned against a soaked brand. Built to catch.',
  },
  {
    inputs: ['axe', 'torch'],
    id: 'fire_axe',
    name: 'Fire Axe',
    desc: 'Blade and brand on one haft. One of them still needs lighting.',
  },
  {
    inputs: ['glasses', 'horseshoe'],
    id: 'burning_lens',
    name: 'Burning Lens',
    desc: 'One lens set in the iron so it can be held steady. It needs the sun.',
  },

  // ------------------------------------------------------------------ water
  {
    inputs: ['bucket', 'torch'],
    id: 'drowned_torch',
    name: 'Drowned Torch',
    desc: 'Soaked through. It will not take a spark now. Some merges are a loss.',
  },
  {
    inputs: ['bucket', 'lit_torch'],
    id: 'doused_brand',
    name: 'Doused Brand',
    desc: 'Into the pail, and out. Black, wet, and finished.',
  },
  {
    inputs: ['bucket', 'straw'],
    id: 'sodden_bale',
    name: 'Sodden Bale',
    desc: 'Straw that has given up any ambition of burning.',
  },
  {
    inputs: ['bucket', 'oil'],
    id: 'oil_slick',
    name: 'Oil Slick',
    desc: 'They refuse to mix. The oil sits on top, waiting.',
  },
  {
    inputs: ['bucket', 'horseshoe'],
    id: 'quenching_trough',
    name: 'Quenching Trough',
    desc: 'Hot iron and cold water. That hiss is the whole craft.',
  },
  {
    inputs: ['bucket', 'flint'],
    id: 'wet_whetstone',
    name: 'Wet Whetstone',
    desc: 'Stone kept wet. It takes an edge back in minutes.',
  },
  {
    inputs: ['bucket', 'plank'],
    id: 'sluice_board',
    name: 'Sluice Board',
    desc: 'A board and a pail. Water goes where you point it.',
  },
  {
    inputs: ['bucket', 'rope'],
    id: 'well_bucket',
    name: 'Well Bucket',
    desc: 'Rope through the handle. Now it reaches the bottom.',
    use: { mode: 'projected', range: 7, onLand: 'water_burst', leaves: 'lands' },
  },

  // ------------------------------------------------------------- edge, mass
  {
    inputs: ['flint', 'rock'],
    id: 'knapped_blade',
    name: 'Knapped Blade',
    desc: 'Stone struck against stone until one piece came off right.',
  },
  {
    inputs: ['knapped_blade', 'plank'],
    id: 'stone_axe',
    name: 'Stone Axe',
    desc: 'A knapped edge sunk into a split board. It is not steel and it does not need to be.',
  },
  {
    inputs: ['axe', 'flint'],
    id: 'honed_axe',
    name: 'Honed Axe',
    desc: 'Ground back to an edge that will part wool.',
  },
  {
    inputs: ['axe', 'horseshoe'],
    id: 'felling_wedge',
    name: 'Felling Wedge',
    desc: 'Iron driven into the split to keep it open.',
  },
  {
    inputs: ['axe', 'plank'],
    id: 'splitting_wedge',
    name: 'Splitting Wedge',
    desc: 'Board split down the grain and driven to a point.',
  },
  {
    inputs: ['axe', 'rock'],
    id: 'splitting_maul',
    name: 'Splitting Maul',
    desc: 'Head weighted with a stone. It does not cut so much as burst.',
  },
  {
    inputs: ['axe', 'oil'],
    id: 'slick_axe',
    name: 'Slick Axe',
    desc: 'Oiled head, oiled haft. It bites and it does not stick.',
  },
  {
    inputs: ['axe', 'rope'],
    id: 'poleaxe',
    name: 'Lashed Poleaxe',
    desc: 'Head bound higher up the haft. More reach, less control.',
  },
  {
    inputs: ['axe', 'bucket'],
    id: 'coopers_axe',
    name: "Cooper's Axe",
    desc: 'Wet-shaved staves. This is how the bucket was made.',
  },
  {
    inputs: ['axe', 'straw'],
    id: 'chaff',
    name: 'Chaff',
    desc: 'Straw chopped to pieces. It catches even faster now.',
  },
  {
    inputs: ['horseshoe', 'rock'],
    id: 'hammerstone',
    name: 'Hammerstone',
    desc: 'A stone bound into the iron’s curve. Swing it at whatever is in the way.',
  },
  {
    inputs: ['knife', 'plank'],
    id: 'spear',
    name: 'Spear',
    desc: 'Blade driven into the end of a board. It reaches further than your arm.',
  },
  {
    inputs: ['spear', 'rope'],
    id: 'harpoon',
    name: 'Harpoon',
    desc: 'A spear you can pull back. Whatever it goes into comes with it.',
  },
  {
    inputs: ['rock', 'sword'],
    id: 'notched_sword',
    name: 'Notched Sword',
    desc: 'Someone used it on a stone. The edge has three flat spots now.',
  },

  // ------------------------------------------------------------------ reach
  {
    inputs: ['plank', 'rope'],
    id: 'rope_ladder',
    name: 'Rope Ladder',
    desc: 'Rungs at uneven spacing. Nobody measured.',
  },
  {
    inputs: ['horseshoe', 'rope'],
    id: 'grapple',
    name: 'Grapple',
    desc: 'Iron on a line. It catches on most things.',
  },
  {
    inputs: ['grapple', 'rope_ladder'],
    id: 'grapple_ladder',
    name: 'Grappling Ladder',
    desc: 'A ladder that throws itself up first. It needs nothing to lean on.',
  },
  {
    inputs: ['rock', 'rope'],
    id: 'bolas',
    name: 'Bolas',
    desc: 'A weight on a cord. It goes further than your arm can throw.',
  },
  {
    inputs: ['plank', 'rock'],
    id: 'deadfall',
    name: 'Deadfall',
    desc: 'A propped board with a stone above it. Something walks under.',
  },
  {
    inputs: ['deadfall', 'rope'],
    id: 'set_deadfall',
    name: 'Set Deadfall',
    desc: 'Board, stone, and a line to trip it. Now it works without you standing there.',
  },

  // --------------------------------------------------------------- domestic
  {
    inputs: ['horseshoe', 'plank'],
    id: 'studded_board',
    name: 'Studded Board',
    desc: 'Iron nailed through, points out. Someone was frightened.',
  },
  {
    inputs: ['oil', 'plank'],
    id: 'oiled_decking',
    name: 'Oiled Decking',
    desc: 'Sealed against the weather. Also against your footing.',
  },
  {
    inputs: ['horseshoe', 'oil'],
    id: 'oiled_iron',
    name: 'Oiled Iron',
    desc: 'It will not rust now. It also will not stay in your grip.',
  },
  {
    inputs: ['plank', 'straw'],
    id: 'straw_pallet',
    name: 'Straw Pallet',
    desc: 'A board, a heap of straw. Somewhere to sleep.',
  },
  {
    inputs: ['rope', 'straw'],
    id: 'straw_doll',
    name: 'Straw Doll',
    desc: 'Bound at the neck and the waist. It has no face.',
  },

  // ------------------------------------------------------------------- food
  {
    inputs: ['apple', 'axe'],
    id: 'quartered_apple',
    name: 'Quartered Apple',
    desc: 'Four clean pieces. A waste of a good axe.',
  },
  {
    inputs: ['apple', 'flint'],
    id: 'cored_apple',
    name: 'Cored Apple',
    desc: 'Opened with a stone edge. The pips are still in there.',
  },
  {
    inputs: ['apple', 'horseshoe'],
    id: 'horse_treat',
    name: 'Horse Treat',
    desc: 'An apple and a shoe. Somewhere there is a horse missing both.',
  },
  {
    inputs: ['apple', 'plank'],
    id: 'apple_press',
    name: 'Apple Press',
    desc: 'Board, weight, and fruit. Cider is a matter of patience.',
  },
  {
    inputs: ['apple', 'rope'],
    id: 'baited_snare',
    name: 'Baited Snare',
    desc: 'A loop and something a hungry animal wants.',
  },
  {
    inputs: ['apple', 'straw'],
    id: 'winter_fodder',
    name: 'Winter Fodder',
    desc: 'Packed in straw so it keeps. Animals will follow this across a field.',
  },
  {
    inputs: ['apple', 'lit_torch'],
    id: 'roast_apple',
    name: 'Roast Apple',
    desc: 'Blackened on one side, hot all the way through.',
  },

  // -------------------------------------------------------- poison and sting
  {
    inputs: ['apple', 'poison'],
    id: 'dosed_apple',
    name: 'Dosed Apple',
    desc: 'The powder went in through the bruise. It looks like an apple.',
  },
  {
    inputs: ['knife', 'poison'],
    id: 'coated_blade',
    name: 'Coated Blade',
    desc: 'Wiped along both edges and left to dry. Mind your own hands.',
  },
  {
    inputs: ['spear', 'poison'],
    id: 'poisoned_spear',
    name: 'Poisoned Spear',
    desc: 'Reach, and a point nobody wants to be scratched by.',
  },
  {
    inputs: ['bucket', 'poison'],
    id: 'poisoned_water',
    name: 'Poisoned Water',
    desc: 'A pail nobody should drink from. It looks exactly like the other one.',
    use: { mode: 'projected', range: 6, onLand: 'tainted_splash', leaves: 'lands' },
  },
  {
    inputs: ['poison', 'straw'],
    id: 'poisoned_fodder',
    name: 'Poisoned Fodder',
    desc: 'Straw laced with it, for whatever eats out of the trough.',
  },
  {
    inputs: ['bucket', 'chili'],
    id: 'chili_water',
    name: 'Chili Water',
    desc: 'The fruit crushed into the pail. Do not rub your eyes after.',
  },
  {
    inputs: ['chili', 'oil'],
    id: 'chili_oil',
    name: 'Chili Oil',
    desc: 'Steeped until the oil itself burns. Good on food, terrible in eyes.',
  },
  {
    inputs: ['chili', 'straw'],
    id: 'acrid_bundle',
    name: 'Acrid Bundle',
    desc: 'Straw packed with crushed fruit. Burn it upwind of somebody else.',
  },
  {
    inputs: ['acrid_bundle', 'fire_striker'],
    id: 'smoke_bundle',
    name: 'Smouldering Bundle',
    desc: 'Lit, then smothered, so it smokes instead of burning. It goes where the wind goes.',
  },

  // ---------------------------------------------------------- blade and fire
  {
    inputs: ['lit_torch', 'sword'],
    id: 'burning_sword',
    name: 'Burning Sword',
    desc: 'Oil down the blade, lit at the guard. It frightens people far more than it cuts them.',
  },
]

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

/** Pair key to recipe. Built once, below. */
const BY_PAIR = new Map<string, Recipe>()

/**
 * Every result is built eagerly at load, in dependency order, for two reasons.
 *
 * A chain names its inputs by result id, so `knapped_blade` has to be in the
 * catalog before the recipe that consumes it can resolve. And a typo in a chain
 * input should be a loud failure at boot rather than a merge that silently
 * stops existing, which follows D16's rule for a recipe naming a missing part.
 */
function buildAll(): void {
  const pending = [...RECIPES]

  for (let pass = 0; pass <= RECIPES.length && pending.length > 0; pass++) {
    let built = 0

    for (let i = pending.length - 1; i >= 0; i--) {
      const r = pending[i]!
      const a = CATALOG[r.inputs[0]]
      const b = CATALOG[r.inputs[1]]
      if (!a || !b) continue

      // Sort the parents so parts and lineage are commutative too, not just the
      // property maths. Without this, merge(a,b) and merge(b,a) would differ
      // while claiming to be the same item.
      const [first, second] = a.id <= b.id ? [a, b] : [b, a]

      CATALOG[r.id] = {
        id: r.id,
        name: r.name,
        desc: r.desc,
        props: deriveProperties(a.props, b.props),
        parts: inheritParts(first, second),
        band: Math.max(first.band ?? 0, second.band ?? 0) as ItemDef['band'],
        use: r.use,
        from: [first.id, second.id],
      }
      BY_PAIR.set(mergeId(r.inputs[0], r.inputs[1]), r)

      pending.splice(i, 1)
      built++
    }

    if (built === 0) break
  }

  if (pending.length > 0) {
    const bad = pending.map((r) => `${r.id} (${r.inputs.join(' + ')})`).join(', ')
    throw new Error(`recipes name inputs that do not exist or form a cycle: ${bad}`)
  }
}

buildAll()

/** How many pairs the recipe book actually knows. For the codex and for tests. */
export const RECIPE_COUNT = RECIPES.length

/** The recipe for a pair, or null if the two do not combine. */
export function recipeFor(aId: string, bId: string): Recipe | null {
  return BY_PAIR.get(mergeId(aId, bId)) ?? null
}

/** Cheap enough for the bench to ask on every render. */
export function canMerge(aId: string, bId: string): boolean {
  const a = CATALOG[aId]
  const b = CATALOG[bId]
  if (!a || !b || a.noMerge || b.noMerge) return false
  return BY_PAIR.has(mergeId(aId, bId))
}

/**
 * The only way to make a new item. Returns null when the pair does not combine,
 * and a null costs the player nothing: this function has no side effects at all.
 */
export function tryMerge(aId: string, bId: string): ItemDef | null {
  if (!canMerge(aId, bId)) return null
  return CATALOG[BY_PAIR.get(mergeId(aId, bId))!.id] ?? null
}

/**
 * What the bench says when a pair does not combine.
 *
 * An item flagged `noMerge` speaks for itself, because a refusal about the
 * object is worth more than a refusal about the rules. Everything else gets the
 * plain line, which is deliberately undramatic: nothing happened, and nothing
 * was lost either.
 */
export function refusal(aId: string, bId: string): string {
  const a = CATALOG[aId]
  const b = CATALOG[bId]
  if (!a || !b) throw new Error(`refusal on unknown item: ${aId} + ${bId}`)

  if (a.noMerge) return a.noMerge
  if (b.noMerge) return b.noMerge
  if (aId === bId) return `Two of the same thing. They stay two of the same thing.`
  return `${a.name} and ${b.name} sit on the bench and stay exactly what they were.`
}

/**
 * Throws if the pair does not combine. Only for call sites that already know a
 * result exists, such as previewing a pair the codex has recorded. Everything
 * else wants `tryMerge`.
 */
export function merge(aId: string, bId: string): ItemDef {
  const out = tryMerge(aId, bId)
  if (!out) {
    throw new Error(
      `${aId} + ${bId} do not combine. Call tryMerge() and handle null, or check canMerge() first.`,
    )
  }
  return out
}

/** True if this exact pair has been merged before, anywhere, ever. */
export function isDiscovered(aId: string, bId: string, codex: Set<string>): boolean {
  return codex.has(mergeId(aId, bId))
}
