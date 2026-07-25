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
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { SHOTS, type ShotSpec } from './shots'
import { decodePng, diff } from './png'

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

async function takeShot(browser: Browser, url: string, spec: ShotSpec): Promise<string[]> {
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
    await page.screenshot({ path: join(CURRENT, `${spec.name}.png`) })
    return errors
  } finally {
    await page.close()
  }
}

async function compare(spec: ShotSpec): Promise<Pick<Result, 'changed' | 'box' | 'isNew'>> {
  const basePath = join(BASELINE, `${spec.name}.png`)
  if (!existsSync(basePath)) return { changed: null, box: null, isNew: true }
  const [a, b] = await Promise.all([readFile(basePath), readFile(join(CURRENT, `${spec.name}.png`))])
  const d = diff(decodePng(a), decodePng(b))
  return { changed: d.changed, box: d.box, isNew: false }
}

const specs = ONLY.length > 0 ? SHOTS.filter((s) => ONLY.some((o) => s.name.includes(o))) : SHOTS

await mkdir(CURRENT, { recursive: true })
const { url, proc } = await startDevServer()
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})

const results: Result[] = []
try {
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      const spec = specs[i]
      if (!spec) return
      let errors: string[] = []
      let ok = false
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          errors = await takeShot(browser, url, spec)
          ok = true
        } catch (e) {
          errors = [String(e)]
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        }
      }
      const cmp = ok ? await compare(spec) : { changed: null, box: null, isNew: false }
      results.push({ spec, ok, errors, ...cmp })
      process.stdout.write(`${ok ? '.' : 'X'}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
} finally {
  await browser.close()
  proc.kill()
}

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
