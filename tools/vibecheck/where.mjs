/**
 * Point at a pixel in a screenshot and ask what is there, in world coordinates.
 *
 *   node tools/vibecheck/where.mjs 640,212           # at the default camera pose
 *   node tools/vibecheck/where.mjs 640,212 --at 0.3,12.4 --size 1600x900
 *
 * The gap this fills: every other instrument in this repo goes one way. `probe`
 * answers "what is at world (x, z)", and a screenshot answers "what does the
 * frame look like". Neither answers the question you actually have when you see
 * something wrong in a picture, which is "what IS that". Guessing world
 * coordinates from an isometric frame by eye is unreliable enough that a
 * floating beam survived one whole debugging session unidentified.
 *
 * How: under an orthographic camera the world-to-NDC map is affine, so
 * projecting the origin and the three unit vectors recovers it exactly. A pixel
 * plus an assumed height is then two equations in x and z. Height is the one
 * thing a single pixel cannot tell you, so this sweeps a range of heights and
 * reports, for each, what mesh actually occupies that column at that height.
 * The row where a mesh brackets the assumed height is the answer.
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const pixel = argv.find((a) => /^\d+,\d+$/.test(a))
if (!pixel) {
  console.error('usage: node tools/vibecheck/where.mjs <px,py> [--at x,z] [--size WxH] [--seed s] [--ticks n]')
  process.exit(2)
}
const [PX, PY] = pixel.split(',').map(Number)
const AT = arg('at', '0.3,12.4')
const [W, H] = arg('size', '1600x900').split('x').map(Number)
const SEED = arg('seed', 'hearth-0')
const TICKS = Number(arg('ticks', '240'))
const YMIN = Number(arg('ymin', '0'))
const YMAX = Number(arg('ymax', '6'))
const YSTEP = Number(arg('ystep', '0.5'))

const proc = spawn('npx', ['vite', '--port', '0'], {
  cwd: resolve(import.meta.dirname, '../..'),
  stdio: ['ignore', 'pipe', 'pipe'],
})
const url = await new Promise((res, rej) => {
  const timer = setTimeout(() => rej(new Error('vite did not start')), 45_000)
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
  const page = await browser.newPage({ viewport: { width: W, height: H } })
  await page.goto(
    `${url}/?seed=${encodeURIComponent(SEED)}&ticks=${TICKS}&at=${encodeURIComponent(AT)}`,
    { waitUntil: 'load', timeout: 60_000 },
  )
  await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 60_000 })

  // Four projections recover the affine map exactly. Under a perspective camera
  // this would be wrong and the numbers would be plausible anyway, which is the
  // dangerous kind of wrong; the camera here is orthographic by design (see
  // CLAUDE.md) and this tool is only correct for as long as that holds.
  const basis = await page.evaluate(() => {
    const p = window.__sinter.project
    return { o: p(0, 0, 0), ex: p(1, 0, 0), ey: p(0, 1, 0), ez: p(0, 0, 1) }
  })

  const toPx = (ndc) => ({ x: (ndc.x * 0.5 + 0.5) * W, y: (1 - (ndc.y * 0.5 + 0.5)) * H })
  const O = toPx(basis.o)
  const EX = toPx(basis.ex)
  const EY = toPx(basis.ey)
  const EZ = toPx(basis.ez)
  const col = (e) => ({ x: e.x - O.x, y: e.y - O.y })
  const ax = col(EX)
  const ay = col(EY)
  const az = col(EZ)

  // px = O + x*ax + y*ay + z*az. With y fixed, a 2x2 solve in (x, z).
  const det = ax.x * az.y - az.x * ax.y
  if (Math.abs(det) < 1e-9) throw new Error('camera basis is degenerate; x and z project to the same screen line')

  const rows = []
  for (let y = YMIN; y <= YMAX + 1e-9; y += YSTEP) {
    const rx = PX - O.x - y * ay.x
    const rz = PY - O.y - y * ay.y
    const x = (rx * az.y - az.x * rz) / det
    const z = (ax.x * rz - rx * ax.y) / det
    rows.push({ y: +y.toFixed(2), x: +x.toFixed(2), z: +z.toFixed(2) })
  }

  const reports = await page.evaluate((ps) => ps.map((p) => window.__sinter.probe(p.x, p.z)), rows)

  console.log(`pixel (${PX}, ${PY})  at=${AT}  ${W}x${H}  seed=${SEED} ticks=${TICKS}`)
  console.log(`screen metres: +1x = (${ax.x.toFixed(1)}, ${ax.y.toFixed(1)})px  +1y = (${ay.x.toFixed(1)}, ${ay.y.toFixed(1)})px  +1z = (${az.x.toFixed(1)}, ${az.y.toFixed(1)})px\n`)
  console.log('assume height   world (x, z)      terrain   mesh occupying that height there')
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const rep = reports[i]
    // The mesh whose vertical span brackets the assumed height is the one a ray
    // through this pixel would hit if the assumption were right.
    const hits = rep.over.filter((m) => m.y0 - 0.05 <= r.y && r.y <= m.y1 + 0.05)
    const label = hits.length
      ? hits.map((m) => `${m.name} ${m.y0.toFixed(2)}..${m.y1.toFixed(2)} #${m.mat}`).join(' | ')
      : '-'
    const onGround = Math.abs(r.y - rep.terrain) < 0.2 ? ' <- ground level' : ''
    console.log(
      `  y ${String(r.y).padStart(5)}      (${String(r.x).padStart(7)}, ${String(r.z).padStart(7)})   ${rep.terrain.toFixed(2).padStart(6)}   ${label}${onGround}`,
    )
  }
} finally {
  await browser.close()
  proc.kill()
}
