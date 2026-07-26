import { describe, expect, it } from 'vitest'
import { box, circle, distanceTo, reach, separate, type Footprint } from './footprint'

const at = (x: number, z: number) => ({ x, z })

/** Walk a straight line and report the first point the footprint objects to. */
function firstBlocked(f: Footprint, from: [number, number], to: [number, number], clearance = 0) {
  const out = at(0, 0)
  const steps = 4000
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = from[0] + (to[0] - from[0]) * t
    const z = from[1] + (to[1] - from[1]) * t
    if (separate(f, x, z, clearance, out)) return { x, z, t }
  }
  return null
}

describe('circle', () => {
  const c = circle(0, 0, 1)

  it('is the shape it says it is', () => {
    expect(distanceTo(c, 3, 0)).toBeCloseTo(2)
    expect(distanceTo(c, 0, 0)).toBeCloseTo(-1)
    expect(distanceTo(c, 0, 1)).toBeCloseTo(0)
    expect(reach(c)).toBeCloseTo(1)
  })

  it('pushes out to exactly the clearance', () => {
    const out = at(0, 0)
    expect(separate(c, 0.5, 0, 0.34, out)).toBe(true)
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1.34)
    expect(out.z).toBeCloseTo(0)
  })

  it('leaves a point that is already clear alone', () => {
    const out = at(99, 99)
    expect(separate(c, 2, 0, 0.34, out)).toBe(false)
    expect(out).toEqual(at(99, 99))
  })
})

describe('box', () => {
  // 3.5m wide, 0.35m deep: the gate. The bug this whole module exists for is
  // that as a circle it needed radius 1.9, which is a two-metre bubble in front
  // of a thing you are meant to be able to walk up to and touch.
  const gate = box(0, -8, 1.75, 0.175)

  /** Near face of the gate, coming from home. */
  const FACE = -8 + 0.175

  it('lets you stand against the flat face', () => {
    const hit = firstBlocked(gate, [0, -4], [0, -8], 0.34)
    // The face, plus the player's own radius. Nothing more.
    expect(hit!.z).toBeCloseTo(FACE + 0.34, 2)
  })

  it('as a circle it would have blocked well over a metre early', () => {
    const asCircle = circle(0, -8, 1.9)
    const hit = firstBlocked(asCircle, [0, -4], [0, -8], 0.34)
    expect(hit!.z).toBeCloseTo(-8 + 1.9 + 0.34, 2)
    // The regression, stated as the gap Max actually walked into.
    expect(hit!.z - (FACE + 0.34)).toBeGreaterThan(1.7)
  })

  it('has no gap anywhere along its length', () => {
    // A run of circles always has one. A box cannot: sweep the whole face.
    for (let x = -1.74; x <= 1.74; x += 0.01) {
      const out = at(0, 0)
      expect(separate(gate, x, -8, 0.34, out)).toBe(true)
    }
  })

  it('measures distance from the nearest face, not the centre', () => {
    expect(distanceTo(gate, 0, -6)).toBeCloseTo(2 - 0.175)
    expect(distanceTo(gate, 5, -8)).toBeCloseTo(5 - 1.75)
    // Diagonally off a corner.
    expect(distanceTo(gate, 1.75 + 3, -8 - 0.175 - 4)).toBeCloseTo(5)
  })

  it('escapes a deep overlap through the nearest face', () => {
    const out = at(0, 0)
    // Just inside the long face: should leave sideways in z, not travel 1.75m.
    separate(gate, 0.4, -8.1, 0.34, out)
    expect(out.z).toBeCloseTo(-8.175 - 0.34, 3)
    expect(out.x).toBeCloseTo(0.4, 3)
  })
})

describe('rotation', () => {
  // Same sense as Object3D.rotation.y, which is what the world builder uses to
  // place the mesh. If these disagree the collision is turned the wrong way and
  // nothing on screen says so.
  const turned = box(0, 0, 2, 0.25, Math.PI / 2)

  it('turns the collision the same way the mesh turns', () => {
    // Long axis now runs along z.
    expect(distanceTo(turned, 0, 3)).toBeCloseTo(1)
    expect(distanceTo(turned, 3, 0)).toBeCloseTo(2.75)
  })

  it('agrees with the three.js local-to-world transform', () => {
    const ry = 0.7
    const f = box(4, -1, 2, 0.5, ry)
    const c = Math.cos(ry)
    const s = Math.sin(ry)
    // A corner of the box, mapped out by hand exactly as region.ts places meshes.
    const cornerX = f.x + f.hx * c + f.hz * s
    const cornerZ = f.z - f.hx * s + f.hz * c
    expect(distanceTo(f, cornerX, cornerZ)).toBeCloseTo(0)
  })
})

describe('rounded box', () => {
  const pill = box(0, 0, 1, 0, 0, 0.5)

  it('is a capsule', () => {
    expect(distanceTo(pill, 0, 0.5)).toBeCloseTo(0)
    expect(distanceTo(pill, 1.5, 0)).toBeCloseTo(0)
    expect(distanceTo(pill, 2, 0)).toBeCloseTo(0.5)
    expect(reach(pill)).toBeCloseTo(1.5)
  })
})

describe('reach', () => {
  it('covers the corners, which is what a broad phase needs', () => {
    const f = box(0, 0, 4, 3, 0.4, 0.2)
    expect(reach(f)).toBeCloseTo(5.2)
    // Nothing outside `reach` of the centre can possibly be touching it.
    const out = at(0, 0)
    for (let a = 0; a < 6.28; a += 0.05) {
      const d = reach(f) + 0.001
      expect(separate(f, Math.cos(a) * d, Math.sin(a) * d, 0, out)).toBe(false)
    }
  })
})
