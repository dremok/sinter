/**
 * How much room is there, actually.
 *
 * "The home base is too crammed with stuff, makes it hard to move" is a claim
 * about free floor area, and free floor area is measurable. This prints the
 * region as characters — one per half metre — so a place that is too tight to
 * walk through looks too tight to walk through on a terminal.
 *
 *   .  open        # blocked        ~ water        = a surface to stand on
 *
 *   node tools/walkmap.mjs             home
 *   node tools/walkmap.mjs 0 -8 14     somewhere else, half-width 14
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const cx = Number(process.argv[2] ?? 0)
const cz = Number(process.argv[3] ?? 13)
const half = Number(process.argv[4] ?? 12)
const STEP = 0.5
const PLAYER_RADIUS = 0.34

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
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
  await page.goto(`${url}/?seed=hearth-0&ticks=1`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 60_000 })

  const grid = await page.evaluate(
    ({ cx, cz, half, step, radius }) => {
      const dist = (f, x, z) => {
        const c = Math.cos(f.ry)
        const s = Math.sin(f.ry)
        const dx = x - f.x
        const dz = z - f.z
        const ox = Math.abs(c * dx - s * dz) - f.hx
        const oz = Math.abs(s * dx + c * dz) - f.hz
        if (ox > 0 || oz > 0) return Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) - f.r
        return Math.max(ox, oz) - f.r
      }
      const blockers = window.__sinter.blockers()
      const standables = window.__sinter.standables()
      const rows = []
      for (let z = cz - half; z <= cz + half; z += step) {
        let row = ''
        for (let x = cx - half; x <= cx + half; x += step) {
          const blocked = blockers.some((b) => dist(b, x, z) < radius)
          const stand = standables.some((s) => dist(s, x, z) < 0)
          const h = window.__sinter.heightAt(x, z)
          row += blocked ? '#' : stand ? '=' : h < -0.42 ? '~' : '.'
        }
        rows.push(row)
      }
      return rows
    },
    { cx, cz, half, step: STEP, radius: PLAYER_RADIUS },
  )

  console.log(`centred on (${cx}, ${cz}), ${half * 2}m across, one character per ${STEP}m\n`)
  for (const r of grid) console.log('  ' + r)

  const all = grid.join('')
  const blocked = (all.match(/#/g) ?? []).length
  const water = (all.match(/~/g) ?? []).length
  console.log(
    `\n  ${((blocked / all.length) * 100).toFixed(1)}% blocked, ${((water / all.length) * 100).toFixed(1)}% water, ${(((all.length - blocked - water) / all.length) * 100).toFixed(1)}% open`,
  )

  // The number that matters for "hard to move" is not the total but the
  // narrowest gap: a yard that is 80% open but laid out as corridors one body
  // wide plays as a maze.
  let pinched = 0
  for (let r = 1; r < grid.length - 1; r++) {
    for (let c = 1; c < grid[r].length - 1; c++) {
      if (grid[r][c] === '#') continue
      const horiz = grid[r][c - 1] === '#' && grid[r][c + 1] === '#'
      const vert = grid[r - 1][c] === '#' && grid[r + 1][c] === '#'
      if (horiz || vert) pinched++
    }
  }
  console.log(`  ${pinched} squeeze points (open ground with walls on both sides)`)
} finally {
  await browser.close()
  proc.kill()
}
