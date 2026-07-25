/**
 * Assert that no run of blockers has a gap the player can squeeze through.
 *
 * Written deliberately by someone other than the author of the geometry. A
 * check written by whoever wrote the placement tends to assert the placement it
 * already has, which is the one arrangement guaranteed not to be the bug.
 *
 * WHY THIS EXISTS. Three collision failures reached a playable build in one
 * session, and every one of them was invisible to typecheck, the unit tests and
 * the screenshots:
 *
 *   - Buildings had a single circular blocker. A circle cannot cover a
 *     rectangle, so the player walked through the barn wall.
 *   - The rock spur beside the palisade had neighbours 2.81m apart against a
 *     2.16m radii sum. That is a hole exactly where the obstacle is supposed to
 *     force a decision, so the palisade could simply be walked around.
 *   - A palisade post was generated INSIDE a gate pillar, and was silently
 *     providing the pillar's collision. Chopping the post opened a hole through
 *     the pillar.
 *
 * The last one is the reason this checks containment as well as spacing.
 * Collision inferred from whatever happens to be nearby is a hole waiting to be
 * opened, because anything destructible can be destroyed.
 *
 *   npm run verify:collision
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

/** Radius of the player capsule, from main.ts. */
const PLAYER_RADIUS = 0.34
/** Two blockers in the same run must not be further apart than this. */
const gapBetween = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) - (a.r + b.r)

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

try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
  await page.goto(`${url}/?seed=hearth-0&ticks=1`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 60_000 })

  const blockers = await page.evaluate(() => window.__sinter.blockers())
  console.log(`${blockers.length} blockers\n`)

  // ------------------------------------------------------------------ gaps
  // Grouped by label, because a "run" is a set of things doing one job: the
  // palisade, one rock spur, one building's perimeter.
  const runs = new Map()
  for (const b of blockers) {
    if (!runs.has(b.label)) runs.set(b.label, [])
    runs.get(b.label).push(b)
  }

  // Only things whose JOB is to be impassable are asserted on. Two barrels five
  // metres apart is two barrels, not a leaky wall, and scattered oaks are
  // supposed to have space between them. Grouping by label alone cannot tell
  // those apart from a perimeter.
  //
  // This list is the weak point of the check and should become a flag set by
  // the generator, so a new barrier is covered the day it is built rather than
  // when someone remembers to add it here.
  const MUST_SEAL = new Set([
    'Palisade',
    'Rock',
    'Home',
    'The barn',
    'The mill',
    'The shed',
    'The store',
  ])

  console.log('gaps within each run')
  for (const [label, run] of [...runs].sort()) {
    if (run.length < 2) continue
    if (!MUST_SEAL.has(label)) {
      const scattered = run.length
      console.log(`  skip  ${label} (${scattered}) is scattered, not a barrier`)
      continue
    }

    // For each blocker, how far is its NEAREST neighbour in the same run. A run
    // is sealed when every member is within reach of at least one other.
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

    const sealed = worst < PLAYER_RADIUS * 2
    check(
      `${label} (${run.length}) has no walkable gap`,
      sealed,
      `worst ${worst.toFixed(2)}m at (${worstAt.x.toFixed(1)}, ${worstAt.z.toFixed(1)})`,
    )
  }

  // ----------------------------------------------------------- containment
  // A blocker entirely inside another means one object is standing in for the
  // other's collision. If the inner one is destructible, destroying it opens a
  // hole through something that was never meant to be passable.
  console.log('\ncontainment')
  const buried = []
  for (const a of blockers) {
    for (const b of blockers) {
      if (a === b) continue
      const d = Math.hypot(a.x - b.x, a.z - b.z)
      if (d + a.r <= b.r * 0.98) buried.push(`${a.label} inside ${b.label} at (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`)
    }
  }
  check('no blocker is buried inside another', buried.length === 0, buried.slice(0, 4).join('; '))
} finally {
  await browser.close()
  proc.kill()
}

console.log(`\n${failures.length === 0 ? 'collision sealed' : `${failures.length} FAILED`}`)
process.exitCode = failures.length > 0 ? 1 : 0
