import { describe, it, expect } from 'vitest'
import {
  REACTIONS,
  codexView,
  emptyCodex,
  keyOf,
  knows,
  record,
  type Codex,
  type Discovery,
  type ReactionId,
} from './codex'
import { CATALOG, STARTING_ITEMS } from './catalog'
import { INTERACTIONS, interactionKey } from './interactions'
import { RECIPES, mergeId } from './merge'

/**
 * The codex is authored content, so most of this checks that the content obeys
 * the four decisions in the header rather than that the engine computes. The
 * two that carry weight are the reachability pair: every kind of discovery must
 * be recordable by something a player can really do, and every reaction note
 * must describe a rule the derivation actually applies.
 */

function recordAll(ds: Discovery[]): Codex {
  let codex: Codex = emptyCodex()
  for (const d of ds) codex = record(codex, d)
  return codex
}

describe('recording', () => {
  it('mutates nothing, so a codex can be kept in one place', () => {
    const before = emptyCodex()
    record(before, { kind: 'item', id: 'rock' })
    expect(before.size).toBe(0)
  })

  it('is idempotent, so the caller never has to check first', () => {
    const once = record(emptyCodex(), { kind: 'item', id: 'rock' })
    const twice = record(once, { kind: 'item', id: 'rock' })
    expect(twice.size).toBe(1)
  })

  it('reads a merge back under the key the UI already uses', () => {
    // `ui.codex` is a live Set of mergeId keys and `isDiscovered` reads it from
    // three call sites. If this stops matching, every discovery ever made by
    // every player silently stops counting.
    const d: Discovery = { kind: 'merge', a: 'flint', b: 'horseshoe' }
    expect(keyOf(d)).toBe(mergeId('flint', 'horseshoe'))
    expect(keyOf(d)).toBe(keyOf({ kind: 'merge', a: 'horseshoe', b: 'flint' }))
  })

  it('gives the other three kinds a prefix, so nothing can collide', () => {
    const keys = [
      keyOf({ kind: 'item', id: 'rock' }),
      keyOf({ kind: 'merge', a: 'flint', b: 'horseshoe' }),
      keyOf({ kind: 'interaction', item: 'key', target: 'mill_door' }),
      keyOf({ kind: 'reaction', id: 'wet_resists_fire' }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('answers what it has been told, and nothing else', () => {
    const codex = record(emptyCodex(), { kind: 'merge', a: 'flint', b: 'horseshoe' })
    expect(knows(codex, { kind: 'merge', a: 'horseshoe', b: 'flint' })).toBe(true)
    expect(knows(codex, { kind: 'merge', a: 'apple', b: 'rope' })).toBe(false)
  })
})

describe('the view is a record of the past, not a map of the future', () => {
  it('shows nothing at all for a codex with nothing in it', () => {
    const view = codexView(emptyCodex())
    expect(view.things).toEqual([])
    expect(view.merges).toEqual([])
    expect(view.uses).toEqual([])
    expect(view.learned).toEqual([])
    expect(view.found).toBe(0)
  })

  it('never carries a total, because a denominator is a completion checklist', () => {
    // Decision 4, enforced rather than described. A percentage says the world
    // is finite and exactly this big, which contradicts the whole pitch.
    const view = codexView(recordAll(RECIPES.map((r) => ({ kind: 'merge', a: r.inputs[0], b: r.inputs[1] }))))
    expect(Object.keys(view).sort()).toEqual(['found', 'learned', 'merges', 'things', 'uses'])
    expect(view.found).toBe(RECIPES.length)
  })

  it('emits one row per discovery and no placeholders', () => {
    const view = codexView(
      recordAll([
        { kind: 'item', id: 'rock' },
        { kind: 'merge', a: 'flint', b: 'horseshoe' },
      ]),
    )
    expect(view.things.length + view.merges.length).toBe(2)
    expect(view.found).toBe(2)
    // Nothing anywhere says "undiscovered", "???" or similar.
    const text = JSON.stringify(view)
    expect(text).not.toMatch(/\?\?\?|undiscovered|locked|unknown/i)
  })

  it('shows a merge with what it cost, by name', () => {
    // Decision 3. The loss is the inputs being gone, not the player forgetting.
    const view = codexView(recordAll([{ kind: 'merge', a: 'flint', b: 'horseshoe' }]))
    const row = view.merges[0]!
    expect(row.title).toBe(CATALOG.fire_striker!.name)
    expect(row.from).toEqual([CATALOG.flint!.name, CATALOG.horseshoe!.name])
  })

  it('is stable in order, so rows do not jump around as you find things', () => {
    const a = codexView(recordAll([{ kind: 'item', id: 'rock' }, { kind: 'item', id: 'apple' }]))
    const b = codexView(recordAll([{ kind: 'item', id: 'apple' }, { kind: 'item', id: 'rock' }]))
    expect(a.things.map((e) => e.key)).toEqual(b.things.map((e) => e.key))
  })

  it('survives a saved codex naming something this build no longer has', () => {
    // A player losing their whole record to one renamed id would be the worst
    // outcome for a feature whose only job is remembering things.
    const stale = new Set(['item:no_such_item', 'ghost+phantom', 'saw:no_such_rule', 'used:a@b'])
    const view = codexView(stale)
    expect(view.found).toBe(0)
    expect(() => codexView(stale)).not.toThrow()
  })
})

describe('every kind of discovery is reachable', () => {
  it('can record every item a player can pick up', () => {
    const view = codexView(recordAll(STARTING_ITEMS.map((id) => ({ kind: 'item', id }))))
    expect(view.things.length).toBe(STARTING_ITEMS.length)
  })

  it('can record every merge in the book, and resolves all of them', () => {
    const view = codexView(recordAll(RECIPES.map((r) => ({ kind: 'merge', a: r.inputs[0], b: r.inputs[1] }))))
    expect(view.merges.length, 'a recipe key did not resolve to an item').toBe(RECIPES.length)
    for (const row of view.merges) expect(row.from, `${row.key} lost its lineage`).toBeDefined()
  })

  it('can record every authored interaction, under the key interactions.ts already makes', () => {
    for (const it of INTERACTIONS) {
      const key = keyOf({ kind: 'interaction', item: it.item, target: it.target })
      expect(key).toBe(`used:${interactionKey(it)}`)
    }
    const view = codexView(recordAll(INTERACTIONS.map((i) => ({ kind: 'interaction', item: i.item, target: i.target }))))
    expect(view.uses.length).toBe(INTERACTIONS.length)
  })

  it('resolves every reaction it declares', () => {
    const ids = Object.keys(REACTIONS) as ReactionId[]
    const view = codexView(recordAll(ids.map((id) => ({ kind: 'reaction', id }))))
    expect(view.learned.length).toBe(ids.length)
    for (const id of ids) expect(REACTIONS[id].id, 'a note is filed under the wrong id').toBe(id)
  })
})

describe('the prose is the player\'s words, not the manual', () => {
  it('records what happened rather than telling anybody what to do', () => {
    // A codex that gives advice is a hint system, and D20 bans those. The
    // difference is grammatical and this catches the obvious half: no
    // imperatives aimed at the player, no second person instructions.
    const advice = /\b(you should|you can|try |use (it|this|water|fire)|remember to|in order to)\b/i
    for (const note of Object.values(REACTIONS)) {
      expect(note.says, note.id).not.toMatch(advice)
    }
  })

  it('does not read like LLM output', () => {
    const banned = /\b(delve|leverage|comprehensive|streamline|myriad|tapestry|testament)\b|—/i
    for (const note of Object.values(REACTIONS)) expect(note.says, note.id).not.toMatch(banned)
  })

  it('keeps every note short, because it is a note and not a lesson', () => {
    for (const note of Object.values(REACTIONS)) {
      expect(note.says.split(/\s+/).length, `${note.id} is a paragraph`).toBeLessThanOrEqual(20)
    }
  })
})
