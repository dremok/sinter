/**
 * Promote the current sweep to the baseline.
 *
 *   npx tsx tools/vibecheck/accept.ts "reason this set is good"
 *   npx tsx tools/vibecheck/accept.ts --only home_hearth "the new thatch"
 *
 * Only ever run this after LOOKING at the shots. The baseline is a record of
 * what somebody judged acceptable, and a baseline accepted without being looked
 * at makes every future diff agree with a defect.
 */

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SHOTS } from './shots'

const ROOT = resolve(import.meta.dirname, '../..')
const CURRENT = join(ROOT, '.shots/vibe/current')
const BASELINE = join(ROOT, '.shots/vibe/baseline')

const argv = process.argv.slice(2)
const onlyIdx = argv.indexOf('--only')
const only =
  onlyIdx >= 0 && argv[onlyIdx + 1]
    ? argv[onlyIdx + 1]!.split(',').map((s) => s.trim()).filter(Boolean)
    : []
const reason = argv.filter((a, i) => i !== onlyIdx && i !== onlyIdx + 1 && !a.startsWith('--')).join(' ')
if (!reason) {
  console.error('give a reason: npx tsx tools/vibecheck/accept.ts "why this set is good"')
  process.exit(1)
}

const sweep = JSON.parse(await readFile(join(CURRENT, 'sweep.json'), 'utf8')) as {
  at: string
  seed: string
  ticks: number
  size: [number, number]
  results: { name: string; x: number; z: number; note: string; ok: boolean }[]
}

await mkdir(BASELINE, { recursive: true })

interface Entry {
  name: string
  x: number
  z: number
  note: string
  acceptedAt: string
  seed: string
  ticks: number
  size: [number, number]
  reason: string
}

const manifestPath = join(BASELINE, 'manifest.json')
const prior: Entry[] = existsSync(manifestPath)
  ? (JSON.parse(await readFile(manifestPath, 'utf8')) as { shots: Entry[] }).shots
  : []
const byName = new Map(prior.map((e) => [e.name, e]))

const now = new Date().toISOString()
let copied = 0
for (const r of sweep.results) {
  if (!r.ok) continue
  if (only.length > 0 && !only.some((o) => r.name.includes(o))) continue
  await copyFile(join(CURRENT, `${r.name}.png`), join(BASELINE, `${r.name}.png`))
  const spec = SHOTS.find((s) => s.name === r.name)
  byName.set(r.name, {
    name: r.name,
    x: r.x,
    z: r.z,
    note: spec?.note ?? r.note,
    acceptedAt: now,
    seed: sweep.seed,
    ticks: sweep.ticks,
    size: sweep.size,
    reason,
  })
  copied++
}

const shots = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
await writeFile(manifestPath, JSON.stringify({ updatedAt: now, shots }, null, 2) + '\n')
console.log(`accepted ${copied} shot(s) into ${BASELINE}; manifest has ${shots.length}`)
