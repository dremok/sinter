/**
 * NPCs, disposition, drives, and dialogue as data.
 *
 * New 2026-07-25 for D19, which reversed the "wordless" half of D7. People talk
 * now. Dialogue is text and is never voiced.
 *
 * This is the half of the palisade example in `docs/DESIGN.md` that was never
 * real. The design has said since the beginning that you can bribe, distract,
 * disguise or frighten a guard, and until now there was nobody standing there.
 *
 * THREE THINGS THIS MODULE IS BUILT AROUND
 *
 * 1. Disposition changes. It is a value in [0,1] that moves during a run, not a
 *    constant. "An NPC who will not help is content, not a failure state" only
 *    means anything if you can move them, and if you can also make them worse.
 *
 * 2. Options gate on PROPERTIES, not only on items. `VALUABLE >= greed` is what
 *    keeps rule 2 alive inside a conversation: any sufficiently valuable thing
 *    bribes, including the one merged into being ten minutes ago, rather than
 *    one authored coin. A threshold may even name a drive, so a guard's greed
 *    IS the price, and a skill that lowers greed lowers the price of every
 *    bribe in the game at once.
 *
 * 3. The world is checkable from inside a conversation, and you can lie about
 *    it. An option may `claim` a world fact. It is offered whether or not the
 *    fact is true, because being able to lie is the point, and if the fact is
 *    false the `caught` outcome runs instead and the NPC thinks less of you.
 *    Nothing in the returned option says which it will be.
 *
 * DEPENDENCIES. This module reads `props/` and `items/` and nothing else. World
 * state arrives as a `Situation` that the caller fills in, so `agents/` never
 * imports `sim/` or `ecs/`, stays testable with no scene and no browser, and
 * cannot quietly start branching on entity internals.
 *
 * There is no RNG here at all. Every function is pure: `choose` returns a new
 * state rather than mutating one, so the same conversation replays identically.
 */

import { CATALOG } from '../items/catalog'
import type { Effect, PropertyRoute } from '../items/interactions'
import { p, type PropertyId } from '../props/registry'

/** What an NPC wants, separately from what they think of you. */
export type DriveId = 'greed' | 'fear' | 'loyalty' | 'curiosity' | 'boredom'

export const DRIVES: DriveId[] = ['greed', 'fear', 'loyalty', 'curiosity', 'boredom']

/**
 * Skills, from A7. Dialogue is their first reader, which is why they are
 * declared here. Move them out the day a skill system exists.
 */
export type SkillId = 'firecraft' | 'haggling' | 'reading' | 'quiet_step' | 'butchery' | 'cold_blood'

/**
 * Facts about the world an option is allowed to test or claim.
 *
 * Deliberately a closed, tiny union. Every entry costs the caller a line to
 * compute, and an option that can test anything at all is an option that can
 * quietly become game logic. If you want a new one, it should be a fact a
 * person standing there could plainly observe.
 */
export type WorldFact = 'something_burning' | 'after_dark' | 'alone'

export const WORLD_FACTS: WorldFact[] = ['something_burning', 'after_dark', 'alone']

/**
 * Run-scope flags, which are the only things a `done` gate may name.
 *
 * The difference between this and `said` is scope. `said` is one person's
 * memory of one conversation and never leaves them. A run flag is something
 * that happened in the run, so a second person can gate on it, which is what
 * lets a thing learnt from Wren be usable at the gate.
 *
 * A closed union for the same reason `WorldFact` is one: every entry is a line
 * the caller has to supply, and a flag vocabulary nobody can list is a quest
 * variable with extra steps. The type makes a typo a compile error, and
 * `npc.test.ts` asserts nothing here is unreachable.
 *
 * Who supplies each:
 *   knows_the_swap   dialogue. Wren sets it; the guard reads it.
 *
 * World-supplied flags go here too when `main.ts` can compute one. There are
 * none yet, and inventing them before anything sets them would be scaffolding.
 */
export const RUN_FLAGS = ['knows_the_swap'] as const

export type RunFlag = (typeof RUN_FLAGS)[number]

/** Flags that dialogue can never set, so the test knows not to look for one. */
export const WORLD_SUPPLIED_FLAGS: readonly RunFlag[] = []

/**
 * Everything outside the NPC that a gate may read, supplied by the caller.
 *
 * `carried` is item ids; properties are read from the catalog definitions. If
 * live entity properties ever need to matter here (a soaked torch is less
 * FLAMMABLE than its definition says) this is the seam to widen.
 */
export interface Situation {
  carried: string[]
  skills: Partial<Record<SkillId, number>>
  facts: Record<WorldFact, boolean>
  /** Things done elsewhere in the run, for `done` gates. */
  done: ReadonlySet<RunFlag>
}

/** A situation with nothing in it. Useful for tests and for a first meeting. */
export function emptySituation(): Situation {
  return {
    carried: [],
    skills: {},
    facts: { something_burning: false, after_dark: false, alone: false },
    done: new Set(),
  }
}

/** A number, or "whatever this NPC's drive currently is". */
export type Threshold = number | { drive: DriveId }

export type Gate =
  /** Carrying one specific thing. Use sparingly; the property gate is better. */
  | { kind: 'item'; item: string; is?: boolean }
  /** Carrying ANYTHING with enough of a property. This is the one that matters. */
  | { kind: 'property'; prop: PropertyId; min: Threshold }
  | { kind: 'skill'; skill: SkillId; min: number }
  /** Something done elsewhere in the run, by anyone, including another NPC. */
  | { kind: 'done'; flag: RunFlag; is?: boolean }
  /** Something already said to THIS person. */
  | { kind: 'said'; line: string; is?: boolean }
  | { kind: 'drive'; drive: DriveId; min?: number; max?: number }
  | { kind: 'disposition'; min?: number; max?: number }
  /** World state, tested openly. To test it dishonestly, use `claim`. */
  | { kind: 'fact'; fact: WorldFact; is?: boolean }

export interface Outcome {
  /** What they say back. One or two lines, in the band's voice. */
  reply: string
  /** Signed change to disposition, clamped into [0,1]. */
  disposition?: number
  /** Signed changes to drives, clamped into [0,1]. */
  drives?: Partial<Record<DriveId, number>>
  /** Remembered, so later options can gate on `said`. */
  remember?: string
  /** Set a run flag, for `done` gates on other people. */
  sets?: RunFlag
  /**
   * Take the item that satisfied this option's item or property gate. For a
   * property gate the CHEAPEST sufficient item goes, not the best one, so
   * working out what will just barely clear the bar is worth doing.
   */
  consumes?: boolean
  /** Where the conversation goes next. 'end' closes it. */
  goto?: string
  /**
   * They stop opposing you. Reuses the effect vocabulary from
   * `items/interactions.ts` on purpose: talking a guard round and handing him a
   * dosed apple both end in `pacify`, so `main.ts` keeps ONE effect switch
   * rather than growing a second one for conversations.
   */
  resolve?: Effect
  /**
   * The reply is computed rather than written, from what the player is
   * carrying. Only Wren uses it, and it is what lets her teach merging by being
   * curious instead of by reciting a recipe list.
   */
  suggest?: true
}

export interface DialogueOption {
  id: string
  /** What the player says. */
  text: string
  /** All must pass for the option to be offered at all. */
  requires?: Gate[]
  /**
   * A fact this option asserts about the world.
   *
   * The option is offered either way. If the fact holds, `then` runs. If it
   * does not, the player has lied, `caught` runs instead, and they wear it.
   * Nothing in the offered option reveals which, because a lie you are warned
   * about is not a lie.
   */
  claim?: WorldFact
  then: Outcome
  /** Required whenever `claim` is set. What happens when the lie does not hold. */
  caught?: Outcome
}

export interface DialogueNode {
  id: string
  /** What they say on arriving here. */
  says: string
  /**
   * Gates on using this as the opening node. The first node whose gates pass
   * becomes the entry, so a soured NPC can open somewhere colder without any
   * of that being code.
   */
  when?: Gate[]
  options: DialogueOption[]
}

/**
 * The kinds of place a region exposes. Must agree with `Place['kind']` in
 * `world/region.ts`, and `npc.test.ts` asserts that it does, at compile time.
 *
 * Declared here rather than imported because the dependency runs one way.
 * `world/` sits on top and pulls in Three.js with it; `agents/` has to stay
 * testable with no scene and no browser. A type-only assertion in the test
 * costs nothing at runtime and still fails the build if the two drift.
 */
export type PlaceKind = 'home' | 'water' | 'work' | 'landmark' | 'exit'

/** As much of a place as an NPC is allowed to know. Note: no coordinate. */
export interface PlaceLike {
  id: string
  kind: PlaceKind
}

export interface NpcDef {
  id: string
  name: string
  /** One line, the way an item has one. Not a biography. */
  blurb: string
  band: 0 | 1 | 2 | 3
  /**
   * The KIND of place this person belongs at. Never a coordinate, and never a
   * region-specific id, because D22 says the region has to stay generable and a
   * person standing at a hardcoded x,z is the first thing generation breaks.
   *
   * "The guard is at the way out" survives a new region. "The guard is at
   * (0, -13.6)" does not.
   */
  stands: PlaceKind
  /**
   * A hint, not a requirement: the place id to take when the region happens to
   * have one. Falls back to any place of the right kind, so a generated region
   * that never heard of the chopping block still gets a Wren.
   */
  prefer?: string
  /** Where they start. [0,1], 0.5 is neutral. */
  disposition: number
  drives: Record<DriveId, number>
  nodes: DialogueNode[]
  /**
   * Ways past this person that involve no conversation at all.
   *
   * Rule 1, and the test enforces it: a guard you can only talk past is a lock
   * with a conversational key, which is the same failure the whole design
   * exists to avoid. Written as property queries so they keep working for items
   * nobody has invented.
   */
  routesPast: PropertyRoute[]
}

export interface NpcState {
  id: string
  disposition: number
  drives: Record<DriveId, number>
  /** Everything said to this person, for `said` gates. */
  said: ReadonlySet<string>
  /** Current node, or null when not mid-conversation. */
  at: string | null
  /** Set once they stop opposing you. */
  resolved: Effect | null
}

/**
 * Whether this person is an obstacle at all, worked out rather than declared.
 *
 * Somebody who has a way of standing aside is somebody who was in the way. A
 * flag saying so would be a second description of the dialogue and would drift
 * from it; this cannot. `main.ts` wants it for placement (a blocker stands in
 * the gap, everyone else stands beside it) and the test wants it to decide who
 * rule 1 applies to.
 */
export function blocks(def: NpcDef): boolean {
  return def.nodes.some((n) => n.options.some((o) => o.then.resolve || o.caught?.resolve))
}

/** Where one person stands, expressed without a single world coordinate. */
export interface Posting<P extends PlaceLike> {
  def: NpcDef
  /** The caller's own place object, handed back with whatever it carries. */
  place: P
  /**
   * Where to stand relative to that place, in metres.
   *
   * This is a formation, not a position: it exists so two people at one gate do
   * not stand inside each other. Whoever is at a place first, blockers before
   * anyone else, gets (0,0) and therefore the spot itself. The rest ring around
   * them. The caller adds this to the place and then has to do the one thing
   * only it can do, which is put the result on walkable ground: `agents/` does
   * not know where the hearth fire is and must not learn.
   */
  offset: { dx: number; dz: number }
}

/** Metres from a place to the people who did not get to stand on it. */
const RING = 1.6

/**
 * Who stands where, given whatever places a region happens to expose.
 *
 * Generic over the place type so `main.ts` can pass `region.places` straight in
 * and get its own objects back with `at` still on them. That is the whole trick
 * that keeps this module free of Three.js.
 *
 * Deterministic with no RNG: candidates are sorted by id, and NPCs wanting the
 * same kind are dealt round robin across the places of it, so four `work`
 * places do not end up with four people on one of them. An NPC whose kind the
 * region does not have is left out rather than dumped at the origin; ask
 * `unplaced` if you care, and a generator should.
 */
export function postings<P extends PlaceLike>(
  cast: readonly NpcDef[],
  places: readonly P[],
): Posting<P>[] {
  const dealt = new Map<PlaceKind, number>()
  const taken: { def: NpcDef; place: P }[] = []

  for (const def of cast) {
    const candidates = places.filter((pl) => pl.kind === def.stands).sort((a, b) => a.id.localeCompare(b.id))
    if (candidates.length === 0) continue

    const preferred = def.prefer ? candidates.find((pl) => pl.id === def.prefer) : undefined
    const n = dealt.get(def.stands) ?? 0
    dealt.set(def.stands, n + 1)
    taken.push({ def, place: preferred ?? candidates[n % candidates.length]! })
  }

  const out: Posting<P>[] = []
  for (const place of places) {
    // Blockers first, so the person in the way gets the spot itself.
    const here = taken.filter((t) => t.place.id === place.id)
    const ordered = [...here.filter((t) => blocks(t.def)), ...here.filter((t) => !blocks(t.def))]

    ordered.forEach((t, i) => {
      const a = i === 0 ? 0 : (2 * Math.PI * (i - 1)) / Math.max(1, ordered.length - 1)
      out.push({
        def: t.def,
        place: t.place,
        offset:
          i === 0
            ? { dx: 0, dz: 0 }
            : {
                dx: Math.round(RING * Math.cos(a) * 1000) / 1000,
                dz: Math.round(RING * Math.sin(a) * 1000) / 1000,
              },
      })
    })
  }
  return out
}

/** Everyone the region had nowhere to put. Should be empty; a generator should check. */
export function unplaced<P extends PlaceLike>(cast: readonly NpcDef[], places: readonly P[]): NpcDef[] {
  const kinds = new Set(places.map((pl) => pl.kind))
  return cast.filter((def) => !kinds.has(def.stands))
}

export function initialState(def: NpcDef): NpcState {
  return {
    id: def.id,
    disposition: def.disposition,
    drives: { ...def.drives },
    said: new Set(),
    at: null,
    resolved: null,
  }
}

/**
 * Walk away mid-sentence. Returns a NEW state, like everything else here.
 *
 * The conversation forgets where it was; the person does not forget anything.
 * Disposition, drives and everything you have said all stand. This exists so
 * `main.ts` never has to reach in and set `at` by hand, and because re-entering
 * is more correct than resuming: entry gates are read on the way in, so a guard
 * you soured two minutes ago opens cold rather than picking up where he was.
 */
export function leave(state: NpcState): NpcState {
  return { ...state, at: null }
}

/**
 * Clamp into [0,1] and round to three places.
 *
 * The rounding is not cosmetic. Boredom starting at 0.8 and rising by 0.07
 * twice gives 0.9400000000000001, which is greater than 0.94, so an option
 * gated `max: 0.94` silently vanished and the patient route through the guard
 * dead ended. Drift like that accumulates over a long conversation and is
 * exactly the kind of thing that makes a state comparison unreliable. Same
 * treatment `prune` gives properties in `props/registry.ts`.
 */
function scalar(v: number): number {
  const clamped = v < 0 ? 0 : v > 1 ? 1 : v
  return Math.round(clamped * 1000) / 1000
}

/** Strongest value of a property across everything carried. */
export function bestCarried(sit: Situation, prop: PropertyId): number {
  let best = 0
  for (const id of sit.carried) {
    const def = CATALOG[id]
    if (def) best = Math.max(best, p(def.props, prop))
  }
  return best
}

function resolveThreshold(min: Threshold, state: NpcState): number {
  return typeof min === 'number' ? min : state.drives[min.drive]
}

/**
 * The cheapest carried item that still clears the bar, or undefined.
 *
 * Cheapest rather than best, deliberately. Bribing should cost you the least
 * thing that will do, and finding that thing is a decision worth making. Ties
 * break on id so the choice is identical in every run.
 */
function cheapestSufficient(sit: Situation, prop: PropertyId, min: number): string | undefined {
  return sit.carried
    .filter((id) => CATALOG[id] && p(CATALOG[id]!.props, prop) >= min)
    .sort((a, b) => p(CATALOG[a]!.props, prop) - p(CATALOG[b]!.props, prop) || a.localeCompare(b))[0]
}

export function gatePasses(gate: Gate, state: NpcState, sit: Situation): boolean {
  switch (gate.kind) {
    case 'item':
      return sit.carried.includes(gate.item) === (gate.is ?? true)
    case 'property':
      return bestCarried(sit, gate.prop) >= resolveThreshold(gate.min, state)
    case 'skill':
      return (sit.skills[gate.skill] ?? 0) >= gate.min
    case 'done':
      return sit.done.has(gate.flag) === (gate.is ?? true)
    case 'said':
      return state.said.has(gate.line) === (gate.is ?? true)
    case 'drive': {
      const v = state.drives[gate.drive]
      return v >= (gate.min ?? 0) && v <= (gate.max ?? 1)
    }
    case 'disposition':
      return state.disposition >= (gate.min ?? 0) && state.disposition <= (gate.max ?? 1)
    case 'fact':
      return sit.facts[gate.fact] === (gate.is ?? true)
  }
}

function allPass(gates: Gate[] | undefined, state: NpcState, sit: Situation): boolean {
  return (gates ?? []).every((g) => gatePasses(g, state, sit))
}

/** The node a conversation opens at: the first whose `when` gates pass. */
export function entryNode(def: NpcDef, state: NpcState, sit: Situation): DialogueNode {
  const hit = def.nodes.find((n) => allPass(n.when, state, sit))
  if (!hit) throw new Error(`${def.id} has no reachable entry node`)
  return hit
}

function nodeById(def: NpcDef, id: string): DialogueNode {
  const hit = def.nodes.find((n) => n.id === id)
  if (!hit) throw new Error(`${def.id} has no node "${id}"`)
  return hit
}

/** One option as the UI should render it. Says nothing about what it will do. */
export interface OfferedOption {
  id: string
  text: string
}

export interface Exchange {
  node: string
  /** What they are saying right now. */
  says: string
  options: OfferedOption[]
}

/**
 * What this person is saying, and what you may say back.
 *
 * Note what is NOT returned: whether an option is a lie, what it will cost, and
 * whether it will work. A player who is told which option is the lie is not
 * lying, they are picking the lie button.
 */
export function talk(def: NpcDef, state: NpcState, sit: Situation): Exchange {
  const node = state.at === null ? entryNode(def, state, sit) : nodeById(def, state.at)
  return {
    node: node.id,
    says: node.says,
    options: node.options
      .filter((o) => allPass(o.requires, state, sit))
      .map((o) => ({ id: o.id, text: o.text })),
  }
}

export interface Said {
  state: NpcState
  /** What they said back. Already resolved, including computed replies. */
  reply: string
  /** True when the option claimed something that was not so. */
  lied: boolean
  /** Item id taken, if the outcome consumed one. */
  consumed?: string
  /** Set when they stop opposing you. Same vocabulary as an interaction. */
  effect?: Effect
  /** A run flag to record, for `done` gates elsewhere. */
  sets?: RunFlag
  /** True when the conversation is over. */
  ended: boolean
}

/**
 * Say one thing. Returns a NEW state; nothing is mutated.
 *
 * `suggestReply` is injected rather than imported so this module stays free of
 * the recipe book. `cast.ts` supplies the real one.
 */
export function choose(
  def: NpcDef,
  state: NpcState,
  sit: Situation,
  optionId: string,
  suggestReply?: (sit: Situation) => string,
): Said {
  const node = state.at === null ? entryNode(def, state, sit) : nodeById(def, state.at)
  const option = node.options.find((o) => o.id === optionId)
  if (!option) throw new Error(`${def.id}/${node.id} has no option "${optionId}"`)
  if (!allPass(option.requires, state, sit)) {
    throw new Error(`${def.id}/${node.id}/${optionId} was chosen but its gates do not pass`)
  }

  // The lie. An option claiming a fact runs `then` only if the fact holds.
  const lied = option.claim !== undefined && !sit.facts[option.claim]
  const outcome = lied ? option.caught! : option.then

  const drives = { ...state.drives }
  for (const [id, delta] of Object.entries(outcome.drives ?? {})) {
    drives[id as DriveId] = scalar(drives[id as DriveId] + delta)
  }

  const said = new Set(state.said)
  if (outcome.remember) said.add(outcome.remember)

  let consumed: string | undefined
  if (outcome.consumes) {
    const gate = (option.requires ?? []).find((g) => g.kind === 'item' || g.kind === 'property')
    if (gate?.kind === 'item') consumed = gate.item
    else if (gate?.kind === 'property') {
      consumed = cheapestSufficient(sit, gate.prop, resolveThreshold(gate.min, state))
    }
  }

  const ended = outcome.goto === 'end' || outcome.resolve !== undefined
  const moved: NpcState = {
    ...state,
    disposition: scalar(state.disposition + (outcome.disposition ?? 0)),
    drives,
    said,
    at: null,
    resolved: outcome.resolve ?? state.resolved,
  }

  /**
   * A gated node is a MOOD, not a place, so it takes precedence over wherever
   * the option was pointing and it applies immediately.
   *
   * Without this, souring only happened when a conversation reopened, because
   * entry gates were read once on the way in. You could stand there and tell
   * the same guard the same lie five times running and he would keep answering
   * as though nothing had happened, which is the opposite of disposition being
   * a value that changes during a run.
   */
  const mood = def.nodes.find((n) => n.when !== undefined && allPass(n.when, moved, sit))
  const next: NpcState = {
    ...moved,
    at: ended ? null : (mood?.id ?? outcome.goto ?? node.id),
  }

  const reply = outcome.suggest && suggestReply ? suggestReply(sit) : outcome.reply

  return {
    state: next,
    reply,
    lied,
    ...(consumed !== undefined ? { consumed } : {}),
    ...(outcome.resolve !== undefined ? { effect: outcome.resolve } : {}),
    ...(outcome.sets !== undefined ? { sets: outcome.sets } : {}),
    ended,
  }
}
