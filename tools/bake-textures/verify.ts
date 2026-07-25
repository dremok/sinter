/**
 * Check the committed textures without calling fal.ai or spending anything.
 *
 *   npx tsx tools/bake-textures/verify.ts
 *
 * The bake validates before it commits, but that only proves the files were
 * right on the machine that made them. This re-derives every claim from the
 * bytes on disk, so a corrupted file, a hand-edited PNG or a palette that
 * drifted after someone changed `src/render/palette.ts` all fail here rather
 * than in a player's browser.
 *
 * Exits non-zero on any problem, which makes it usable as a check in CI.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodePng } from './png'
import { inspectTiling } from './image'
import { SPECS } from './prompts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DIR = resolve(ROOT, 'assets/baked/textures')

let bad = 0
let bytes = 0

for (const spec of SPECS) {
  const path = resolve(DIR, `${spec.name}.png`)
  const problems: string[] = []

  if (!existsSync(path)) {
    console.log(`${spec.name.padEnd(9)} MISSING`)
    bad++
    continue
  }

  const size = statSync(path).size
  bytes += size
  const bmp = decodePng(new Uint8Array(readFileSync(path)))

  if (bmp.width !== spec.size || bmp.height !== spec.size) {
    problems.push(`is ${bmp.width}x${bmp.height}, expected ${spec.size}`)
  }

  // Every colour must be a step of a ramp in src/render/palette.ts. This is the
  // check that would catch someone editing a PNG by hand, and the one that ties
  // the committed art back to the file the renderer reads.
  const allowed = new Set(spec.palette.map((h) => parseInt(h.slice(1), 16)))
  const seen = new Set<number>()
  for (let i = 0; i < bmp.width * bmp.height; i++) {
    seen.add((bmp.data[i * 4]! << 16) | (bmp.data[i * 4 + 1]! << 8) | bmp.data[i * 4 + 2]!)
  }
  const strays = [...seen].filter((c) => !allowed.has(c))
  if (strays.length > 0) {
    problems.push(`${strays.length} colour(s) not in the palette`)
  }

  const tiling = inspectTiling(bmp)
  if (tiling.seamX > 1.6 || tiling.seamY > 1.6) {
    problems.push(`seam ${tiling.seamX.toFixed(2)}/${tiling.seamY.toFixed(2)}`)
  }

  const status = problems.length === 0 ? 'ok' : problems.join('; ')
  console.log(
    `${spec.name.padEnd(9)} ${String(bmp.width).padStart(4)}px  ` +
      `${(size / 1024).toFixed(1).padStart(6)} kB  ` +
      `${seen.size}/${spec.palette.length} colours  ` +
      `seam ${tiling.seamX.toFixed(2)}/${tiling.seamY.toFixed(2)}  ${status}`,
  )
  if (problems.length > 0) bad++
}

console.log(`\n${SPECS.length} textures, ${(bytes / 1024).toFixed(1)} kB total.`)
if (bad > 0) {
  console.log(`${bad} problem(s).`)
  process.exitCode = 1
}
