/**
 * The codex: what this player has found out.
 *
 * New 2026-07-26. This is the fourth thing D17 promises and the only one that
 * did not exist. Its argument for authored content being a declared table is
 * that a table can be listed, counted, tested for reachability AND SHOWN TO THE
 * PLAYER. The first three have been used hard this week. This is the fourth.
 *
 * WHY IT BEARS ON MERGING FEELING LIKE ADMIN
 *
 * Rule 3 makes the loss real and D18 makes refusing free, so between them the
 * game asks the player to experiment. Until now it gave them nowhere to put
 * what they learned, which left them keeping a recipe book in their head. That
 * is bookkeeping, and bookkeeping is the literal thing "it feels like admin"
 * describes. A record you can look at is the difference between experimenting
 * and re-deriving.
 *
 * ---------------------------------------------------------------------------
 * FOUR DECISIONS, MADE HERE RATHER THAN LEFT TO THE UI
 *
 * 1. A DISCOVERY IS SOMETHING YOU DID THAT YOU COULD NOT HAVE KNOWN IN ADVANCE.
 *    Four kinds, and they are deliberately not equal. Holding a rock is barely
 *    a discovery, and it is recorded only so the other three have something to
 *    refer to. A merge, an authored use, and a REACTION are the real ones.
 *
 *    The fourth kind is the ambitious one and it is the reason this file is
 *    worth writing. "Wet things resist fire" is a rule the player can only
 *    learn by seeing it, and it is not written down anywhere in the game. A
 *    codex that records the physics you have personally witnessed teaches the
 *    simulation without a tutorial and without a word of instruction, which is
 *    the only way to teach it that D20 permits.
 *
 * 2. NOTHING IS SHOWN FOR WHAT YOU HAVE NOT FOUND. No silhouettes, no locked
 *    rows, no greyed entries, no "???".
 *
 *    This is the line and it is worth being precise about where it sits. A
 *    silhouette says "there is a thing here and you have not got it", which is
 *    an instruction to go and get it, which is a quest marker wearing a
 *    costume. An empty space says nothing. The codex is a RECORD OF THE PAST,
 *    not a map of the future, and every locked row would turn it into the
 *    second thing.
 *
 * 3. THE RECIPE IS SHOWN ONCE YOU HAVE MADE IT. The loss in rule 3 is the
 *    inputs being gone forever, not the player forgetting how. Making somebody
 *    re-derive something they already did is not tension, it is homework, and
 *    it is exactly the admin this is meant to cure.
 *
 * 4. THERE IS NO DENOMINATOR. `CodexView` has a `found` count and deliberately
 *    NO total, and `codexView()` cannot compute one because it is never given
 *    the recipe book.
 *
 *    Two reasons, and the second is the one that matters. "23 of 64" turns a
 *    game about wandering into a completion checklist, and this game is not
 *    about completion. Worse, a denominator states that the world is finite and
 *    exactly this big, which contradicts the entire pitch: the further you go
 *    the stranger it gets, and a total says it gets stranger 41 more times and
 *    then stops. Do not add one. If somebody asks for a percentage, that is the
 *    request to refuse.
 *
 * ---------------------------------------------------------------------------
 * KEYS ARE COMPATIBLE WITH THE SET THE UI ALREADY HAS
 *
 * `ui.codex` is already a live `Set<string>` of `mergeId(a, b)` keys, and
 * `merge.ts` already exports `isDiscovered` against it from three call sites.
 * So merge keys here are UNPREFIXED and identical to `mergeId`, and the other
 * three kinds carry a prefix. The asymmetry is deliberate: it means the
 * existing set is already a valid codex and nothing has to be migrated, and it
 * cannot collide, because no item id contains a colon.
 *
 * This module is pure and holds no state. `record` returns a new set. Nothing
 * here imports `sim/` or `ecs/`, so the codex stays testable with no scene.
 */

import { CATALOG, type ItemDef } from './catalog'
import { INTERACTIONS, interactionKey, type TargetId } from './interactions'
import { mergeId, recipeFor } from './merge'

/**
 * A rule of the world the player can witness happening.
 *
 * Declared here as a table for the same reason `INTERACTIONS` is one: this is
 * authored prose about a mechanic, it needs to be listable and testable, and
 * scattering it as strings inside `sim/` would put player-facing text in the
 * simulation. The rules themselves live in `props/derive.ts`; these are the
 * player's words for them, which is not the same thing and should not be.
 */
export type ReactionId =
  | 'wet_resists_fire'
  | 'water_kills_heat'
  | 'water_thins_poison'
  | 'iron_on_stone_sparks'
  | 'glass_will_not_hold'
  | 'an_edge_needs_a_haft'

export interface ReactionNote {
  id: ReactionId
  /** What the player saw. Written as an observation, never as advice. */
  says: string
}

/**
 * Six, and every one of them is a rule `props/derive.ts` actually applies.
 *
 * Written as things that happened rather than as instructions. "Water put it
 * out" is a record. "Use water to put out fires" is a manual, and a manual for
 * a simulation nobody has to read is how you end up with a game that explains
 * itself instead of being explored.
 */
export const REACTIONS: Record<ReactionId, ReactionNote> = {
  wet_resists_fire: {
    id: 'wet_resists_fire',
    says: 'Soaked through, it would not take. Water buys you a while.',
  },
  water_kills_heat: {
    id: 'water_kills_heat',
    says: 'Into the water and out again, black and finished.',
  },
  water_thins_poison: {
    id: 'water_thins_poison',
    says: 'Rinsed off, and most of the harm went with it. A pailful is another matter.',
  },
  iron_on_stone_sparks: {
    id: 'iron_on_stone_sparks',
    says: 'Iron on a hard stone throws a spark. Any iron, any hard stone.',
  },
  glass_will_not_hold: {
    id: 'glass_will_not_hold',
    says: 'It went under the weight. Anything mostly glass will.',
  },
  an_edge_needs_a_haft: {
    id: 'an_edge_needs_a_haft',
    says: 'An edge with something to drive it cuts. On its own it is a stone.',
  },
}

export type Discovery =
  /** First time this item was in the pack. The weakest kind, and the index. */
  | { kind: 'item'; id: string }
  /** A merge actually performed. Both inputs were destroyed for this. */
  | { kind: 'merge'; a: string; b: string }
  /** An authored interaction that fired. */
  | { kind: 'interaction'; item: string; target: TargetId }
  /** A rule of the world, witnessed. */
  | { kind: 'reaction'; id: ReactionId }

export type Codex = ReadonlySet<string>

export function emptyCodex(): Set<string> {
  return new Set<string>()
}

/** The stable key for one discovery. Merges are unprefixed; see the header. */
export function keyOf(d: Discovery): string {
  switch (d.kind) {
    case 'item':
      return `item:${d.id}`
    case 'merge':
      return mergeId(d.a, d.b)
    case 'interaction':
      return `used:${d.item}@${d.target}`
    case 'reaction':
      return `saw:${d.id}`
  }
}

export function knows(codex: Codex, d: Discovery): boolean {
  return codex.has(keyOf(d))
}

/**
 * Write one discovery down. Returns a NEW set; nothing is mutated.
 *
 * Safe to call on every pickup and every merge. Recording something twice is a
 * no-op, so the caller never has to check first.
 */
export function record(codex: Codex, d: Discovery): Set<string> {
  const next = new Set(codex)
  next.add(keyOf(d))
  return next
}

/** One row, already resolved into the words the panel should print. */
export interface CodexEntry {
  key: string
  title: string
  /** One line under the title. Prose, never a stat block. */
  line: string
  /**
   * For a merge, the two things it cost, by name. Absent for everything else.
   * The panel should show these: the whole point of recording a merge is that
   * the inputs are gone.
   */
  from?: [string, string]
}

/**
 * Everything the player has found, resolved and grouped, ready to render.
 *
 * NOTE WHAT IS NOT HERE: any count of what is missing, any total, any locked or
 * placeholder row. See decisions 2 and 4 in the header. `found` is the size of
 * the player's own history and is the only number this type will ever carry.
 */
export interface CodexView {
  things: CodexEntry[]
  merges: CodexEntry[]
  uses: CodexEntry[]
  learned: CodexEntry[]
  found: number
}

function itemEntry(key: string, def: ItemDef): CodexEntry {
  return { key, title: def.name, line: def.desc }
}

/**
 * Resolve a codex into rows.
 *
 * Unknown keys are skipped rather than thrown on, because a saved codex from an
 * older build may name an item that no longer exists, and a player losing their
 * whole record to one renamed id would be the worst possible outcome for a
 * feature whose entire job is remembering things.
 */
export function codexView(codex: Codex): CodexView {
  const view: CodexView = { things: [], merges: [], uses: [], learned: [], found: 0 }

  for (const key of [...codex].sort()) {
    if (key.startsWith('item:')) {
      const def = CATALOG[key.slice(5)]
      if (def) view.things.push(itemEntry(key, def))
      continue
    }

    if (key.startsWith('used:')) {
      const it = INTERACTIONS.find((i) => interactionKey(i) === key.slice(5))
      if (it) view.uses.push({ key, title: it.verb, line: it.says })
      continue
    }

    if (key.startsWith('saw:')) {
      const note = REACTIONS[key.slice(4) as ReactionId]
      if (note) view.learned.push({ key, title: 'You noticed', line: note.says })
      continue
    }

    // Unprefixed: a merge pair key, in `mergeId` form.
    const [a, b] = key.split('+')
    if (!a || !b) continue
    const recipe = recipeFor(a, b)
    const made = recipe ? CATALOG[recipe.id] : undefined
    if (!made) continue
    view.merges.push({
      key,
      title: made.name,
      line: made.desc,
      from: [CATALOG[a]?.name ?? a, CATALOG[b]?.name ?? b],
    })
  }

  view.found = view.things.length + view.merges.length + view.uses.length + view.learned.length
  return view
}
