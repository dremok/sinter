/**
 * How two items' properties become one item's properties.
 *
 * Everything here MUST be commutative: `derive(a, b)` and `derive(b, a)` have
 * to produce identical output, because `merge(A, B) === merge(B, A)` is a
 * design guarantee. Every rule below is symmetric in its inputs; keep it that
 * way. `max`, `sum` and `blend` are all symmetric, and the emergent rules read
 * only the already-combined values, so they inherit the symmetry. `sum` was the
 * one that was not, and the fix is written up where it is applied.
 *
 * There are no item ids in this file and there never will be.
 */

import {
  ALL_PROPERTIES,
  PROPERTIES,
  clamp01,
  p,
  prune,
  type Properties,
  type PropertyId,
} from './registry'

function combineOne(id: PropertyId, a: number, b: number): number {
  switch (PROPERTIES[id].combine) {
    case 'max':
      return Math.max(a, b)
    case 'sum':
      // Written as `a + b * 0.75` until 2026-07-25, which is NOT symmetric:
      // derive(flint, horseshoe) and derive(horseshoe, flint) disagreed on
      // HEAVY. The old merge() hid it behind a pair-keyed cache, so whichever
      // order was tried first won and the commutativity test passed anyway.
      // Ordering by size makes it symmetric and keeps the intent, which is that
      // the smaller quantity contributes less than the larger one.
      return clamp01(Math.max(a, b) + Math.min(a, b) * 0.75)
    case 'blend':
      // Materials dilute. Half a thing made of oak is half as wooden, which is
      // what stops a merge chain from ending in a lump of every material at 1.0.
      return (a + b) / 2
  }
}

/**
 * Emergent capabilities.
 *
 * This is where merging stops being arithmetic and starts being interesting.
 * None of these name an item. They say things like "an edge lashed to a haft
 * cuts", which is true of a flint axe, a steel sickle, and item number 4,000
 * alike.
 */
function emerge(out: Properties): void {
  const set = (id: PropertyId, v: number) => {
    const next = clamp01(v)
    if (next > p(out, id)) out[id] = next
  }

  // An edge plus something rigid to drive it is a cutting tool.
  //
  // The multiplier was 1.25, and every emergent multiplier here was above 1.
  // That is why merging felt like admin. A bonus above 1 means an improvised
  // combination BEATS the purpose-built tool: flint lashed to a horseshoe came
  // out at TOOL_CUTTING 0.75 against the axe's 0.6, so the axe was pointless and
  // every chain that touched a striker inherited a better axe than the axe.
  //
  // Below 1, emergence still gets you a tool you did not have, and the real one
  // is still better. That is the whole relationship between merging and
  // finding, stated as a number.
  set('TOOL_CUTTING', Math.min(p(out, 'SHARP'), p(out, 'RIGID')) * 0.9)

  // Mass behind a rigid body breaks things.
  set('TOOL_STRIKING', Math.min(p(out, 'HEAVY'), p(out, 'RIGID')) * 0.9)

  // Something to hold plus something to stand on gets you over a wall.
  set('LADDER_LIKE', Math.min(p(out, 'ROPE_LIKE'), Math.max(p(out, 'PLATFORM'), p(out, 'RIGID'))) * 0.95)

  // Hard metal struck on hard stone throws sparks. This is the rule that makes
  // fire-from-nothing possible without an authored "firestarter" item: any
  // metal and any stone will do it, including ones that do not exist yet.
  set('HOT', Math.min(p(out, 'METAL'), p(out, 'STONE')) * 0.95)

  // Anything hot enough is its own lamp.
  set('LUMINOUS', p(out, 'HOT') * 0.85)

  // Wood and plant matter float.
  set('BUOYANT', Math.max(p(out, 'WOODEN'), p(out, 'PLANT')) * 0.7)

  // Metal and stone are dense.
  set('HEAVY', Math.max(p(out, 'STONE'), p(out, 'METAL')) * 0.55)

  // A rigid span is something to walk on, or to bridge with.
  //
  // Wood, not "wood or metal", and gated on mass as well. The rule used to be
  // `min(RIGID, WOODEN + METAL)`, which any small rigid metal thing satisfied:
  // a brass key and a fire striker both came out as things you could bridge a
  // stream with. Nothing in this vocabulary expresses SIZE, so mass is the
  // proxy, and a thing already built as a platform still passes one on through
  // `max` regardless of what this rule says.
  set('PLATFORM', Math.min(p(out, 'RIGID'), p(out, 'WOODEN'), p(out, 'HEAVY') * 1.2) * 0.8)

  // Water in the mix soaks whatever it was mixed with.
  set('WET', p(out, 'WATER'))

  // Glass breaks. Anything mostly glass carries that with it, which is why a
  // lens bound into an iron ring is still a thing you can sit on and ruin.
  set('FRAGILE', p(out, 'GLASS') * 0.9)

  // Fire frightens most living things.
  set('FRIGHTENING', p(out, 'HOT') * 0.7)

  // So does an edge with weight behind it. Note the `min`: a razor with no mass
  // and a boulder with no edge are both unremarkable to stand in front of.
  set('FRIGHTENING', Math.min(p(out, 'SHARP'), p(out, 'HEAVY')) * 0.9)
}

/**
 * Reactions, applied after emergence. These SUBTRACT, so they cannot be folded
 * into `emerge`, which only ever raises values.
 */
function react(out: Properties): void {
  const wet = p(out, 'WET')
  const water = p(out, 'WATER')

  // Wet things resist fire. This is the single most useful interaction in the
  // game and it is three lines, because it reads properties instead of ids.
  if (wet > 0) out.FLAMMABLE = clamp01(p(out, 'FLAMMABLE') * (1 - 0.9 * wet))

  // Water kills heat. Dunking a burning brand puts it out.
  if (water > 0) {
    out.HOT = clamp01(p(out, 'HOT') * (1 - water))
    out.LUMINOUS = clamp01(p(out, 'LUMINOUS') * (1 - water * 0.7))
  }

  // There was a "hot things with no fuel cool down" rule here. It was removed
  // rather than tuned: fuel depletion is already modelled properly in sim/fire,
  // and this cruder second copy pushed sparkers and embers (both HOT with no
  // FLAMMABLE of their own) below the ignition threshold, so the one item whose
  // entire purpose is starting fires could not start one.

  // A blade blunts when it is buried in mass.
  const heavy = p(out, 'HEAVY')
  if (heavy > 0.75) out.SHARP = clamp01(p(out, 'SHARP') * (1 - (heavy - 0.75)))

  // Water rinses poison OFF a thing. It does not destroy poison put INTO a
  // vessel of it, and conflating those two made every liquid toxin useless.
  //
  // `poisoned_water` came out at TOXIC 0.27 while being described as a pail
  // nobody should drink from, and while throwing a `tainted_splash` that
  // applies TOXIC 0.9. The item disagreed with its own description and with its
  // own landing, and it sat below the 0.5 the granary rats need, so the one
  // obvious use for a bucket of poison did not work.
  //
  // A container holds what it is given; everything else gets hosed down. Both
  // halves have a real consumer: this path is the merge bench, and
  // `applyReactions` runs the same rule when water lands on something in the
  // world, which is the case the rinse was written for.
  if (water > 0 && p(out, 'CONTAINER') < 0.35) {
    out.TOXIC = clamp01(p(out, 'TOXIC') * (1 - water * 0.7))
  }

  // Something that breaks under load is not a platform and not a tool, whatever
  // else it is. Below 0.5 it is merely delicate and still works.
  const fragile = p(out, 'FRAGILE')
  if (fragile > 0.5) {
    const keeps = 1 - (fragile - 0.5)
    out.RIGID = clamp01(p(out, 'RIGID') * keeps)
    out.PLATFORM = clamp01(p(out, 'PLATFORM') * keeps)
    out.TOOL_STRIKING = clamp01(p(out, 'TOOL_STRIKING') * keeps)
  }
}

/** How far an inherited capability falls when the merge was not about it. */
const FOCUS_FADE = 0.7

/**
 * A merged object is a SPECIALISATION, not an accumulation.
 *
 * This is the rule that was missing, and its absence was the whole reason
 * merging read as admin. Every capability combined by `max`, so a result was
 * the union of everything its lineage had ever been able to do, at full
 * strength, forever. Measured before this existed: base items averaged 1.4
 * capabilities, first merges 4.0, second 7.9, third 9.0, and half of all
 * results gained nothing their parents did not already have. Everything drifted
 * toward the same swiss army knife, so no result felt like anything.
 *
 * The deeper problem was that merging had no cost. Rule 3 says deciding whether
 * to merge is the core tension and that it only exists if the loss is real, but
 * a result strictly better than both parents at everything is never a decision.
 * You merge everything, always, and that is admin by definition.
 *
 * So: a thing made for a job does that job, and the parts stop being usable on
 * their own. Bind a flint to a torch and you no longer have an edge you can
 * knap with. The stuff is still there and the capability is not.
 *
 * WHAT THE MERGE CREATED, IT KEEPS. WHAT IT MERELY CARRIED OVER, IT LOSES.
 *
 * The first attempt at this kept whichever capabilities were numerically
 * largest, which is wrong and the measurement said so immediately: raw values
 * are not comparable between properties. RIGID 0.85 on a horseshoe is
 * unremarkable and HOT 0.52 on a striker is the entire reason the thing exists,
 * so ranking by size faded the striker's heat below the ignition threshold and
 * broke fire. Worse, it faded the capability the combination had just invented,
 * which is exactly backwards.
 *
 * Comparing against the parents instead needs no thresholds and no tuning. A
 * capability higher than either parent's is what this combination is FOR, and
 * it survives intact. Anything at or below what a parent already had is a part
 * that came along for the ride, and it fades.
 *
 * The useful second-order effect: a recipe that invents nothing now produces
 * something visibly worse than its parents, so filler cannot hide. That is the
 * loss rule 3 asks for, and it falls out rather than being administered.
 */
function specialise(out: Properties, a: Properties, b: Properties): void {
  for (const id of FADES) {
    const now = p(out, id)
    if (now === 0) continue
    // A hair of tolerance, so floating point cannot call an inherited value an
    // invention and quietly exempt it.
    if (now > Math.max(p(a, id), p(b, id)) + 0.001) continue
    out[id] = clamp01(now * FOCUS_FADE)
  }
}

/**
 * The properties a merge trades between: what the object can DO.
 *
 * The physical drivers are in here alongside the functional results, and they
 * have to be. `emerge` rebuilds TOOL_CUTTING out of SHARP and RIGID on every
 * merge, so fading the tool while leaving the edge untouched restores it on the
 * next pass and the rule does nothing at all.
 *
 * Everything the simulation reads as STATE is exempt: HOT, FLAMMABLE, WET and
 * WATER are what `sim/fire.ts` runs on, and a thing does not become less on
 * fire because it was made of two things. Materials already dilute through
 * `blend`. What a thing is worth, or whether it is food, is not a skill.
 */
const STATE: PropertyId[] = ['HOT', 'FLAMMABLE', 'WET', 'WATER', 'LUMINOUS']

const FADES = new Set<PropertyId>(
  ALL_PROPERTIES.filter((id) => {
    const group = PROPERTIES[id].group
    const capability = group === 'functional' || group === 'physical' || group === 'energetic'
    return capability && !STATE.includes(id)
  }),
)

/** The whole derivation, in the order the rules depend on each other. */
export function deriveProperties(a: Properties, b: Properties): Properties {
  const out: Properties = {}
  for (const id of ALL_PROPERTIES) {
    const v = combineOne(id, p(a, id), p(b, id))
    if (v > 0) out[id] = v
  }
  emerge(out)
  react(out)
  specialise(out, a, b)
  return prune(out)
}

/**
 * Soaking, heating and other in-world state changes run through the same
 * reaction rules as merging, so a plank soaked by rain and a plank merged with
 * a bucket of water end up equally fireproof.
 */
export function applyReactions(props: Properties): Properties {
  const out = { ...props }
  emerge(out)
  react(out)
  return prune(out)
}
