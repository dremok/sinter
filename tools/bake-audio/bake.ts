/**
 * The offline ElevenLabs audio bake.
 *
 *   npx tsx tools/bake-audio/bake.ts --plan          # print the bill, call nothing
 *   npx tsx tools/bake-audio/bake.ts                 # everything not already cached
 *   npx tsx tools/bake-audio/bake.ts --only merge    # just these
 *   npx tsx tools/bake-audio/bake.ts --force merge   # regenerate even if cached
 *
 * A developer-machine build step. Its output is committed and the shipped game
 * loads it as a static file: nothing under `src/` ever talks to ElevenLabs,
 * which is the constraint D8 and the README are built on. The key lives in
 * `.env`, is gitignored, is never added to Railway and is never read from `src/`.
 *
 * ## It cannot spend twice
 *
 * Every clip is keyed by a hash of the exact request. A cue whose hash is
 * already in the cache is copied out without a request. `docs/ASSET_PIPELINE.md`
 * is blunt about why: the normal failure mode of a script like this is not a
 * crash, it is a re-run that quietly re-bills, and nobody notices until the
 * fourth time. `--plan` prints what a run would cost and calls nothing.
 *
 * ## Nothing is trusted
 *
 * What comes back is checked for being an MP3 at all and for being a plausible
 * size before it is written. What it SOUNDS like is a separate question and a
 * separate tool: `npx tsx tools/bake-audio/measure.ts` decodes the committed
 * files in a real browser and reports duration, level and loop seam. Neither
 * tool can tell you whether a clip is any good. Somebody has to listen.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readEnvFile } from '../bake-textures/fal'
import { generate, looksLikeMp3, type SoundRequest } from './eleven'
import { creditsFor, FORMAT, MAX_PROMPT, MODEL, PIPELINE_VERSION, SPECS, type SoundSpec } from './prompts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT_DIR = resolve(ROOT, 'assets/baked/audio')
const MANIFEST = resolve(OUT_DIR, 'manifest.json')

/**
 * Raw model output, kept on disk and gitignored by `tools/bake-audio/.gitignore`.
 *
 * Keyed on what the model was actually asked for, so it survives every change
 * to this script and correctly misses when a prompt or a duration moves.
 */
const CACHE_DIR = resolve(ROOT, 'tools/bake-audio/.cache')

/** The whole set has to fit in this. `docs/ASSET_PIPELINE.md`, and the brief. */
const BUDGET_BYTES = 2 * 1024 * 1024

interface Entry {
  id: string
  key: string
  bytes: number
  seconds: number
  loop: boolean
  characterCost: number | null
  bakedAt: string
}

interface Manifest {
  pipeline: number
  model: string
  format: string
  entries: Record<string, Entry>
}

// ------------------------------------------------------------------ arguments

const argv = process.argv.slice(2)
const PLAN = argv.includes('--plan')

function list(flag: string): Set<string> | null {
  const i = argv.indexOf(flag)
  if (i < 0) return null
  const value = argv[i + 1]
  if (!value || value.startsWith('--')) return new Set(SPECS.map((s) => s.id))
  return new Set(value.split(',').map((s) => s.trim()))
}

const ONLY = list('--only')
const FORCE = list('--force')

// --------------------------------------------------------------------- keys

function requestFor(spec: SoundSpec): SoundRequest {
  const request: SoundRequest = {
    text: spec.prompt,
    model_id: MODEL,
    duration_seconds: spec.seconds,
    prompt_influence: spec.influence,
  }
  if (spec.loop) request.loop = true
  return request
}

function keyFor(spec: SoundSpec): string {
  return createHash('sha256')
    .update(JSON.stringify({ pipeline: PIPELINE_VERSION, format: FORMAT, ...requestFor(spec) }))
    .digest('hex')
    .slice(0, 16)
}

function loadManifest(): Manifest {
  if (!existsSync(MANIFEST)) {
    return { pipeline: PIPELINE_VERSION, model: MODEL, format: FORMAT, entries: {} }
  }
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest
  } catch {
    return { pipeline: PIPELINE_VERSION, model: MODEL, format: FORMAT, entries: {} }
  }
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} kB`

// ---------------------------------------------------------------------- run

const manifest = loadManifest()
mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(CACHE_DIR, { recursive: true })

/**
 * Everything the API will reject, checked before the first request.
 *
 * A batch that validates as it goes has already spent money by the time it
 * finds the bad entry, which is exactly how the 450 character limit was found.
 */
for (const spec of SPECS) {
  if (spec.prompt.length > MAX_PROMPT) {
    throw new Error(`${spec.id}: prompt is ${spec.prompt.length} characters, the limit is ${MAX_PROMPT}`)
  }
  if (spec.seconds < 0.5 || spec.seconds > 30) {
    throw new Error(`${spec.id}: duration ${spec.seconds}s is outside the API's 0.5 to 30 range`)
  }
  if (spec.influence < 0 || spec.influence > 1) {
    throw new Error(`${spec.id}: prompt_influence ${spec.influence} is outside 0 to 1`)
  }
}

const wanted = SPECS.filter((s) => !ONLY || ONLY.has(s.id))
if (ONLY && wanted.length !== ONLY.size) {
  const known = new Set(SPECS.map((s) => s.id))
  for (const id of ONLY) if (!known.has(id)) throw new Error(`no such cue: ${id}`)
}

interface Planned {
  spec: SoundSpec
  key: string
  cached: string | null
  /** Already committed with this exact key, so nothing at all needs doing. */
  current: boolean
}

const planned: Planned[] = wanted.map((spec) => {
  const key = keyFor(spec)
  const cachePath = resolve(CACHE_DIR, `${key}.mp3`)
  const outPath = resolve(OUT_DIR, `${spec.id}.mp3`)
  const forced = FORCE?.has(spec.id) === true
  const cached = !forced && existsSync(cachePath) ? cachePath : null
  const current =
    !forced && cached !== null && existsSync(outPath) && manifest.entries[spec.id]?.key === key
  return { spec, key, cached, current }
})

const toGenerate = planned.filter((p) => !p.current && !p.cached)
const toCopy = planned.filter((p) => !p.current && p.cached)
const credits = toGenerate.reduce((sum, p) => sum + creditsFor(p.spec), 0)

console.log(`model    ${MODEL}`)
console.log(`format   ${FORMAT}`)
console.log(`up to date  ${planned.filter((p) => p.current).length}`)
console.log(`from cache  ${toCopy.length}`)
console.log(`to generate ${toGenerate.length}`)
for (const p of toGenerate) {
  console.log(
    `  ${p.spec.id.padEnd(12)} ${String(p.spec.seconds).padStart(5)}s  ${creditsFor(p.spec)} credits` +
      `  ${p.spec.prompt.length}/${MAX_PROMPT} chars${p.spec.loop ? '  loop' : ''}`,
  )
}
console.log(`estimated cost  ${credits} credits`)

if (PLAN) {
  console.log('\n--plan: nothing was called and nothing was written.')
  process.exit(0)
}

let key = process.env.ELEVENLABS_API_KEY ?? ''
if (!key) key = readEnvFile(resolve(ROOT, '.env')).ELEVENLABS_API_KEY ?? ''
if (!key && toGenerate.length > 0) {
  throw new Error('ELEVENLABS_API_KEY not found in the environment or in .env')
}
if (toGenerate.length > 0) console.log(`\nkey found, ${toGenerate.length} request(s) to make\n`)

for (const p of planned) {
  const { spec } = p
  if (p.current) {
    console.log(`skip   ${spec.id}  (unchanged)`)
    continue
  }

  let bytes: Uint8Array
  let characterCost: number | null = manifest.entries[spec.id]?.characterCost ?? null

  if (p.cached) {
    bytes = new Uint8Array(readFileSync(p.cached))
    console.log(`cache  ${spec.id}  ${kb(bytes.length)}`)
  } else {
    process.stdout.write(`call   ${spec.id} ... `)
    const result = await generate(key, requestFor(spec), FORMAT)
    bytes = result.bytes
    characterCost = result.characterCost
    if (!looksLikeMp3(bytes)) {
      throw new Error(`${spec.id}: response is not an MP3 (${bytes.length} bytes). Nothing written.`)
    }
    // A 22 second bed that comes back as 3 kB is a truncated or empty
    // generation, and committing it would be worse than failing here.
    const floor = Math.max(1024, spec.seconds * 1000)
    if (bytes.length < floor) {
      throw new Error(`${spec.id}: only ${bytes.length} bytes for ${spec.seconds}s. Nothing written.`)
    }
    writeFileSync(resolve(CACHE_DIR, `${p.key}.mp3`), bytes)
    console.log(`${kb(bytes.length)}${characterCost === null ? '' : `, ${characterCost} credits`}`)
  }

  writeFileSync(resolve(OUT_DIR, `${spec.id}.mp3`), bytes)
  manifest.entries[spec.id] = {
    id: spec.id,
    key: p.key,
    bytes: bytes.length,
    seconds: spec.seconds,
    loop: spec.loop === true,
    characterCost,
    bakedAt: new Date().toISOString().slice(0, 10),
  }
}

manifest.pipeline = PIPELINE_VERSION
manifest.model = MODEL
manifest.format = FORMAT
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)

// -------------------------------------------------------------------- budget

const total = Object.values(manifest.entries).reduce((sum, e) => sum + e.bytes, 0)
console.log('')
for (const e of Object.values(manifest.entries).sort((a, b) => b.bytes - a.bytes)) {
  console.log(`  ${e.id.padEnd(12)} ${kb(e.bytes).padStart(8)}  ${e.seconds}s${e.loop ? ' loop' : ''}`)
}
console.log(`  ${'total'.padEnd(12)} ${kb(total).padStart(8)}  of a ${kb(BUDGET_BYTES)} budget`)
if (total > BUDGET_BYTES) {
  console.error(`\nOVER BUDGET by ${kb(total - BUDGET_BYTES)}. Shorten a bed or drop the bitrate.`)
  process.exitCode = 1
}
