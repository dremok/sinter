/**
 * The AudioContext, the three buses, and the mute.
 *
 * Two rules shape this file and both of them are about NOT doing things.
 *
 * **Nothing is created until the player touches something.** Browsers refuse to
 * start audio without a gesture, and the usual answer, constructing an
 * AudioContext at boot and calling resume() hopefully, produces a context stuck
 * in `suspended` and a pile of nodes playing into it. `tools/shot.ts` never
 * interacts with the page at all, so under the headless path that pile would be
 * built on every run and never make a sound. So: no context, no nodes, no
 * decode, no fetch, until `pointerdown` or `keydown` says a human is there.
 *
 * **Nothing here is ever awaited by the game.** `resume()` and
 * `decodeAudioData()` both return promises and either can hang. The boot path
 * in `main.ts` already uses top-level await for the parts library, and
 * `window.__sinterReady` is what the screenshot harness blocks on, so one
 * awaited audio promise that never settles is a 30 second hang and a failed
 * shot. Every promise in the audio layer is fire and forget with a catch.
 *
 * The consequence to keep in mind: `ready` is false for the first few seconds
 * of a session, and one-shots fired in that window are dropped. That is
 * correct. Sound is never the only channel for anything (CLAUDE.md), so a
 * dropped footstep costs nothing, and beds started early are remembered and
 * begin when the context does.
 */

import type { BusId } from './cues'

const STORE_KEY = 'sinter.audio'
const BUSES: BusId[] = ['music', 'ambience', 'sfx']

/** Per-bus trim, so the mix has a shape before anything is tuned by hand. */
const BUS_LEVEL: Record<BusId, number> = {
  music: 0.7,
  ambience: 0.9,
  sfx: 1,
}

interface Prefs {
  muted: boolean
  master: number
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { muted: false, master: 0.8 }
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      muted: parsed.muted === true,
      master: typeof parsed.master === 'number' ? Math.min(1, Math.max(0, parsed.master)) : fallback.master,
    }
  } catch {
    // Private browsing, a corrupt value, or no localStorage at all. The game
    // must still make a sound.
    return fallback
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs))
  } catch {
    // Not being able to remember the mute is not a reason to fail.
  }
}

class Mixer {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private buses = new Map<BusId, GainNode>()
  private prefs: Prefs | null = null
  private waiting: (() => void)[] = []
  private listening = false
  private off: (() => void) | null = null

  /**
   * Hard off. The headless branch of `main.ts` sets this, so a screenshot run
   * cannot even register a gesture listener.
   */
  private allowed = true

  // ------------------------------------------------------------------ startup

  /** Arm the gesture listeners. Creates nothing. Safe to call more than once. */
  install(): void {
    if (!this.allowed || this.listening || typeof window === 'undefined') return
    this.listening = true

    const start = (): void => this.start()
    addEventListener('pointerdown', start, { once: true })
    addEventListener('keydown', start, { once: true })
    this.off = () => {
      removeEventListener('pointerdown', start)
      removeEventListener('keydown', start)
    }

    // A tab in the background should be silent. Nothing is suspended before the
    // context exists, so this is cheap until it isn't.
    addEventListener('visibilitychange', () => {
      if (!this.ctx) return
      if (document.hidden) void this.ctx.suspend().catch(() => {})
      else void this.ctx.resume().catch(() => {})
    })
  }

  /** Never make a sound, and never listen for a reason to. */
  disable(): void {
    this.allowed = false
    this.off?.()
    this.off = null
    this.waiting.length = 0
  }

  get enabled(): boolean {
    return this.allowed
  }

  /**
   * Build the graph. Called from inside a gesture handler, which is the only
   * moment a browser will let a context reach `running`.
   */
  private start(): void {
    if (!this.allowed || this.ctx) return

    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) {
      // No Web Audio at all. Turn the whole layer off rather than guarding
      // every call site for the rest of the session.
      this.allowed = false
      return
    }

    const ctx = new Ctor({ latencyHint: 'interactive' })
    this.ctx = ctx

    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : this.level
    this.master.connect(ctx.destination)

    for (const id of BUSES) {
      const g = ctx.createGain()
      g.gain.value = BUS_LEVEL[id]
      g.connect(this.master)
      this.buses.set(id, g)
    }

    // Chrome hands back a context already running when it is built in a
    // gesture; Safari does not. Ask either way, and never wait for the answer.
    if (ctx.state !== 'running') void ctx.resume().catch(() => {})

    const pending = this.waiting.slice()
    this.waiting.length = 0
    for (const fn of pending) {
      try {
        fn()
      } catch {
        // One broken bed must not take the rest of the queue with it.
      }
    }
  }

  // -------------------------------------------------------------------- state

  get ready(): boolean {
    return this.ctx !== null
  }

  get context(): AudioContext | null {
    return this.ctx
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0
  }

  bus(id: BusId): GainNode | null {
    return this.buses.get(id) ?? null
  }

  /** Run `fn` now if the context exists, or the moment it does. */
  whenReady(fn: () => void): void {
    if (!this.allowed) return
    if (this.ctx) fn()
    else this.waiting.push(fn)
  }

  // ------------------------------------------------------------------ volumes

  private get settings(): Prefs {
    // Read lazily rather than in the constructor: this module is imported by
    // tests running in node, where `localStorage` does not exist.
    if (!this.prefs) this.prefs = loadPrefs()
    return this.prefs
  }

  get muted(): boolean {
    return this.settings.muted
  }

  get level(): number {
    return this.settings.master
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted
    savePrefs(this.settings)
    this.applyMaster()
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted)
    return this.muted
  }

  setLevel(level: number): void {
    this.settings.master = Math.min(1, Math.max(0, level))
    savePrefs(this.settings)
    this.applyMaster()
  }

  setBusLevel(id: BusId, level: number): void {
    const g = this.buses.get(id)
    if (g && this.ctx) g.gain.setTargetAtTime(Math.max(0, level), this.ctx.currentTime, 0.02)
  }

  // ---------------------------------------------------------------- verifying

  /**
   * A stereo tap on the master bus, for `tools/bake-audio/runtime.ts`.
   *
   * Audio cannot be screenshotted, and every other check in this repo works by
   * looking at the thing that was made rather than at the code that made it
   * (CLAUDE.md). This is the closest equivalent: it hands a harness the actual
   * samples leaving the mixer, so "the merge made a sound", "the fire is in the
   * left ear" and "walking away made it quieter" are measurements rather than
   * claims. Split rather than a single analyser because a single one downmixes
   * to mono, which is exactly the information a pan check needs.
   *
   * Nothing in `src/` calls this and it costs nothing until it is called.
   */
  tap(): { left: AnalyserNode; right: AnalyserNode } | null {
    if (!this.ctx || !this.master) return null
    const splitter = this.ctx.createChannelSplitter(2)
    const left = this.ctx.createAnalyser()
    const right = this.ctx.createAnalyser()
    left.fftSize = 2048
    right.fftSize = 2048
    this.master.connect(splitter)
    splitter.connect(left, 0)
    splitter.connect(right, 1)
    return { left, right }
  }

  private applyMaster(): void {
    if (!this.master || !this.ctx) return
    // Ramped, not assigned. A gain that jumps to zero clicks, and a mute that
    // clicks is a worse mute than no mute.
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.level, this.ctx.currentTime, 0.015)
  }
}

export const mixer = new Mixer()
