/**
 * Assert that the world the collision system sees is the world on screen.
 *
 * Written deliberately by someone other than the author of the geometry. A
 * check written by whoever wrote the placement tends to assert the placement it
 * already has, which is the one arrangement guaranteed not to be the bug.
 *
 * WHY THIS EXISTS. Every collision failure that has reached a playable build
 * was a disagreement between three separate descriptions of one spot — the
 * drawn mesh, the collision footprint, and the terrain height — and every one
 * of them was invisible to typecheck, the unit tests AND the screenshots:
 *
 *   - Buildings had a single circular blocker. A circle cannot cover a
 *     rectangle, so the player walked through the barn wall.
 *   - The rock spur beside the palisade had neighbours 2.81m apart against a
 *     2.16m radii sum. That is a hole exactly where the obstacle is supposed to
 *     force a decision, so the palisade could simply be walked around.
 *   - A palisade post was generated INSIDE a gate pillar, and was silently
 *     providing the pillar's collision. Chopping the post opened a hole through
 *     the pillar.
 *   - The gate, 3.5m wide and 0.35m deep, was given a circle of radius 1.9. Two
 *     metres of invisible wall in front of the one landmark the region points
 *     at, and nothing on screen to blame it on.
 *   - The plank crossing sat 0.26m below the bank it landed on, so the player
 *     walked through the deck instead of over it.
 *
 * The first three are covered by the spacing and containment checks. The last
 * two are what the reach and burial checks are for, and they are the general
 * form: collision must not exceed what you can see, and a walkable surface must
 * not be under the ground.
 *
 *   npm run verify:collision
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

/** From src/core/body.ts. */
const PLAYER_RADIUS = 0.34

/** How far a footprint may stick out past its own mesh before it is a lie. */
const REACH_TOLERANCE = 0.45
/** How far the ground may rise above a walkable surface before it is buried. */
const BURIAL_TOLERANCE = 0.05

const proc = spawn('npx', ['vite', '--port', '0'], {
  cwd: resolve(import.meta.dirname, '..'),
  stdio: ['ignore', 'pipe', 'pipe'],
})
const url = await new Promise((res, rej) => {
  const timer = setTimeout(() => rej(new Error('vite did not start')), 30_000)
  proc.stdout.on('data', (c) => {
    const m = /(http:\/\/localhost:\d+)/.exec(c.toString())
    if (m) {
      clearTimeout(timer)
      res(m[1])
    }
  })
})

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})

const failures = []
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

/** Points around the outside of a footprint, in world space. */
function rim(f, n = 24) {
  const c = Math.cos(f.ry)
  const s = Math.sin(f.ry)
  const out = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    // Walk the rounded rectangle: the box corner nearest this bearing, pushed
    // out by r. Exact at the axes and the corners, which is where it matters.
    const lx = Math.sign(Math.cos(a)) * f.hx + Math.cos(a) * f.r
    const lz = Math.sign(Math.sin(a)) * f.hz + Math.sin(a) * f.r
    out.push([f.x + lx * c + lz * s, f.z - lx * s + lz * c])
  }
  return out
}

try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
  await page.goto(`${url}/?seed=hearth-0&ticks=1`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 60_000 })

  const blockers = await page.evaluate(() => window.__sinter.blockers())
  const standables = await page.evaluate(() => window.__sinter.standables())
  const boxes = blockers.filter((b) => b.hx > 0 || b.hz > 0).length
  console.log(`${blockers.length} blockers (${boxes} boxes), ${standables.length} standables\n`)

  // -------------------------------------------------------- collision is visible
  // A footprint that reaches past its own mesh is an invisible wall. This is
  // the check that would have caught the gate on the day it was written.
  console.log('collision matches what you can see')
  {
    const overhang = []
    for (const b of blockers) {
      if (!Number.isFinite(b.seen.x0)) continue
      let worst = 0
      for (const [x, z] of rim(b)) {
        const out = Math.max(b.seen.x0 - x, x - b.seen.x1, b.seen.z0 - z, z - b.seen.z1)
        worst = Math.max(worst, out)
      }
      overhang.push({ label: b.label, worst, at: `(${b.x.toFixed(1)}, ${b.z.toFixed(1)})` })
    }
    overhang.sort((a, b) => b.worst - a.worst)
    for (const o of overhang.slice(0, 3)) {
      console.log(`    worst: ${o.label} ${o.at} reaches ${o.worst.toFixed(2)}m past its mesh`)
    }
    const bad = overhang.filter((o) => o.worst > REACH_TOLERANCE)
    check(
      'no blocker reaches past the thing it belongs to',
      bad.length === 0,
      bad.slice(0, 4).map((o) => `${o.label} ${o.at} +${o.worst.toFixed(2)}m`).join('; '),
    )
  }

  // ------------------------------------------------- nothing solid is uncovered
  // The other direction, and the one a "collision must not exceed the mesh"
  // check cannot see: geometry standing at walking height that no footprint
  // covers. The cottage grew a chimney 0.53m proud of its west wall and the
  // hand-typed footprint did not, so Max walked through a stone stack.
  console.log('\nnothing you can see at walking height is walk-through')
  {
    const leaks = blockers
      .filter((b) => b.uncovered > 0.02)
      .sort((a, b) => b.uncovered - a.uncovered)
    for (const l of leaks.slice(0, 3)) {
      console.log(`    worst: ${l.label} (${l.x.toFixed(1)}, ${l.z.toFixed(1)}) leaves ${l.uncovered.toFixed(2)}m uncovered`)
    }
    check(
      'no solid geometry stands outside its own footprint',
      leaks.length === 0,
      leaks.slice(0, 4).map((l) => `${l.label} +${l.uncovered.toFixed(2)}m`).join('; '),
    )
  }

  // ---------------------------------------------------- walkable is above ground
  // A surface the player is meant to stand on that sits under the terrain is a
  // surface they walk THROUGH, and it always looks like a rendering bug.
  console.log('\nwalkable surfaces are above the ground')
  {
    const samples = []
    for (const s of standables) {
      for (const [x, z] of rim(s, 12)) samples.push({ s, x, z })
      samples.push({ s, x: s.x, z: s.z })
    }
    const heights = await page.evaluate(
      (pts) => pts.map(([x, z]) => window.__sinter.heightAt(x, z)),
      samples.map((p) => [p.x, p.z]),
    )
    const buried = []
    for (let i = 0; i < samples.length; i++) {
      const under = heights[i] - samples[i].s.top
      if (under > BURIAL_TOLERANCE) {
        buried.push(
          `top ${samples[i].s.top.toFixed(2)} at (${samples[i].x.toFixed(1)}, ${samples[i].z.toFixed(1)}) is ${under.toFixed(2)}m under the ground`,
        )
      }
    }
    check('no walkable surface is buried', buried.length === 0, buried.slice(0, 4).join('; '))
  }

  // ------------------------------------------------------------------ gaps
  // Only for runs of circles. A box has no gaps by construction, which is most
  // of why there is now a box.
  const runs = new Map()
  for (const b of blockers) {
    if (b.hx > 0 || b.hz > 0) continue
    if (!runs.has(b.label)) runs.set(b.label, [])
    runs.get(b.label).push(b)
  }

  // Only things whose JOB is to be impassable are asserted on. Two barrels five
  // metres apart is two barrels, not a leaky wall, and scattered oaks are
  // supposed to have space between them.
  const MUST_SEAL = new Set(['Palisade', 'Rock'])
  const gapBetween = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) - (a.r + b.r)

  console.log('\ngaps within each run of circles')
  for (const [label, run] of [...runs].sort()) {
    if (run.length < 2 || !MUST_SEAL.has(label)) continue

    let worst = -Infinity
    let worstAt = null
    for (const a of run) {
      let nearest = Infinity
      for (const b of run) {
        if (a === b) continue
        nearest = Math.min(nearest, gapBetween(a, b))
      }
      if (nearest > worst) {
        worst = nearest
        worstAt = a
      }
    }

    check(
      `${label} (${run.length}) has no walkable gap`,
      worst < PLAYER_RADIUS * 2,
      `worst ${worst.toFixed(2)}m at (${worstAt.x.toFixed(1)}, ${worstAt.z.toFixed(1)})`,
    )
  }

  // ----------------------------------------------------------- containment
  // A DESTRUCTIBLE blocker entirely inside another means the thing that can be
  // destroyed is standing in for the collision of the thing that cannot, and
  // destroying it opens a hole through something still standing.
  console.log('\ncontainment')
  {
    const buried = []
    for (const a of blockers) {
      if (!a.destructible) continue
      for (const b of blockers) {
        if (a === b) continue
        // Every point on a's rim inside b means a contributes nothing of its own.
        const inside = rim(a).every(([x, z]) => {
          const c = Math.cos(b.ry)
          const s = Math.sin(b.ry)
          const dx = x - b.x
          const dz = z - b.z
          const lx = Math.abs(c * dx - s * dz) - b.hx
          const lz = Math.abs(s * dx + c * dz) - b.hz
          return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) < b.r * 0.98
        })
        if (inside) buried.push(`${a.label} inside ${b.label} at (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`)
      }
    }
    check(
      'nothing destructible is the sole collision for something else',
      buried.length === 0,
      buried.slice(0, 4).join('; '),
    )
  }
} finally {
  await browser.close()
  proc.kill()
}

console.log(`\n${failures.length === 0 ? 'collision sealed' : `${failures.length} FAILED`}`)
process.exitCode = failures.length > 0 ? 1 : 0
