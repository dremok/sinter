/**
 * Fire.
 *
 * The milestone that proves the design (PROJECT_STATUS M2). Read the rules
 * below and note what is absent: any mention of a fence, a tree, a torch, or an
 * item id. Fire finds FLAMMABLE things near HOT things. That is the entire
 * model, and it is why setting one thing alight produces a chain of
 * consequences nobody wrote down.
 *
 * Consequences that fall out of this file without being authored anywhere:
 *   - a burning brand dropped in dry straw takes the straw, then the fence
 *   - rain-soaked wood refuses to catch until the fire dries it out first
 *   - a palisade burns through and stops blocking, because its blocker is
 *     removed when its structure fails, not because "burning" was a solution
 *   - throwing a bucket of water makes a firebreak, since WET damps ignition
 */

import { TICK_DT } from '../core/clock'
import type { Rng } from '../core/rng'
import { queries, world, type Entity } from '../ecs/world'
import { clamp01, p } from '../props/registry'
import { spatial } from './spatial'

/** Below this a thing is warm, not dangerous. */
const IGNITION_HEAT = 0.35
/** Below this a thing will not carry a flame at all. */
const IGNITION_FUEL = 0.12
/**
 * How far a flame reaches, at full heat. Deliberately short: at 2.6m a fire can
 * jump three fence posts at once, which lets it hop a soaked gap and makes
 * dousing a firebreak pointless.
 */
const REACH = 2
/**
 * Ignition eagerness. Tuned so that a line of dry fuel reliably cascades within
 * the time the first thing stays alight. Much lower and fires fizzle out before
 * they reach anything, which reads as fire being broken rather than as fire
 * being survivable.
 */
const SPREAD = 3
/** Fuel spent per second at full heat. Sets how long a thing stays alight. */
const BURN_RATE = 0.12

export interface FireEvents {
  onIgnite?: (e: Entity) => void
  onBurnOut?: (e: Entity) => void
  onStructureFail?: (e: Entity) => void
}

const scratch: Entity[] = []

/**
 * Anything hot enough is an ignition source, whether or not it is itself on
 * fire. That is what makes a live ember work as a tool: it never burns, it just
 * sits at HOT 1.0 until it touches something that does.
 */
function isSource(e: Entity): boolean {
  return e.burning !== undefined || p(e.props ?? {}, 'HOT') >= IGNITION_HEAT
}

export function stepFire(rng: Rng, events: FireEvents = {}): void {
  spatial.rebuild(queries.simulated)

  // ------------------------------------------------------------- propagation
  for (const source of queries.simulated) {
    if (!isSource(source)) continue

    const heat = Math.max(p(source.props, 'HOT'), source.burning?.heat ?? 0)
    if (heat < IGNITION_HEAT) continue

    const reach = REACH * heat
    const near = spatial.near(source.transform.pos.x, source.transform.pos.z, reach, scratch)

    for (const target of near) {
      if (target === source || target.burning || target.spent) continue

      const fuel = p(target.props!, 'FLAMMABLE')
      if (fuel < IGNITION_FUEL) continue

      const wet = p(target.props!, 'WET')

      const dx = target.transform!.pos.x - source.transform.pos.x
      const dz = target.transform!.pos.z - source.transform.pos.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      const falloff = 1 - Math.min(dist / reach, 1)

      // Wet things dry before they burn. This is the interaction that makes a
      // bucket of water a firebreak rather than a fire extinguisher.
      const chance = fuel * falloff * heat * (1 - wet) * SPREAD * TICK_DT

      if (rng.chance(chance)) {
        world.addComponent(target, 'burning', { heat: 0.25, fuel, age: 0 })
        events.onIgnite?.(target)
      }
    }
  }

  // ----------------------------------------------------------------- burning
  for (const e of [...queries.burning]) {
    const b = e.burning
    b.age += TICK_DT

    // Flames build, then hold.
    b.heat = clamp01(b.heat + 1.4 * TICK_DT)

    // A fire dries what it is standing on before it consumes it.
    const wet = p(e.props, 'WET')
    if (wet > 0) {
      e.props.WET = clamp01(wet - 0.5 * TICK_DT)
      if (e.props.WET <= 0.02) delete e.props.WET
    }

    // Burning is fuel being spent. Hotter fires eat faster.
    const rate = BURN_RATE * b.heat
    b.fuel = clamp01(b.fuel - rate * TICK_DT)
    e.props.FLAMMABLE = b.fuel
    e.props.HOT = b.heat
    e.props.LUMINOUS = Math.max(p(e.props, 'LUMINOUS'), b.heat * 0.9)

    // Fire eats structure. The palisade does not have a "burn" solution; it has
    // hit points and a fire that is taking them.
    if (e.structure) {
      e.structure.hp -= 26 * b.heat * TICK_DT
      if (e.structure.hp <= 0) {
        fail(e, events)
        continue
      }
    }

    if (b.fuel <= IGNITION_FUEL * 0.5) burnOut(e, events)
  }
}

function burnOut(e: Entity, events: FireEvents): void {
  world.removeComponent(e, 'burning')
  e.props!.HOT = 0
  e.props!.FLAMMABLE = 0
  delete e.props!.LUMINOUS

  // A structure that has spent all its fuel is gone, not merely charred. Without
  // this a post can burn to completion and still be holding the wall up, because
  // fuel runs out before hit points do. Whichever finishes first, the result is
  // the same: it is not standing any more.
  if (e.structure) {
    fail(e, events)
    return
  }

  world.addComponent(e, 'spent', true)
  events.onBurnOut?.(e)
}

/** A structure that fails stops blocking. Nothing checks how it failed. */
export function fail(e: Entity, events: FireEvents = {}): void {
  if (e.burning) world.removeComponent(e, 'burning')
  if (e.blocker) world.removeComponent(e, 'blocker')
  world.addComponent(e, 'spent', true)
  e.props!.HOT = 0
  e.props!.FLAMMABLE = 0
  events.onStructureFail?.(e)
}

/** Used by the throw/place interaction: put something hot into the world. */
export function ignite(e: Entity): void {
  if (e.burning || e.spent) return
  const fuel = p(e.props ?? {}, 'FLAMMABLE')
  if (fuel < IGNITION_FUEL) return
  world.addComponent(e, 'burning', { heat: 0.3, fuel, age: 0 })
}
