/**
 * Ask the running game what is actually at a place.
 *
 * A screenshot shows one of the three representations of a spot — the drawn
 * mesh — and says nothing about the other two, the terrain height function and
 * the standable/blocker lists. Every collision bug in this project so far has
 * been a disagreement between those three, and every one of them was looked at
 * in a screenshot first and survived it.
 *
 *   node tools/probe.mjs 0,-6            one point
 *   node tools/probe.mjs 0,-4 0,-9 0.5   a line, sampled every 0.5m
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: node tools/probe.mjs x,z [x2,z2 [step]]')
  process.exit(2)
}
const pt = (s) => s.split(',').map(Number)
const [ax, az] = pt(args[0])
const points = []
if (args[1]) {
  const [bx, bz] = pt(args[1])
  const step = Number(args[2] ?? 0.5)
  const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step))
  for (let i = 0; i <= n; i++) points.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n])
} else {
  points.push([ax, az])
}

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
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
  await page.goto(`${url}/?seed=hearth-0&ticks=1`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 60_000 })

  const reports = await page.evaluate((ps) => ps.map(([x, z]) => window.__sinter.probe(x, z)), points)

  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i]
    const r = reports[i]
    console.log(`\n(${x.toFixed(2)}, ${z.toFixed(2)})  terrain ${r.terrain.toFixed(3)}`)
    if (r.standing.length) {
      console.log(
        '  stand   ' +
          r.standing.map((s) => `top ${s.top.toFixed(2)} ${s.shape}`).join('  '),
      )
    }
    if (r.blocking.length) {
      console.log(
        '  block   ' +
          r.blocking.map((b) => `${b.label} ${b.shape} in ${b.overlap.toFixed(2)}`).join('  '),
      )
    }
    for (const m of r.over) {
      const gap = m.y0 - r.terrain
      const flag = gap > 0.12 && m.y1 - m.y0 < 3 ? '  <-- floats' : ''
      console.log(`  mesh    ${m.name.padEnd(22)} y ${m.y0.toFixed(2)}..${m.y1.toFixed(2)}  #${m.mat}${flag}`)
    }
  }
} finally {
  await browser.close()
  proc.kill()
}
