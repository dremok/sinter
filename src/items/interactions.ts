/**
 * Authored interactions: a specific item having a specific effect on a specific
 * thing.
 *
 * New 2026-07-25, per D17. This is the layer that used to be forbidden. Max's
 * call after playing the alpha was that everything being general made the game
 * feel like a chore, and he is right that pure generality bought less enjoyment
 * than it cost. A brass key that opens one door is more satisfying to find than
 * a property threshold being met.
 *
 * What did NOT change, and is the part worth defending: this is a DECLARED
 * TABLE, not a pile of `if (item.id === ...)` inside `sim/`. The difference is
 * practical rather than ideological. A table can be listed, counted, tested for
 * reachability, and shown to the player in a codex. Scattered conditionals can
 * only be found by reading every file. `sim/` still reads properties and still
 * never sees an item id, and this module deliberately imports nothing from
 * `sim/` or `ecs/` so that dependency cannot grow by accident.
 *
 * The other half of D17 is enforced here in data rather than in prose:
 * `OBSTACLES` gives every target at least one route nobody authored, written as
 * a property query. `merge.test.ts` asserts that the table has no target
 * without one. An obstacle whose only answer is the authored one is a lock with
 * a key, and that is the thing this whole design exists to avoid.
 *
 * ---------------------------------------------------------------------------
 * HOW `src/main.ts` SHOULD CONSUME THIS
 *
 * Two things are needed on the world side, neither of them in this file:
 *
 *   1. Entities that are interaction targets need to say which one they are.
 *      Add one optional field to `Entity` in `src/ecs/world.ts`:
 *
 *          target?: TargetId
 *
 *      and set it where `world/region.ts` builds the mill door, the dog, the
 *      guard. `label` is prose and will be rewritten; this is an id and is not.
 *
 *   2. `affordances(target)` in `main.ts` gains one block, after the existing
 *      property-driven ones so the general answers are always offered too:
 *
 *          const tid = target.target
 *          if (tid) {
 *            for (const held of ui.pack) {
 *              const act = interactionFor(held.id, tid)
 *              if (!act) continue
 *              out.push({
 *                label: `${act.verb} (${held.name})`,
 *                run: () => {
 *                  applyEffect(act.effect, target)   // main.ts owns this switch
 *                  if (act.consumes) ui.consume(held)
 *                  ui.toast('Used', act.says)
 *                  codex.add(interactionKey(act))
 *                },
 *              })
 *            }
 *          }
 *
 * `applyEffect` is a switch over five `Effect.kind` values and belongs in
 * `main.ts` next to `fail()` and `ignite()`, because it touches components. It
 * must NOT live here: this module stays data, and stays testable without a
 * browser or a scene.
 *
 * `routesPast(tid)` returns the unauthored routes for a target and is the right
 * source for a codex page, or for a hint system if one is ever wanted. It is
 * not a quest marker: D20 stands, and nothing here should be shown unprompted.
 *
 * ---------------------------------------------------------------------------
 * THE USE KEY, ALL FOUR MODES (A11)
 *
 * `useOf(def)` in `items/catalog.ts` returns the mode with its default filled
 * in, so the switch below is total and there is no undefined case:
 *
 *   switch (useOf(def).mode) {
 *
 *     case 'contextual':
 *       // Nothing new. The affordance list at the focused target already
 *       // covers this, and the authored block above adds to it.
 *
 *     case 'projected':
 *       // The mode that did not exist. Aim within `use.range`, then:
 *       const land = landingOf(def.id)!
 *       for (const e of spatial.near(x, z, land.radius)) {
 *         e.props = applyReactions({ ...e.props, ...land.applies })
 *       }
 *       // and then STOP. Do not check what the player was aiming at, do not
 *       // special-case the palisade, do not decide anything caught. The next
 *       // stepSimulation() reads HOT and FLAMMABLE and works it out, which is
 *       // how a thrown flask can burn down a tree nobody was aiming at.
 *       // `use.leaves` says whether the item drops on the ground ('lands') or
 *       // is gone ('shatters'). Either way it leaves the pack.
 *
 *     case 'worn':
 *       // No keypress effect. Equip it in `use.slot` and let other systems ask
 *       // what is worn. Nothing reads a slot yet, so this is a stub with a
 *       // shape rather than a feature.
 *
 *     case 'panel':
 *       // Open `use.hud` from the registry in `ui/huds/`. Nothing in Band 0
 *       // uses this; the phone in Band 1 is the first one (A9).
 *   }
 *
 * `useSummary(def)` gives the one-line answer to "what happens if I press use
 * right now?", which A11 says must never be a silent nothing.
 *
 * Note the deliberate overlap: `{ kind: 'apply' }` and a projected item's
 * `onLand` name the SAME table. An authored verb aimed at a point and an
 * authored verb aimed at a target both end in "put these properties there",
 * which is the shape every authored interaction is supposed to have.
 * ---------------------------------------------------------------------------
 */

import { CATALOG, useOf, type LandingId } from './catalog'
import type { Properties, PropertyId } from '../props/registry'

/**
 * Things an authored interaction can act on.
 *
 * Kept small on purpose. Every entry costs a world-side tag and a line of
 * dialogue-free prose, and D17 is explicit that authored entries are the
 * highlights rather than the mechanism.
 */
export type TargetId =
  | 'mill_door'
  | 'stuck_shutters'
  | 'dry_tinder'
  | 'yard_dog'
  | 'stray_ox'
  | 'gate_guard'
  | 'bee_skep'
  | 'granary_rats'

/**
 * What an interaction does, as data. `main.ts` switches on `kind`; nothing else
 * is allowed to. Adding a kind means adding a case there, so keep the list
 * short and make each one mean something a system can actually do.
 */
export type Effect =
  /**
   * Stamp a landing's properties into the world and stand back. The preferred
   * kind, and the only one that cannot author its own outcome: see `Landing`.
   */
  | { kind: 'apply'; landing: LandingId }
  /** Stops blocking. Removes `blocker`, and `structure` if it has one. */
  | { kind: 'open' }
  /** It stops opposing you, and stays that way for the rest of the run. */
  | { kind: 'pacify' }
  /** It follows the thing you offered, and forgets about you. */
  | { kind: 'lure'; ticks: number }
  /** It cannot see for a while. Everything else about it is unchanged. */
  | { kind: 'blind'; ticks: number }

/**
 * What arrives at a point in the world.
 *
 * This type is the load-bearing one for A11's rule, and the important thing
 * about it is what it CANNOT say. There is no target, no hit points, no
 * "destroy", no "opens the door". A landing puts properties somewhere and stops.
 * Everything after that is `sim/fire.ts` reading FLAMMABLE and WET, and every
 * other system that reads properties, including the ones not written yet.
 *
 * That is the difference between a cutscene and a tool, expressed as a type
 * rather than as a convention somebody has to remember. If a future landing
 * wants a field like `destroys`, the answer is no: give the impact point a
 * property and let a system decide what that means.
 *
 * Projected items name one of these through `use.onLand`. A contextual
 * interaction can name one too, through `{ kind: 'apply' }`, which is how the
 * burning lens starts a fire without the lens ever being flagged HOT.
 */
export interface Landing {
  id: LandingId
  /** One line when it arrives. The consequences narrate themselves. */
  says: string
  /**
   * Stamped onto whatever is within `radius` of the impact point, through the
   * same `applyReactions` path `main.ts` already uses for dousing. A soaked
   * plank ignores HOT 1 for free, because the reaction rules say so and not
   * because anything here checked.
   */
  applies: Properties
  /** World units. Keep it small; spreading is the simulation's job, not this. */
  radius: number
}

/**
 * Every landing in the game. Six, and all six are read by systems that already
 * exist: FLAMMABLE, HOT and WET by `sim/fire.ts`, WATER and TOXIC by the
 * reaction rules in `props/derive.ts`.
 */
export const LANDINGS: Record<LandingId, Landing> = {
  shatter_burning: {
    id: 'shatter_burning',
    says: 'The glass goes, and the oil goes with it.',
    applies: { HOT: 1, FLAMMABLE: 1 },
    radius: 1.2,
  },
  thrown_flame: {
    id: 'thrown_flame',
    says: 'It lands still burning and lies there.',
    applies: { HOT: 0.7 },
    radius: 0.8,
  },
  oil_spill: {
    id: 'oil_spill',
    says: 'Oil across the ground, and nothing lighting it yet.',
    applies: { FLAMMABLE: 1 },
    radius: 1.4,
  },
  water_burst: {
    id: 'water_burst',
    says: 'The water goes everywhere it was pointed.',
    applies: { WATER: 1, WET: 1 },
    radius: 1.6,
  },
  tainted_splash: {
    id: 'tainted_splash',
    says: 'It soaks in. It will still be there tomorrow.',
    applies: { WATER: 1, WET: 1, TOXIC: 0.9 },
    radius: 1.4,
  },
  /**
   * Chili, delivered.
   *
   * Added because two items were writing cheques the simulation could not
   * cash. `chili_water` says "Do not rub your eyes after" and `chili_oil` says
   * "terrible in eyes", and neither could reach anybody's eyes: crushing the
   * fruit into a pail produced a pail, and the blinding lives in the authored
   * interaction on the raw fruit, which the derivatives do not inherit.
   *
   * TOXIC rather than a new CAUSTIC property, because TOXIC already means "harms
   * whatever eats or absorbs it", which is what capsaicin in the eyes is, and
   * because a property with no reader is a word nothing can hear. It lands
   * above the 0.5 the granary rats want, so burning them out is no longer the
   * only answer that is not rat poison.
   */
  caustic_burst: {
    id: 'caustic_burst',
    says: 'It goes everywhere, and everything close by starts blinking.',
    applies: { TOXIC: 0.55, WET: 1 },
    radius: 1.5,
  },
  focused_sunlight: {
    id: 'focused_sunlight',
    says: 'A white spot, a thread of smoke, and then it takes.',
    applies: { HOT: 0.9 },
    radius: 0.4,
  },
}

/** A way past something that nobody wrote down, written as a property query. */
export interface PropertyRoute {
  prop: PropertyId
  min: number
  /** Plain description, for the codex. Never shown as an objective. */
  says: string
}

/**
 * An obstacle as `docs/DESIGN.md` writes one: a set of facts, plus the routes
 * that fall out of the simulation rather than out of this table.
 */
export interface Obstacle {
  target: TargetId
  /** The facts. Prose here is for the codex, not for the simulation. */
  facts: string
  /** At least one, always. This is rule 1 and the test enforces it. */
  routes: PropertyRoute[]
}

export interface Interaction {
  /** Catalog id. May be a base item or a merge result. */
  item: string
  target: TargetId
  /** Verb for the prompt: "Unlock the door". */
  verb: string
  /** One line when it fires, same voice as an item description. */
  says: string
  effect: Effect
  /** Whether using it costs you the item. */
  consumes: boolean
}

export const OBSTACLES: Record<TargetId, Obstacle> = {
  mill_door: {
    target: 'mill_door',
    facts: 'Oak, banded, locked from inside. The frame is older than the lock.',
    routes: [
      { prop: 'TOOL_CUTTING', min: 0.45, says: 'Cut through the door, or the frame holding it.' },
      { prop: 'HOT', min: 0.35, says: 'Burn it. The whole mill is dry.' },
      { prop: 'TOOL_STRIKING', min: 0.5, says: 'Batter it until the frame gives.' },
    ],
  },
  stuck_shutters: {
    target: 'stuck_shutters',
    facts: 'Nailed shut from outside, two seasons ago, by somebody in a hurry.',
    routes: [
      { prop: 'TOOL_STRIKING', min: 0.5, says: 'Break the boards.' },
      { prop: 'TOOL_CUTTING', min: 0.45, says: 'Cut round the nails.' },
      { prop: 'HOT', min: 0.35, says: 'Burn them, and probably the wall.' },
    ],
  },
  dry_tinder: {
    target: 'dry_tinder',
    facts: 'A heap of dead grass under the eaves. It has not rained in a week.',
    routes: [{ prop: 'HOT', min: 0.35, says: 'Touch anything hot to it.' }],
  },
  yard_dog: {
    target: 'yard_dog',
    facts: 'Chained, bored, and loud. It has never had to bite anybody.',
    routes: [
      { prop: 'EDIBLE', min: 0.5, says: 'Feed it. It would rather eat than bark.' },
      { prop: 'FRIGHTENING', min: 0.5, says: 'Frighten it back to the end of its chain.' },
    ],
  },
  stray_ox: {
    target: 'stray_ox',
    facts: 'Standing in the gateway. Nine hundred kilos of no opinion.',
    routes: [
      { prop: 'EDIBLE', min: 0.5, says: 'Lead it off with food.' },
      { prop: 'FRIGHTENING', min: 0.5, says: 'Drive it off, and hope it goes the right way.' },
    ],
  },
  gate_guard: {
    target: 'gate_guard',
    facts: 'Neutral, greedy, bored, and afraid of his sergeant. Nobody through after dark.',
    routes: [
      { prop: 'VALUABLE', min: 0.5, says: 'Buy him. He is not expensive.' },
      { prop: 'FRIGHTENING', min: 0.5, says: 'Threaten him, and be somewhere else afterwards.' },
    ],
  },
  bee_skep: {
    target: 'bee_skep',
    facts: 'A straw hive against the orchard wall, in the way, and occupied.',
    routes: [
      { prop: 'WATER', min: 0.5, says: 'Soak it. They will not fly wet.' },
      { prop: 'HOT', min: 0.35, says: 'Burn it, and lose the honey with it.' },
    ],
  },
  granary_rats: {
    target: 'granary_rats',
    facts: 'They are in the walls and they are in the grain. The miller has stopped counting.',
    routes: [
      { prop: 'TOXIC', min: 0.5, says: 'Anything toxic they will eat.' },
      { prop: 'HOT', min: 0.35, says: 'Burn them out, and the grain with them.' },
    ],
  },
}

/**
 * The authored layer. Nine entries against eight targets, which is the ratio
 * D17 asks for: highlights on top of a world that already responds, not one key
 * per lock.
 */
export const INTERACTIONS: Interaction[] = [
  {
    item: 'key',
    target: 'mill_door',
    verb: 'Unlock the door',
    says: 'The key turns hard. Nobody has oiled this lock in years.',
    effect: { kind: 'open' },
    consumes: false,
  },
  {
    item: 'knife',
    target: 'stuck_shutters',
    verb: 'Work the blade into the jamb',
    says: 'The nails come out sideways, one at a time, complaining.',
    effect: { kind: 'open' },
    consumes: false,
  },
  {
    item: 'burning_lens',
    target: 'dry_tinder',
    verb: 'Focus the sun on it',
    says: 'You hold it steady until the spot stops moving.',
    // Note what this does NOT say: "the tinder catches". It puts heat on a spot
    // and fire does the rest, so the thing that actually burns might be the
    // tinder, or the thatch above it, or the whole row of them.
    effect: { kind: 'apply', landing: 'focused_sunlight' },
    consumes: false,
  },
  {
    item: 'chili',
    target: 'yard_dog',
    verb: 'Throw the fruit',
    says: 'It bites down once, and then it has other problems.',
    effect: { kind: 'blind', ticks: 600 },
    consumes: true,
  },
  {
    item: 'apple',
    target: 'yard_dog',
    verb: 'Toss it the apple',
    says: 'It takes the apple and forgets you were ever there.',
    effect: { kind: 'lure', ticks: 900 },
    consumes: true,
  },
  {
    item: 'winter_fodder',
    target: 'stray_ox',
    verb: 'Lead it off with the fodder',
    says: 'It follows the smell out of the gateway without being asked twice.',
    effect: { kind: 'lure', ticks: 1800 },
    consumes: true,
  },
  {
    item: 'dosed_apple',
    target: 'gate_guard',
    verb: 'Offer him the apple',
    says: 'He eats it in three bites and thanks you. Then he sits down.',
    effect: { kind: 'pacify' },
    consumes: true,
  },
  {
    item: 'smoke_bundle',
    target: 'bee_skep',
    verb: 'Smoke the skep',
    says: 'They go quiet and heavy, the way smoke always makes them.',
    effect: { kind: 'pacify' },
    consumes: true,
  },
  {
    item: 'poisoned_fodder',
    target: 'granary_rats',
    verb: 'Leave the fodder in the corner',
    says: 'By morning the granary is quiet. Nobody asks how.',
    effect: { kind: 'pacify' },
    consumes: true,
  },
]

const BY_ITEM = new Map<string, Interaction[]>()
const BY_TARGET = new Map<TargetId, Interaction[]>()

for (const it of INTERACTIONS) {
  const forItem = BY_ITEM.get(it.item)
  if (forItem) forItem.push(it)
  else BY_ITEM.set(it.item, [it])

  const forTarget = BY_TARGET.get(it.target)
  if (forTarget) forTarget.push(it)
  else BY_TARGET.set(it.target, [it])
}

/** Stable key for the codex, which records interactions alongside merges. */
export function interactionKey(it: Interaction): string {
  return `${it.item}@${it.target}`
}

/** Everything a carried item can be used on. Empty for almost every item. */
export function interactionsFor(itemId: string): Interaction[] {
  return BY_ITEM.get(itemId) ?? []
}

/** Everything authored against one target, for the codex page. */
export function interactionsOn(target: TargetId): Interaction[] {
  return BY_TARGET.get(target) ?? []
}

/** The one thing `main.ts` calls per held item per focused target. */
export function interactionFor(itemId: string, target: TargetId): Interaction | null {
  return BY_ITEM.get(itemId)?.find((it) => it.target === target) ?? null
}

/** The routes nobody authored. Never empty; the test enforces it. */
export function routesPast(target: TargetId): PropertyRoute[] {
  return OBSTACLES[target].routes
}

/** Whether an item id in this table is one the catalog actually knows. */
export function unknownInteractionItems(): string[] {
  return INTERACTIONS.filter((it) => !CATALOG[it.item]).map((it) => it.item)
}

/** The landing an id names. Total, because `LandingId` is a closed union. */
export function landing(id: LandingId): Landing {
  return LANDINGS[id]
}

/**
 * What a projected item does when it arrives, resolved in one call.
 *
 * Returns null for every item that is not mode 3, so `main.ts` can ask without
 * first switching on the mode.
 */
export function landingOf(itemId: string): Landing | null {
  const def = CATALOG[itemId]
  if (!def) return null
  const use = useOf(def)
  return use.mode === 'projected' ? LANDINGS[use.onLand] : null
}

/** Every item that can be thrown, for the codex and for tests. */
export function projectedItems(): string[] {
  return Object.keys(CATALOG).filter((id) => useOf(CATALOG[id]!).mode === 'projected')
}
