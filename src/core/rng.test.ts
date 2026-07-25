import { describe, it, expect } from 'vitest'
import { createRng } from './rng'

/**
 * Determinism is load bearing: the screenshot harness, reproducible bug
 * reports, and seeded runs all depend on it. If these tests fail, do not
 * "fix" them by updating the expected values without understanding why the
 * stream changed.
 */
describe('rng', () => {
  it('produces the same stream for the same seed', () => {
    const a = createRng('hearth-0')
    const b = createRng('hearth-0')
    const seqA = Array.from({ length: 32 }, () => a.next())
    const seqB = Array.from({ length: 32 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('produces different streams for different seeds', () => {
    const a = createRng('hearth-0')
    const b = createRng('hearth-1')
    expect(a.next()).not.toEqual(b.next())
  })

  it('accepts numeric and string seeds interchangeably', () => {
    expect(() => createRng(12345)).not.toThrow()
    expect(() => createRng('12345')).not.toThrow()
  })

  it('stays within [0, 1)', () => {
    const r = createRng('bounds')
    for (let i = 0; i < 5000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('int() is inclusive on both ends', () => {
    const r = createRng('ints')
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) seen.add(r.int(1, 4))
    expect([...seen].sort()).toEqual([1, 2, 3, 4])
  })

  it('forked streams are independent of consumption order', () => {
    // A subsystem drawing from its own fork must not be perturbed by how much
    // the parent stream was consumed first. This is what stops one system's
    // change from desyncing every other system in the world.
    const parentA = createRng('world')
    const forkA = parentA.fork('fire')

    const parentB = createRng('world')
    for (let i = 0; i < 100; i++) parentB.next()
    const forkB = parentB.fork('fire')

    expect(forkA.next()).toEqual(forkB.next())
  })

  it('different fork labels give different streams', () => {
    const parent = createRng('world')
    expect(parent.fork('fire').next()).not.toEqual(parent.fork('water').next())
  })

  it('shuffle is a permutation, not a resample', () => {
    const r = createRng('shuffle')
    const input = Array.from({ length: 50 }, (_, i) => i)
    const out = r.shuffle([...input])
    expect([...out].sort((x, y) => x - y)).toEqual(input)
  })

  it('pick throws on an empty array rather than returning undefined', () => {
    const r = createRng('pick')
    expect(() => r.pick([])).toThrow()
  })
})
