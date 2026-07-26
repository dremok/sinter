/**
 * The game's whole view of sound.
 *
 * `main.ts` says what happened and where; this decides whether that is audible,
 * how loud, and in which ear. Nothing outside this directory touches an
 * AudioContext, a node or a buffer.
 *
 * Three things it deliberately does not do:
 *
 *   - **It never reads an item id.** A chop is a chop because `main.ts` ran the
 *     chop affordance, which was offered because something carried
 *     TOOL_CUTTING. Rule 2 holds here as much as anywhere in `sim/`.
 *   - **It never writes to the simulation.** Not one function returns a value
 *     the game branches on, and nothing here consumes the seeded Rng. Audio
 *     cannot desync a run because it has no way to affect one.
 *   - **It never blocks.** Every call is safe before the context exists, and
 *     when it is not ready, one-shots are dropped and beds are remembered.
 */

import { bakedCues, prime, sampleFor, type Sample } from './bank'
import { ALL_CUES, cue, voiceFor, type CueId } from './cues'
import { mixer } from './mixer'
import { hash01, heard, type Ears } from './space'

/**
 * How many positional loops may run at once.
 *
 * The same argument as MAX_FIRE_LIGHTS in `main.ts`: the palisade can have
 * seventeen posts alight, and seventeen fire loops is not a fire, it is a
 * washing machine. The nearest few carry the scene and the rest are covered by
 * the ones you can hear.
 */
const MAX_EMITTERS = 7

/**
 * Metres walked per footfall.
 *
 * Derived rather than picked, so footsteps land with feet: `render/character.ts`
 * advances its stride phase at 14 rad/s at full speed with two footfalls per
 * 2*pi cycle, and `main.ts` moves at 6.5 m/s, which is (2*pi / 14 / 2) * 6.5.
 *
 * It is measured in DISTANCE and not in time on purpose. Tie a footstep to a
 * clock and it drifts out of step the moment the player is slowed, pushed out
 * of a blocker, or walking into a wall; tie it to ground covered and standing
 * still is silent for free.
 *
 * This is the one number in the audio layer that is a copy of something owned
 * elsewhere. If the walk cycle changes, this changes.
 */
const STRIDE_METRES = 1.46

/** Above this, the player was moved rather than walked. Do not step. */
const TELEPORT = 2.5

/**
 * One thing currently making a positional loop, as `field()` wants it.
 *
 * Exported so a caller can keep a pool of these and refill it in place rather
 * than allocating a fresh array of objects every frame, which is what
 * `docs/PERFORMANCE.md` asks for and what `main.ts` does for fires.
 */
export interface FieldEntry {
  /** Anything with a stable identity for as long as the sound should last. */
  key: unknown
  x: number
  z: number
  /** 0 to 1, multiplying the cue's own gain. A fire's heat, for instance. */
  level: number
}

/** One positional loop: a fire, the mill, the ford. */
class Emitter {
  x = 0
  z = 0
  level = 1
  radius: number
  private source: AudioBufferSourceNode | null = null
  private gain: GainNode | null = null
  private pan: StereoPannerNode | null = null
  private lastGain = -1
  private lastPan = -2
  /** Level correction for whatever buffer this ended up playing. */
  private lift = 1
  /** Set when the entry stops being reported, so `sweep` can collect it. */
  seen = true

  constructor(readonly id: CueId, radius: number) {
    this.radius = radius
  }

  update(ears: Ears): void {
    const ctx = mixer.context
    if (!ctx) return

    const at = heard(ears, this.x, this.z, this.radius)
    const want = at.gain * this.level * cue(this.id).gain * this.lift

    // Hysteresis: start once clearly audible, stop only at true silence. The
    // rolloff reaches exactly zero at the radius, so without the gap an emitter
    // sitting on the boundary would build and tear down its graph every frame.
    if (want <= 0) {
      this.stop()
      return
    }
    if (!this.source && want > 0.02) this.begin(ctx)
    if (!this.source || !this.gain || !this.pan) return

    // Only touch a param when it has actually moved. A static emitter would
    // otherwise schedule 60 automation events a second forever.
    if (Math.abs(want - this.lastGain) > 0.004) {
      this.lastGain = want
      this.gain.gain.setTargetAtTime(want, ctx.currentTime, 0.05)
    }
    if (Math.abs(at.pan - this.lastPan) > 0.01) {
      this.lastPan = at.pan
      this.pan.pan.setTargetAtTime(at.pan, ctx.currentTime, 0.05)
    }
  }

  private begin(ctx: AudioContext): void {
    const bus = mixer.bus(cue(this.id).bus)
    if (!bus) return
    const sample = sampleFor(ctx, this.id)
    this.lift = sample.lift

    const src = ctx.createBufferSource()
    src.buffer = sample.buffer
    src.loop = true
    // Loop inside the audible part of the file, which is how the MP3 encoder's
    // padding is kept out of the loop. See `synth.bounds`.
    src.loopStart = sample.start
    src.loopEnd = sample.end

    const gain = ctx.createGain()
    gain.gain.value = 0
    const pan = ctx.createStereoPanner()

    src.connect(gain).connect(pan).connect(bus)
    // Start somewhere inside the loop, so two fires lit at once are not one
    // fire twice as loud.
    src.start(0, sample.start + hash01(this.x * 7.7 + this.z * 3.1) * Math.max(0, sample.end - sample.start))

    this.source = src
    this.gain = gain
    this.pan = pan
    this.lastGain = -1
    this.lastPan = -2
  }

  stop(): void {
    if (!this.source || !this.gain) return
    const ctx = mixer.context
    const src = this.source
    const gain = this.gain
    this.source = null
    this.gain = null
    this.pan = null
    if (!ctx) return
    // Fade, then stop. Cutting a loop dead is a click.
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04)
    try {
      src.stop(ctx.currentTime + 0.25)
    } catch {
      // Already stopped. Nothing to do.
    }
    src.onended = () => {
      src.disconnect()
      gain.disconnect()
    }
  }

  get live(): boolean {
    return this.source !== null
  }
}

class Audio {
  private ears: Ears = { x: 0, z: 0, rightX: 1, rightZ: 0 }
  private emitters = new Map<string, Emitter>()
  private beds = new Map<CueId, { gain: GainNode; source: AudioBufferSourceNode } | null>()
  private lastPlayed = new Map<CueId, number>()
  private shots = 0
  private walked = 0
  private from: { x: number; z: number } | null = null
  /** Scratch for `field`, so a frame loop does not allocate. */
  private ranked: FieldEntry[] = []

  // ----------------------------------------------------------------- lifecycle

  /**
   * Arm the gesture listeners and queue the loading of the baked files. Creates
   * no context and makes no request until the player touches something.
   */
  install(): void {
    mixer.install()
    mixer.whenReady(() => {
      const ctx = mixer.context
      if (ctx) prime(ctx, ALL_CUES)
    })
  }

  /** For the headless path in `main.ts`. After this, nothing here does anything. */
  disable(): void {
    mixer.disable()
  }

  get ready(): boolean {
    return mixer.ready
  }

  get muted(): boolean {
    return mixer.muted
  }

  toggleMute(): boolean {
    return mixer.toggleMute()
  }

  setLevel(level: number): void {
    mixer.setLevel(level)
  }

  /** For a HUD line. Sound must never be the only channel for anything. */
  status(): { ready: boolean; muted: boolean; voices: number; baked: number } {
    let voices = 0
    for (const e of this.emitters.values()) if (e.live) voices++
    return { ready: mixer.ready, muted: mixer.muted, voices, baked: bakedCues().length }
  }

  // ------------------------------------------------------------------ listener

  /**
   * Where the player is, and which way is right on screen.
   *
   * Call once a frame, before anything else. This is also when every positional
   * emitter is re-levelled, so a frame that does not call this is a frame where
   * the mill does not get quieter as you walk away from it.
   */
  listen(x: number, z: number, rightX: number, rightZ: number): void {
    if (!mixer.ready) return
    this.ears.x = x
    this.ears.z = z
    this.ears.rightX = rightX
    this.ears.rightZ = rightZ
    for (const e of this.emitters.values()) e.update(this.ears)
  }

  // ------------------------------------------------------------------ one-shots

  /**
   * Play a cue once. With `x`/`z` it is placed in the world; without, it is
   * flat and centred, which is right for anything that happens in the player's
   * own hands.
   */
  play(id: CueId, at?: { x: number; z: number }): void {
    const ctx = mixer.context
    if (!ctx) return

    const def = cue(id)
    const bus = mixer.bus(def.bus)
    if (!bus) return

    const now = ctx.currentTime
    if (def.throttle) {
      const last = this.lastPlayed.get(id) ?? -Infinity
      if (now - last < def.throttle) return
      this.lastPlayed.set(id, now)
    }

    let gainValue = def.gain
    let panValue = 0
    if (at) {
      const h = heard(this.ears, at.x, at.z, def.radius ?? 18)
      if (h.gain <= 0) return
      gainValue *= h.gain
      panValue = h.pan
    }

    const sample: Sample = sampleFor(ctx, id)
    const src = ctx.createBufferSource()
    src.buffer = sample.buffer
    if (def.detune) {
      // Deterministic, from the play counter. Never Math.random. (CLAUDE.md)
      const spread = hash01(this.shots * 3.77 + 11.3) * 2 - 1
      src.playbackRate.value = 1 + spread * def.detune
    }
    this.shots++

    const gain = ctx.createGain()
    gain.gain.value = gainValue * sample.lift
    const pan = ctx.createStereoPanner()
    pan.pan.value = panValue

    src.connect(gain).connect(pan).connect(bus)
    // From the first audible sample, so an MP3's encoder delay is not latency.
    src.start(0, sample.start, Math.max(0.01, sample.end - sample.start))
    src.onended = () => {
      src.disconnect()
      gain.disconnect()
      pan.disconnect()
    }
  }

  /**
   * A footfall every `STRIDE_METRES` of ground covered. Give it the player's
   * position every frame and whether they are on something built.
   */
  travel(x: number, z: number, onWood: boolean): void {
    if (!mixer.ready) {
      this.from = { x, z }
      return
    }
    if (!this.from) {
      this.from = { x, z }
      return
    }
    const d = Math.hypot(x - this.from.x, z - this.from.z)
    this.from.x = x
    this.from.z = z
    // A climb or a respawn is not a walk.
    if (d > TELEPORT) return

    this.walked += d
    while (this.walked >= STRIDE_METRES) {
      this.walked -= STRIDE_METRES
      this.play(onWood ? 'step-wood' : 'step-grass')
    }
  }

  // ---------------------------------------------------------------------- beds

  /** A non-positional loop: the clearing, and one day the music. */
  bed(id: CueId, on: boolean): void {
    if (on && this.beds.has(id)) return
    if (!on) {
      const live = this.beds.get(id)
      this.beds.delete(id)
      if (!live || !mixer.context) return
      const ctx = mixer.context
      live.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4)
      try {
        live.source.stop(ctx.currentTime + 1.5)
      } catch {
        // Already stopped.
      }
      return
    }

    // Claim the slot now, so two calls in one frame cannot start two beds.
    this.beds.set(id, null)
    mixer.whenReady(() => {
      const ctx = mixer.context
      if (!ctx || !this.beds.has(id)) return
      const def = cue(id)
      const bus = mixer.bus(def.bus)
      if (!bus) return

      const sample = sampleFor(ctx, id)
      const src = ctx.createBufferSource()
      src.buffer = sample.buffer
      src.loop = true
      src.loopStart = sample.start
      src.loopEnd = sample.end

      const gain = ctx.createGain()
      gain.gain.value = 0
      src.connect(gain).connect(bus)
      src.start(0, sample.start)
      // Four seconds in. An ambience bed that arrives is a bed you noticed.
      gain.gain.setTargetAtTime(def.gain * sample.lift, ctx.currentTime, 1.4)

      this.beds.set(id, { gain, source: src })
    })
  }

  // -------------------------------------------------------------------- fields

  /**
   * Reconcile the positional loops for one cue against a list.
   *
   * Call every frame with everything that should be making this sound right
   * now; anything that has stopped being reported is faded out and collected.
   * The nearest `MAX_EMITTERS` are kept and the rest are dropped.
   */
  field(id: CueId, entries: readonly FieldEntry[], count = entries.length): void {
    if (!mixer.ready) return
    const radius = cue(id).radius ?? 12

    for (const [key, e] of this.emitters) {
      if (key.startsWith(`${id}:`)) e.seen = false
    }

    // Nearest first, so the cap drops what is furthest away rather than
    // whatever the caller happened to list last. `count` lets a caller keep a
    // pool that only ever grows and say how much of it is live this frame,
    // which is how `main.ts` reports fires without allocating.
    this.ranked.length = 0
    for (let i = 0; i < count && i < entries.length; i++) {
      this.ranked.push(entries[i]!)
    }
    this.ranked.sort(
      (a, b) =>
        Math.hypot(a.x - this.ears.x, a.z - this.ears.z) -
        Math.hypot(b.x - this.ears.x, b.z - this.ears.z),
    )
    const ranked = this.ranked.slice(0, MAX_EMITTERS)

    for (const e of ranked) {
      const key = `${id}:${this.keyOf(e.key)}`
      let emitter = this.emitters.get(key)
      if (!emitter) {
        emitter = new Emitter(id, radius)
        this.emitters.set(key, emitter)
      }
      emitter.x = e.x
      emitter.z = e.z
      emitter.level = e.level
      emitter.seen = true
      emitter.update(this.ears)
    }

    for (const [key, emitter] of this.emitters) {
      if (!key.startsWith(`${id}:`) || emitter.seen) continue
      emitter.stop()
      this.emitters.delete(key)
    }
  }

  /**
   * Give the region's places their voices, once, at boot.
   *
   * The region is asked what it has and where; nothing in the audio layer knows
   * a coordinate. See `cues.PLACE_VOICES` and D22.
   */
  places(places: readonly { id: string; kind: string; at: { x: number; z: number } }[]): void {
    for (const place of places) {
      const voice = voiceFor(place)
      if (!voice) continue
      const key = `place:${place.id}`
      if (this.emitters.has(key)) continue
      const emitter = new Emitter(voice.cue, voice.radius)
      emitter.x = place.at.x
      emitter.z = place.at.z
      emitter.level = voice.gain
      this.emitters.set(key, emitter)
      // Levelled on the spot rather than on the next `listen`. An emitter that
      // is built and not updated is silent, so leaving it to the frame loop
      // would make "places are audible" depend on the order two calls happen
      // to be made in, which is the sort of thing that works in `main.ts` and
      // fails everywhere else.
      emitter.update(this.ears)
    }
  }

  /** Stable string for a field key, without holding a reference to an entity. */
  private keys = new WeakMap<object, string>()
  private nextKey = 0

  private keyOf(key: unknown): string {
    if (typeof key === 'string' || typeof key === 'number') return String(key)
    if (key !== null && typeof key === 'object') {
      let id = this.keys.get(key as object)
      if (!id) {
        id = `o${this.nextKey++}`
        this.keys.set(key as object, id)
      }
      return id
    }
    return 'anonymous'
  }
}

export const audio = new Audio()
export type { CueId } from './cues'
