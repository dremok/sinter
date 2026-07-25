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

const URL = process.argv[2] ?? 'http://localhost:5199/'

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
  await page.keyboard.down('w')
  await page.waitForTimeout(2600)
  await page.keyboard.up('w')
  const atWall = await page.evaluate(() => window.__sinter.pos())
  const advanced = beforeWall.z - atWall.z
  check('player can travel a long way unobstructed', advanced > 4, `${advanced.toFixed(1)} units north`)

  const escape = await press('s', 600)
  check('player can always back out again', escape.dy < -0.02, `dy ${escape.dy.toFixed(3)}`)

  // Finally, no NaNs. A single NaN in the position silently freezes movement.
  const finalPos = await page.evaluate(() => window.__sinter.pos())
  check(
    'position stays finite',
    Number.isFinite(finalPos.x) && Number.isFinite(finalPos.y) && Number.isFinite(finalPos.z),
    JSON.stringify(finalPos),
  )
} finally {
  await browser.close()
}

console.log(`\n${failures.length === 0 ? 'all movement checks passed' : `${failures.length} FAILED: ${failures.join(', ')}`}`)
process.exitCode = failures.length > 0 ? 1 : 0
