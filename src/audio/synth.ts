/**
 * Placeholder sounds, rendered in code.
 *
 * Every cue in `cues.ts` has one of these whether or not a baked file exists
 * for it, and the runtime falls back to it silently. That is the same call D14
 * made for textures and it is worth making twice: the wiring has to be provable
 * before any asset exists, an offline bake is not always available, and a cue
 * that was added but never baked should be quietly audible rather than quietly
 * missing. A missing sound is the hardest kind of audio bug to notice.
 *
 * These are not meant to be good. They are meant to be DISTINCT, so that "the
 * chop fires when I chop" is a question you can answer by listening, months
 * before the real chop is baked.
 *
 * `render` is a pure function of (spec, sampleRate) into a Float32Array. No
 * AudioContext, no OfflineAudioContext, no Math.random, so it runs in node and
 * the tests can assert on the actual samples.
 */

import { hash01 } from './space'

/**
 * One layer of a sound. A cue is a short stack of these, because the things
 * worth distinguishing by ear are nearly all two events close together: a chop
 * is an impact and then a splitting, a merge is a grinding and then a landing.
 */
export interface Layer {
  /** Seconds from the start of the cue. */
  at: number
  /** Total length of this layer, in seconds. */
  seconds: number
  /** Peak amplitude before the cue's own gain. */
  gain: number
  /** 0 is a pure tone, 1 is pure noise, between is both. */
  noise: number
  /** Tone frequency at the start, in Hz. Ignored when `noise` is 1. */
  freq: number
  /** Frequency at the end, as a multiple of `freq`. 1 holds. */
  bend: number
  /** One-pole lowpass corner at the start, in Hz. */
  cutoff: number
  /** Corner at the end, as a multiple of `cutoff`. */
  cutoffBend: number
  /** Fade in, seconds. Zero would click. */
  attack: number
  /** Fraction of the remaining time held at full before the release begins. */
  hold: number
  /** How sharply the tail falls. 1 is roughly linear, 4 is a hard percussive. */
  curve: number
  /** Slow amplitude movement, so a loop does not sit perfectly still. */
  wobble?: { depth: number; hz: number }
}

export interface SynthSpec {
  layers: Layer[]
  /** Total length, which may exceed the last layer so a tail can ring out. */
  seconds: number
  /**
   * Fold the tail back over the head so the buffer can loop without a click.
   * Only for beds; a one-shot ending in silence needs no help.
   */
  loop?: boolean
}

/** Sensible defaults, so a cue only states what makes it different. */
export function layer(spec: Partial<Layer> = {}): Layer {
  return {
    at: 0,
    seconds: 0.3,
    gain: 0.8,
    noise: 1,
    freq: 220,
    bend: 1,
    cutoff: 3000,
    cutoffBend: 1,
    attack: 0.004,
    hold: 0.05,
    curve: 2.4,
    ...spec,
  }
}

/** Equal-power crossfade weight, so a fold does not dip in the middle. */
function fadeIn(t: number): number {
  return Math.sin((t * Math.PI) / 2)
}

/**
 * Render one layer additively into `out`.
 *
 * The filter is a one-pole lowpass run in the time domain rather than a
 * BiquadFilterNode, because this has to work with no AudioContext at all. One
 * pole is 6 dB per octave and audibly gentle, which is fine: the job is to tell
 * a thud from a hiss, not to be a synthesiser.
 */
function renderLayer(out: Float32Array<ArrayBuffer>, l: Layer, sampleRate: number, salt: number): void {
  const start = Math.floor(l.at * sampleRate)
  const length = Math.floor(l.seconds * sampleRate)
  if (length <= 0) return

  const attack = Math.max(1, Math.floor(l.attack * sampleRate))
  const held = Math.floor((length - attack) * Math.max(0, Math.min(1, l.hold)))

  let phase = 0
  let filtered = 0

  // Hoisted where they are constant. A swept corner needs an exp per sample and
  // most layers do not sweep, which is the difference between the placeholder
  // set rendering in three milliseconds and in thirty.
  const sweeps = l.cutoffBend !== 1
  const bends = l.bend !== 1
  const fixedA = sweeps ? 0 : 1 - Math.exp((-2 * Math.PI * l.cutoff) / sampleRate)
  const wobbleRate = l.wobble ? l.wobble.hz * Math.PI * 2 : 0

  for (let i = 0; i < length; i++) {
    const o = start + i
    if (o < 0 || o >= out.length) continue
    const t = i / length

    // Envelope: linear in, flat, then a power curve out. `curve` is the whole
    // difference between a knock and a hum.
    let env: number
    if (i < attack) env = i / attack
    else if (i < attack + held) env = 1
    else {
      const rt = (i - attack - held) / Math.max(1, length - attack - held)
      env = Math.pow(1 - rt, l.curve)
    }

    // Source. Noise is a pure hash of the sample index, so the same spec always
    // renders the same bytes and a screenshot-style comparison stays possible.
    const n = hash01(o * 1.37 + salt) * 2 - 1
    let src = n
    if (l.noise < 1) {
      const f = bends ? l.freq * Math.pow(l.bend, t) : l.freq
      phase += (f / sampleRate) * Math.PI * 2
      src = Math.sin(phase) * (1 - l.noise) + n * l.noise
    }

    // One-pole lowpass, corner swept over the layer's life.
    const a = sweeps
      ? 1 - Math.exp((-2 * Math.PI * (l.cutoff * Math.pow(l.cutoffBend, t))) / sampleRate)
      : fixedA
    filtered += a * (src - filtered)

    const w = l.wobble
      ? 1 - l.wobble.depth + l.wobble.depth * (0.5 + 0.5 * Math.sin(t * l.seconds * wobbleRate))
      : 1

    out[o] = out[o]! + filtered * env * l.gain * w
  }
}

/**
 * Render a whole cue.
 *
 * Clipped rather than normalised on purpose: normalising would make every
 * placeholder the same loudness, and a footstep that is as loud as a felled
 * tree is a worse lie than a quiet footstep.
 */
export function render(spec: SynthSpec, sampleRate: number, salt = 0): Float32Array<ArrayBuffer> {
  const total = Math.max(1, Math.floor(spec.seconds * sampleRate))
  const full = new Float32Array(total)
  for (let i = 0; i < spec.layers.length; i++) {
    renderLayer(full, spec.layers[i]!, sampleRate, salt + i * 131.7)
  }

  const out = spec.loop ? foldTail(full, sampleRate) : full

  for (let i = 0; i < out.length; i++) {
    const v = out[i]!
    out[i] = v > 1 ? 1 : v < -1 ? -1 : v
  }
  return out
}

/**
 * Make a buffer loop without a click.
 *
 * Noise is discontinuous everywhere, which is exactly why an untreated noise
 * bed ticks once per loop, and one tick every four seconds is the sort of thing
 * you stop noticing and start finding unbearable.
 *
 * The standard crossfade loop, and the order matters. Given a rendered signal
 * `s` of length T and a fold of F samples, the loop is the first `T - F`
 * samples, with the head crossfaded so that
 *
 *     loop[0]      == s[T - F]        (the tail, at full weight)
 *     loop[F - 1]  == s[F - 1]        (the head, at full weight)
 *     loop[T-F-1]  == s[T - F - 1]
 *
 * so playing off the end of the loop and back to the start steps from
 * `s[T-F-1]` to `s[T-F]`, which are adjacent samples of one continuous signal.
 * The tail is DISCARDED rather than silenced: zeroing it would leave a hole at
 * the end of every cycle, which is a worse artefact than the click it fixed.
 */
const FOLD = 0.25

function foldTail(full: Float32Array<ArrayBuffer>, sampleRate: number): Float32Array<ArrayBuffer> {
  const n = Math.min(Math.floor(FOLD * sampleRate), Math.floor(full.length / 3))
  if (n <= 1) return full
  const length = full.length - n
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    full[i] = full[i]! * fadeIn(t) + full[length + i]! * fadeIn(1 - t)
  }
  // Copied rather than returned as a subarray: a subarray still owns a view on
  // the longer buffer, and `AudioBuffer.copyToChannel` wants an array whose
  // backing store is exactly its own.
  const out = new Float32Array(length)
  out.set(full.subarray(0, length))
  return out
}

/** Wrap a render into an AudioBuffer. The only part that needs a context. */
export function toBuffer(ctx: BaseAudioContext, spec: SynthSpec, salt = 0): AudioBuffer {
  const data = render(spec, ctx.sampleRate, salt)
  // Mono. Placeholders have no business having a stereo image; position is the
  // panner's job and it is applied per emitter, not baked into a buffer.
  const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate)
  buffer.copyToChannel(data, 0)
  return buffer
}

/**
 * Where a buffer's audible part starts and ends, and how hot it is.
 *
 * Two problems, one scan.
 *
 * **The trim exists because of MP3.** Every MP3 decoder inserts an encoder
 * delay at the head and pads the tail out to a whole frame, so a clip generated
 * as a seamless loop comes back with tens of milliseconds of silence welded to
 * each end, and looping it produces an audible gap once per cycle. The measured
 * padding on the baked set runs from 0 to 400 ms. Trimming to the first and
 * last sample above a floor removes it without re-encoding anything. The same
 * trim fixes one-shots: a chop with 30 ms of silence in front of it is a chop
 * that fires 30 ms late, every time.
 *
 * **The peak exists because generated audio arrives at whatever level it feels
 * like.** The nine baked cues came back with peaks between 0.04 and 0.87, a
 * spread of 27 dB, and the cue table's `gain` is a statement about the MIX, not
 * about how hot one generation happened to be. Normalising here means a cue
 * sounds the same whether it is playing its placeholder or its baked file,
 * which is the whole premise of having both, and it means a re-bake cannot
 * silently change the balance of the game.
 */
export interface Bounds {
  start: number
  end: number
  /** Largest absolute sample. Zero only for a buffer that is entirely silent. */
  peak: number
}

export function bounds(buffer: AudioBuffer, floor = 0.002): Bounds {
  const data = buffer.getChannelData(0)
  let first = 0
  let last = data.length - 1
  while (first < data.length && Math.abs(data[first]!) < floor) first++
  while (last > first && Math.abs(data[last]!) < floor) last--

  let peak = 0
  for (let i = first; i <= last && i < data.length; i++) {
    const v = Math.abs(data[i]!)
    if (v > peak) peak = v
  }

  // A buffer that is silent throughout is returned whole rather than as an
  // empty range, so a bad file is quiet rather than a division by zero.
  if (first >= last) return { start: 0, end: buffer.duration, peak }
  return { start: first / buffer.sampleRate, end: (last + 1) / buffer.sampleRate, peak }
}

/**
 * How much to scale a buffer so that the cue table's gains mean what they say.
 *
 * Capped, and the cap is the point: without one, a generation that came back
 * 40 dB down would be multiplied up until its 64 kbps quantisation noise was
 * the loudest thing in the game. A clip that needs more than this is a clip
 * that needs re-baking, and `tools/bake-audio/measure.ts` fails on it.
 *
 * 16 is +24 dB and it is a compromise arrived at by measuring rather than by
 * taste. The generated set came back with peaks between 0.035 and 1.0, a spread
 * of 29 dB, and the pattern is consistent: close physical events (an axe, a
 * footstep on wood, the merge) arrive near full scale and anything the model
 * reads as an environment arrives 20 to 40 dB down. A cap of 8 left the
 * ambience bed audibly under the rest of the mix through no fault of the mix.
 *
 * The risk being accepted is that lifting a quiet MP3 lifts its quantisation
 * noise with it. It is a real risk and it is NOT measured here, because nothing
 * available can measure it: it is a question about what a person hears. If the
 * beds ever sound hissy, this is the first place to look, and the fix is a
 * hotter generation rather than a bigger number.
 */
const MAX_LIFT = 16

export function normalise(peak: number): number {
  if (peak <= 0.0001) return 1
  return Math.min(MAX_LIFT, 1 / peak)
}
