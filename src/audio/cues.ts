/**
 * Every sound the game can make, as data.
 *
 * One table, and adding a sound means adding a row. Nothing anywhere is allowed
 * to reach for a file path or build a node graph of its own; `index.ts` reads
 * this and that is the only route to the speakers. The reason is the one D17
 * gives for `items/interactions.ts`: a table can be listed, counted, checked for
 * a missing asset and shown to somebody, and a set of scattered play() calls
 * with baked-in gains can only be found by reading every file.
 *
 * Each row carries its own placeholder in `synth`, so the cue exists and is
 * audible whether or not it has been baked. `assets.ts` fills in the baked file
 * when there is one.
 */

import { layer, type SynthSpec } from './synth'

/** The three faders. Music is declared and unused: nothing is baked for it. */
export type BusId = 'music' | 'ambience' | 'sfx'

export interface CueDef {
  bus: BusId
  /** Peak gain for this cue, before the bus and master. */
  gain: number
  /** A bed that runs until it is stopped, rather than a one-shot. */
  loop?: boolean
  /**
   * Audible radius in metres, for positional plays. Beyond it the emitter is
   * torn down rather than left running at zero. See `space.rolloff`.
   */
  radius?: number
  /**
   * Playback-rate spread for one-shots, as a fraction. Two identical footsteps
   * in a row read as a machine; the same footstep 6% apart reads as two steps.
   * Deterministic, from `hash01` of the play index, never from Math.random.
   */
  detune?: number
  /** Shortest gap between two plays of this cue, in seconds. */
  throttle?: number
  synth: SynthSpec
}

export type CueId =
  | 'ambience'
  | 'fire'
  | 'water'
  | 'step-grass'
  | 'step-wood'
  | 'chop'
  | 'take'
  | 'drop'
  | 'merge'

export const CUES = {
  /**
   * The clearing. Wind in the tree line, birds a long way off, nothing with a
   * pitch you could hum. An ambience bed you notice is a bed that will be muted
   * within ten minutes.
   */
  ambience: {
    bus: 'ambience',
    gain: 0.28,
    loop: true,
    synth: {
      seconds: 6,
      loop: true,
      layers: [
        layer({ seconds: 6, gain: 0.5, cutoff: 420, cutoffBend: 1.6, attack: 0.5, hold: 1, curve: 0.2, wobble: { depth: 0.5, hz: 0.11 } }),
        layer({ seconds: 6, gain: 0.16, cutoff: 1800, attack: 0.5, hold: 1, curve: 0.2, wobble: { depth: 0.7, hz: 0.07 } }),
      ],
    },
  },

  /**
   * Fire, positional, one per burning thing. The radius is small: seventeen
   * palisade posts alight at once is a real state of this game, and a fire you
   * can hear from anywhere in the clearing turns that into a wall of noise.
   * `index.ts` caps how many run at once for the same reason `main.ts` caps
   * fire lights at six.
   */
  fire: {
    bus: 'sfx',
    gain: 0.5,
    loop: true,
    radius: 11,
    synth: {
      seconds: 3,
      loop: true,
      layers: [
        // The bed: a broad hiss that breathes.
        layer({ seconds: 3, gain: 0.34, cutoff: 900, attack: 0.3, hold: 1, curve: 0.3, wobble: { depth: 0.45, hz: 0.9 } }),
        // Crackles, at fixed offsets. Scattered rather than regular, because a
        // crackle on a beat is a metronome.
        layer({ at: 0.21, seconds: 0.05, gain: 0.5, cutoff: 5200, curve: 5, hold: 0 }),
        layer({ at: 0.77, seconds: 0.04, gain: 0.36, cutoff: 6400, curve: 5, hold: 0 }),
        layer({ at: 1.09, seconds: 0.06, gain: 0.55, cutoff: 4200, curve: 4, hold: 0 }),
        layer({ at: 1.88, seconds: 0.04, gain: 0.3, cutoff: 7000, curve: 5, hold: 0 }),
        layer({ at: 2.31, seconds: 0.05, gain: 0.46, cutoff: 5000, curve: 5, hold: 0 }),
      ],
    },
  },

  /**
   * Moving water: the brook, the ford, and the mill wheel, which is the loudest
   * of them. Placed from `region.places` rather than from coordinates, so a
   * generated region gets its water audible for free. See PLACE_VOICES.
   */
  water: {
    bus: 'sfx',
    gain: 0.4,
    loop: true,
    radius: 14,
    synth: {
      seconds: 4,
      loop: true,
      layers: [
        layer({ seconds: 4, gain: 0.3, cutoff: 2600, attack: 0.4, hold: 1, curve: 0.2, wobble: { depth: 0.3, hz: 0.6 } }),
        layer({ seconds: 4, gain: 0.1, cutoff: 700, attack: 0.4, hold: 1, curve: 0.2, wobble: { depth: 0.5, hz: 0.23 } }),
        // Two bubbles. Water without any pitch in it reads as radio static.
        layer({ at: 0.9, seconds: 0.09, gain: 0.13, noise: 0.15, freq: 640, bend: 2.1, curve: 3, hold: 0 }),
        layer({ at: 2.7, seconds: 0.08, gain: 0.1, noise: 0.15, freq: 810, bend: 1.8, curve: 3, hold: 0 }),
      ],
    },
  },

  /** A footfall on ground. Short, dull, no pitch. */
  'step-grass': {
    bus: 'sfx',
    gain: 0.22,
    detune: 0.09,
    throttle: 0.12,
    synth: {
      seconds: 0.16,
      layers: [layer({ seconds: 0.14, gain: 0.7, cutoff: 1500, cutoffBend: 0.5, curve: 3.2, hold: 0.02 })],
    },
  },

  /** A footfall on a deck or a felled trunk. Same event, with a body under it. */
  'step-wood': {
    bus: 'sfx',
    gain: 0.26,
    detune: 0.09,
    throttle: 0.12,
    synth: {
      seconds: 0.2,
      layers: [
        layer({ seconds: 0.16, gain: 0.5, cutoff: 2600, cutoffBend: 0.4, curve: 3.6, hold: 0.02 }),
        layer({ seconds: 0.18, gain: 0.42, noise: 0.35, freq: 168, bend: 0.85, cutoff: 900, curve: 3, hold: 0.02 }),
      ],
    },
  },

  /** Axe into standing timber: the hit, then the fibres letting go. */
  chop: {
    bus: 'sfx',
    gain: 0.55,
    detune: 0.06,
    synth: {
      seconds: 0.55,
      layers: [
        layer({ seconds: 0.09, gain: 0.85, noise: 0.55, freq: 96, bend: 0.7, cutoff: 3200, cutoffBend: 0.3, curve: 4.5, hold: 0 }),
        layer({ at: 0.05, seconds: 0.28, gain: 0.36, cutoff: 4600, cutoffBend: 0.25, curve: 3, hold: 0.03 }),
      ],
    },
  },

  /** Taking something. A small dry sound, up. */
  take: {
    bus: 'sfx',
    gain: 0.3,
    detune: 0.04,
    synth: {
      seconds: 0.18,
      layers: [
        layer({ seconds: 0.13, gain: 0.4, cutoff: 3400, cutoffBend: 0.4, curve: 4, hold: 0 }),
        layer({ seconds: 0.15, gain: 0.3, noise: 0.25, freq: 430, bend: 1.45, curve: 3, hold: 0.05 }),
      ],
    },
  },

  /** Putting something down. The same sound, down, and a touch heavier. */
  drop: {
    bus: 'sfx',
    gain: 0.32,
    detune: 0.04,
    synth: {
      seconds: 0.24,
      layers: [
        layer({ seconds: 0.16, gain: 0.45, cutoff: 2200, cutoffBend: 0.35, curve: 3.6, hold: 0 }),
        layer({ seconds: 0.2, gain: 0.34, noise: 0.3, freq: 320, bend: 0.62, curve: 3, hold: 0.04 }),
      ],
    },
  },

  /**
   * The merge, which is the one sound in this table that carries a rule.
   *
   * Rule 3: both inputs are destroyed permanently, and the whole tension of the
   * game is in deciding whether to accept that. If this cue is a chime, the
   * game has told the player they were rewarded, and a reward is exactly what a
   * merge is not.
   *
   * So it is three events and none of them is bright:
   *
   *   1. a grind, 0.5s, with the filter CLOSING rather than opening. Two things
   *      being worked against each other, getting duller, not sharper.
   *   2. a low impact where the grind ends. This is the loss landing, and it is
   *      the loudest moment in the cue.
   *   3. one quiet resonance, a second and a half, decaying to nothing. What is
   *      left. Nothing follows it and nothing resolves it.
   *
   * It ends far quieter than it starts, and there is no rise anywhere in it.
   * That is the whole design, and the baked version is prompted for the same
   * shape rather than for a nicer noise.
   */
  merge: {
    bus: 'sfx',
    gain: 0.62,
    synth: {
      seconds: 2.4,
      layers: [
        layer({ seconds: 0.52, gain: 0.42, cutoff: 2000, cutoffBend: 0.22, attack: 0.06, curve: 1.2, hold: 0.35 }),
        layer({ at: 0.46, seconds: 0.4, gain: 0.9, noise: 0.4, freq: 58, bend: 0.8, cutoff: 1400, cutoffBend: 0.3, curve: 3.4, hold: 0 }),
        layer({ at: 0.6, seconds: 1.75, gain: 0.3, noise: 0.05, freq: 147, bend: 0.985, cutoff: 2400, cutoffBend: 0.5, attack: 0.02, curve: 1.5, hold: 0.03 }),
      ],
    },
  },
} as const satisfies Record<CueId, CueDef>

export const ALL_CUES = Object.keys(CUES) as CueId[]

export function cue(id: CueId): CueDef {
  return CUES[id]
}

/**
 * What a place sounds like.
 *
 * D22 asks that regions expose their meaning and that systems ask rather than
 * know the map, and `Region.places` was built for exactly that and has had no
 * consumer until now. This is the consumer: audio asks the region where its
 * water is and puts water there, so a generated region is audible without one
 * coordinate appearing in this file.
 *
 * Keyed by place id first and place kind second. The id key is a semantic slot
 * ("the mill"), not an instance in a particular clearing, which is the line D22
 * actually draws; a generator that emits a mill emits a place called `mill` and
 * gets its wheel for free. If it emits something nobody has voiced, the `kind`
 * fallback still covers it.
 *
 * The mill is the loud one. `region.ts` says the wheel is visible from most of
 * the clearing, so it should be audible from most of it too, and being able to
 * hear it from the hearth is a signpost in a game that has banned signposts.
 */
export interface PlaceVoice {
  cue: CueId
  /** Multiplies the cue's own gain. */
  gain: number
  /** Overrides the cue's radius, in metres. */
  radius: number
}

export const PLACE_VOICES: {
  byId: Partial<Record<string, PlaceVoice>>
  byKind: Partial<Record<string, PlaceVoice>>
} = {
  byId: {
    mill: { cue: 'water', gain: 1.15, radius: 21 },
    // A well is water that is not going anywhere. Nothing to hear.
    well: { cue: 'water', gain: 0, radius: 0 },
    // A pond is nearly still: audible at the shore and not from the track.
    pond: { cue: 'water', gain: 0.5, radius: 9 },
  },
  byKind: {
    water: { cue: 'water', gain: 1, radius: 13 },
  },
}

export function voiceFor(place: { id: string; kind: string }): PlaceVoice | null {
  const found = PLACE_VOICES.byId[place.id] ?? PLACE_VOICES.byKind[place.kind]
  if (!found || found.gain <= 0 || found.radius <= 0) return null
  return found
}
