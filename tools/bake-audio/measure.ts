/**
 * What is actually in the baked files.
 *
 *   npx tsx tools/bake-audio/measure.ts
 *
 * `bake.ts` checks that a response was an MP3 of a plausible size, which only
 * rules out the failures that are not really audio. This decodes the committed
 * bytes and measures the waveform, which is the audio equivalent of opening the
 * PNG and looking at it. It needs no API key and calls nothing.
 *
 * Decoding happens in Chromium because there is no MP3 decoder in node and
 * adding one would be a dependency with no other user; Playwright is already a
 * devDependency and `tools/shot.ts` already drives it. The same decoder that
 * runs in the game runs here, which is the point: the padding this reports is
 * the padding `src/audio/synth.ts:bounds` has to trim at runtime.
 *
 * What it cannot tell you is whether a clip sounds right. A fire that came back
 * as rain passes every number below. Somebody has to listen, exactly as the
 * texture pipeline says somebody has to look.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import { SPECS } from './prompts'

/**
 * Kept in step with `src/audio/synth.ts` by hand, because `tools/` importing
 * from `src/` would be the only such edge in the repo. If that constant moves,
 * this moves.
 */
const MAX_LIFT = 16

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DIR = resolve(ROOT, 'assets/baked/audio')
const BUDGET_BYTES = 2 * 1024 * 1024

interface Report {
  seconds: number
  channels: number
  sampleRate: number
  peak: number
  rms: number
  /** Silence welded on by the MP3 encoder, in milliseconds, at each end. */
  headMs: number
  tailMs: number
  /** Step across the loop point, once the padding is trimmed. */
  seam: number
  /** Largest step between adjacent samples anywhere, for scale. */
  roughest: number
  /** Peak in the first and second half, for shape questions. */
  earlyPeak: number
  latePeak: number
  openRms: number
  closeRms: number
}

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

if (!existsSync(DIR)) throw new Error(`nothing baked: ${DIR} does not exist`)

const files = readdirSync(DIR).filter((f) => f.endsWith('.mp3')).sort()
if (files.length === 0) throw new Error(`nothing baked: no .mp3 in ${DIR}`)

const browser = await chromium.launch()
const reports = new Map<string, Report>()

try {
  const page = await browser.newPage()
  await page.goto('about:blank')

  /**
   * tsx compiles with esbuild's `keepNames`, which wraps every named inner
   * function in a `__name(...)` helper that only exists in the node module.
   * Serialising such a function into the page throws `__name is not defined`
   * before a single sample is read. Defining it as the identity in the page is
   * the standard fix. Written as a string so it is not itself transformed.
   */
  await page.evaluate('globalThis.__name = (fn) => fn')

  for (const file of files) {
    const bytes = readFileSync(resolve(DIR, file))
    const report = await page.evaluate(async (base64: string): Promise<Report | { error: string }> => {
      const binary = atob(base64)
      const buf = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)

      const ctx = new OfflineAudioContext(1, 1024, 44100)
      let decoded: AudioBuffer
      try {
        decoded = await ctx.decodeAudioData(buf.buffer)
      } catch (e) {
        return { error: String(e) }
      }

      const data = decoded.getChannelData(0)
      const rate = decoded.sampleRate

      let peak = 0
      let sum = 0
      let roughest = 0
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]!)
        if (v > peak) peak = v
        sum += v * v
        if (i > 0) {
          const step = Math.abs(data[i]! - data[i - 1]!)
          if (step > roughest) roughest = step
        }
      }

      // The same floor `synth.bounds` uses, so this reports the trim the
      // runtime will actually make.
      const floor = 0.002
      let first = 0
      let last = data.length - 1
      while (first < data.length && Math.abs(data[first]!) < floor) first++
      while (last > first && Math.abs(data[last]!) < floor) last--

      const rms = (from: number, to: number): number => {
        let s = 0
        for (let i = from; i < to; i++) s += data[i]! * data[i]!
        return Math.sqrt(s / Math.max(1, to - from))
      }
      const peakIn = (from: number, to: number): number => {
        let p = 0
        for (let i = from; i < to; i++) p = Math.max(p, Math.abs(data[i]!))
        return p
      }

      // Windows scaled to the clip, not fixed. Half a second of "opening" and
      // 0.4s of "closing" measured on a 0.68 second footstep overlap almost
      // completely, so every short cue reported open == close and looked like
      // it never decayed. The bug was in the ruler, not in the audio.
      const span = last - first
      const openTo = first + Math.min(Math.floor(rate * 0.5), Math.floor(span * 0.3))
      const closeFrom = last - Math.min(Math.floor(rate * 0.4), Math.floor(span * 0.25))

      const mid = Math.floor((first + last) / 2)
      return {
        seconds: decoded.duration,
        channels: decoded.numberOfChannels,
        sampleRate: rate,
        peak,
        rms: Math.sqrt(sum / data.length),
        headMs: (first / rate) * 1000,
        tailMs: ((data.length - 1 - last) / rate) * 1000,
        seam: Math.abs(data[first]! - data[last]!),
        roughest,
        earlyPeak: peakIn(first, mid),
        latePeak: peakIn(mid, last),
        openRms: rms(first, openTo),
        closeRms: rms(closeFrom, last),
      }
    }, bytes.toString('base64'))

    if ('error' in report) {
      check(`${file} decodes`, false, report.error)
      continue
    }
    reports.set(file.replace(/\.mp3$/, ''), report)
  }
} finally {
  await browser.close()
}

// ------------------------------------------------------------------- report

console.log('')
console.log('cue           bytes    length  peak    rms     head    tail    seam/rough')
for (const [id, r] of reports) {
  const bytes = readFileSync(resolve(DIR, `${id}.mp3`)).length
  console.log(
    `${id.padEnd(12)} ${`${(bytes / 1024).toFixed(0)} kB`.padStart(7)} ${r.seconds.toFixed(2).padStart(7)}s ` +
      `${r.peak.toFixed(3).padStart(6)} ${r.rms.toFixed(4).padStart(7)} ` +
      `${`${r.headMs.toFixed(0)}ms`.padStart(7)} ${`${r.tailMs.toFixed(0)}ms`.padStart(7)}  ` +
      `${(r.seam / Math.max(1e-6, r.roughest)).toFixed(2)}`,
  )
}

// -------------------------------------------------------------------- checks

for (const spec of SPECS) {
  const r = reports.get(spec.id)
  if (!r) {
    check(`${spec.id} is baked`, false, 'no file')
    continue
  }

  check(
    `${spec.id} is the length asked for`,
    Math.abs(r.seconds - spec.seconds) < Math.max(0.5, spec.seconds * 0.25),
    `${r.seconds.toFixed(2)}s for ${spec.seconds}s asked`,
  )
  // Not "is it silent" but "can the runtime rescue it". `synth.normalise` lifts
  // a quiet clip by at most MAX_LIFT, because past that the 64 kbps
  // quantisation noise comes up with it. Anything below this needs re-baking
  // with a prompt that names a close physical event rather than an environment.
  check(
    `${spec.id} is hot enough to normalise`,
    r.peak >= 1 / MAX_LIFT,
    `peak ${r.peak.toFixed(3)}, needs ${(1 / Math.max(r.peak, 1e-6)).toFixed(1)}x of ${MAX_LIFT}x`,
  )
  check(`${spec.id} is not clipped`, r.peak <= 1.0001, `peak ${r.peak.toFixed(3)}`)

  if (spec.loop) {
    // A loop's join is only inaudible if the wrap is no sharper than the signal
    // already is. Measured AFTER trimming, because the encoder padding would
    // otherwise make a silent-to-silent join look perfect while leaving a gap.
    check(
      `${spec.id} loops without a click`,
      r.seam <= r.roughest,
      `seam ${r.seam.toFixed(4)} vs roughest step ${r.roughest.toFixed(4)}`,
    )
    // A bed that fades out is a bed that disappears once a cycle.
    check(
      `${spec.id} does not fade at its end`,
      r.closeRms > r.openRms * 0.4,
      `open ${r.openRms.toFixed(4)} close ${r.closeRms.toFixed(4)}`,
    )
  } else {
    check(
      `${spec.id} ends in silence rather than a cut`,
      r.closeRms < r.openRms * 0.5,
      `open ${r.openRms.toFixed(4)} close ${r.closeRms.toFixed(4)}`,
    )
  }
}

/**
 * The merge, held to the rule rather than to a metric.
 *
 * Rule 3 says both inputs are destroyed and the loss has to be real, and the
 * prompt in `prompts.ts` asks for grind, impact, decay with every word for
 * "chime" excluded. A sound effects model asked about combining two things
 * returns a reward chime by default, so this is the check that catches a
 * regenerated merge that has quietly become one.
 */
const merge = reports.get('merge')
if (merge) {
  check(
    'the merge lands in its first half',
    merge.earlyPeak > merge.latePeak,
    `early ${merge.earlyPeak.toFixed(3)} late ${merge.latePeak.toFixed(3)}`,
  )
  check(
    'the merge decays rather than resolving',
    merge.closeRms < merge.openRms * 0.5,
    `open ${merge.openRms.toFixed(4)} close ${merge.closeRms.toFixed(4)}`,
  )
}

const total = files.reduce((sum, f) => sum + readFileSync(resolve(DIR, f)).length, 0)
check(
  'the set fits the budget',
  total <= BUDGET_BYTES,
  `${(total / 1024).toFixed(0)} kB of ${(BUDGET_BYTES / 1024).toFixed(0)} kB`,
)

console.log('')
let failed = 0
for (const c of checks) {
  if (!c.ok) failed++
  console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(40)} ${c.detail}`)
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
if (failed > 0) process.exitCode = 1
