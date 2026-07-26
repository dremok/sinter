/**
 * The sweep. Takes the whole shot list in one run and diffs it against the
 * accepted baseline.
 *
 *   npx tsx tools/vibecheck/sweep.ts
 *   npx tsx tools/vibecheck/sweep.ts --only home,pond      # substring filter
 *   npx tsx tools/vibecheck/sweep.ts --ticks 40 --seed hearth-0
 *
 * Why this is not a loop around `npm run shot`: that spawns a Vite server and
 * a Chromium for every single frame, which for a forty-shot sweep is forty
 * cold starts, and several agents are taking screenshots at the same time. One
 * server and one browser for the whole sweep is the same headless contract
 * (`?seed=&ticks=&at=`, wait for `__sinterReady`) at a fraction of the load,
 * and load is exactly what makes a shot fail spuriously.
 *
 * Every shot gets retried on its own page. A shot that fails twice is reported
 * as FAILED rather than skipped, because a missing frame is the one thing a
 * visual check must never quietly swallow.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile, readdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { SHOTS, type ShotSpec } from './shots'
import { decodePng, diff, type Image } from './png'

const ROOT = resolve(import.meta.dirname, '../..')
const CURRENT = join(ROOT, '.shots/vibe/current')
const BASELINE = join(ROOT, '.shots/vibe/baseline')

const argv = process.argv.slice(2)
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback
}

const SEED = arg('seed', 'hearth-0')
const TICKS = Number(arg('ticks', '40'))
const WIDTH = Number(arg('width', '1600'))
const HEIGHT = Number(arg('height', '900'))
const ONLY = arg('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
/** Two at a time. Software GL, and other agents are on the same machine. */
const CONCURRENCY = Number(arg('jobs', '2'))

async function startDevServer(): Promise<{ url: string; proc: ChildProcess }> {
  const proc = spawn('npx', ['vite', '--port', '0'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  const url = await new Promise<string>((res, rej) => {
    const timer = setTimeout(() => rej(new Error('vite did not start within 45s')), 45_000)
    proc.stdout?.on('data', (chunk: Buffer) => {
      const m = /(http:\/\/localhost:\d+)/.exec(chunk.toString())
      if (m?.[1]) {
        clearTimeout(timer)
        res(m[1])
      }
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      rej(new Error(`vite exited early with code ${code}`))
    })
  })
  return { url, proc }
}

interface Result {
  spec: ShotSpec
  ok: boolean
  errors: string[]
  changed: number | null
  box: { x0: number; y0: number; x1: number; y1: number } | null
  isNew: boolean
}

/**
 * Is this frame actually a picture of the world?
 *
 * A sweep is worthless if it can quietly record a blank frame, and it recorded
 * one: Vite watches the whole project, `.shots/` is inside the project, so
 * every screenshot this tool wrote reloaded every other page it had open. One
 * shot came back pure black with only the HUD on it and was reported as a
 * clean pass. Screenshots are now held in memory until the browser is shut,
 * which removes the cause, and this checks the symptom anyway, because the
 * next thing that blanks a frame will not be Vite.
 */
function isBlank(img: Image): boolean {
  let lit = 0
  const n = img.width * img.height
  for (let p = 0; p < n; p += 7) {
    const l = img.data[p * 4]! + img.data[p * 4 + 1]! + img.data[p * 4 + 2]!
    if (l > 90) lit++
  }
  return lit / (n / 7) < 0.02
}

async function takeShot(
  browser: Browser,
  url: string,
  spec: ShotSpec,
): Promise<{ errors: string[]; png: Buffer }> {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  try {
    const target = `${url}/?seed=${encodeURIComponent(SEED)}&ticks=${TICKS}&at=${encodeURIComponent(`${spec.x},${spec.z}`)}`
    await page.goto(target, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 60_000 })
    // Never `{ path }`: writing inside the repo is what caused the blank frame.
    const png = await page.screenshot()
    if (isBlank(decodePng(png))) throw new Error('frame came back blank')
    return { errors, png }
  } finally {
    await page.close()
  }
}

function compare(spec: ShotSpec, png: Buffer): Pick<Result, 'changed' | 'box' | 'isNew'> {
  const basePath = join(BASELINE, `${spec.name}.png`)
  if (!existsSync(basePath)) return { changed: null, box: null, isNew: true }
  const d = diff(decodePng(readFileSync(basePath)), decodePng(png))
  return { changed: d.changed, box: d.box, isNew: false }
}

const specs = ONLY.length > 0 ? SHOTS.filter((s) => ONLY.some((o) => s.name.includes(o))) : SHOTS

await mkdir(CURRENT, { recursive: true })
const { url, proc } = await startDevServer()
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})

const results: Result[] = []
/** name -> PNG bytes. Held until the browser is shut; see `takeShot`. */
const captured = new Map<string, Buffer>()
try {
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      const spec = specs[i]
      if (!spec) return
      let errors: string[] = []
      let png: Buffer | null = null
      for (let attempt = 0; attempt < 3 && !png; attempt++) {
        try {
          const shot = await takeShot(browser, url, spec)
          errors = shot.errors
          png = shot.png
        } catch (e) {
          errors = [String(e)]
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        }
      }
      if (png) captured.set(spec.name, png)
      const cmp = png ? compare(spec, png) : { changed: null, box: null, isNew: false }
      results.push({ spec, ok: png !== null, errors, ...cmp })
      process.stdout.write(png ? '.' : 'X')
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
} finally {
  await browser.close()
  proc.kill()
}

// Only now, with nothing left to reload.
for (const [name, png] of captured) await writeFile(join(CURRENT, `${name}.png`), png)

process.stdout.write('\n\n')

results.sort((a, b) => (b.changed ?? -1) - (a.changed ?? -1))
const failed = results.filter((r) => !r.ok)
const withErrors = results.filter((r) => r.ok && r.errors.length > 0)

console.log(`seed=${SEED} ticks=${TICKS} ${WIDTH}x${HEIGHT}  ${results.length} shots`)
if (failed.length > 0) {
  console.log(`\nFAILED (${failed.length}):`)
  for (const r of failed) console.log(`  ${r.spec.name}: ${r.errors[0]}`)
}
if (withErrors.length > 0) {
  console.log(`\nCONSOLE ERRORS (${withErrors.length}):`)
  for (const r of withErrors) console.log(`  ${r.spec.name}: ${r.errors.join(' | ')}`)
}

const known = results.filter((r) => r.changed !== null)
const fresh = results.filter((r) => r.isNew)
if (known.length > 0) {
  console.log(`\nCHANGED vs baseline (worst first):`)
  for (const r of known) {
    const pct = (r.changed! * 100).toFixed(2)
    const where = r.box ? `  box ${r.box.x0},${r.box.y0}..${r.box.x1},${r.box.y1}` : ''
    console.log(`  ${pct.padStart(6)}%  ${r.spec.name}${where}`)
  }
}
if (fresh.length > 0) console.log(`\nNO BASELINE (${fresh.length}): ${fresh.map((r) => r.spec.name).join(', ')}`)

await writeFile(
  join(CURRENT, 'sweep.json'),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      seed: SEED,
      ticks: TICKS,
      size: [WIDTH, HEIGHT],
      results: results.map((r) => ({ ...r.spec, ok: r.ok, changed: r.changed, box: r.box, errors: r.errors })),
    },
    null,
    2,
  ) + '\n',
)

const baselineCount = existsSync(BASELINE) ? (await readdir(BASELINE)).filter((f) => f.endsWith('.png')).length : 0
console.log(`\ncurrent -> ${CURRENT}  (baseline has ${baselineCount} shots)`)
if (failed.length > 0) process.exitCode = 1
