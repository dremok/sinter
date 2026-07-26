/**
 * The one collision shape in the game.
 *
 * WHY THERE IS ONLY ONE. Everything solid used to be a circle, and rectangles
 * were approximated by runs of overlapping circles. That produced four separate
 * reported bugs in as many days, all of them the same bug:
 *
 *   - the barn: one circle cannot cover a rectangle, so you walked in through
 *     the middle of a wall;
 *   - the buildings after that: a run of ~30 circles round each perimeter,
 *     which closed the hole but made every wall lumpy and cost 30 entities;
 *   - the gate: 3.5m wide and 0.35m deep, given a circle of radius 1.9, so
 *     there was an invisible two-metre bubble in front of it and you could not
 *     walk up to the one landmark the whole region points at;
 *   - the plank crossing: five circles laid along a deck, overhanging its ends
 *     by 0.6m, so you stepped up onto thin air before reaching the boards.
 *
 * No amount of care with radii fixes that, because the shape is wrong. So there
 * is one primitive here and it is a rectangle: an oriented box with half-extents
 * `hx`/`hz`, turned by `ry`, and grown outward by `r` in every direction.
 *
 *   circle      hx = hz = 0, r = radius
 *   wall        hx = length/2, hz = thickness/2, r = 0
 *   post        hx = hz = 0, r = girth
 *   rounded box any combination of the two
 *
 * Nothing else is needed, and nothing here knows what a gate or a barn is.
 */

export interface Footprint {
  x: number
  z: number
  /** Half-extents along the footprint's own axes. Zero for a circle. */
  hx: number
  hz: number
  /** Rotation of those axes about world Y, in the same sense as `Object3D.rotation.y`. */
  ry: number
  /** How far the box is grown outward. The whole radius, for a circle. */
  r: number
}

export function circle(x: number, z: number, r: number): Footprint {
  return { x, z, hx: 0, hz: 0, ry: 0, r }
}

export function box(x: number, z: number, hx: number, hz: number, ry = 0, r = 0): Footprint {
  return { x, z, hx, hz, ry, r }
}

/**
 * Furthest any part of the footprint reaches from its centre.
 *
 * Broad-phase queries must use this rather than `r`, or a long wall is missed
 * by anything asking "what is within 3 metres of me".
 */
export function reach(f: Footprint): number {
  return Math.hypot(f.hx, f.hz) + f.r
}

/** Scratch for the local-space solve. Nothing here allocates. */
let lx = 0
let lz = 0

function toLocal(f: Footprint, x: number, z: number): void {
  const c = Math.cos(f.ry)
  const s = Math.sin(f.ry)
  const dx = x - f.x
  const dz = z - f.z
  lx = c * dx - s * dz
  lz = s * dx + c * dz
}

/**
 * Signed distance from (x, z) to the footprint's edge.
 *
 * Positive outside, negative inside, zero on the boundary. This is the only
 * question `standables` ever asks, and asking it as a distance rather than as a
 * boolean is what lets the caller widen the shape by a hysteresis margin
 * without a second shape.
 */
export function distanceTo(f: Footprint, x: number, z: number): number {
  toLocal(f, x, z)
  const ox = Math.abs(lx) - f.hx
  const oz = Math.abs(lz) - f.hz
  if (ox > 0 || oz > 0) return Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) - f.r
  // Inside the box core: the nearest edge is the nearest face.
  return Math.max(ox, oz) - f.r
}

export interface Point2 {
  x: number
  z: number
}

/**
 * Push a point out until it clears the footprint by `clearance`.
 *
 * Returns false and leaves `out` alone when the point is already clear, so a
 * caller can count how many footprints actually acted. The push is always along
 * the shortest way out, which is what makes two overlapping footprints resolve
 * into the corner between them rather than fight over one axis.
 */
export function separate(
  f: Footprint,
  x: number,
  z: number,
  clearance: number,
  out: Point2,
): boolean {
  toLocal(f, x, z)
  const want = f.r + clearance

  const qx = Math.min(f.hx, Math.max(-f.hx, lx))
  const qz = Math.min(f.hz, Math.max(-f.hz, lz))
  const ox = lx - qx
  const oz = lz - qz
  const d = Math.hypot(ox, oz)

  if (d > 1e-6) {
    if (d >= want) return false
    const k = (want - d) / d
    lx += ox * k
    lz += oz * k
  } else {
    // Standing inside the solid core. Leave through the nearest face, which for
    // a deep overlap is the only exit that does not shove the player across the
    // whole object.
    const gapX = f.hx - Math.abs(lx)
    const gapZ = f.hz - Math.abs(lz)
    if (gapX <= gapZ) lx = (lx < 0 ? -1 : 1) * (f.hx + want)
    else lz = (lz < 0 ? -1 : 1) * (f.hz + want)
  }

  const c = Math.cos(f.ry)
  const s = Math.sin(f.ry)
  out.x = f.x + lx * c + lz * s
  out.z = f.z - lx * s + lz * c
  return true
}
