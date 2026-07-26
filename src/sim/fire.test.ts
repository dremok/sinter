import { describe, it, expect, beforeEach } from 'vitest'
import * as THREE from 'three'
import { circle } from '../core/footprint'
import { createRng } from '../core/rng'
import { clearWorld, queries, world } from '../ecs/world'
import { ignite, stepFire } from './fire'

/**
 * Fire is the system that proves the design, so it gets tested away from the
 * renderer. A palisade is modelled here as what it actually is: a row of
 * flammable things with hit points. Nothing in these tests names an item.
 */

function countBurning(): number {
  let n = 0
  for (const _ of queries.burning) n++
  return n
}

/** A row of `n` posts, `spacing` apart, like a fence line. */
function buildRow(n: number, spacing: number, props: Record<string, number>) {
  const made = []
  for (let i = 0; i < n; i++) {
    made.push(
      world.add({
        transform: { pos: new THREE.Vector3(i * spacing, 2, 0), ry: 0 },
        props: { ...props },
        structure: { hp: 100, maxHp: 100, height: 4, label: 'Post' },
        blocker: circle(i * spacing, 0, 0.75),
      }),
    )
  }
  return made
}

function run(ticks: number, seed = 'fire-test') {
  const rng = createRng(seed)
  for (let i = 0; i < ticks; i++) stepFire(rng.fork(`fire:${i}`))
}

beforeEach(() => clearWorld())

describe('fire propagation', () => {
  it('ignites a flammable thing when told to', () => {
    const [post] = buildRow(1, 0.82, { WOODEN: 0.95, FLAMMABLE: 0.62 })
    ignite(post!)
    expect(countBurning()).toBe(1)
  })

  it('refuses to ignite something that will not burn', () => {
    const [rock] = buildRow(1, 0.82, { STONE: 1 })
    ignite(rock!)
    expect(countBurning()).toBe(0)
  })

  it('spreads along a line of fuel without anyone authoring the chain', () => {
    const posts = buildRow(8, 0.82, { WOODEN: 0.95, FLAMMABLE: 0.62 })
    ignite(posts[0]!)
    run(240)

    const touched = posts.filter((e) => e.burning !== undefined || e.spent === true).length
    expect(touched, 'fire should reach beyond the post it started on').toBeGreaterThan(1)
  })

  it('destroys the structures it burns, which removes what was blocking', () => {
    const posts = buildRow(6, 0.82, { WOODEN: 0.95, FLAMMABLE: 0.62 })
    ignite(posts[0]!)
    run(600)

    const stillBlocking = posts.filter((e) => e.blocker !== undefined).length
    expect(stillBlocking, 'a burnt-through palisade must stop blocking').toBeLessThan(posts.length)
  })

  it('will not cross a soaked gap, so water makes a firebreak', () => {
    const posts = buildRow(6, 0.82, { WOODEN: 0.95, FLAMMABLE: 0.62 })
    // Soak the middle of the row. Nothing here knows what a firebreak is.
    posts[2]!.props!.WET = 1
    posts[3]!.props!.WET = 1
    ignite(posts[0]!)
    run(400)

    expect(posts[5]!.burning, 'fire jumped a soaked gap').toBeUndefined()
    expect(posts[5]!.spent, 'fire jumped a soaked gap').toBeUndefined()
  })

  it('burns out instead of burning forever', () => {
    const [post] = buildRow(1, 0.82, { WOODEN: 0.95, FLAMMABLE: 0.62 })
    ignite(post!)
    run(900)
    expect(post!.burning).toBeUndefined()
    expect(post!.spent).toBe(true)
  })
})
