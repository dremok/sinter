/**
 * Band 0: Hearth.
 *
 * Tuned for a 16-bit console look rather than a naturalistic one. That means
 * high saturation, few hues, and clear separation between neighbouring
 * surfaces, because the frame is rendered at 720p and then upscaled with hard
 * pixel edges. Muddy, closely related colours turn to noise at that size; the
 * original olive-and-tan palette read as sludge once pixellated.
 *
 * Rule of thumb when adding a colour here: if you cannot tell it apart from its
 * neighbour in a 16x16 thumbnail, it is wrong.
 *
 * ## Ramps are the source of truth
 *
 * Everything below is built from `RAMP`, which is the whole palette as a set of
 * ordered dark-to-light runs, one per material family. This replaced two dozen
 * hex literals scattered through `textures.ts` that had drifted away from the
 * colours named here, so "the palette" and "what the textures actually draw"
 * were two different sets that nobody could compare.
 *
 * Three rules hold across every ramp, and they are what make the set read as
 * one palette rather than eleven unrelated gradients:
 *
 *   1. **Six steps, spanning roughly 3:1 in luminance.** The old textures sat
 *      inside a narrow band, which is why they read as mud once the toon ramp
 *      quantised them: three lighting bands landing on three near-identical
 *      colours is one flat colour. A wide internal range gives cel shading
 *      something to bite on, because the texture's own light and dark survive
 *      inside a single lighting band.
 *   2. **Hue rotates warm as a ramp gets lighter, cool as it gets darker.**
 *      Grass runs from a blue-leaning shadow green to a yellow-leaning sunlit
 *      green. This is the oldest trick in painted sprite work and it is most of
 *      what stops a ramp looking like a brightness slider.
 *   3. **Saturation peaks in the middle.** The darkest and lightest steps pull
 *      toward neutral, so highlights read as light rather than as neon.
 *
 * Ramps are hex strings because their consumer is a 2D canvas. The numeric
 * exports below are the same colours for three.js, which wants ints.
 */

/** Dark to light. Index 0 is deepest shadow, the last index is full sunlight. */
export const RAMP = {
  /** Field grass. Cool in shadow, yellowing in the sun. */
  grass: ['#2c4a1e', '#3a6023', '#4a7a2a', '#5d9634', '#74b241', '#93cc55'],
  /** Bare soil showing through the sward, and the trodden ring around the pond. */
  dirt: ['#4a3720', '#63492a', '#7d5d36', '#977345', '#b08c58', '#c4a271'],
  /**
   * Canopy. Deliberately light: `foliage` is multiplied by a per-tier leaf
   * colour in region.ts, and a mid-green map times a mid-green tint is a black
   * green. Keeping the map pale lets the tint do the colouring and the map do
   * the structure, which is the division of labour that makes three tinted
   * copies of one bitmap look like three kinds of leaf.
   */
  leaf: ['#6f9c5a', '#86b06a', '#9dc47c', '#b3d68e', '#c6e29e', '#d8ecb2'],
  /** Standing timber: trunks, palisade posts, the woodpile. */
  bark: ['#3d2916', '#52361c', '#6b4724', '#85582c', '#9e6c38', '#b78446'],
  /** Sawn and dressed timber. Lighter and yellower than bark: a cut face. */
  wood: ['#6d4826', '#85582f', '#9c6b3a', '#b47f46', '#c89457', '#dcaa6d'],
  /** Granite. Warm-neutral rather than blue-grey, so it sits beside the wood. */
  stone: ['#4f5250', '#676a66', '#7f827c', '#979a92', '#b0b2a9', '#c8cabf'],
  /** Wet-to-dry shore sand. */
  sand: ['#9c7845', '#b48e57', '#c5a36c', '#d6b884', '#e4ca9c', '#f0dcb8'],
  /** Cut thatch, dry pasture, roofing. */
  straw: ['#8a6a2e', '#a3813a', '#bb9848', '#d0ae5c', '#e2c478', '#f0d998'],
  /** Still fresh water. */
  water: ['#1a5480', '#1f6b9c', '#2b85bc', '#3898cf', '#4fb0e0', '#7fcdf0'],
  steel: ['#4a5865', '#66737f', '#828f9c', '#9eabb8', '#bcc8d4', '#dde6ef'],
  cloth: ['#9c8264', '#b39a7c', '#c8ae90', '#d9c1a4', '#e8d4ba', '#f4e6d2'],
  clay: ['#6d3a26', '#874c31', '#a25f3e', '#b8734c', '#cb8a62', '#daa17c'],
  glass: ['#4f95a6', '#6cb0be', '#8ac8d4', '#a6dbe4', '#c0e9f0', '#d8f4f8'],
  gold: ['#8a6418', '#ab7f24', '#c89a34', '#dcb84a', '#efd268', '#ffe98c'],
  /** Live coals: a dark crust with fire in the cracks. Ends far brighter. */
  ember: ['#3d1608', '#6b2410', '#a63817', '#d95420', '#ff7a2f', '#ffc247'],
} as const

/** A ramp step as a three.js int. `RAMP.grass[3]` and `hex('grass', 3)` agree. */
export function hex(ramp: keyof typeof RAMP, step: number): number {
  const s = RAMP[ramp][Math.max(0, Math.min(RAMP[ramp].length - 1, step))]!
  return parseInt(s.slice(1), 16)
}

export const BAND0 = {
  sky: 0x7ec8e3,
  fogNear: 34,
  fogFar: 96,

  // Sampled off RAMP.grass, mid to light. These are reference values for
  // anything that needs a flat green; the ground itself is textured.
  grass: [0x5d9634, 0x4a7a2a, 0x74b241, 0x3a6023],
  dirt: 0x977345,
  sand: 0xd6b884,
  rock: 0x979a92,
  water: 0x3898cf,
  waterDeep: 0x1a5480,

  bark: 0x85582c,
  barkDark: 0x52361c,

  /**
   * Three canopy tints, one per cone tier, multiplied over the pale `foliage`
   * bitmap. Ordered dark to light so the lowest tier of a tree is its deepest
   * green and the crown catches the most sun, which is the single cheapest way
   * to make a stack of cones read as a tree rather than as a stack of cones.
   */
  leaf: [0x2f6b28, 0x3f8a33, 0x59a83f],

  sun: 0xfff4dc,
  skyLight: 0xa8d8ee,
  groundLight: 0x4a5c30,

  ember: 0xff7a2f,
  flame: 0xffc247,

  // The player. A saturated tunic against saturated grass needs a hue that is
  // nowhere else in the scene, or the character vanishes into the field.
  tunic: 0xc8443c,
  trouser: 0x3c4a7a,
  skin: 0xe8b98a,
  hair: 0x4a3220,
} as const

/**
 * The flat colour for each item material. Only the transparent kinds actually
 * tint their texture; the rest pass the bitmap through untinted and use these
 * for icon fallbacks. Each one is step 3 or 4 of its ramp, which is the step
 * that reads as "this material in full sun".
 */
export const MATERIAL_COLOR = {
  wood: 0xb47f46,
  steel: 0x9eabb8,
  stone: 0x979a92,
  cloth: 0xd9c1a4,
  glass: 0xa6dbe4,
  leaf: 0x3f8a33,
  water: 0x3898cf,
  ember: 0xff7a2f,
  gold: 0xdcb84a,
  straw: 0xd0ae5c,
  clay: 0xb8734c,
} as const
