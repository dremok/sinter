/**
 * The ONLY source of randomness in this project.
 *
 * Math.random() is banned everywhere. A seed must reproduce a run exactly, or
 * the screenshot verification workflow is worthless and bugs stop being
 * reproducible. See CLAUDE.md.
 */

export interface Rng {
  /** float in [0, 1) */
  next(): number
  /** float in [min, max) */
  range(min: number, max: number): number
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number
  /** true with probability p */
  chance(p: number): boolean
  /** uniform pick */
  pick<T>(items: readonly T[]): T
  /** in-place Fisher-Yates */
  shuffle<T>(items: T[]): T[]
  /** a derived stream, so subsystems cannot desync each other */
  fork(label: string): Rng
}

/** sfc32, chosen for speed and a long period. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
}

/** FNV-1a, used to turn seed strings into 32-bit state. */
function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function createRng(seed: string | number): Rng {
  const base = typeof seed === 'number' ? seed >>> 0 : hashString(seed)
  const next = sfc32(base, base ^ 0x9e3779b9, base ^ 0x85ebca6b, base ^ 0xc2b2ae35)
  // Discard early values; sfc32 needs a short warmup to decorrelate.
  for (let i = 0; i < 12; i++) next()

  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('rng.pick on empty array')
      return items[Math.floor(next() * items.length)]!
    },
    shuffle<T>(items: T[]): T[] {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const a = items[i]!
        const b = items[j]!
        items[i] = b
        items[j] = a
      }
      return items
    },
    fork: (label: string) => createRng(`${base}:${label}`),
  }
  return rng
}
