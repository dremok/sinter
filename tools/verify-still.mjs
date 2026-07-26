/**
 * Find pixels that change when nothing should be changing.
 *
 * Max has reported flicker three times now, and every attempt to diagnose it
 * from a still screenshot has failed, because a still screenshot is exactly the
 * wrong instrument: flicker is a property of consecutive frames. This captures
 * frames from the live animation loop with the player standing still and counts
 * how many pixels move between them.
 *
 * Deliberate animation exists — fire, embers, smoke, the water — so the answer
 * is never zero. What the report is for is WHERE: a heat map that lights up
 * only around the hearth is the fire doing its job, and one that lights up
 * along every shadow edge in the frame is the shadow map crawling.
 *
 *   node tools/verify-still.mjs               stand at the hearth
 *   node tools/verify-still.mjs 0,-6 8        stand somewhere else, 8 frames
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { PNG } from 'pngjs'
import { writeFileSync } from 'node:fs'

const at = process.argv[2] ?? '0.3,12.4'
const frames = Number(process.argv[3] ?? 6)
const OUT = resolve(import.meta.dirname, '../.shots/still-heat.png')

/** Above this fraction of the frame moving per frame, something is wrong. */
const BUDGET = 0.06
/** And above this fraction of any ONE cell, something in that cell is strobing. */
const CELL_BUDGET = 0.09

const proc = spawn('npx', ['vite', '--port', '0'], {
  cwd: resolve(import.meta.dirname, '..'),
  stdio: ['ignore', 'pipe', 'pipe'],
})
const url = await new Promise((res) => {
  proc.stdout.on('data', (c) => {
    const m = /(http:\/\/localhost:\d+)/.exec(c.toString())
    if (m) res(m[1])
  })
})

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})

let failed = false
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  // No `ticks`, so this runs the real animation loop rather than the headless
  // single-frame path. That is the whole point: one frame cannot flicker.
  await page.goto(`${url}/?seed=hearth-0&at=${at}`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 60_000 })
  await page.waitForTimeout(1200)

  /**
   * Captured INSIDE the page, on consecutive animation frames.
   *
   * Screenshotting from the driver looks equivalent and is not: the round trip
   * costs a few hundred milliseconds and the game keeps ticking through it, so
   * "consecutive frames" arrive half a second of game time apart. Every fire in
   * the world looks completely different half a second apart, which made the
   * first version of this tool report a strobe that was not there and hide one
   * that was.
   */
  const raw = await page.evaluate(async (n) => {
    const src = document.querySelector('canvas')
    const w = Math.min(480, src.width)
    const h = Math.round((w / src.width) * src.height)
    const pad = document.createElement('canvas')
    pad.width = w
    pad.height = h
    const ctx = pad.getContext('2d', { willReadFrequently: true })
    const out = []
    for (let i = 0; i < n; i++) {
      await new Promise((r) => requestAnimationFrame(r))
      ctx.drawImage(src, 0, 0, w, h)
      out.push(Array.from(ctx.getImageData(0, 0, w, h).data))
    }
    return { w, h, out }
  }, frames)

  const width = raw.w
  const height = raw.h
  const shots = raw.out.map((d) => ({ data: d }))
  const heat = new Float32Array(width * height)
  const moved = []

  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1].data
    const b = shots[i].data
    let count = 0
    for (let p = 0; p < width * height; p++) {
      const d =
        Math.abs(a[p * 4] - b[p * 4]) +
        Math.abs(a[p * 4 + 1] - b[p * 4 + 1]) +
        Math.abs(a[p * 4 + 2] - b[p * 4 + 2])
      if (d > 24) {
        count++
        heat[p] += 1
      }
    }
    moved.push(count / (width * height))
  }

  const worst = Math.max(...moved)
  console.log(`standing at ${at}, ${frames} frames`)
  console.log(`  moving pixels per frame: ${moved.map((m) => (m * 100).toFixed(1) + '%').join('  ')}`)

  // Where. Split the frame into a coarse grid and name the busiest cells, so
  // "the fire" and "everywhere" are distinguishable without opening the image.
  const GX = 6
  const GY = 4
  const cells = []
  for (let gy = 0; gy < GY; gy++) {
    for (let gx = 0; gx < GX; gx++) {
      let sum = 0
      let n = 0
      for (let y = Math.floor((gy * height) / GY); y < Math.floor(((gy + 1) * height) / GY); y++) {
        for (let x = Math.floor((gx * width) / GX); x < Math.floor(((gx + 1) * width) / GX); x++) {
          sum += heat[y * width + x]
          n++
        }
      }
      cells.push({ gx, gy, share: sum / n / (shots.length - 1) })
    }
  }
  console.log('  where (share of each cell moving):')
  for (let gy = 0; gy < GY; gy++) {
    console.log(
      '    ' +
        cells
          .filter((c) => c.gy === gy)
          .map((c) => (c.share * 100).toFixed(0).padStart(4))
          .join(''),
    )
  }

  /**
   * The number that matters is CONCENTRATION, not total movement.
   *
   * A whole frame drifting a little is motion. A tenth of one cell changing
   * every frame while the rest sits still is something strobing, and the
   * frame-wide percentage cannot tell them apart: the campfire strobe moved
   * 0.3% of the frame both before and after it was fixed, because the fire is
   * 0.3% of the frame either way. Per cell it went from 15% to 5%.
   */
  const hottest = Math.max(...cells.map((c) => c.share))
  console.log(`  busiest cell: ${(hottest * 100).toFixed(0)}% of it moves every frame`)
  if (hottest > CELL_BUDGET) {
    console.log(`\nFAIL  a cell is strobing (${(hottest * 100).toFixed(0)}% > ${CELL_BUDGET * 100}%)`)
    failed = true
  }

  const png = new PNG({ width, height })
  for (let p = 0; p < width * height; p++) {
    const v = Math.min(1, heat[p] / (shots.length - 1))
    png.data[p * 4] = Math.round(255 * v)
    png.data[p * 4 + 1] = Math.round(40 * v)
    png.data[p * 4 + 2] = Math.round(120 * (1 - v))
    png.data[p * 4 + 3] = 255
  }
  writeFileSync(OUT, PNG.sync.write(png))
  console.log(`  heat map: ${OUT}`)

  if (errors.length) {
    console.log(`  page errors: ${errors.slice(0, 3).join(' | ')}`)
    failed = true
  }
  if (worst > BUDGET) {
    console.log(`\nFAIL  ${(worst * 100).toFixed(1)}% of the frame moves while standing still`)
    failed = true
  } else {
    console.log(`\nstill  (worst frame moved ${(worst * 100).toFixed(1)}%)`)
  }
} finally {
  await browser.close()
  proc.kill()
}

process.exitCode = failed ? 1 : 0
