/**
 * Drive the game with real key presses and check that the controls do what a
 * player would expect.
 *
 * The screenshot harness renders one frame with no input, so it can prove the
 * world looks right and prove nothing at all about how it handles. This exists
 * because "left and right are reversed" was shipped once already and a static
 * screenshot could never have caught it.
 *
 * Everything here is judged in SCREEN space, because that is the only space the
 * player is in. "D goes right" is a claim about pixels.
 *
 *   npm run verify:movement
 *   npm run verify:movement -- http://localhost:5173/
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * Starts its own server unless told otherwise.
 *
 * This used to default to a hardcoded `http://localhost:5199/` and start
 * nothing, which quietly makes the check meaningless: a leftover dev server on
 * that port from some earlier session answers, and every assertion is then
 * about whatever code that process happens to be serving. It cost an hour of
 * chasing a debug hook that "did not exist" while sitting in the file.
 *
 * A verification tool that can silently test something other than the working
 * tree is worse than no verification tool.
 */
let server = null
let URL = process.argv[2]
if (!URL) {
  server = spawn('npx', ['vite', '--port', '0'], {
    cwd: resolve(import.meta.dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  URL = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('vite did not start')), 30_000)
    server.stdout.on('data', (c) => {
      const m = /(http:\/\/localhost:\d+)/.exec(c.toString())
      if (m) {
        clearTimeout(timer)
        res(m[1] + '/')
      }
    })
  })
}

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 900, height: 560 } })

const failures = []
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures.push(name)
}

/**
 * Hold a key for `ms`, return the screen-space direction it moved the player.
 *
 * Both endpoints are projected through the camera as it stands AFTER the move,
 * so the camera's own follow motion cancels out. Sampling the player's screen
 * position directly does not work: the camera is glued to the player, so that
 * delta is always near zero regardless of which way the controls go.
 */
/**
 * Hold a key until the SIMULATION has advanced by `ticks`, not until a wall
 * clock has.
 *
 * `Clock` caps at five fixed ticks per rendered frame so a stalled tab cannot
 * spiral, which means a slow headless renderer advances the world at a fraction
 * of real time. Asserting "2.6 seconds of walking covers 4 metres" therefore
 * measures the machine: the same build covered 8.2m, then 4.5m, then 3.1m on
 * one laptop as it got busier, and three checks went red with nothing wrong.
 * Ticks are the game's own clock, so distance per tick is a fact about the game.
 */
async function walk(keys, ticks, cap = 40_000) {
  const start = await page.evaluate(() => window.__sinter.ticks())
  for (const k of keys) await page.keyboard.down(k)
  const deadline = Date.now() + cap
  while (Date.now() < deadline) {
    await page.waitForTimeout(80)
    const now = await page.evaluate(() => window.__sinter.ticks())
    if (now - start >= ticks) break
  }
  for (const k of keys) await page.keyboard.up(k)
  await page.waitForTimeout(150)
  return (await page.evaluate(() => window.__sinter.ticks())) - start
}

async function press(key, ms = 500) {
  const before = await page.evaluate(() => window.__sinter.pos())
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
  await page.waitForTimeout(120)
  const after = await page.evaluate(() => window.__sinter.pos())

  const [sa, sb] = await page.evaluate(
    ([p0, p1]) => [window.__sinter.project(p0.x, p0.y, p0.z), window.__sinter.project(p1.x, p1.y, p1.z)],
    [before, after],
  )
  return { dx: sb.x - sa.x, dy: sb.y - sa.y, world: after }
}

try {
  await page.goto(URL, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 60_000 })
  await page.waitForTimeout(400)

  console.log('direction')
  // In normalised device coordinates +y is up the screen and +x is right.
  const w = await press('w')
  check('W moves up the screen', w.dy > 0.02, `dy ${w.dy.toFixed(3)}`)

  const s = await press('s')
  check('S moves down the screen', s.dy < -0.02, `dy ${s.dy.toFixed(3)}`)

  const d = await press('d')
  check('D moves right', d.dx > 0.02, `dx ${d.dx.toFixed(3)}`)

  const a = await press('a')
  check('A moves left', a.dx < -0.02, `dx ${a.dx.toFixed(3)}`)

  console.log('\nfeel')
  // Diagonals must not be faster than cardinals, the classic normalisation bug.
  const straight = await press('w', 400)
  await page.keyboard.down('w')
  await page.keyboard.down('d')
  const beforeDiag = await page.evaluate(() => window.__sinter.pos())
  await page.waitForTimeout(400)
  await page.keyboard.up('w')
  await page.keyboard.up('d')
  const afterDiag = await page.evaluate(() => window.__sinter.pos())
  const diagDist = Math.hypot(afterDiag.x - beforeDiag.x, afterDiag.z - beforeDiag.z)
  check('diagonal is not faster than straight', diagDist < 3.0, `${diagDist.toFixed(2)} world units in 0.4s`)
  void straight

  // Rotating the camera must rotate the controls with it, or the player has to
  // re-learn the keys at every angle.
  await page.keyboard.press('e')
  await page.waitForTimeout(200)
  const wRotated = await press('w')
  check('W still moves up the screen after rotating', wRotated.dy > 0.02, `dy ${wRotated.dy.toFixed(3)}`)
  await page.keyboard.press('q')
  await page.waitForTimeout(200)

  console.log('\nsticking')
  // Walk hard into the palisade for two seconds, then check the player is still
  // free to move away from it. Getting wedged was the loudest complaint.
  await page.evaluate(() => {
    // Nothing to do; movement is driven by keys only. Placeholder for clarity.
  })
  const beforeWall = await page.evaluate(() => window.__sinter.pos())
  const walked = await walk(['w'], 150)
  const atWall = await page.evaluate(() => window.__sinter.pos())
  const advanced = beforeWall.z - atWall.z
  // 150 ticks is 2.5 simulated seconds at 6.5 m/s, so 16 metres of intent. Four
  // is a low bar deliberately: this is a check for being wedged, not a speed run.
  check(
    'player can travel a long way unobstructed',
    advanced > 4,
    `${advanced.toFixed(1)} units north in ${walked} ticks`,
  )

  const escape = await press('s', 600)
  check('player can always back out again', escape.dy < -0.02, `dy ${escape.dy.toFixed(3)}`)

  console.log('\ntargeting')
  // Regression: a felled post stayed a valid target forever, and being the
  // nearest thing it kept stealing focus, so chopping reported 0% while the
  // player stood in front of a post that was still standing.
  await page.goto(`${URL}?pack=axe`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 60_000 })
  await page.keyboard.press('Tab')
  await page.waitForTimeout(200)

  // W alone runs diagonally north-west in world space, because "up the screen"
  // on an isometric camera is not "north". W+D together is straight north,
  // which is where the palisade is.
  // North to the wall, then east along it. W+D together is due north in world
  // terms under this camera, so the first leg arrives at the GATE, which is a
  // different obstacle with an item lying in front of it. The second leg slides
  // along the palisade to a post, which is what this section is about.
  await walk(['w', 'd'], 320)
  await walk(['d'], 45)
  await page.waitForTimeout(250)

  const promptText = async () => page.evaluate(() => document.getElementById('prompt')?.textContent ?? '')

  const atPalisade = await promptText()
  check('palisade is targeted on approach', /Palisade/.test(atPalisade), JSON.stringify(atPalisade.slice(0, 60)))
  check('chop is offered', /Chop with/.test(atPalisade), '')

  // Fell one post outright.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('1')
    await page.waitForTimeout(160)
  }
  await page.waitForTimeout(400)

  const after = await promptText()
  // Whatever is now targeted, it must not be a dead post reporting 0%.
  check('does not target a felled post', !/at 0%/.test(after), JSON.stringify(after.slice(0, 60)))

  await page.keyboard.press('1')
  await page.waitForTimeout(250)
  const afterChop = await promptText()
  check(
    'chopping still makes progress on a standing post',
    !/at 0%/.test(afterChop),
    JSON.stringify(afterChop.slice(0, 60)),
  )

  // Finally, no NaNs. A single NaN in the position silently freezes movement.
  const finalPos = await page.evaluate(() => window.__sinter.pos())
  check(
    'position stays finite',
    Number.isFinite(finalPos.x) && Number.isFinite(finalPos.y) && Number.isFinite(finalPos.z),
    JSON.stringify(finalPos),
  )
} finally {
  await browser.close()
  server?.kill()
}

console.log(`\n${failures.length === 0 ? 'all movement checks passed' : `${failures.length} FAILED: ${failures.join(', ')}`}`)
process.exitCode = failures.length > 0 ? 1 : 0
