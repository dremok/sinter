/**
 * Load a deployed build in a real browser and prove the game actually runs.
 *
 * `docs/DEPLOY.md` is blunt about why this exists: a green build says nothing
 * about whether the game works, because WebGL context creation and WASM
 * instantiation both fail in ways that a successful `vite build` cannot catch.
 * This drives the LIVE animation loop (not the headless single-frame path), so
 * it exercises the same code a player hits.
 *
 *   npm run verify:deploy
 *   npm run verify:deploy -- https://some-preview.up.railway.app/ out.png
 *
 * Exits non-zero on any page error, console error, or failed request.
 */

import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'https://sinter-production.up.railway.app/'
const OUT = process.argv[3] ?? '.shots/deployed.png'

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`))

try {
  await page.goto(URL, { waitUntil: 'load', timeout: 180_000 })
  await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 180_000 })

  // Let the wall-clock loop run for a few seconds. A single frame would pass
  // even if the simulation threw on its second tick.
  await page.waitForTimeout(3000)

  const stats = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const tick = /tick\s+(\d+)/.exec(document.getElementById('hud')?.textContent ?? '')
    return {
      canvas: canvas ? `${canvas.width}x${canvas.height}` : null,
      tick: tick ? Number(tick[1]) : 0,
    }
  })

  await page.screenshot({ path: OUT })

  console.log(`url     ${URL}`)
  console.log(`canvas  ${stats.canvas ?? 'MISSING'}`)
  console.log(`tick    ${stats.tick}`)
  console.log(`shot    ${OUT}`)

  if (!stats.canvas) errors.push('no canvas in the document: WebGL never started')
  if (stats.tick < 1) errors.push(`simulation is not advancing (tick ${stats.tick})`)

  console.log(`errors  ${errors.length === 0 ? 'none' : ''}`)
  for (const e of errors) console.error(`  ${e}`)
} finally {
  await browser.close()
}

process.exitCode = errors.length > 0 ? 1 : 0
