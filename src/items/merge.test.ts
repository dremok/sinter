import { describe, it, expect } from 'vitest'
import { CATALOG, STARTING_ITEMS } from './catalog'
import { merge, mergeId } from './merge'
import { p } from '../props/registry'

/**
 * The merge guarantees are load bearing for the whole catalog. If they fail the
 * same pair starts producing different items for different players, or a pair
 * produces nothing, and the mechanic is gone. Do not "fix" a failure here by
 * relaxing the assertion.
 */

const ids = Object.keys(CATALOG)

describe('merge guarantees', () => {
  it('always yields, for every pair', () => {
    for (const a of ids) {
      for (const b of ids) {
        const out = merge(a, b)
        expect(out.name.length).toBeGreaterThan(0)
        expect(out.parts.length).toBeGreaterThan(0)
      }
    }
  })

  it('is commutative in id, name, properties and parts', () => {
    for (const a of ids) {
      for (const b of ids) {
        const ab = merge(a, b)
        const ba = merge(b, a)
        expect(ab.id).toEqual(ba.id)
        expect(ab.name).toEqual(ba.name)
        expect(ab.props).toEqual(ba.props)
        expect(ab.parts).toEqual(ba.parts)
      }
    }
  })

  it('is deterministic across repeated calls', () => {
    const first = ids.map((a) => ids.map((b) => merge(a, b).name))
    const second = ids.map((a) => ids.map((b) => merge(a, b).name))
    expect(first).toEqual(second)
  })

  /**
   * The one that matters most for how merging FEELS. Playtest feedback was that
   * lots of different combinations produced what looked like the same item,
   * because the namer drew from a small pool. Distinct pairs must be distinctly
   * named or the player cannot tell that anything happened.
   */
  it('gives every distinct pair a distinct name', () => {
    const byName = new Map<string, string>()
    for (let i = 0; i < ids.length; i++) {
      for (let j = i; j < ids.length; j++) {
        const a = ids[i]!
        const b = ids[j]!
        if (a === b) continue
        const out = merge(a, b)
        const clash = byName.get(out.name)
        expect(clash, `"${out.name}" produced by both ${clash} and ${mergeId(a, b)}`).toBeUndefined()
        byName.set(out.name, mergeId(a, b))
      }
    }
    // Sanity: we actually checked the whole triangle.
    expect(byName.size).toBe((ids.length * (ids.length - 1)) / 2)
  })

  it('keeps every property inside [0,1]', () => {
    for (const a of ids) {
      for (const b of ids) {
        for (const [key, v] of Object.entries(merge(a, b).props)) {
          expect(v, `${a}+${b} ${key}`).toBeGreaterThanOrEqual(0)
          expect(v, `${a}+${b} ${key}`).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('mergeId is order independent', () => {
    expect(mergeId('flint', 'torch')).toEqual(mergeId('torch', 'flint'))
  })
})

describe('derivation rules produce sensible physics', () => {
  it('metal on stone throws a spark hot enough to light something', () => {
    // Fire from scratch, using only properties. No item is flagged a firestarter.
    const striker = merge('flint', 'horseshoe')
    expect(p(striker.props, 'HOT')).toBeGreaterThan(0.35)
  })

  it('water puts fire out', () => {
    const quenched = merge('bucket', 'torch')
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

  it('materials dilute rather than stacking to 1', () => {
    expect(p(merge('plank', 'flint').props, 'WOODEN')).toBeLessThan(p(CATALOG.plank!.props, 'WOODEN'))
  })
})

describe('catalog integrity', () => {
  it('every starting item exists', () => {
    for (const id of STARTING_ITEMS) expect(CATALOG[id], id).toBeDefined()
  })

  it('every item has properties, parts, and naming words', () => {
    for (const id of STARTING_ITEMS) {
      const d = CATALOG[id]!
      expect(Object.keys(d.props).length, id).toBeGreaterThan(0)
      expect(d.parts.length, id).toBeGreaterThan(0)
      expect(d.epithet.length, id).toBeGreaterThan(0)
      expect(d.noun.length, id).toBeGreaterThan(0)
    }
  })

  it('epithets and nouns are unique, which is what makes names unique', () => {
    const epithets = new Set(STARTING_ITEMS.map((id) => CATALOG[id]!.epithet))
    const nouns = new Set(STARTING_ITEMS.map((id) => CATALOG[id]!.noun))
    expect(epithets.size).toBe(STARTING_ITEMS.length)
    expect(nouns.size).toBe(STARTING_ITEMS.length)
  })

  it('no description reads like LLM output', () => {
    const banned = /\b(delve|leverage|comprehensive|streamline|myriad|tapestry|testament)\b|—/i
    for (const id of STARTING_ITEMS) {
      expect(CATALOG[id]!.desc, id).not.toMatch(banned)
    }
  })

  it('the starting ten can solve the palisade more than one way', () => {
    // Not a hardcoded solution list: these ask whether the PROPERTIES exist.
    const canChop = STARTING_ITEMS.some((id) => p(CATALOG[id]!.props, 'TOOL_CUTTING') >= 0.45)
    const canWet = STARTING_ITEMS.some((id) => p(CATALOG[id]!.props, 'WATER') >= 0.5)
    const canBurn = p(merge('flint', 'horseshoe').props, 'HOT') >= 0.35
    const canClimb = p(merge('plank', 'rope').props, 'LADDER_LIKE') >= 0.45

    expect({ canChop, canBurn, canClimb, canWet }).toEqual({
      canChop: true,
      canBurn: true,
      canClimb: true,
      canWet: true,
    })
  })
})
