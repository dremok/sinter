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
import { magnify, tile2x2 } from './image'
import { SPECS } from './prompts'

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
    // A blank page on the dev server's origin, so a module import is same-origin.
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
    console.log(`${spec.name}: drawn ${old.width}px vs baked ${baked.width}px`)
  }

  console.log(`\nwrote to ${dir}. Left is code-drawn, right is baked.`)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : String(err))
  process.exitCode = 1
})
