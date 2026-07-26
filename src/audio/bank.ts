/**
 * Buffers, and where they came from.
 *
 * Every cue resolves to a sample from one of two places: the baked MP3 in
 * `assets/baked/audio/`, or the placeholder rendered by `synth.ts`. The baked
 * one wins as soon as it has decoded, and until then the placeholder plays, so
 * a cue is never silently missing and a slow decode is never a gap.
 *
 * The file list comes from a glob rather than a written-out set of imports. An
 * import of a file that has not been baked yet is a build error, and the whole
 * point of the placeholder layer is that the game runs with none of them; a
 * glob simply returns fewer entries.
 */

import { cue, type CueId } from './cues'
import { bounds, normalise, toBuffer } from './synth'

/**
 * Whatever has been baked, as URLs. Vite emits these as separate files with
 * hashed names, so nothing here is inlined into the bundle.
 */
const FILES = import.meta.glob('../../assets/baked/audio/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const BY_NAME = new Map<string, string>()
for (const [path, url] of Object.entries(FILES)) {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.mp3$/, '')
  BY_NAME.set(name, url)
}

/** Baked file for a cue, if there is one. The bake writes `<cue id>.mp3`. */
export function bakedUrl(id: CueId): string | undefined {
  return BY_NAME.get(id)
}

/** Which cues have a baked file. Reported by the audio debug line. */
export function bakedCues(): string[] {
  return [...BY_NAME.keys()].sort()
}

export interface Sample {
  buffer: AudioBuffer
  /** First and last audible second, so MP3 encoder padding cannot be heard. */
  start: number
  end: number
  /**
   * Scales this buffer to full scale, so a cue's authored gain means the same
   * thing whether it is playing a placeholder or a baked file. See
   * `synth.normalise`.
   */
  lift: number
  baked: boolean
}

const samples = new Map<CueId, Sample>()
const fetching = new Set<CueId>()

/**
 * Start fetching every baked file. Called once, when the context appears.
 *
 * Deliberately not awaited anywhere. A failed fetch or a corrupt file leaves
 * the placeholder in place and logs nothing louder than a warning: audio that
 * cannot load must never stop the game from running.
 */
export function prime(ctx: BaseAudioContext, ids: readonly CueId[]): void {
  for (const id of ids) load(ctx, id)
}

function load(ctx: BaseAudioContext, id: CueId): void {
  const url = bakedUrl(id)
  if (!url || fetching.has(id)) return
  fetching.add(id)

  void fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`${res.status}`)
      return res.arrayBuffer()
    })
    .then((bytes) => ctx.decodeAudioData(bytes))
    .then((buffer) => {
      const b = bounds(buffer)
      samples.set(id, { buffer, start: b.start, end: b.end, lift: normalise(b.peak), baked: true })
    })
    .catch((err: unknown) => {
      console.warn(`[audio] ${id} did not load, using the placeholder:`, err)
    })
}

/**
 * The sample for a cue, rendering the placeholder on first use if the baked one
 * is not here yet.
 *
 * Rendering is a few milliseconds for a one-shot and about thirty for the six
 * second ambience bed, which is why it happens on demand rather than for all
 * nine cues at once at the moment the player first presses a key.
 */
export function sampleFor(ctx: BaseAudioContext, id: CueId): Sample {
  const have = samples.get(id)
  if (have) return have

  const buffer = toBuffer(ctx, cue(id).synth)
  // The placeholders are authored at the level they should play at, so they
  // are not lifted. Only generated audio needs rescuing.
  const made: Sample = { buffer, start: 0, end: buffer.duration, lift: 1, baked: false }
  samples.set(id, made)
  return made
}

/** Drop everything. For tests and for a context that has been torn down. */
export function forget(): void {
  samples.clear()
  fetching.clear()
}
