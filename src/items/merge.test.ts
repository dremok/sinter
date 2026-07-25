import { describe, it, expect } from 'vitest'
import { CATALOG, STARTING_ITEMS, itemsInBand, useOf, useSummary } from './catalog'
import { RECIPES, canMerge, merge, mergeId, refusal, tryMerge } from './merge'
import {
  INTERACTIONS,
  LANDINGS,
  OBSTACLES,
  interactionFor,
  landingOf,
  projectedItems,
  routesPast,
  unknownInteractionItems,
} from './interactions'
import { applyReactions } from '../props/derive'
import { p, type PropertyId } from '../props/registry'

/**
 * The merge guarantees are load bearing for the whole catalog. If they fail the
 * same pair starts producing different items for different players, or the
 * bench eats something it should have handed back, and the mechanic is gone.
 * Do not "fix" a failure here by relaxing the assertion.
 *
 * The old "always yields, for every pair" case is deliberately GONE. D18
 * reversed that guarantee: a pair either has an authored result or it does not
 * combine, and the tests that replace it are `noMerge items never combine` and
 * `refusing costs nothing`.
 */

const ids = Object.keys(CATALOG)
const base = itemsInBand(0).map((d) => d.id)

/** Every pair of catalog ids, once each, without the self pairs. */
function pairs(): [string, string][] {
  const out: [string, string][] = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) out.push([ids[i]!, ids[j]!])
  }
  return out
}

/**
 * Everything a player could hold, starting from the Band 0 items and applying
 * recipes until nothing new appears.
 *
 * Deliberately computed rather than listed. A test that names the solution
 * cannot notice when the solution stops existing, which is the whole failure
 * mode rule 1 is written against.
 */
function reachable(): string[] {
  const have = new Set(STARTING_ITEMS)
  for (let pass = 0; pass <= RECIPES.length; pass++) {
    let added = 0
    for (const r of RECIPES) {
      if (have.has(r.id)) continue
      if (have.has(r.inputs[0]) && have.has(r.inputs[1])) {
        have.add(r.id)
        added++
      }
    }
    if (added === 0) break
  }
  return [...have]
}

/** The strongest value of a property anywhere in a set of items. */
function best(itemIds: string[], prop: PropertyId): number {
  return itemIds.reduce((acc, id) => Math.max(acc, p(CATALOG[id]!.props, prop)), 0)
}

describe('merge guarantees', () => {
  it('is commutative in id, name, properties and parts', () => {
    for (const [a, b] of pairs()) {
      const ab = tryMerge(a, b)
      const ba = tryMerge(b, a)
      expect(ab === null, `${a}+${b}`).toEqual(ba === null)
      if (!ab || !ba) continue
      expect(ab.id).toEqual(ba.id)
      expect(ab.name).toEqual(ba.name)
      expect(ab.props).toEqual(ba.props)
      expect(ab.parts).toEqual(ba.parts)
    }
  })

  it('is deterministic across repeated calls', () => {
    const once = pairs().map(([a, b]) => tryMerge(a, b)?.name ?? null)
    const twice = pairs().map(([a, b]) => tryMerge(a, b)?.name ?? null)
    expect(once).toEqual(twice)
  })

  /**
   * The one that matters most for how merging FEELS. Playtest feedback was that
   * lots of different combinations produced what looked like the same item.
   * Names are authored now rather than assembled from word pools, so this is a
   * check on the recipe book rather than on a namer, but a duplicate is still
   * the same bug: the player cannot tell that anything happened.
   */
  it('gives every recipe a distinct name and a distinct id', () => {
    const names = new Map<string, string>()
    const resultIds = new Map<string, string>()

    for (const r of RECIPES) {
      const pair = mergeId(r.inputs[0], r.inputs[1])
      expect(names.get(r.name), `"${r.name}" is used twice`).toBeUndefined()
      expect(resultIds.get(r.id), `"${r.id}" is produced twice`).toBeUndefined()
      names.set(r.name, pair)
      resultIds.set(r.id, pair)
    }
    expect(names.size).toBe(RECIPES.length)
  })

  it('never authors the same pair twice', () => {
    const seen = new Set<string>()
    for (const r of RECIPES) {
      const key = mergeId(r.inputs[0], r.inputs[1])
      expect(seen.has(key), `${key} is authored twice`).toBe(false)
      seen.add(key)
    }
  })

  it('keeps every property inside [0,1]', () => {
    for (const [a, b] of pairs()) {
      const out = tryMerge(a, b)
      if (!out) continue
      for (const [key, v] of Object.entries(out.props)) {
        expect(v, `${a}+${b} ${key}`).toBeGreaterThanOrEqual(0)
        expect(v, `${a}+${b} ${key}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('mergeId is order independent', () => {
    expect(mergeId('flint', 'torch')).toEqual(mergeId('torch', 'flint'))
  })
})

describe('not every pair merges', () => {
  it('leaves plenty of pairs uncombined, which is the point of D18', () => {
    const combines = pairs().filter(([a, b]) => canMerge(a, b))
    expect(combines.length).toBeLessThan(pairs().length)
    // And the book is still worth reading rather than being three entries.
    expect(RECIPES.length).toBeGreaterThan(40)
  })

  it('noMerge items never combine with anything, in either order', () => {
    const inert = base.filter((id) => CATALOG[id]!.noMerge)
    expect(inert.length, 'at least one item should refuse, or the flag is untested').toBeGreaterThan(0)

    for (const id of inert) {
      for (const other of ids) {
        expect(canMerge(id, other), `${id}+${other}`).toBe(false)
        expect(tryMerge(id, other)).toBeNull()
        expect(tryMerge(other, id)).toBeNull()
      }
    }
  })

  it('never authors a recipe using an item flagged noMerge', () => {
    for (const r of RECIPES) {
      for (const input of r.inputs) {
        expect(CATALOG[input]?.noMerge, `${r.id} consumes ${input}`).toBeUndefined()
      }
    }
  })

  it('refusing costs nothing: no item changes and no item appears', () => {
    const before = Object.keys(CATALOG).length
    const snapshot = JSON.stringify([CATALOG.key, CATALOG.apple, CATALOG.sword])

    for (const other of ids) {
      expect(tryMerge('key', other)).toBeNull()
      expect(tryMerge('apple', 'sword')).toBeNull()
    }

    expect(Object.keys(CATALOG).length, 'a refusal invented an item').toBe(before)
    expect(JSON.stringify([CATALOG.key, CATALOG.apple, CATALOG.sword])).toEqual(snapshot)
  })

  it('says something about the object when an item refuses', () => {
    const forKey = refusal('key', 'rope')
    expect(forKey).toEqual(CATALOG.key!.noMerge)
    expect(refusal('rope', 'key')).toEqual(forKey)
    // The generic refusal still names both things rather than reciting a rule.
    expect(refusal('apple', 'sword')).toContain(CATALOG.apple!.name)
    expect(refusal('apple', 'sword')).toContain(CATALOG.sword!.name)
  })

  it('merge() throws where tryMerge() returns null, so a caller cannot ignore it', () => {
    expect(() => merge('key', 'rope')).toThrow()
    expect(() => merge('apple', 'sword')).toThrow()
    expect(merge('flint', 'horseshoe').id).toBe('fire_striker')
  })
})

describe('derivation rules produce sensible physics', () => {
  it('metal on stone throws a spark hot enough to light something', () => {
    // Fire from scratch, using only properties. No item is flagged a firestarter.
    const striker = merge('flint', 'horseshoe')
    expect(p(striker.props, 'HOT')).toBeGreaterThan(0.35)
  })

  it('water puts fire out', () => {
    const quenched = merge('bucket', 'lit_torch')
    expect(p(CATALOG.lit_torch!.props, 'HOT')).toBeGreaterThan(0.35)
    expect(p(quenched.props, 'HOT')).toBeLessThan(0.2)
  })

  it('soaking something flammable makes it resist fire', () => {
    const dry = p(CATALOG.straw!.props, 'FLAMMABLE')
    expect(p(merge('straw', 'bucket').props, 'FLAMMABLE')).toBeLessThan(dry * 0.5)
  })

  it('oil keeps things flammable rather than dulling them', () => {
    expect(p(merge('straw', 'oil').props, 'FLAMMABLE')).toBeGreaterThan(0.7)
  })

  it('rope plus a rigid span becomes climbable', () => {
    expect(p(merge('plank', 'rope').props, 'LADDER_LIKE')).toBeGreaterThan(0.5)
  })

  it('an edge on a haft still cuts', () => {
    expect(p(merge('axe', 'plank').props, 'TOOL_CUTTING')).toBeGreaterThan(0.4)
  })

  it('mass behind something rigid breaks things', () => {
    expect(p(merge('horseshoe', 'rock').props, 'TOOL_STRIKING')).toBeGreaterThan(0.5)
  })

  it('water thins poison the same way it kills heat', () => {
    const neat = p(CATALOG.poison!.props, 'TOXIC')
    expect(p(merge('bucket', 'poison').props, 'TOXIC')).toBeLessThan(neat * 0.6)
  })

  it('poison carries onto an edge without being watered down', () => {
    expect(p(merge('knife', 'poison').props, 'TOXIC')).toBeGreaterThan(0.6)
    expect(p(merge('knife', 'poison').props, 'SHARP')).toBeGreaterThan(0.6)
  })

  it('something mostly glass will not hold a load', () => {
    const lens = merge('glasses', 'horseshoe')
    expect(p(lens.props, 'FRAGILE')).toBeGreaterThan(0.5)
    expect(p(lens.props, 'RIGID')).toBeLessThan(p(CATALOG.horseshoe!.props, 'RIGID'))
  })

  it('materials dilute rather than stacking to 1', () => {
    expect(p(merge('plank', 'oil').props, 'WOODEN')).toBeLessThan(p(CATALOG.plank!.props, 'WOODEN'))
  })

  it('sum properties are symmetric, not merely cached', () => {
    // The bug this catches: `a + b * 0.75` gives a different HEAVY depending on
    // argument order, and a pair-keyed cache hides it behind whichever call
    // happened first.
    const forward = merge('flint', 'horseshoe').props
    const backward = merge('horseshoe', 'flint').props
    expect(forward).toEqual(backward)
  })
})

describe('the recipe book is a designed object', () => {
  it('resolves every recipe, including the ones that name another result', () => {
    for (const r of RECIPES) {
      expect(CATALOG[r.id], `${r.id} was never built`).toBeDefined()
      expect(CATALOG[r.inputs[0]], `${r.id} wants ${r.inputs[0]}`).toBeDefined()
      expect(CATALOG[r.inputs[1]], `${r.id} wants ${r.inputs[1]}`).toBeDefined()
    }
  })

  it('builds chains, not only pairs', () => {
    const chained = RECIPES.filter((r) =>
      r.inputs.some((input) => RECIPES.some((other) => other.id === input)),
    )
    expect(chained.length, 'a book of pairs is a list, not a subject').toBeGreaterThan(10)

    // And at least one thing three deep: two merges before the third is possible.
    const depth = new Map<string, number>(STARTING_ITEMS.map((id) => [id, 0]))
    for (let pass = 0; pass < RECIPES.length; pass++) {
      for (const r of RECIPES) {
        const a = depth.get(r.inputs[0])
        const b = depth.get(r.inputs[1])
        if (a === undefined || b === undefined) continue
        const d = Math.max(a, b) + 1
        if (d < (depth.get(r.id) ?? Infinity)) depth.set(r.id, d)
      }
    }
    expect(Math.max(...depth.values())).toBeGreaterThanOrEqual(3)
  })

  it('reaches every recipe from the starting items alone', () => {
    const have = new Set(reachable())
    for (const r of RECIPES) {
      expect(have.has(r.id), `${r.id} cannot be reached from Band 0`).toBe(true)
    }
  })

  it('no description reads like LLM output', () => {
    const banned = /\b(delve|leverage|comprehensive|streamline|myriad|tapestry|testament)\b|—/i
    for (const id of Object.keys(CATALOG)) {
      expect(CATALOG[id]!.desc, id).not.toMatch(banned)
      expect(CATALOG[id]!.name, id).not.toMatch(banned)
    }
    for (const it of INTERACTIONS) {
      expect(it.says, it.item).not.toMatch(banned)
      expect(it.verb, it.item).not.toMatch(banned)
    }
    for (const o of Object.values(OBSTACLES)) {
      expect(o.facts, o.target).not.toMatch(banned)
      for (const r of o.routes) expect(r.says, o.target).not.toMatch(banned)
    }
  })
})

describe('catalog integrity', () => {
  it('every starting item exists and is Band 0', () => {
    expect(STARTING_ITEMS.length).toBeGreaterThanOrEqual(14)
    expect(STARTING_ITEMS.length).toBeLessThanOrEqual(18)
    for (const id of STARTING_ITEMS) {
      expect(CATALOG[id], id).toBeDefined()
      expect(CATALOG[id]!.band ?? 0, id).toBe(0)
      expect(CATALOG[id]!.from, `${id} is authored, not merged`).toBeUndefined()
    }
  })

  it('every item has properties and parts', () => {
    for (const id of Object.keys(CATALOG)) {
      const d = CATALOG[id]!
      expect(Object.keys(d.props).length, id).toBeGreaterThan(0)
      expect(d.parts.length, id).toBeGreaterThan(0)
      expect(d.name.length, id).toBeGreaterThan(0)
      expect(d.desc.length, id).toBeGreaterThan(0)
    }
  })

  it('names nothing the parts library does not have', () => {
    // Guards the constraint that the Blender library is owned elsewhere: a
    // recipe naming a part that does not exist throws at load in the real game.
    const known = new Set(STARTING_ITEMS.flatMap((id) => CATALOG[id]!.parts.map((s) => s.part)))
    for (const id of Object.keys(CATALOG)) {
      for (const spec of CATALOG[id]!.parts) {
        expect(known.has(spec.part), `${id} uses ${spec.part}`).toBe(true)
      }
    }
  })
})

describe('obstacles keep a route nobody authored', () => {
  /**
   * Rule 1, as a test rather than as a promise. Every one of these asks whether
   * a PROPERTY is reachable, so all of them keep working for items that do not
   * exist yet, and none of them can be satisfied by a solution list.
   */
  it('the starting set affords more than one route past a wooden obstacle', () => {
    const have = reachable()

    const routes = {
      chop: best(have, 'TOOL_CUTTING') >= 0.45,
      burn: best(have, 'HOT') >= 0.35,
      climb: best(have, 'LADDER_LIKE') >= 0.45,
      batter: best(have, 'TOOL_STRIKING') >= 0.5,
      douse: best(have, 'WATER') >= 0.5,
    }

    const open = Object.values(routes).filter(Boolean).length
    expect(routes, `only ${open} route(s) past a wooden wall`).toEqual({
      chop: true,
      burn: true,
      climb: true,
      batter: true,
      douse: true,
    })
  })

  it('fire is still makeable from scratch, with no item flagged a firestarter', () => {
    for (const id of STARTING_ITEMS) {
      expect(p(CATALOG[id]!.props, 'HOT'), `${id} is a firestarter`).toBeLessThan(0.35)
    }
    expect(best(reachable(), 'HOT')).toBeGreaterThanOrEqual(0.35)
  })

  it('every authored target also has at least one unauthored route', () => {
    for (const it of INTERACTIONS) {
      const routes = routesPast(it.target)
      expect(routes.length, `${it.target} is a lock with a key`).toBeGreaterThan(0)
    }
  })

  it('every unauthored route is actually satisfiable from Band 0', () => {
    const have = reachable()
    for (const target of Object.keys(OBSTACLES) as (keyof typeof OBSTACLES)[]) {
      const routes = OBSTACLES[target].routes
      const open = routes.filter((r) => best(have, r.prop) >= r.min)
      expect(open.length, `nothing in Band 0 satisfies any route past ${target}`).toBeGreaterThan(0)
    }
  })
})

describe('the interaction table', () => {
  it('names only items the catalog knows', () => {
    expect(unknownInteractionItems()).toEqual([])
  })

  it('looks up by item and target, and misses cleanly', () => {
    expect(interactionFor('key', 'mill_door')?.effect).toEqual({ kind: 'open' })
    expect(interactionFor('key', 'yard_dog')).toBeNull()
    expect(interactionFor('rock', 'mill_door')).toBeNull()
  })

  it('declares a target that the obstacle table describes', () => {
    for (const it of INTERACTIONS) {
      expect(OBSTACLES[it.target], `${it.target} has no facts`).toBeDefined()
      expect(OBSTACLES[it.target].facts.length).toBeGreaterThan(0)
    }
  })

  it('stays smaller than the property layer it sits on top of', () => {
    // D17: authored entries are the highlights, not the mechanism. If this ever
    // inverts, the game has quietly become a lock-and-key adventure.
    expect(INTERACTIONS.length).toBeLessThan(RECIPES.length)
  })
})

describe('the four use modes', () => {
  it('gives every item a mode, with contextual as the default', () => {
    for (const id of Object.keys(CATALOG)) {
      const use = useOf(CATALOG[id]!)
      expect(['contextual', 'panel', 'projected', 'worn']).toContain(use.mode)
      // A11: pressing use must never be a silent nothing, so every mode owes
      // the player a sentence.
      expect(useSummary(CATALOG[id]!).length, id).toBeGreaterThan(0)
    }
  })

  it('has something in every mode the game can currently express', () => {
    expect(projectedItems().length, 'mode 3 is the one that was missing').toBeGreaterThan(4)
    const worn = Object.keys(CATALOG).filter((id) => useOf(CATALOG[id]!).mode === 'worn')
    expect(worn.length).toBeGreaterThan(0)
  })

  it('never lets a projected item name a landing that does nothing', () => {
    for (const id of projectedItems()) {
      const use = useOf(CATALOG[id]!)
      if (use.mode !== 'projected') throw new Error('unreachable')
      expect(use.range, id).toBeGreaterThan(0)

      const land = landingOf(id)!
      expect(land, id).toBeDefined()
      expect(land.radius, id).toBeGreaterThan(0)
      // The failure this catches: a throwable whose arrival stamps nothing, so
      // the player aims, throws, loses the item, and the world does not react.
      expect(Object.keys(land.applies).length, `${id} lands and does nothing`).toBeGreaterThan(0)
    }
  })

  it('keeps every landing inside [0,1] and readable by a real system', () => {
    // The systems that exist today. A landing stamping something nothing reads
    // is the same dead weight as a property nothing reads.
    const read: PropertyId[] = ['FLAMMABLE', 'HOT', 'WET', 'WATER', 'TOXIC']
    for (const land of Object.values(LANDINGS)) {
      for (const [key, v] of Object.entries(land.applies)) {
        expect(v, `${land.id} ${key}`).toBeGreaterThanOrEqual(0)
        expect(v, `${land.id} ${key}`).toBeLessThanOrEqual(1)
      }
      const useful = (Object.keys(land.applies) as PropertyId[]).some((k) => read.includes(k))
      expect(useful, `nothing reads anything ${land.id} applies`).toBe(true)
    }
  })

  it('the fire flask is a verb, not an outcome', () => {
    const flask = landingOf('fire_flask')!
    expect(flask).toBeDefined()
    // Hot enough to matter: sim/fire.ts ignites at HOT 0.35.
    expect(p(flask.applies, 'HOT')).toBeGreaterThanOrEqual(0.35)
    expect(p(flask.applies, 'FLAMMABLE')).toBeGreaterThan(0)
  })
})

describe('the verb is authored, the consequences are simulated', () => {
  /**
   * The whole point of A11, tested at the only level this module owns: what a
   * landing does to something depends on what that something already is, and
   * nothing in the table gets to decide the outcome.
   */
  const dryPlank = () => ({ ...CATALOG.plank!.props })
  const soakedPlank = () => applyReactions({ ...CATALOG.plank!.props, WATER: 1, WET: 1 })

  const land = (target: ReturnType<typeof dryPlank>, id: keyof typeof LANDINGS) =>
    applyReactions({ ...target, ...LANDINGS[id].applies })

  it('sets a dry thing alight', () => {
    expect(p(land(dryPlank(), 'shatter_burning'), 'HOT')).toBeGreaterThanOrEqual(0.35)
  })

  it('does nothing to the same thing soaked, and nobody wrote that down', () => {
    const hit = land(soakedPlank(), 'shatter_burning')
    expect(p(hit, 'HOT'), 'water kills the heat').toBeLessThan(0.35)
    expect(p(hit, 'FLAMMABLE'), 'and it will not carry fire either').toBeLessThan(0.2)
  })

  it('lets thrown water put out what a thrown flame started', () => {
    const burning = land(dryPlank(), 'thrown_flame')
    expect(p(burning, 'HOT')).toBeGreaterThanOrEqual(0.35)
    expect(p(applyReactions({ ...burning, ...LANDINGS.water_burst.applies }), 'HOT')).toBeLessThan(0.2)
  })

  it('lays fuel without lighting it, so the two acts stay separate', () => {
    const oiled = land(dryPlank(), 'oil_spill')
    expect(p(oiled, 'FLAMMABLE')).toBeGreaterThan(0.9)
    expect(p(oiled, 'HOT'), 'a spill is not a fire').toBeLessThan(0.35)
  })

  it('carries poison onto ground without pretending to kill anything', () => {
    const splash = LANDINGS.tainted_splash.applies
    expect(p(splash, 'TOXIC')).toBeGreaterThan(0.5)
    // And the same dilution rule that applies everywhere else still applies.
    expect(p(applyReactions({ ...splash }), 'TOXIC')).toBeLessThan(p(splash, 'TOXIC'))
  })

  it('never lets a landing express an outcome', () => {
    // Structural, and worth asserting because the shape is the guarantee. A
    // landing has properties and a radius. If a field like `destroys` or
    // `target` ever appears here, the authored layer has started authoring
    // consequences and A11 has been lost.
    for (const land of Object.values(LANDINGS)) {
      expect(Object.keys(land).sort()).toEqual(['applies', 'id', 'radius', 'says'])
    }
  })
})

describe('items do not look like each other', () => {
  /**
   * The pack list is how a player picks merge inputs, and merging is
   * irreversible, so two items that read the same at a glance cost somebody an
   * item permanently. This runs the check over the catalog's own data, which
   * finds the next collision before anyone has to look at a screenshot.
   *
   * It is not a substitute for looking. It cannot see that a stretched knife
   * blade reads as a trowel. It only catches "these two are built from the same
   * parts in the same material", which is what produces the collisions.
   */
  const bulk = (s: { scale: [number, number, number]; signature?: true }) =>
    s.signature ? Infinity : s.scale[0] * s.scale[1] * s.scale[2]

  const signature = (id: string) => [...CATALOG[id]!.parts].sort((a, b) => bulk(b) - bulk(a))[0]!
  const kinds = (id: string) => [...new Set(CATALOG[id]!.parts.map((s) => s.part))].sort()

  const overlap = (a: string[], b: string[]) => {
    const A = new Set(a)
    const B = new Set(b)
    const shared = [...A].filter((x) => B.has(x)).length
    return shared / (A.size + B.size - shared)
  }

  /** True if two items would read as the same object on a card at 240p. */
  const confusable = (x: string, y: string): boolean => {
    const sx = signature(x)
    const sy = signature(y)
    if (sx.material !== sy.material) return false
    return sx.part === sy.part || overlap(kinds(x), kinds(y)) >= 0.5
  }

  /**
   * Collisions that need geometry rather than data, waiting on the parts
   * library, listed here so the check can be green without being a lie.
   *
   * Empty as of the parts rebuild. It held `flint`/`rock` (one was a scaled-up
   * copy of the other) and `knife`/`sword` (a knife blade stretched to 2.35
   * times its length); `stone_lump`, `blade_sword`, `guard_cross` and
   * `pommel_round` retired both. The test below fails if an entry stops
   * colliding, which is what emptied this rather than anyone remembering to.
   */
  const PENDING_REBUILD: [string, string][] = []

  const key = (a: string, b: string) => [a, b].sort().join('+')
  const pending = new Set(PENDING_REBUILD.map(([a, b]) => key(a, b)))

  it('finds no collision that is not already known', () => {
    const found: string[] = []
    for (let i = 0; i < STARTING_ITEMS.length; i++) {
      for (let j = i + 1; j < STARTING_ITEMS.length; j++) {
        const a = STARTING_ITEMS[i]!
        const b = STARTING_ITEMS[j]!
        if (confusable(a, b) && !pending.has(key(a, b))) {
          found.push(`${CATALOG[a]!.name} and ${CATALOG[b]!.name} (${key(a, b)})`)
        }
      }
    }
    expect(found, 'these two items read as the same object').toEqual([])
  })

  it('keeps the pending list honest', () => {
    for (const [a, b] of PENDING_REBUILD) {
      expect(confusable(a, b), `${key(a, b)} no longer collides, drop it from the list`).toBe(true)
    }
  })

  it('gives each item at most one signature part', () => {
    for (const id of Object.keys(CATALOG)) {
      const marked = CATALOG[id]!.parts.filter((s) => s.signature)
      expect(marked.length, `${id} marks ${marked.length} signature parts`).toBeLessThanOrEqual(1)
    }
  })

  it('passes the part that IS the parent down to the merge result', () => {
    // The bucket bug: its hoop scored higher than its body on scale product, so
    // Well Bucket inherited a steel band and a disc of water, and no bucket.
    // D6's whole claim is that a result visibly contains its parents.
    for (const [parent, child] of [
      ['bucket', 'well_bucket'],
      ['oil', 'pitch_torch'],
      ['poison', 'coated_blade'],
    ] as const) {
      const want = signature(parent).part
      const got = CATALOG[child]!.parts.map((s) => s.part)
      expect(got, `${child} lost the ${want} that makes it a ${parent}`).toContain(want)
    }
  })
})
