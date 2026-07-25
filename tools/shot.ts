/**
 * Headless screenshot harness.
 *
 * This is the most important tool in the repo. It is how an agent working on
 * this codebase looks at what it actually built instead of assuming the code
 * is right. See CLAUDE.md, "Verify your own work".
 *
 *   npm run shot
 *   npm run shot -- --seed hearth-7 --ticks 300 --out .shots/fire-after.png
 *
 * Boots the game headless at a fixed seed, runs N deterministic simulation
 * ticks with no wall clock involved, renders one frame, writes a PNG.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

interface Args {
  seed: string
  ticks: number
  out: string
  width: number
  height: number
  /** "x,z" — lights the nearest flammable thing on boot, for before/after shots. */
  ignite: string
  /** "x,z" — where the player starts, so a shot can frame a specific place. */
  at: string
  /** Comma-separated item ids to put in the pack, which also opens the panel. */
  pack: string
  /** Two pack indices to load into the merge bench, e.g. "0,1". Needs --pack. */
  slots: string
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback: string): string => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback
  }
  const seed = get('seed', 'hearth-0')
  return {
    seed,
    ticks: Number(get('ticks', '240')),
    out: get('out', `.shots/${seed}.png`),
    width: Number(get('width', '1600')),
    height: Number(get('height', '900')),
    ignite: get('ignite', ''),
    at: get('at', ''),
    pack: get('pack', ''),
    slots: get('slots', ''),
  }
}

async function startDevServer(): Promise<{ url: string; proc: ChildProcess }> {
  const proc = spawn('npx', ['vite', '--port', '5199', '--strictPort'], {
    cwd: resolve(import.meta.dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const url = await new Promise<string>((res, rej) => {
    const timer = setTimeout(() => rej(new Error('vite did not start within 30s')), 30_000)
    proc.stdout?.on('data', (chunk: Buffer) => {
      const m = /(http:\/\/localhost:\d+)/.exec(chunk.toString())
      if (m?.[1]) {
        clearTimeout(timer)
        res(m[1])
      }
    })
    proc.stderr?.on('data', (c: Buffer) => process.stderr.write(c))
    proc.on('exit', (code) => {
      clearTimeout(timer)
      rej(new Error(`vite exited early with code ${code}`))
    })
  })

  return { url, proc }
}

const args = parseArgs(process.argv.slice(2))
const { url, proc } = await startDevServer()

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})

try {
  const page = await browser.newPage({ viewport: { width: args.width, height: args.height } })

  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  const extra =
    (args.ignite ? `&ignite=${encodeURIComponent(args.ignite)}` : '') +
    (args.at ? `&at=${encodeURIComponent(args.at)}` : '') +
    (args.pack ? `&pack=${encodeURIComponent(args.pack)}` : '') +
    (args.slots ? `&slots=${encodeURIComponent(args.slots)}` : '')
  const target = `${url}/?seed=${encodeURIComponent(args.seed)}&ticks=${args.ticks}${extra}`
  await page.goto(target, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 30_000 })

  await mkdir(dirname(args.out), { recursive: true })
  await page.screenshot({ path: args.out })

  console.log(`wrote ${args.out}  (seed=${args.seed} ticks=${args.ticks})`)
  if (errors.length > 0) {
    console.error(`\n${errors.length} console error(s):`)
    for (const e of errors) console.error(`  ${e}`)
    process.exitCode = 1
  }
} finally {
  await browser.close()
  proc.kill()
}
