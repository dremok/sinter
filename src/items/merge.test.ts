import { describe, it, expect } from 'vitest'
import { CATALOG, SCATTER_POOL } from './catalog'
import { merge, mergeId } from './merge'
import { p } from '../props/registry'

/**
 * The three merge guarantees from docs/DESIGN.md are load bearing for the whole
 * catalog. If these fail, the same pair starts producing different items for
 * different players, or a pair produces nothing at all, and the mechanic is
 * gone. Do not "fix" a failure here by relaxing the assertion.
 */

const ids = Object.keys(CATALOG)

describe('merge guarantees', () => {
  it('always yields, for every pair in the hand-authored catalog', () => {
    for (const a of ids) {
      for (const b of ids) {
        const out = merge(a, b)
        expect(out.name.length).toBeGreaterThan(0)
        expect(out.parts.length).toBeGreaterThan(0)
      }
    }
  })

  it('is commutative in id, name, and properties', () => {
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
    expect(mergeId('branch', 'flint')).toEqual(mergeId('flint', 'branch'))
  })
})

describe('derivation rules produce sensible physics', () => {
  it('an edge plus a haft cuts better than either parent', () => {
    const axe = merge('branch', 'flint')
    expect(p(axe.props, 'TOOL_CUTTING')).toBeGreaterThan(p(CATALOG.flint!.props, 'TOOL_CUTTING'))
    expect(p(axe.props, 'TOOL_CUTTING')).toBeGreaterThan(0.3)
  })

  it('water puts fire out', () => {
    const quenched = merge('bucket', 'ember')
    expect(p(quenched.props, 'HOT')).toBeLessThan(0.2)
  })

  it('soaking something flammable makes it resist fire', () => {
    const dry = p(CATALOG.straw!.props, 'FLAMMABLE')
    const soaked = merge('straw', 'bucket')
    expect(p(soaked.props, 'FLAMMABLE')).toBeLessThan(dry * 0.5)
  })

  it('oil makes things more flammable, not less', () => {
    const oiled = merge('rag', 'oil')
    expect(p(oiled.props, 'FLAMMABLE')).toBeGreaterThanOrEqual(p(CATALOG.rag!.props, 'FLAMMABLE'))
  })

  it('metal on stone throws a spark hot enough to light something', () => {
    // The point of this one is that fire can be made from scratch, using only
    // properties. No item is flagged as a firestarter anywhere.
    const striker = merge('flint', 'nail')
    expect(p(striker.props, 'HOT')).toBeGreaterThan(0.35)
  })

  it('rope plus a rigid span becomes climbable', () => {
    const ladder = merge('plank', 'rope')
    expect(p(ladder.props, 'LADDER_LIKE')).toBeGreaterThan(0.5)
  })

  it('materials dilute rather than stacking to 1', () => {
    const both = merge('plank', 'flint')
    expect(p(both.props, 'WOODEN')).toBeLessThan(p(CATALOG.plank!.props, 'WOODEN'))
  })
})

describe('catalog integrity', () => {
  it('every scattered item exists in the catalog', () => {
    for (const id of SCATTER_POOL) expect(CATALOG[id], id).toBeDefined()
  })

  it('every hand-authored item has at least one property and one part', () => {
    for (const id of SCATTER_POOL) {
      const d = CATALOG[id]!
      expect(Object.keys(d.props).length, id).toBeGreaterThan(0)
      expect(d.parts.length, id).toBeGreaterThan(0)
    }
  })

  it('no description reads like LLM output', () => {
    const banned = /\b(delve|leverage|comprehensive|streamline|myriad|tapestry|testament)\b|—/i
    for (const id of SCATTER_POOL) {
      const d = CATALOG[id]!
      expect(d.desc, `${id}: ${d.desc}`).not.toMatch(banned)
    }
  })
})
