/**
 * Uniform spatial hash, rebuilt each tick.
 *
 * Gameplay proximity lives here, NOT in Rapier. Physics is for contact and
 * constraint; "what flammable things are near this fire" is a simulation
 * question and asking the physics engine would tangle the two. See
 * docs/ARCHITECTURE.md, "Spatial queries".
 *
 * Regions are bounded, so a rebuild per tick stays cheap. When it stops being
 * cheap the fix is to make it incremental, not to reach for physics queries.
 */

import type { Entity } from '../ecs/world'

const CELL = 3

function key(cx: number, cz: number): number {
  // Cantor-ish pack into one number so the Map key is primitive, not a string.
  return (cx + 4096) * 8192 + (cz + 4096)
}

export class SpatialHash {
  private cells = new Map<number, Entity[]>()

  rebuild(entities: Iterable<Entity>): void {
    this.cells.clear()
    for (const e of entities) {
      const t = e.transform
      if (!t) continue
      const k = key(Math.floor(t.pos.x / CELL), Math.floor(t.pos.z / CELL))
      const bucket = this.cells.get(k)
      if (bucket) bucket.push(e)
      else this.cells.set(k, [e])
    }
  }

  /** Everything within `radius` of (x, z), ignoring height. */
  near(x: number, z: number, radius: number, out: Entity[] = []): Entity[] {
    out.length = 0
    const span = Math.ceil(radius / CELL)
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    const r2 = radius * radius

    for (let dx = -span; dx <= span; dx++) {
      for (let dz = -span; dz <= span; dz++) {
        const bucket = this.cells.get(key(cx + dx, cz + dz))
        if (!bucket) continue
        for (const e of bucket) {
          const t = e.transform!
          const ddx = t.pos.x - x
          const ddz = t.pos.z - z
          if (ddx * ddx + ddz * ddz <= r2) out.push(e)
        }
      }
    }
    return out
  }
}

export const spatial = new SpatialHash()
