/**
 * Can you find the character?
 *
 *   node tools/vibecheck/legible.mjs
 *   node tools/vibecheck/legible.mjs --only pond,oak --ticks 240
 *
 * The one thing a screenshot sweep cannot tell you by itself. A frame can be
 * correct in every measurable way and still be one in which the player has no
 * idea where they are, because the figure is the same value as the grass, or
 * because a pine is drawn over the top of them. Max's own example for this tool
 * was "yellow character on top of tree", which is a legibility claim and
 * nothing else.
 *
 * Method: project the character's own bounding box through the live camera to
 * get its screen rectangle, then compare the pixels inside it against a ring of
 * background just outside it. Two numbers come out.
 *
 *   VALUE    the greyscale gap between the figure and its surroundings. This is
 *            the classic test — squint, or desaturate, and see whether the
 *            silhouette survives. Colour cannot rescue a figure that sits at
 *            the same value as what is behind it, and an orange tunic on orange
 *            dirt sits at exactly the same value.
 *   FADING   how many occluders the game has decided are in the way and is
 *            currently dissolving. A low VALUE with FADING at zero is the bad
 *            case: the figure is lost and nothing has noticed.
 *
 * Neither number is the verdict. Both are pointers: the tool writes a magnified
 * crop of every character it measured, and the crops are the evidence. A metric
 * that says "0.3% of pixels changed" told nobody anything on this project; a
 * magnified crop found the bug in ten seconds.
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT = join(ROOT, '.shots/vibe/legible')

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const SEED = arg('seed', 'hearth-0')
const TICKS = Number(arg('ticks', '240'))
const W = Number(arg('width', '1600'))
const H = Number(arg('height', '900'))
const ONLY = arg('only', '').split(',').map((s) => s.trim()).filter(Boolean)
const SCALE = Number(arg('scale', '5'))

/** Reported when the figure is this close in value to what is behind it. */
const VALUE_FLOOR = 34

const { SHOTS } = await import('./shots.ts')
const specs = ONLY.length ? SHOTS.filter((s) => ONLY.some((o) => s.name.includes(o))) : SHOTS

const proc = spawn('npx', ['vite', '--port', '0'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
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

const rows = []
/** name -> PNG bytes, written after the browser is shut. Vite watches `.shots/`,
 *  so writing during the run reloads every page still open. */
const crops = new Map()

try {
  for (const spec of specs) {
    // Inside the try, not outside it. Several agents share this machine and one
    // of them killed the browser mid-run; `newPage` threw where nothing caught
    // it, the process died on the spot, and every crop measured up to that
    // point was lost because they are all written at the end. A measurement
    // tool that discards its own results on the last step is worse than one
    // that never ran, because it costs the same and reports nothing.
    let page = null
    try {
      page = await browser.newPage({ viewport: { width: W, height: H } })
      await page.goto(
        `${url}/?seed=${encodeURIComponent(SEED)}&ticks=${TICKS}&at=${encodeURIComponent(`${spec.x},${spec.z}`)}`,
        { waitUntil: 'load', timeout: 60_000 },
      )
      await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 60_000 })

      const shot = await page.evaluate(
        ({ w, h }) => {
          const p = window.__sinter.pos()
          // A box the size of a person, centred on where they stand. Measured
          // in world space and projected, rather than guessed in pixels, so it
          // stays right if the camera zoom or the character's height changes.
          const HALF = 0.42
          const TALL = 1.8
          let x0 = Infinity
          let y0 = Infinity
          let x1 = -Infinity
          let y1 = -Infinity
          for (const dx of [-HALF, HALF]) {
            for (const dz of [-HALF, HALF]) {
              for (const dy of [0, TALL]) {
                const v = window.__sinter.project(p.x + dx, p.y + dy, p.z + dz)
                const sx = (v.x * 0.5 + 0.5) * w
                const sy = (1 - (v.y * 0.5 + 0.5)) * h
                x0 = Math.min(x0, sx)
                y0 = Math.min(y0, sy)
                x1 = Math.max(x1, sx)
                y1 = Math.max(y1, sy)
              }
            }
          }
          const box = {
            x0: Math.max(0, Math.floor(x0)),
            y0: Math.max(0, Math.floor(y0)),
            x1: Math.min(w, Math.ceil(x1)),
            y1: Math.min(h, Math.ceil(y1)),
          }

          // A margin of background all round, wide enough to be what the eye
          // compares the figure against and narrow enough to still be the same
          // surface the figure is standing on.
          const pad = Math.round((box.x1 - box.x0) * 0.9)
          const ring = {
            x0: Math.max(0, box.x0 - pad),
            y0: Math.max(0, box.y0 - pad),
            x1: Math.min(w, box.x1 + pad),
            y1: Math.min(h, box.y1 + pad),
          }

          const src = document.querySelector('canvas')
          const pad2 = document.createElement('canvas')
          pad2.width = w
          pad2.height = h
          const ctx = pad2.getContext('2d', { willReadFrequently: true })
          ctx.drawImage(src, 0, 0, w, h)
          const grab = (r) => ({
            ...r,
            w: r.x1 - r.x0,
            h: r.y1 - r.y0,
            data: Array.from(ctx.getImageData(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0).data),
          })

          // Everything that could be drawn in front of the figure, and whether
          // it is currently faded out of the way.
          const occ = window.__sinter.occluders().filter((o) => o.opacity < 0.99)
          return { pos: p, box: grab(box), ring: grab(ring), fading: occ.length }
        },
        { w: W, h: H },
      )

      const lum = (d, i) => 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]

      // Background: the ring, minus the rectangle the figure sits in.
      const bg = []
      const r = shot.ring
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const gx = r.x0 + x
          const gy = r.y0 + y
          if (gx >= shot.box.x0 && gx < shot.box.x1 && gy >= shot.box.y0 && gy < shot.box.y1) continue
          bg.push(lum(r.data, y * r.w + x))
        }
      }
      bg.sort((a, b) => a - b)
      const bgMid = bg[Math.floor(bg.length / 2)] ?? 0
      const bgLo = bg[Math.floor(bg.length * 0.1)] ?? 0
      const bgHi = bg[Math.floor(bg.length * 0.9)] ?? 255

      // The figure's own rectangle contains background too, so the honest
      // question is not "how different is the average" but "is ANY of it
      // clearly separated". Take the strongest 8% and ask how far out it gets.
      const b = shot.box
      const gaps = []
      for (let i = 0; i < b.w * b.h; i++) {
        const l = lum(b.data, i)
        gaps.push(l < bgMid ? bgLo - l : l - bgHi)
      }
      gaps.sort((p, q) => q - p)
      const value = gaps[Math.floor(gaps.length * 0.08)] ?? 0

      rows.push({
        name: spec.name,
        note: spec.note,
        value: Math.round(value),
        fading: shot.fading,
        box: `${b.x0},${b.y0} ${b.w}x${b.h}`,
      })

      // The crop, at a size a person can actually judge.
      const png = new PNG({ width: r.w * SCALE, height: r.h * SCALE })
      for (let y = 0; y < r.h * SCALE; y++) {
        for (let x = 0; x < r.w * SCALE; x++) {
          const s = (Math.floor(y / SCALE) * r.w + Math.floor(x / SCALE)) * 4
          const d = (y * r.w * SCALE + x) * 4
          png.data[d] = r.data[s]
          png.data[d + 1] = r.data[s + 1]
          png.data[d + 2] = r.data[s + 2]
          png.data[d + 3] = 255
        }
      }
      crops.set(spec.name, PNG.sync.write(png))
      process.stdout.write('.')
    } catch (e) {
      rows.push({ name: spec.name, note: spec.note, value: null, fading: 0, box: String(e).slice(0, 60) })
      process.stdout.write('X')
    } finally {
      await page?.close().catch(() => {})
    }
  }
} finally {
  await browser.close()
  proc.kill()
}

await mkdir(OUT, { recursive: true })
for (const [name, png] of crops) await writeFile(join(OUT, `${name}.png`), png)

process.stdout.write('\n\n')
rows.sort((a, b) => (a.value ?? 999) - (b.value ?? 999))
console.log('worst first. VALUE is the greyscale gap between figure and background.')
console.log('value  fading  place                     box')
for (const row of rows) {
  const flag = row.value === null ? ' FAILED' : row.value < VALUE_FLOOR ? ' <- hard to see' : ''
  console.log(
    `${String(row.value ?? '-').padStart(5)}  ${String(row.fading).padStart(6)}  ${row.name.padEnd(24)}  ${row.box}${flag}`,
  )
}
console.log(`\ncrops -> ${OUT}   LOOK AT THEM. The number only says where to look.`)
