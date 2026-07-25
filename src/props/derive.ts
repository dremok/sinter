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

  // An edge plus something rigid to drive it is a cutting tool. The bonus is
  // what makes a deliberate combination beat either half.
  set('TOOL_CUTTING', Math.min(p(out, 'SHARP'), p(out, 'RIGID')) * 1.25)

  // Mass behind a rigid body breaks things.
  set('TOOL_STRIKING', Math.min(p(out, 'HEAVY'), p(out, 'RIGID')) * 1.15)

  // Something to hold plus something to stand on gets you over a wall.
  set('LADDER_LIKE', Math.min(p(out, 'ROPE_LIKE'), Math.max(p(out, 'PLATFORM'), p(out, 'RIGID'))) * 1.3)

  // A rigid span is something to walk on, or to bridge with.
  set('PLATFORM', Math.min(p(out, 'RIGID'), p(out, 'WOODEN') + p(out, 'METAL')) * 0.8)

  // Hard metal struck on hard stone throws sparks. This is the rule that makes
  // fire-from-nothing possible without an authored "firestarter" item: any
  // metal and any stone will do it, including ones that do not exist yet.
  set('HOT', Math.min(p(out, 'METAL'), p(out, 'STONE')) * 1.1)

  // Anything hot enough is its own lamp.
  set('LUMINOUS', p(out, 'HOT') * 0.85)

  // Wood and plant matter float.
  set('BUOYANT', Math.max(p(out, 'WOODEN'), p(out, 'PLANT')) * 0.7)

  // Metal and stone are dense.
  set('HEAVY', Math.max(p(out, 'STONE'), p(out, 'METAL')) * 0.55)

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

  // Water thins poison and rinses it off whatever was carrying it. Same shape
  // as the fire rules above: it reads a property, so it holds for any toxin.
  if (water > 0) out.TOXIC = clamp01(p(out, 'TOXIC') * (1 - water * 0.7))

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

/** The whole derivation, in the order the rules depend on each other. */
export function deriveProperties(a: Properties, b: Properties): Properties {
  const out: Properties = {}
  for (const id of ALL_PROPERTIES) {
    const v = combineOne(id, p(a, id), p(b, id))
    if (v > 0) out[id] = v
  }
  emerge(out)
  react(out)
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
