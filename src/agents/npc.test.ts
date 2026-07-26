import { describe, it, expect } from 'vitest'
import { CAST, FERRYMAN, GATE_GUARD, KEEPER, WREN, npc, say, suggestFromPack } from './cast'
import {
  DRIVES,
  RUN_FLAGS,
  WORLD_FACTS,
  WORLD_SUPPLIED_FLAGS,
  bestCarried,
  blocks,
  emptySituation,
  entryNode,
  initialState,
  postings,
  talk,
  unplaced,
  type Gate,
  type NpcDef,
  type NpcState,
  type Outcome,
  type PlaceKind,
  type PlaceLike,
  type RunFlag,
  type Situation,
  type WorldFact,
} from './npc'
// Types only, and deliberately: `world/region.ts` pulls in Three.js, and this
// import is erased at build time, so the check below costs nothing at runtime
// and still fails `npm run typecheck` if the two ever disagree.
import type { Place } from '../world/region'
import { CATALOG, RECIPES, STARTING_ITEMS } from '../items'
import { p, type PropertyId } from '../props/registry'

/**
 * Dialogue is content, so most of these check that the content obeys the rules
 * rather than that the engine computes. The two that carry real weight are the
 * reachability pair at the bottom: they COMPUTE which routes through the guard
 * are open from the Band 0 items, the same way merge.test.ts computes what is
 * obtainable instead of listing it. A test that names the solution cannot
 * notice when the solution stops existing.
 */

/** Everything a player could be holding, starting from Band 0 and merging. */
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

function situation(over: Partial<Situation> = {}): Situation {
  return { ...emptySituation(), ...over }
}

/**
 * Every sequence of things you can say that ends with them standing aside.
 *
 * Depth first over the actual dialogue, using the real engine, so it finds only
 * routes a player could really walk. States are deduplicated so the patient
 * options do not spin forever.
 */
function resolvingRoutes(def: NpcDef, sit: Situation, maxDepth = 6): string[][] {
  const found: string[][] = []
  const seen = new Set<string>()

  const key = (s: NpcState) =>
    `${s.at}|${s.disposition.toFixed(3)}|${DRIVES.map((d) => s.drives[d].toFixed(3)).join(',')}|${[...s.said].sort().join(',')}`

  const walk = (state: NpcState, path: string[]): void => {
    if (path.length >= maxDepth) return
    const k = key(state) + '#' + path.length
    if (seen.has(k)) return
    seen.add(k)

    for (const option of talk(def, state, sit).options) {
      const said = say(def, state, sit, option.id)
      const next = [...path, option.id]
      if (said.state.resolved) found.push(next)
      else if (!said.ended) walk(said.state, next)
    }
  }

  walk(initialState(def), [])
  return found
}

/** Carrying everything, knowing everything, having done everything. */
function fullyEquipped(over: Partial<Situation> = {}): Situation {
  return situation({
    carried: reachable(),
    skills: { firecraft: 1, haggling: 1, reading: 1, quiet_step: 1, butchery: 1, cold_blood: 1 },
    done: new Set<RunFlag>(RUN_FLAGS),
    ...over,
  })
}

/**
 * Every situation worth exploring from, which between them can satisfy any gate
 * the vocabulary allows. Both settings of every fact, because a claim is only
 * offered honestly in one of them and the `sour` node is only reachable through
 * a lie, which needs the fact to be FALSE.
 */
const ALL_SITUATIONS: Situation[] = [
  situation(),
  fullyEquipped(),
  fullyEquipped({ facts: { something_burning: true, after_dark: true, alone: true } }),
]

/**
 * Every option id this person can ever actually put in front of a player.
 *
 * Computed by walking the real dialogue with the real engine, not by reading
 * the table, because the question is whether the gates can all be satisfied at
 * once from a state you can really get to. An option nobody can ever be offered
 * is dead content, and dead content in a table is invisible: it typechecks, it
 * reads fine, and it never appears in the game.
 */
function everOffered(def: NpcDef, sits: Situation[]): Set<string> {
  const offered = new Set<string>()

  const key = (s: NpcState) =>
    `${s.at}|${s.disposition.toFixed(3)}|${DRIVES.map((d) => s.drives[d].toFixed(3)).join(',')}|${[...s.said].sort().join(',')}`

  for (const sit of sits) {
    const seen = new Set<string>()
    const walk = (state: NpcState, depth: number): void => {
      if (depth > 8 || seen.has(key(state))) return
      seen.add(key(state))
      for (const o of talk(def, state, sit).options) {
        offered.add(o.id)
        const said = say(def, state, sit, o.id)
        if (!said.ended) walk(said.state, depth + 1)
      }
    }
    walk(initialState(def), 0)
  }
  return offered
}

/** Every gate written anywhere in the cast, with enough context to name it. */
function everyGate(): { def: NpcDef; where: string; gate: Gate }[] {
  const out: { def: NpcDef; where: string; gate: Gate }[] = []
  for (const def of CAST) {
    for (const node of def.nodes) {
      for (const g of node.when ?? []) out.push({ def, where: `${def.id}/${node.id} (entry)`, gate: g })
      for (const o of node.options) {
        for (const g of o.requires ?? []) out.push({ def, where: `${def.id}/${node.id}/${o.id}`, gate: g })
      }
    }
  }
  return out
}

/** Every outcome written anywhere in the cast, both sides of every lie. */
function everyOutcome(): { def: NpcDef; where: string; out: Outcome }[] {
  const out: { def: NpcDef; where: string; out: Outcome }[] = []
  for (const def of CAST) {
    for (const node of def.nodes) {
      for (const o of node.options) {
        out.push({ def, where: `${def.id}/${o.id}`, out: o.then })
        if (o.caught) out.push({ def, where: `${def.id}/${o.id} (caught)`, out: o.caught })
      }
    }
  }
  return out
}

describe('the engine', () => {
  it('offers only options whose gates pass', () => {
    const broke = situation()
    const ids = talk(GATE_GUARD, initialState(GATE_GUARD), broke).options.map((o) => o.id)
    // Carrying nothing: no bribe, no threat.
    expect(ids).not.toContain('bribe')
    expect(ids).not.toContain('threaten')
    expect(ids).toContain('whose_orders')
  })

  it('opens a property gate for anything that clears the bar, not one item', () => {
    const withSword = situation({ carried: ['sword'] })
    const ids = talk(GATE_GUARD, initialState(GATE_GUARD), withSword).options.map((o) => o.id)
    expect(ids).toContain('threaten')

    // And it is the PROPERTY doing the work: something merged into being that
    // nobody wrote a dialogue line for opens the same option.
    const merged = reachable().find(
      (id) => id !== 'sword' && p(CATALOG[id]!.props, 'FRIGHTENING') >= GATE_GUARD.drives.fear,
    )
    expect(merged, 'no merged item is frightening enough to test the property gate').toBeDefined()
    const ids2 = talk(GATE_GUARD, initialState(GATE_GUARD), situation({ carried: [merged!] })).options
    expect(ids2.map((o) => o.id)).toContain('threaten')
  })

  it('mutates nothing, so a conversation can be replayed', () => {
    const state = initialState(GATE_GUARD)
    const before = JSON.stringify({ ...state, said: [...state.said] })
    say(GATE_GUARD, state, situation(), 'whose_orders')
    expect(JSON.stringify({ ...state, said: [...state.said] })).toEqual(before)
  })

  it('is deterministic: the same words produce the same person', () => {
    const run = () => {
      let s = initialState(GATE_GUARD)
      for (const id of ['whose_orders', 'wait', 'wait']) s = say(GATE_GUARD, s, situation(), id).state
      return JSON.stringify({ ...s, said: [...s.said].sort() })
    }
    expect(run()).toEqual(run())
  })

  it('refuses an option whose gates do not pass, rather than quietly allowing it', () => {
    expect(() => say(GATE_GUARD, initialState(GATE_GUARD), situation(), 'bribe')).toThrow()
  })

  it('reads the strongest carried value, not the first', () => {
    const sit = situation({ carried: ['apple', 'sword', 'rock'] })
    expect(bestCarried(sit, 'FRIGHTENING')).toBe(p(CATALOG.sword!.props, 'FRIGHTENING'))
  })
})

describe('the world is checkable, and you can lie about it', () => {
  const burning = situation({ facts: { something_burning: true, after_dark: false, alone: false } })

  it('offers the claim whether or not it is true', () => {
    for (const sit of [situation(), burning]) {
      const ids = talk(GATE_GUARD, initialState(GATE_GUARD), sit).options.map((o) => o.id)
      expect(ids, 'a lie you cannot pick is not a lie').toContain('fire_behind_you')
    }
  })

  it('works when something really is burning', () => {
    const said = say(GATE_GUARD, initialState(GATE_GUARD), burning, 'fire_behind_you')
    expect(said.lied).toBe(false)
    expect(said.state.resolved).toEqual({ kind: 'pacify' })
  })

  it('costs disposition when it is not', () => {
    const before = initialState(GATE_GUARD)
    const said = say(GATE_GUARD, before, situation(), 'fire_behind_you')
    expect(said.lied).toBe(true)
    expect(said.state.resolved).toBeNull()
    expect(said.state.disposition).toBeLessThan(before.disposition)
    expect(said.state.said.has('lied_about_fire')).toBe(true)
  })

  it('remembers, and a second lie sours him on the spot', () => {
    let s = initialState(GATE_GUARD)
    s = say(GATE_GUARD, s, situation(), 'fire_behind_you').state
    expect(talk(GATE_GUARD, s, situation()).node, 'one lie is not yet the end of it').toBe('start')

    s = say(GATE_GUARD, s, situation(), 'fire_behind_you').state

    // Immediately, not on the next conversation. Entry gates are read on the
    // way in, so souring used to wait politely until you walked off and came
    // back, and you could tell the same lie five times in a row meanwhile.
    expect(talk(GATE_GUARD, s, situation()).node).toBe('sour')
    expect(entryNode(GATE_GUARD, s, situation()).id).toBe('sour')

    // And the thing he will no longer do is take your money, or hear it again.
    const ids = talk(GATE_GUARD, s, situation({ carried: ['sword'] })).options.map((o) => o.id)
    expect(ids).not.toContain('bribe')
    expect(ids).not.toContain('fire_behind_you')
  })

  it('never claims a fact without saying what happens when the lie fails', () => {
    for (const def of CAST) {
      for (const node of def.nodes) {
        for (const o of node.options) {
          if (o.claim) expect(o.caught, `${def.id}/${o.id} claims but has no caught`).toBeDefined()
          if (o.caught) expect(o.claim, `${def.id}/${o.id} has caught but claims nothing`).toBeDefined()
        }
      }
    }
  })
})

describe('disposition and drives move', () => {
  it('wears a guard down until he stops caring', () => {
    let s = initialState(GATE_GUARD)
    const start = s.drives.boredom
    for (let i = 0; i < 3; i++) s = say(GATE_GUARD, s, situation(), 'wait').state
    expect(s.drives.boredom).toBeGreaterThan(start)

    const last = say(GATE_GUARD, s, situation(), 'wait_more')
    expect(last.state.resolved, 'waiting him out should actually work').toEqual({ kind: 'pacify' })
  })

  it('keeps disposition and every drive inside [0,1] whatever you say', () => {
    for (const def of CAST) {
      for (const route of resolvingRoutes(def, situation({ carried: reachable() }), 5)) {
        let s = initialState(def)
        for (const id of route) s = say(def, s, situation({ carried: reachable() }), id).state
        expect(s.disposition).toBeGreaterThanOrEqual(0)
        expect(s.disposition).toBeLessThanOrEqual(1)
        for (const d of DRIVES) {
          expect(s.drives[d], `${def.id} ${d}`).toBeGreaterThanOrEqual(0)
          expect(s.drives[d], `${def.id} ${d}`).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('takes the cheapest thing that will do, not the best thing you have', () => {
    // Two items clear a bar of 0.1: the guard should take the lesser one.
    const cheap = 'glasses'
    const dear = 'sword'
    expect(p(CATALOG[cheap]!.props, 'VALUABLE')).toBeLessThan(p(CATALOG[dear]!.props, 'VALUABLE'))

    const generous: NpcDef = {
      ...GATE_GUARD,
      drives: { ...GATE_GUARD.drives, greed: 0.1 },
    }
    const said = say(generous, initialState(generous), situation({ carried: [dear, cheap] }), 'bribe')
    expect(said.consumed).toBe(cheap)
    expect(said.state.resolved).toEqual({ kind: 'pacify' })
  })
})

describe('a person is an obstacle you can also walk around', () => {
  /**
   * Rule 1, applied to people. Every NPC you can talk your way past has to have
   * a way past that involves no talking, or they are a lock with a
   * conversational key. NPCs who block nothing are exempt, and the test works
   * out which is which rather than being told.
   */
  const blocks = (def: NpcDef) =>
    def.nodes.some((n) => n.options.some((o) => o.then.resolve || o.caught?.resolve))

  it('gives everyone who can be resolved a route that is not dialogue', () => {
    for (const def of CAST) {
      if (!blocks(def)) continue
      expect(def.routesPast.length, `${def.id} can only be talked past`).toBeGreaterThan(0)
    }
  })

  it('proves at least one of those routes is reachable from Band 0', () => {
    const have = reachable()
    const best = (prop: PropertyId) =>
      have.reduce((acc, id) => Math.max(acc, p(CATALOG[id]!.props, prop)), 0)

    for (const def of CAST) {
      if (!blocks(def)) continue
      const open = def.routesPast.filter((r) => best(r.prop) >= r.min)
      expect(open.length, `nothing in Band 0 gets past ${def.id} without talking`).toBeGreaterThan(0)
    }
  })

  it('proves at least one dialogue route through the guard exists, by walking it', () => {
    // Computed, not listed. Carrying everything Band 0 can produce, and with
    // nothing burning, so the honest version of the fire line is unavailable.
    const routes = resolvingRoutes(GATE_GUARD, situation({ carried: reachable() }))
    const distinct = new Set(routes.map((r) => r[r.length - 1]!))

    expect(routes.length, 'no way of talking past the guard at all').toBeGreaterThan(0)
    expect(distinct.size, `only one way through: ${[...distinct]}`).toBeGreaterThan(1)
  })

  it('keeps every route the guard advertises open, counted rather than named', () => {
    /**
     * `cast.ts` claims six ways through him, five of them conversation. This
     * counts, and does not name: a test listing 'bribe' would still pass with
     * the bribe reachable only in theory, which is exactly what happened. His
     * greed was above anything Band 0 could produce, so the bribe existed in
     * the table, read correctly, and could never be chosen.
     */
    const routes = resolvingRoutes(GATE_GUARD, fullyEquipped(), 7)
    const distinct = new Set(routes.map((r) => r[r.length - 1]!))
    expect(distinct.size, `only ${distinct.size} ways past him: ${[...distinct]}`).toBeGreaterThanOrEqual(5)
  })

  it('opens one more route when the world cooperates', () => {
    const carried = reachable()
    const calm = new Set(
      resolvingRoutes(GATE_GUARD, situation({ carried })).map((r) => r[r.length - 1]!),
    )
    const alight = new Set(
      resolvingRoutes(
        GATE_GUARD,
        situation({ carried, facts: { something_burning: true, after_dark: false, alone: false } }),
      ).map((r) => r[r.length - 1]!),
    )
    expect(calm.has('fire_behind_you')).toBe(false)
    expect(alight.has('fire_behind_you'), 'setting something alight should open the honest line').toBe(true)
  })
})

describe('the cast is well formed', () => {
  it('gives every conversation somewhere to start', () => {
    for (const def of CAST) {
      expect(() => entryNode(def, initialState(def), situation())).not.toThrow()
      // A soured NPC still needs an entry, so the last node must be ungated.
      expect(def.nodes.some((n) => n.when === undefined), `${def.id} has no ungated node`).toBe(true)
    }
  })

  it('never sends a conversation to a node that does not exist', () => {
    for (const def of CAST) {
      const ids = new Set(def.nodes.map((n) => n.id))
      for (const node of def.nodes) {
        for (const o of node.options) {
          for (const out of [o.then, o.caught]) {
            if (!out?.goto || out.goto === 'end') continue
            expect(ids.has(out.goto), `${def.id}/${o.id} goes to missing node "${out.goto}"`).toBe(true)
          }
        }
      }
    }
  })

  it('gives every option a way out of the conversation', () => {
    for (const def of CAST) {
      for (const node of def.nodes) {
        const canLeave = node.options.some(
          (o) => o.then.goto === 'end' || o.then.resolve !== undefined,
        )
        expect(canLeave, `${def.id}/${node.id} has no way to end`).toBe(true)
      }
    }
  })

  it('names only items the catalog knows', () => {
    for (const def of CAST) {
      for (const node of def.nodes) {
        for (const o of node.options) {
          for (const g of o.requires ?? []) {
            if (g.kind === 'item') expect(CATALOG[g.item], `${def.id} wants ${g.item}`).toBeDefined()
          }
        }
      }
    }
  })

  it('gives every option and node a unique id within its person', () => {
    for (const def of CAST) {
      const nodeIds = def.nodes.map((n) => n.id)
      expect(new Set(nodeIds).size, `${def.id} repeats a node id`).toBe(nodeIds.length)
      for (const node of def.nodes) {
        const ids = node.options.map((o) => o.id)
        expect(new Set(ids).size, `${def.id}/${node.id} repeats an option id`).toBe(ids.length)
      }
    }
  })

  it('claims only facts the caller is asked to supply', () => {
    for (const def of CAST) {
      for (const node of def.nodes) {
        for (const o of node.options) {
          if (o.claim) expect(WORLD_FACTS).toContain(o.claim as WorldFact)
        }
      }
    }
  })

  it('is registered under its own id', () => {
    for (const def of CAST) expect(npc(def.id)).toBe(def)
    expect(npc('nobody')).toBeUndefined()
  })
})

describe('nothing authored is unreachable', () => {
  it('gives everybody something to say to a player carrying nothing', () => {
    for (const def of CAST) {
      const opening = talk(def, initialState(def), situation())
      expect(opening.says.length, `${def.id} opens with silence`).toBeGreaterThan(0)
      expect(opening.options.length, `${def.id} cannot be spoken to empty handed`).toBeGreaterThan(0)
    }
  })

  it('can actually offer every option it authored', () => {
    for (const def of CAST) {
      const offered = everOffered(def, ALL_SITUATIONS)
      for (const node of def.nodes) {
        for (const o of node.options) {
          expect(offered.has(o.id), `${def.id}/${node.id}/${o.id} can never be offered`).toBe(true)
        }
      }
    }
  })

  it('can actually reach every node it authored', () => {
    // A node is reached either by being an entry or by being the target of an
    // option that can be offered. A `sour` node nobody can sour into is a mood
    // the game never has.
    for (const def of CAST) {
      const offered = everOffered(def, ALL_SITUATIONS)
      const reached = new Set<string>()
      for (const sit of ALL_SITUATIONS) {
        try {
          reached.add(entryNode(def, initialState(def), sit).id)
        } catch {
          // Covered by 'gives every conversation somewhere to start'.
        }
      }
      for (const node of def.nodes) {
        if (node.when) reached.add(node.id) // a mood; reachability of it is the drive test's job
        for (const o of node.options) {
          if (!offered.has(o.id)) continue
          for (const outcome of [o.then, o.caught]) {
            if (outcome?.goto && outcome.goto !== 'end') reached.add(outcome.goto)
          }
        }
      }
      for (const node of def.nodes) {
        expect(reached.has(node.id), `${def.id}/${node.id} is a node nothing leads to`).toBe(true)
      }
    }
  })

  it('sours the guard into his own node, which is how that node is reached at all', () => {
    // The one gated node in the cast, checked by walking rather than asserting
    // that the gate looks satisfiable.
    let s = initialState(GATE_GUARD)
    s = say(GATE_GUARD, s, situation(), 'fire_behind_you').state
    s = say(GATE_GUARD, s, situation(), 'fire_behind_you').state
    expect(talk(GATE_GUARD, s, situation()).node).toBe('sour')
    expect(talk(GATE_GUARD, s, fullyEquipped()).options.length).toBeGreaterThan(0)
  })
})

describe('no gate is unsatisfiable', () => {
  const have = reachable()
  const best = (prop: PropertyId) =>
    have.reduce((acc, id) => Math.max(acc, p(CATALOG[id]!.props, prop)), 0)

  it('asks only for items Band 0 can produce', () => {
    for (const { where, gate } of everyGate()) {
      if (gate.kind !== 'item' || gate.is === false) continue
      expect(have, `${where} wants ${gate.item}, which nothing in Band 0 yields`).toContain(gate.item)
    }
  })

  it('asks only for property levels Band 0 can reach', () => {
    for (const { def, where, gate } of everyGate()) {
      if (gate.kind !== 'property') continue
      // A drive threshold is checked at its STARTING value, which is what a
      // first meeting sees. Drives move afterwards, and an option getting
      // harder because you frightened somebody is design, not a defect.
      const min = typeof gate.min === 'number' ? gate.min : def.drives[gate.min.drive]
      expect(best(gate.prop), `${where} needs ${gate.prop} >= ${min} and nothing gets there`).toBeGreaterThanOrEqual(min)
    }
  })

  it('asks only about lines somebody actually remembers', () => {
    const remembered = new Map<string, Set<string>>()
    for (const { def, out } of everyOutcome()) {
      if (!out.remember) continue
      const forNpc = remembered.get(def.id) ?? new Set<string>()
      forNpc.add(out.remember)
      remembered.set(def.id, forNpc)
    }
    for (const { def, where, gate } of everyGate()) {
      if (gate.kind !== 'said' || gate.is === false) continue
      expect(
        remembered.get(def.id)?.has(gate.line),
        `${where} waits for "${gate.line}", which ${def.id} never remembers`,
      ).toBe(true)
    }
  })

  it('asks only about run flags something can set', () => {
    const settable = new Set<RunFlag>(WORLD_SUPPLIED_FLAGS)
    for (const { out } of everyOutcome()) if (out.sets) settable.add(out.sets)

    for (const { where, gate } of everyGate()) {
      if (gate.kind !== 'done' || gate.is === false) continue
      expect(settable.has(gate.flag), `${where} waits for ${gate.flag}, which nothing sets`).toBe(true)
    }
  })

  it('declares no run flag that is dead on both ends', () => {
    // The vocabulary is the contract with main.ts, so it must not accumulate
    // flags nobody sets or nobody reads.
    const set = new Set<RunFlag>(WORLD_SUPPLIED_FLAGS)
    for (const { out } of everyOutcome()) if (out.sets) set.add(out.sets)
    const read = new Set<RunFlag>()
    for (const { gate } of everyGate()) if (gate.kind === 'done') read.add(gate.flag)

    for (const flag of RUN_FLAGS) {
      expect(set.has(flag), `${flag} is declared but nothing sets it`).toBe(true)
      expect(read.has(flag), `${flag} is declared but nothing reads it`).toBe(true)
    }
  })

  it('never writes a range nothing can sit in', () => {
    for (const { where, gate } of everyGate()) {
      if (gate.kind !== 'drive' && gate.kind !== 'disposition') continue
      const min = gate.min ?? 0
      const max = gate.max ?? 1
      expect(min, `${where} wants ${min}..${max}, which is empty`).toBeLessThanOrEqual(max)
      expect(min).toBeGreaterThanOrEqual(0)
      expect(max).toBeLessThanOrEqual(1)
    }
  })

  it('never asks for a skill nobody could have', () => {
    for (const { where, gate } of everyGate()) {
      if (gate.kind !== 'skill') continue
      expect(gate.min, `${where} wants ${gate.skill} above 1`).toBeLessThanOrEqual(1)
      expect(gate.min, `${where} wants a skill of 0, which is everybody`).toBeGreaterThan(0)
    }
  })

  it('reaches a run flag through one person and spends it on another', () => {
    // The whole point of the `done` gate, walked end to end rather than
    // asserted. Without Wren, the option does not exist.
    const cold = fullyEquipped({ done: new Set<RunFlag>() })
    expect(talk(GATE_GUARD, initialState(GATE_GUARD), cold).options.map((o) => o.id)).not.toContain('the_swap')

    const told = say(WREN, initialState(WREN), cold, 'about_the_gate')
    expect(told.sets).toBe('knows_the_swap')

    const warm = fullyEquipped({ done: new Set<RunFlag>([told.sets!]) })
    expect(talk(GATE_GUARD, initialState(GATE_GUARD), warm).options.map((o) => o.id)).toContain('the_swap')
    expect(say(GATE_GUARD, initialState(GATE_GUARD), warm, 'the_swap').state.resolved).toEqual({ kind: 'pacify' })
  })
})

describe('people belong to a kind of place, not to a coordinate', () => {
  /**
   * D22, enforced at compile time. `PlaceKind` is declared in `npc.ts` rather
   * than imported so that `agents/` never depends on `world/`, and this is what
   * stops the two copies drifting: if the region adds or drops a kind, this
   * stops compiling and `npm run typecheck` fails.
   */
  type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
  const KINDS_AGREE: Same<PlaceKind, Place['kind']> = true

  /** The places the hand-laid Band 0 region exposes today, kinds only. */
  const PLACES: PlaceLike[] = [
    { id: 'hearth', kind: 'home' },
    { id: 'well', kind: 'water' },
    { id: 'pond', kind: 'water' },
    { id: 'ford', kind: 'water' },
    { id: 'mill', kind: 'work' },
    { id: 'barn', kind: 'work' },
    { id: 'field', kind: 'work' },
    { id: 'block', kind: 'work' },
    { id: 'oldoak', kind: 'landmark' },
    { id: 'grave', kind: 'landmark' },
    { id: 'arch', kind: 'landmark' },
    { id: 'tower', kind: 'landmark' },
    { id: 'gate', kind: 'exit' },
  ]

  it('agrees with the region about what kinds of place exist', () => {
    expect(KINDS_AGREE).toBe(true)
  })

  it('finds everybody a place in the region as it stands', () => {
    expect(unplaced(CAST, PLACES)).toEqual([])
    expect(postings(CAST, PLACES).length).toBe(CAST.length)
  })

  it('puts the person who is in the way in the way, and the rest beside him', () => {
    const atGate = postings(CAST, PLACES).filter((post) => post.place.id === 'gate')
    expect(atGate.length, 'the guard and the ferryman both belong at the way out').toBe(2)

    const guard = atGate.find((post) => post.def === GATE_GUARD)!
    expect(blocks(GATE_GUARD)).toBe(true)
    expect(guard.offset, 'a blocker stands ON the place, or he is not blocking it').toEqual({ dx: 0, dz: 0 })

    const ferryman = atGate.find((post) => post.def === FERRYMAN)!
    expect(Math.hypot(ferryman.offset.dx, ferryman.offset.dz), 'two people inside each other').toBeGreaterThan(1)
  })

  it('never stands two people on the same spot', () => {
    const seen = new Set<string>()
    for (const post of postings(CAST, PLACES)) {
      const spot = `${post.place.id}@${post.offset.dx},${post.offset.dz}`
      expect(seen.has(spot), `two people at ${spot}`).toBe(false)
      seen.add(spot)
    }
  })

  it('treats a preferred place as a hint and not a requirement', () => {
    expect(postings(CAST, PLACES).find((post) => post.def === WREN)!.place.id).toBe(WREN.prefer)

    // A generated region that never heard of the chopping block still gets her.
    const without = PLACES.filter((pl) => pl.id !== 'block')
    const moved = postings(CAST, without).find((post) => post.def === WREN)!
    expect(moved.place.kind).toBe('work')
    expect(unplaced(CAST, without)).toEqual([])
  })

  it('spreads people of one kind across the places of it', () => {
    const crowd: NpcDef[] = [WREN, { ...WREN, id: 'wren2', prefer: undefined }, { ...WREN, id: 'wren3', prefer: undefined }]
    const where = postings(crowd, PLACES).map((post) => post.place.id)
    expect(new Set(where).size, 'three workers stacked on one workplace').toBeGreaterThan(1)
  })

  it('survives a region that has almost nothing, rather than inventing a coordinate', () => {
    const bare: PlaceLike[] = [{ id: 'fire', kind: 'home' }]
    const placed = postings(CAST, bare)
    expect(placed.map((post) => post.def.id)).toEqual([KEEPER.id])
    expect(unplaced(CAST, bare).map((d) => d.id).sort()).toEqual(['ferryman', 'gate_guard', 'wren'])
  })

  it('hands the caller its own place back, with whatever it was carrying', () => {
    // The generic is what keeps Three.js out of this module: main.ts passes
    // region.places straight in and gets objects with `at` still on them.
    const rich = PLACES.map((pl) => ({ ...pl, at: { x: 1, y: 2, z: 3 } }))
    expect(postings(CAST, rich)[0]!.place.at).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('names a kind of place and never a coordinate', () => {
    for (const def of CAST) {
      expect(PLACES.map((pl) => pl.kind), `${def.id} stands somewhere no region has`).toContain(def.stands)
    }
  })
})

describe('speech obeys the band', () => {
  /**
   * From docs/DESIGN.md: Band 0 people are plain and warm, Band 1 unremarkable
   * and slightly wrong, Band 2 wary and transactional, and Band 3 people say
   * LESS, not more, with the silence around them doing the work.
   *
   * Encoded as a hard cap per band so the rule holds the first time somebody
   * writes a Band 3 NPC, rather than being noticed in review afterwards.
   */
  const MAX_WORDS = [30, 26, 20, 12]

  const lines = (def: NpcDef): string[] => {
    const out: string[] = []
    for (const node of def.nodes) {
      out.push(node.says)
      for (const o of node.options) {
        out.push(o.text, o.then.reply)
        if (o.caught) out.push(o.caught.reply)
      }
    }
    return out.filter((l) => l.length > 0)
  }

  it('keeps every line inside its band budget', () => {
    for (const def of CAST) {
      for (const line of lines(def)) {
        const words = line.split(/\s+/).length
        expect(words, `${def.id} says ${words} words: "${line}"`).toBeLessThanOrEqual(MAX_WORDS[def.band]!)
      }
    }
  })

  it('does not read like LLM output', () => {
    const banned = /\b(delve|leverage|comprehensive|streamline|myriad|tapestry|testament)\b|—/i
    for (const def of CAST) {
      expect(def.blurb, def.id).not.toMatch(banned)
      for (const line of lines(def)) expect(line, def.id).not.toMatch(banned)
    }
    expect(suggestFromPack(situation({ carried: STARTING_ITEMS }))).not.toMatch(banned)
  })
})

describe('the people who are not obstacles', () => {
  it('lets the Keeper explain the bench without saying the word recipe', () => {
    const bench = KEEPER.nodes[0]!.options.find((o) => o.id === 'the_bench')!
    expect(bench.then.reply).toMatch(/hands them back/i)
    expect(bench.then.reply.toLowerCase()).not.toContain('recipe')
  })

  it('has Wren ask about what you are carrying, and never name the result', () => {
    const withPair = situation({ carried: ['flint', 'horseshoe'] })
    const said = say(WREN, initialState(WREN), withPair, 'show')

    expect(said.reply).toContain(CATALOG.flint!.name)
    expect(said.reply).toContain(CATALOG.horseshoe!.name)
    expect(said.reply, 'she is not a recipe list').not.toContain(CATALOG.fire_striker!.name)
  })

  it('has Wren say something honest when nothing combines', () => {
    const said = say(WREN, initialState(WREN), situation({ carried: ['rope'] }), 'show')
    expect(said.reply.length).toBeGreaterThan(0)
    expect(said.reply).not.toContain('undefined')
  })

  it('gives Wren the same question for the same pack every time', () => {
    const sit = situation({ carried: reachable() })
    expect(suggestFromPack(sit)).toEqual(suggestFromPack(sit))
  })

  it('never lets the Ferryman say where to go', () => {
    const words = /\b(north|south|east|west|go to|head for|follow the|you should go)\b/i
    for (const node of FERRYMAN.nodes) {
      for (const o of node.options) expect(o.then.reply, o.id).not.toMatch(words)
    }
  })

  it('unfolds the Ferryman one answer at a time', () => {
    let s = initialState(FERRYMAN)
    const sit = situation()
    expect(talk(FERRYMAN, s, sit).options.map((o) => o.id)).toContain('seen_one')
    expect(talk(FERRYMAN, s, sit).options.map((o) => o.id)).not.toContain('seen_two')

    s = say(FERRYMAN, s, sit, 'seen_one').state
    const ids = talk(FERRYMAN, s, sit).options.map((o) => o.id)
    expect(ids).toContain('seen_two')
    expect(ids, 'and he does not repeat himself').not.toContain('seen_one')
  })
})
