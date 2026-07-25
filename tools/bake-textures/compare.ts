/**
 * Put the baked textures next to the code-drawn ones and look at both.
 *
 *   npx tsx tools/bake-textures/compare.ts
 *   npx tsx tools/bake-textures/compare.ts --out /tmp/compare
 *
 * The question this bake has to answer is not "are these textures any good" but
 * "are these better than what is already in `src/render/textures.ts`", and the
 * honest answer needs both images on screen at the same size. The code-drawn
 * tiles only exist inside a browser, since they are drawn into a canvas, so this
 * boots the repo's own Vite dev server, imports `render/textures.ts` from it,
 * builds the set at a fixed seed, and reads each canvas back out.
 *
 * Same trick as `tools/shot.ts`, and it borrows its port discipline: a private
 * server on a port nothing else uses, torn down at the end.
 *
 * Writes one PNG per material: the code-drawn tile on the left, the baked one on
 * the right, both laid out 2x2 so a seam has somewhere to show itself, both
 * magnified with nearest-neighbour so texels stay texels.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import { decodePng, encodeIndexedPng, type Bitmap } from './png'
import { inspectTiling, magnify, tile2x2 } from './image'
import { SPECS } from './prompts'

/**
 * Mean neighbour luminance delta over 255, wrapped.
 *
 * A second noise metric, kept alongside the Oklab one in `inspectTiling`,
 * because the two are not interchangeable and a comparison between them is
 * meaningless. Oklab distance is chroma-weighted and perceptually scaled;
 * this one is a plain luminance difference in display units. On the same tile
 * they differ by a factor of several, so quoting one texture's Oklab busyness
 * against another texture's luma busyness overstates the gap badly.
 *
 * Both are printed for both sets below, so whichever number a reviewer prefers,
 * they are comparing like with like.
 */
function lumaBusyness(b: Bitmap): number {
  const { width: w, height: h, data } = b
  const lum = (x: number, y: number) => {
    const i = ((((y % h) + h) % h) * w + ((((x % w) + w) % w))) * 4
    return 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
  }
  let sum = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      sum += Math.abs(lum(x + 1, y) - lum(x, y)) + Math.abs(lum(x, y + 1) - lum(x, y))
    }
  }
  return sum / (w * h * 2) / 255
}

/**
 * Mean HSV saturation and hue.
 *
 * Saturation is the axis Max complained about by name ("too harsh and too
 * saturated, hurts my eyes"), and `palette.ts` budgets it by role: 30-40% for
 * ground and terrain, 50-80% for items. So it belongs in the standing
 * comparison rather than in a one-off script.
 *
 * Note what this can and cannot show for a baked tile. Every texel in one is a
 * step of a ramp in `palette.ts`, which `bake:verify` checks, so a baked texture
 * cannot be off-ramp. What it can be is unevenly *distributed* over its ramps:
 * leaning on the light end, which is the most chromatic part of most ramps, or
 * spending more of itself on an accent ramp than the code-drawn version does.
 * That is a real difference and this is what measures it.
 */
function meanSaturation(b: Bitmap): { sat: number; hue: number } {
  const n = b.width * b.height
  let sat = 0
  let hx = 0
  let hy = 0
  for (let i = 0; i < n; i++) {
    const r = b.data[i * 4]! / 255
    const g = b.data[i * 4 + 1]! / 255
    const bl = b.data[i * 4 + 2]! / 255
    const max = Math.max(r, g, bl)
    const min = Math.min(r, g, bl)
    const d = max - min
    sat += max === 0 ? 0 : d / max
    if (d > 0) {
      let h: number
      if (max === r) h = ((g - bl) / d) % 6
      else if (max === g) h = (bl - r) / d + 2
      else h = (r - g) / d + 4
      const rad = (h * 60 * Math.PI) / 180
      // Averaged as a vector, since hue wraps and a plain mean of 350 and 10 is 180.
      hx += Math.cos(rad) * d
      hy += Math.sin(rad) * d
    }
  }
  let hue = (Math.atan2(hy, hx) * 180) / Math.PI
  if (hue < 0) hue += 360
  return { sat: sat / n, hue }
}

/** How the tile spends itself across a palette, as a share per entry. */
function paletteHistogram(b: Bitmap, palette: readonly string[]): number[] {
  const index = new Map(palette.map((h, i) => [parseInt(h.slice(1), 16), i]))
  const counts = new Array(palette.length).fill(0) as number[]
  const n = b.width * b.height
  for (let i = 0; i < n; i++) {
    const key = (b.data[i * 4]! << 16) | (b.data[i * 4 + 1]! << 8) | b.data[i * 4 + 2]!
    const at = index.get(key)
    if (at !== undefined) counts[at]!++
  }
  return counts.map((c) => c / n)
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PORT = 5201

function outDir(argv: string[]): string {
  const i = argv.indexOf('--out')
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]!) : resolve(ROOT, '.shots/texture-compare')
}

async function startVite(): Promise<ChildProcess> {
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('vite did not start')), 30_000)
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('ready in') || chunk.toString().includes(String(PORT))) {
        clearTimeout(timer)
        ok()
      }
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      fail(new Error(`vite exited with ${code}`))
    })
  })
  return proc
}

/** Every code-drawn tile, as raw RGBA, straight out of its canvas. */
async function drawnTextures(): Promise<Map<string, Bitmap>> {
  const proc = await startVite()
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()

    // Load index.html for its origin, but stop the game from booting on it.
    //
    // This tool only needs a same-origin document to import a module into; it
    // has no interest in the game running. Letting it run makes the comparison
    // hostage to whatever state `src/` happens to be in, and that is not
    // hypothetical: a `ReferenceError` in region.ts tore down the execution
    // context mid-evaluate and this tool started failing for a reason that had
    // nothing to do with textures. Aborting the entry module keeps it working
    // while the rest of the repo is halfway through something.
    await page.route('**/src/main.ts', (route) => route.abort())
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })

    const raw = await page.evaluate(async () => {
      // Specifiers held in variables on purpose. These are dev-server URLs that
      // only resolve inside the browser, and a literal would send `tsc` looking
      // for a module at the filesystem root.
      // Annotated as `string`, not left to inference. A `const` holding a
      // string literal keeps its literal TYPE, so tsc still resolved these and
      // went looking for a module at the filesystem root. Widening to `string`
      // is what actually makes the specifier opaque to it.
      const texUrl: string = '/src/render/textures.ts'
      const rngUrl: string = '/src/core/rng.ts'
      const tex = (await import(texUrl)) as {
        textures: (r: unknown) => Record<string, unknown>
      }
      const { createRng } = (await import(rngUrl)) as { createRng: (s: string) => unknown }
      const set = tex.textures(createRng('hearth-0'))
      const out: Record<string, { w: number; h: number; data: number[] }> = {}
      for (const [name, t] of Object.entries(set)) {
        const canvas = (t as { image: HTMLCanvasElement }).image
        const ctx = canvas.getContext('2d')!
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        out[name] = { w: canvas.width, h: canvas.height, data: Array.from(img.data) }
      }
      return out
    })

    const map = new Map<string, Bitmap>()
    for (const [name, v] of Object.entries(raw)) {
      map.set(name, { width: v.w, height: v.h, data: Uint8Array.from(v.data) })
    }
    return map
  } finally {
    await browser.close()
    proc.kill()
  }
}

/** Two tiles side by side with a dark gutter between them. */
function pair(left: Bitmap, right: Bitmap, gutter = 12): Bitmap {
  const h = Math.max(left.height, right.height)
  const w = left.width + gutter + right.width
  const out = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = 24
    out[i * 4 + 1] = 24
    out[i * 4 + 2] = 28
    out[i * 4 + 3] = 255
  }
  const blit = (src: Bitmap, ox: number) => {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const s = (y * src.width + x) * 4
        const o = (y * w + x + ox) * 4
        out[o] = src.data[s]!
        out[o + 1] = src.data[s + 1]!
        out[o + 2] = src.data[s + 2]!
      }
    }
  }
  blit(left, 0)
  blit(right, left.width + gutter)
  return { width: w, height: h, data: out }
}

/**
 * Reduce to at most 256 colours so the sheet can be written as an indexed PNG.
 *
 * The code-drawn tiles are already inside their ramps, so in practice this only
 * ever fires on the gutter, but a comparison sheet that throws instead of
 * rendering would be a silly way to lose the review.
 */
function capColours(bmp: Bitmap): Bitmap {
  const seen = new Set<number>()
  for (let i = 0; i < bmp.width * bmp.height; i++) {
    seen.add((bmp.data[i * 4]! << 16) | (bmp.data[i * 4 + 1]! << 8) | bmp.data[i * 4 + 2]!)
  }
  if (seen.size <= 256) return bmp
  const out = new Uint8Array(bmp.data.length)
  for (let i = 0; i < bmp.data.length; i += 4) {
    out[i] = bmp.data[i]! & 0xf0
    out[i + 1] = bmp.data[i + 1]! & 0xf0
    out[i + 2] = bmp.data[i + 2]! & 0xf0
    out[i + 3] = 255
  }
  return { width: bmp.width, height: bmp.height, data: out }
}

async function main(): Promise<void> {
  const dir = outDir(process.argv.slice(2))
  mkdirSync(dir, { recursive: true })

  console.log('building the code-drawn set in a headless browser...')
  const drawn = await drawnTextures()
  const rows: { name: string; drawn: Bitmap; baked: Bitmap }[] = []

  for (const spec of SPECS) {
    const bakedPath = resolve(ROOT, `assets/baked/textures/${spec.name}.png`)
    if (!existsSync(bakedPath)) {
      console.log(`${spec.name}: not baked, skipped`)
      continue
    }
    const baked = decodePng(new Uint8Array(readFileSync(bakedPath)))
    const old = drawn.get(spec.name)
    if (!old) {
      console.log(`${spec.name}: no code-drawn counterpart`)
      continue
    }

    // Both tiles are shown at the same *world* scale, not the same pixel scale,
    // which is the only comparison that means anything: the pair only has to
    // agree if the two files are the same size, and they are by construction.
    const scale = Math.max(1, Math.round(384 / baked.width))
    const sheet = capColours(
      pair(magnify(tile2x2(old), scale), magnify(tile2x2(baked), scale)),
    )
    writeFileSync(resolve(dir, `${spec.name}.png`), encodeIndexedPng(sheet))
    rows.push({ name: spec.name, drawn: old, baked })
  }

  console.log(`\nwrote to ${dir}. Left is code-drawn, right is baked.\n`)

  // "Is the bake noisier than the code?" is the question that decides whether a
  // set ships, so answer it with numbers rather than with adjectives, and give
  // both metrics so nobody has to trust the choice of one.
  console.log('                 oklab busyness          luma busyness')
  console.log('name        drawn   baked  ratio    drawn   baked  ratio')
  for (const r of rows) {
    const dO = inspectTiling(r.drawn).busyness
    const bO = inspectTiling(r.baked).busyness
    const dL = lumaBusyness(r.drawn)
    const bL = lumaBusyness(r.baked)
    const ratio = (a: number, b: number) => (a === 0 ? '  n/a' : `${(b / a).toFixed(1)}x`.padStart(5))
    console.log(
      `${r.name.padEnd(10)} ${dO.toFixed(4)}  ${bO.toFixed(4)}  ${ratio(dO, bO)}   ` +
        `${dL.toFixed(4)}  ${bL.toFixed(4)}  ${ratio(dL, bL)}`,
    )
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : String(err))
  process.exitCode = 1
})
