import { describe, expect, it } from 'vitest'
import { ALL_CUES, CUES, cue, voiceFor, type CueId } from './cues'
import { layer, render } from './synth'

/**
 * Half the usual rate, and every cue rendered once.
 *
 * Nothing asserted here is rate-dependent: they are all shape and ratio
 * questions. Rendering the full table at 48 kHz for every case took six seconds
 * of a test run that is otherwise instant, which is the sort of thing that ends
 * with somebody not running the tests.
 */
const RATE = 24000

const rendered = new Map<CueId, Float32Array>()

function of(id: CueId): Float32Array {
  let data = rendered.get(id)
  if (!data) {
    data = render(cue(id).synth, RATE)
    rendered.set(id, data)
  }
  return data
}

function peak(data: Float32Array): number {
  let max = 0
  for (const v of data) max = Math.max(max, Math.abs(v))
  return max
}

function rms(data: Float32Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i]! * data[i]!
  return Math.sqrt(sum / Math.max(1, to - from))
}

/** Largest step between two adjacent samples anywhere in the buffer. */
function roughest(data: Float32Array): number {
  let max = 0
  for (let i = 1; i < data.length; i++) max = Math.max(max, Math.abs(data[i]! - data[i - 1]!))
  return max
}

describe('render', () => {
  it('is deterministic', () => {
    // The whole repo depends on a seed reproducing a run (CLAUDE.md), and a
    // placeholder that renders differently each boot would be the one place
    // Math.random could hide.
    const spec = CUES.chop.synth
    expect(Array.from(render(spec, RATE))).toEqual(Array.from(render(spec, RATE)))
  })

  it('produces the requested length for a one-shot', () => {
    const spec = { seconds: 0.5, layers: [layer({ seconds: 0.4 })] }
    expect(render(spec, RATE).length).toBe(0.5 * RATE)
  })

  it('never clips past full scale', () => {
    for (const id of ALL_CUES) expect(peak(of(id))).toBeLessThanOrEqual(1)
  })

  it('makes a sound at all', () => {
    for (const id of ALL_CUES) expect(peak(of(id))).toBeGreaterThan(0.01)
  })

  it('decays, so a one-shot ends in silence rather than a cut', () => {
    for (const id of ALL_CUES) {
      const def = cue(id)
      if (def.loop) continue
      const data = of(id)
      const tail = rms(data, Math.floor(data.length * 0.97), data.length)
      const body = rms(data, 0, Math.floor(data.length * 0.5))
      expect(tail, `${id} does not fade out`).toBeLessThan(body * 0.1)
    }
  })
})

describe('loops', () => {
  it('joins end to start without a step', () => {
    // A loop's seam is only inaudible if the wrap is no sharper than the signal
    // already is. Anything larger is the click the fold exists to remove.
    for (const id of ALL_CUES) {
      const def = cue(id)
      if (!def.loop) continue
      const data = of(id)
      const seam = Math.abs(data[0]! - data[data.length - 1]!)
      expect(seam, `${id} clicks at the loop point`).toBeLessThanOrEqual(roughest(data))
    }
  })

  it('is shorter than the rendered signal, because the fold is discarded', () => {
    const spec = { seconds: 2, loop: true, layers: [layer({ seconds: 2, hold: 1 })] }
    const looped = render(spec, RATE)
    expect(looped.length).toBeLessThan(2 * RATE)
    expect(looped.length).toBeGreaterThan(1.5 * RATE)
  })

  it('does not leave a hole where the tail was', () => {
    // The first version silenced the folded tail instead of dropping it, which
    // swapped a click for a quarter second of nothing once per cycle.
    const data = of('ambience')
    const end = rms(data, data.length - Math.floor(0.2 * RATE), data.length)
    const middle = rms(data, Math.floor(data.length * 0.4), Math.floor(data.length * 0.6))
    expect(end).toBeGreaterThan(middle * 0.3)
  })

  it('runs at a steady level rather than fading out', () => {
    for (const id of ALL_CUES) {
      const def = cue(id)
      if (!def.loop) continue
      const data = of(id)
      const first = rms(data, 0, Math.floor(data.length * 0.2))
      const last = rms(data, Math.floor(data.length * 0.8), data.length)
      expect(last, `${id} sags`).toBeGreaterThan(first * 0.4)
    }
  })
})

describe('the merge cue', () => {
  /**
   * Rule 3 is that both inputs are destroyed permanently and the loss has to be
   * real. A sound that gets brighter and louder at the end is a reward chime,
   * and a reward chime tells the player they gained something. These assert the
   * shape argued for in `cues.ts`, so nobody can quietly "improve" it into a
   * jingle without a test going red.
   */
  const data = of('merge')

  it('is loudest in its first half, where the loss lands', () => {
    const early = peak(data.subarray(0, Math.floor(data.length * 0.5)))
    const late = peak(data.subarray(Math.floor(data.length * 0.5)))
    expect(early).toBeGreaterThan(late)
  })

  it('ends far quieter than it begins', () => {
    const open = rms(data, 0, Math.floor(0.6 * RATE))
    const close = rms(data, data.length - Math.floor(0.3 * RATE), data.length)
    expect(close).toBeLessThan(open * 0.35)
  })

  it('is long enough to be an event rather than a click', () => {
    expect(CUES.merge.synth.seconds).toBeGreaterThan(1.5)
  })
})

describe('the cue table', () => {
  it('gives every cue a bus and a sane gain', () => {
    for (const id of ALL_CUES) {
      const def = cue(id)
      expect(['music', 'ambience', 'sfx']).toContain(def.bus)
      expect(def.gain).toBeGreaterThan(0)
      expect(def.gain).toBeLessThanOrEqual(1)
    }
  })

  it('gives every positional loop a radius', () => {
    // Without one, `field()` falls back to a default and the emitter is never
    // torn down at the right distance.
    for (const id of ALL_CUES) {
      const def = cue(id)
      if (!def.loop) continue
      if (def.bus === 'ambience') continue
      expect(def.radius, `${id} has no radius`).toBeGreaterThan(0)
    }
  })

  it('marks every loop cue as loopable in its placeholder too', () => {
    for (const id of ALL_CUES) {
      const def = cue(id)
      if (def.loop) expect(def.synth.loop, `${id} placeholder does not fold`).toBe(true)
    }
  })
})

describe('place voices', () => {
  it('voices water wherever a region puts it', () => {
    // D22: the region says what it has, audio asks. No coordinate appears here
    // or in `cues.ts`, so a generated region gets its brook for free.
    const voice = voiceFor({ id: 'ford', kind: 'water' })
    expect(voice?.cue).toBe('water')
  })

  it('lets a named place override its kind', () => {
    const mill = voiceFor({ id: 'mill', kind: 'work' })
    const field = voiceFor({ id: 'field', kind: 'work' })
    expect(mill?.cue).toBe('water')
    expect(field).toBeNull()
  })

  it('carries the mill further than anything else, because the wheel is loud', () => {
    const mill = voiceFor({ id: 'mill', kind: 'work' })!
    const ford = voiceFor({ id: 'ford', kind: 'water' })!
    expect(mill.radius).toBeGreaterThan(ford.radius)
  })

  it('is silent for still water', () => {
    expect(voiceFor({ id: 'well', kind: 'water' })).toBeNull()
  })

  it('names only cues that exist', () => {
    const known = new Set<string>(ALL_CUES)
    for (const place of ['mill', 'pond', 'ford', 'well', 'hearth', 'gate']) {
      const voice = voiceFor({ id: place, kind: 'water' })
      if (voice) expect(known.has(voice.cue satisfies CueId)).toBe(true)
    }
  })
})
