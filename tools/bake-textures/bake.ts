/**
 * The offline texture bake.
 *
 *   npm run bake:textures                  # everything missing or stale
 *   npm run bake:textures -- --only bark   # just these
 *   npm run bake:textures -- --force bark  # regenerate even if cached
 *   npm run bake:textures -- --review      # also write magnified 2x2 previews
 *   npm run bake:textures -- --plan        # print what would be spent, call nothing
 *
 * This is a developer-machine build step. Its output is committed and the
 * shipped game loads it as a static file: nothing under `src/` ever talks to
 * fal.ai, which is the constraint D8 and the README are built on.
 *
 * ## Resumability
 *
 * Every texture is keyed by a hash of its prompt, its parameters, its palette
 * and `PIPELINE_VERSION`. A texture whose hash matches the manifest and whose
 * PNG is on disk is skipped without a request. That matters because the failure
 * mode of a bake script is not a crash, it is a re-run that quietly spends the
 * credits again, and by the time anyone notices they have paid for the same
 * fourteen images four times.
 *
 * ## Nothing is trusted
 *
 * Everything that comes back is measured before it is committed: that it is the
 * size that was asked for, that opposite edges actually meet, that it has enough
 * value range to survive a three-band toon shader, and that it is made of shapes
 * rather than of noise. A failing image is regenerated with a clause appended to
 * the prompt naming the specific fault, on a new seed. After the last attempt
 * the tool gives up loudly and writes nothing, because a texture that is wrong
 * in the repo is worse than one that is missing: missing fails at boot, wrong
 * ships.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodePng, encodeIndexedPng, type Bitmap } from './png'
import {
  inspectTiling,
  labDistance,
  magnify,
  meanLab,
  oklabOfHex,
  reduce,
  sharpen,
  snapToPalette,
  tile2x2,
  type TileReport,
} from './image'
import { download, readEnvFile, run } from './fal'
import { MODEL, PIPELINE_VERSION, SPECS, type TextureSpec } from './prompts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT_DIR = resolve(ROOT, 'assets/baked/textures')
const MANIFEST = resolve(OUT_DIR, 'manifest.json')

// --------------------------------------------------------------- thresholds

/**
 * What counts as good enough to commit.
 *
 * The seam ceiling is the one number here with a principled value rather than a
 * measured one: the metric is a ratio against the tile's own interior contrast,
 * so 1.0 is "the edge is unremarkable" by construction and anything past about
 * 1.6 is a line a player can find. The rest were set by baking the first three
 * textures, printing the numbers, looking at the images, and picking a bound
 * that admitted the ones that looked right.
 */
interface Limits {
  seam: number
  /** Palette entries that must actually appear. */
  minUsed: number
  /** Share of the tile allowed to be one single colour. */
  maxDominance: number
  /** Mean neighbour-to-neighbour Oklab distance. The noise ceiling. */
  maxBusyness: number
  /** How far the mean colour may sit from the palette's mean. */
  maxDrift: number
}

const DEFAULT_LIMITS: Limits = {
  seam: 1.6,
  minUsed: 5,
  maxDominance: 0.62,
  maxBusyness: 0.075,
  maxDrift: 0.06,
}

/** Per-texture departures, each with a reason. */
const LIMIT_OVERRIDES: Record<string, Partial<Limits>> = {
  // Ripples are broad and low contrast on purpose, so this tile is legitimately
  // flatter and quieter than any other. Holding it to the general noise ceiling
  // would pass a pond that shimmers.
  water: { maxDominance: 0.72, maxBusyness: 0.035 },
  // One tile spans the whole region and carries variation at three scales, so
  // it has more edges in it than a prop tile does, and that is the point.
  grass: { maxBusyness: 0.1 },
  // A crust of dark plates with fire in the cracks is mostly crust.
  ember: { maxDominance: 0.7, maxBusyness: 0.12 },
  // The weave is two texels a thread, which is deliberately at the noise ceiling.
  cloth: { maxBusyness: 0.11 },
}

function limitsFor(spec: TextureSpec): Limits {
  return { ...DEFAULT_LIMITS, ...LIMIT_OVERRIDES[spec.name] }
}

// ------------------------------------------------------------------ manifest

interface Entry {
  hash: string
  size: number
  worldUnits: number
  model: string
  seed: number
  bytes: number
  generatedAt: string
  metrics: { seamX: number; seamY: number; busyness: number; used: number; dominance: number }
}

type Manifest = Record<string, Entry>

function readManifest(): Manifest {
  if (!existsSync(MANIFEST)) return {}
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest
  } catch {
    return {}
  }
}

function hashOf(spec: TextureSpec): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        v: PIPELINE_VERSION,
        model: MODEL,
        prompt: spec.prompt,
        size: spec.size,
        source: spec.source,
        palette: spec.palette,
        stretch: spec.stretch,
        gamma: spec.gamma,
        sharpen: spec.sharpen,
      }),
    )
    .digest('hex')
    .slice(0, 16)
}

// --------------------------------------------------------------------- money

/**
 * PATINA is priced at $0.01 per call plus $0.02 per megapixel plus $0.01 per
 * megapixel per requested map. Only basecolor is requested: see the README in
 * `assets/baked/` for why the other four maps are not baked.
 */
function estimateCost(spec: TextureSpec): number {
  const mp = (spec.source * spec.source) / 1_000_000
  return 0.01 + mp * 0.02 + mp * 0.01
}

// ----------------------------------------------------------------- pipeline

interface Attempt {
  bitmap: Bitmap
  report: TileReport
  used: number
  dominance: number
  drift: number
  seed: number
  failures: string[]
}

function pipeline(spec: TextureSpec, source: Bitmap): Omit<Attempt, 'seed' | 'failures'> {
  const sharpened = sharpen(source, spec.sharpen)
  const small = reduce(sharpened, spec.size)
  const snapped = snapToPalette(small, {
    palette: spec.palette,
    stretch: spec.stretch,
    gamma: spec.gamma,
  })

  const labs = spec.palette.map(oklabOfHex)
  const paletteMean = {
    L: labs.reduce((a, p) => a + p.L, 0) / labs.length,
    a: labs.reduce((a, p) => a + p.a, 0) / labs.length,
    b: labs.reduce((a, p) => a + p.b, 0) / labs.length,
  }

  return {
    bitmap: snapped.bitmap,
    report: inspectTiling(snapped.bitmap),
    used: snapped.used,
    dominance: snapped.dominance,
    // Measured before snapping. After snapping the answer is trivially small,
    // which would make the check a tautology rather than a test of whether the
    // model painted the right material.
    drift: labDistance(meanLab(small), paletteMean),
  }
}

function judge(spec: TextureSpec, a: Omit<Attempt, 'seed' | 'failures'>): string[] {
  const lim = limitsFor(spec)
  const out: string[] = []
  if (a.report.seamX > lim.seam) out.push(`seamX ${a.report.seamX.toFixed(2)} > ${lim.seam}`)
  if (a.report.seamY > lim.seam) out.push(`seamY ${a.report.seamY.toFixed(2)} > ${lim.seam}`)
  if (a.used < lim.minUsed) out.push(`uses only ${a.used} palette steps, needs ${lim.minUsed}`)
  if (a.dominance > lim.maxDominance) {
    out.push(`${(a.dominance * 100).toFixed(0)}% one colour, max ${(lim.maxDominance * 100).toFixed(0)}%`)
  }
  if (a.report.busyness > lim.maxBusyness) {
    out.push(`busyness ${a.report.busyness.toFixed(3)} > ${lim.maxBusyness}`)
  }
  if (a.drift > lim.maxDrift) out.push(`colour drift ${a.drift.toFixed(3)} > ${lim.maxDrift}`)
  return out
}

/** Turn the specific fault into a specific instruction for the next attempt. */
function corrective(failures: string[]): string {
  const add: string[] = []
  if (failures.some((f) => f.startsWith('seam'))) {
    add.push(
      'The image must tile perfectly seamlessly: the left edge has to continue into ' +
        'the right edge and the top into the bottom, with no border, frame or vignette.',
    )
  }
  if (failures.some((f) => f.startsWith('busyness'))) {
    add.push(
      'Far fewer and much larger shapes. Almost no fine detail. Large flat areas of ' +
        'one tone carrying only a handful of deliberate marks.',
    )
  }
  if (failures.some((f) => f.includes('one colour') || f.includes('palette steps'))) {
    add.push(
      'Much stronger variation between light and dark across the image. Clearly ' +
        'lighter and clearly darker areas, not one flat tone.',
    )
  }
  if (failures.some((f) => f.startsWith('colour drift'))) {
    add.push('Stay strictly within the colours named above and keep the saturation low.')
  }
  return add.join(' ')
}

// --------------------------------------------------------------------- main

interface Args {
  only: string[]
  force: string[]
  review: boolean
  plan: boolean
  attempts: number
}

function parseArgs(argv: string[]): Args {
  const list = (name: string): string[] => {
    const i = argv.indexOf(`--${name}`)
    if (i < 0) return []
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) return ['all']
    return v.split(',').map((s) => s.trim()).filter(Boolean)
  }
  const num = (name: string, fallback: number): number => {
    const i = argv.indexOf(`--${name}`)
    const v = i >= 0 ? Number(argv[i + 1]) : NaN
    return Number.isFinite(v) ? v : fallback
  }
  return {
    only: list('only'),
    force: list('force'),
    review: argv.includes('--review'),
    plan: argv.includes('--plan'),
    attempts: num('attempts', 3),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const manifest = readManifest()
  mkdirSync(OUT_DIR, { recursive: true })

  const forcedAll = args.force.includes('all')
  const selected = SPECS.filter(
    (s) => args.only.length === 0 || args.only.includes('all') || args.only.includes(s.name),
  )
  if (args.only.length > 0 && !args.only.includes('all')) {
    for (const n of args.only) {
      if (!SPECS.some((s) => s.name === n)) throw new Error(`no texture named "${n}"`)
    }
  }

  const todo = selected.filter((spec) => {
    if (forcedAll || args.force.includes(spec.name)) return true
    const entry = manifest[spec.name]
    return !(entry && entry.hash === hashOf(spec) && existsSync(resolve(OUT_DIR, `${spec.name}.png`)))
  })

  const skipped = selected.length - todo.length
  console.log(
    `${selected.length} selected, ${skipped} already baked and current, ${todo.length} to generate.`,
  )
  if (todo.length > 0) {
    const cost = todo.reduce((n, s) => n + estimateCost(s), 0)
    console.log(
      `estimated ${todo.map((s) => s.name).join(', ')} — about $${cost.toFixed(2)} at one attempt each.`,
    )
  }
  if (args.plan || todo.length === 0) {
    if (args.plan) console.log('--plan: nothing was called.')
    return
  }

  const env = readEnvFile(resolve(ROOT, '.env'))
  const key = process.env.FAL_KEY || env.FAL_KEY
  if (!key) throw new Error('FAL_KEY not found in the environment or in .env')

  let spent = 0
  const failed: string[] = []

  for (const spec of todo) {
    console.log(`\n--- ${spec.name} (${spec.size}px, ${spec.worldUnits} world units)`)
    let committed = false
    /** Carried between attempts so a retry can name the fault it is fixing. */
    let lastFailures: string[] = []

    for (let attempt = 1; attempt <= args.attempts && !committed; attempt++) {
      const extra = attempt === 1 ? '' : ` ${corrective(lastFailures)}`
      const seed = 1000 + attempt * 7919 + spec.name.length * 31
      const result = await run(
        key,
        MODEL,
        {
          prompt: spec.prompt + extra,
          image_size: { width: spec.source, height: spec.source },
          maps: ['basecolor'],
          tiling_mode: 'both',
          // The endpoint rewrites a prompt by default. These prompts are the art
          // direction; an expansion that adds "dramatic lighting" undoes it.
          enable_prompt_expansion: false,
          output_format: 'png',
          num_images: 1,
          seed,
        },
        { onWait: (s) => s % 20 === 0 && s > 0 && console.log(`    waiting ${s}s`) },
      )
      spent += estimateCost(spec)

      const image =
        result.images?.find((i) => i.map_type === 'basecolor') ?? result.images?.[0]
      if (!image) throw new Error(`${spec.name}: fal returned no image`)

      const source = decodePng(await download(image.url))
      if (source.width !== spec.source || source.height !== spec.source) {
        console.log(
          `    warning: asked for ${spec.source}px, got ${source.width}x${source.height}`,
        )
        if (source.width !== source.height || source.width % spec.size !== 0) {
          lastFailures = [`wrong size ${source.width}x${source.height}`]
          console.log(`    rejected: ${lastFailures[0]}`)
          continue
        }
      }

      const done = pipeline(spec, source)
      const failures = judge(spec, done)
      console.log(
        `    seam ${done.report.seamX.toFixed(2)}/${done.report.seamY.toFixed(2)}` +
          `  busy ${done.report.busyness.toFixed(3)}` +
          `  steps ${done.used}/${spec.palette.length}` +
          `  dominance ${(done.dominance * 100).toFixed(0)}%` +
          `  drift ${done.drift.toFixed(3)}`,
      )

      if (failures.length > 0 && attempt < args.attempts) {
        lastFailures = failures
        console.log(`    rejected (attempt ${attempt}): ${failures.join('; ')}`)
        continue
      }
      if (failures.length > 0) {
        console.log(`    FAILED after ${attempt} attempts: ${failures.join('; ')}`)
        failed.push(`${spec.name}: ${failures.join('; ')}`)
        break
      }

      const png = encodeIndexedPng(done.bitmap)
      writeFileSync(resolve(OUT_DIR, `${spec.name}.png`), png)
      manifest[spec.name] = {
        hash: hashOf(spec),
        size: spec.size,
        worldUnits: spec.worldUnits,
        model: MODEL,
        seed,
        bytes: png.length,
        generatedAt: new Date().toISOString().slice(0, 10),
        metrics: {
          seamX: Number(done.report.seamX.toFixed(3)),
          seamY: Number(done.report.seamY.toFixed(3)),
          busyness: Number(done.report.busyness.toFixed(4)),
          used: done.used,
          dominance: Number(done.dominance.toFixed(3)),
        },
      }
      writeFileSync(MANIFEST, JSON.stringify(sortKeys(manifest), null, 2) + '\n')
      console.log(`    committed ${(png.length / 1024).toFixed(1)} kB`)
      committed = true

      if (args.review) {
        const dir = process.env.REVIEW_DIR ?? resolve(ROOT, '.shots/texture-review')
        mkdirSync(dir, { recursive: true })
        const scale = Math.max(1, Math.round(512 / done.bitmap.width))
        writeFileSync(
          resolve(dir, `${spec.name}-2x2.png`),
          encodeIndexedPng(magnify(tile2x2(done.bitmap), scale)),
        )
      }
    }
  }

  console.log(`\nspent about $${spent.toFixed(2)}.`)
  if (failed.length > 0) {
    console.log(`\n${failed.length} texture(s) not committed:`)
    for (const f of failed) console.log(`  ${f}`)
    process.exitCode = 1
  }
}

function sortKeys(m: Manifest): Manifest {
  return Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]!])) as Manifest
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
