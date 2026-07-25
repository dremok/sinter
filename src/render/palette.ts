/**
 * Band 0: Hearth.
 *
 * ## Saturation is a spotlight, not a floodlight
 *
 * This file used to say "high saturation, few hues". That instruction existed
 * because the first art pass read as olive sludge, and it worked, and then it
 * overshot: Max's words on the build were "some of the colors are too harsh and
 * too saturated, hurts my eyes". A measurement of the rendered frame agreed —
 * mean HSV saturation 64%, with the ground alone about three quarters of every
 * pixel. **Do not treat the old instruction as still binding.**
 *
 * The rule now is that saturation varies by role, because chroma is what the
 * eye goes to first and there is no point spending it on the backdrop:
 *
 *   - Ground, foliage, terrain: 30-40%. These are what everything else sits
 *     against. A field should be restful.
 *   - Wood, stone, sand, cloth: 30-40% and warm rather than colourful; stone
 *     is nearly neutral.
 *   - Items, fire, gold, the player: 50-80%. These are the spotlight, and they
 *     read as important precisely because their surroundings do not.
 *
 * Greens moved toward olive and sage rather than emerald, following the Don't
 * Starve direction: muted and earthy, with separation carried by value and by
 * the outline pass, not by chroma.
 *
 * ## Value does the reading
 *
 * This is the part that must not be lost while desaturating. Every ramp is six
 * steps spanning roughly 3:1 in luminance, and that span is what makes cel
 * shading work: the toon shader quantises lighting to three bands, so if a
 * texture's own range is narrower than one band the whole surface collapses to
 * a flat colour. Desaturating should *widen* the gap between how much work
 * value does and how much chroma does, not flatten value along with it.
 *
 * A greyscale check of the frame is the honest test, and it is how the ground
 * was caught reading as one uniform carpet. `RAMP.grass` in particular must not
 * sit tight in value, because everything in the game stands on it.
 *
 * Two more rules that hold across every ramp:
 *   - Hue rotates warm as a ramp lightens and cool as it darkens.
 *   - Saturation peaks in the middle and pulls toward neutral at both ends, so
 *     highlights read as sun-bleached rather than as neon. Check this in the
 *     rendered frame, not only in the table.
 *
 * Ramps are hex strings because their consumer is a 2D canvas. The numeric
 * exports below are the same colours for three.js, which wants ints.
 */

/** Dark to light. Index 0 is deepest shadow, the last index is full sunlight. */
export const RAMP = {
  /**
   * Field grass. Olive-sage, spanning 3.5:1 in value.
   *
   * Saturation genuinely peaks in the middle here: 27% at the shadow end, 39%
   * at step 2, 20% at the top. The first attempt held ~35% all the way up, and
   * a 2.1-intensity warm sun on a saturated light green came out acid lime
   * across every lit slope. The top step has to be sun-bleached, not just
   * bright, or the brightest thing in the frame is the backdrop.
   */
  grass: ['#2b3124', '#39432a', '#4b5836', '#5f6f45', '#7b8a5f', '#9ca887'],
  /** Bare soil. Warmer and redder than bark, so worn ground reads as earth. */
  dirt: ['#352a1c', '#473828', '#5a4835', '#705843', '#876c53', '#9e8267'],
  /**
   * Canopy. Deliberately pale and near-neutral (8-15% saturation): region.ts
   * multiplies this by a per-tier leaf colour, and multiplication compounds
   * saturation, so any chroma in the map is chroma the tint cannot take back.
   * Keeping the map neutral lets the tint choose the hue and the map carry the
   * structure, which is what makes three tinted copies of one bitmap look like
   * three kinds of leaf.
   */
  leaf: ['#5a6152', '#6f7767', '#848c7c', '#99a191', '#aeb6a6', '#c3cbbb'],
  /** Standing timber: trunks, palisade posts, the woodpile. */
  bark: ['#332b21', '#453a2d', '#584b3a', '#6b5c48', '#816f57', '#988468'],
  /** Sawn and dressed timber. Lighter and yellower than bark: a cut face. */
  wood: ['#3e3324', '#544534', '#6a5843', '#806c53', '#9a8568', '#bcab8d'],
  /** Granite. Nearly neutral, faintly warm, so it sits beside the wood. */
  stone: ['#353735', '#4b4d4a', '#636560', '#7c7e77', '#9b9c93', '#c2c3ba'],
  /** Wet-to-dry shore sand, and the tinted base for tracks and tilled ground. */
  sand: ['#57482f', '#6f5e40', '#877453', '#a08c68', '#bda882', '#dacbae'],
  /** Cut thatch, dry pasture, roofing. */
  straw: ['#463b26', '#5c4f34', '#726343', '#8a7a54', '#a5966e', '#c9bd96'],
  /** Still fresh water. Allowed more chroma than the land, but not much more. */
  water: ['#30474f', '#3b5b66', '#48727f', '#578a98', '#71a4b1', '#96c2ce'],
  steel: ['#3f474f', '#555d66', '#6c747d', '#848c95', '#a2aab2', '#c6ccd2'],
  /**
   * Cloth, and rope. The light end used to run to near-white, which made a
   * rope coil vanish against pale sand at play distance. It now tops out around
   * 0.65 luminance against sand's 0.80, so the two separate by value.
   */
  cloth: ['#463c2e', '#5a4e3c', '#6e614b', '#83755c', '#9a8b70', '#b3a488'],
  clay: ['#4e3226', '#63402f', '#785039', '#8d6146', '#a37556', '#b98c6c'],
  glass: ['#3f5d66', '#52757f', '#668d98', '#7ea5b0', '#9bbfc8', '#bcd8de'],
  /** An item, so it keeps its chroma. Gold that is not loud is just brass. */
  gold: ['#6b4d13', '#8d681c', '#af8528', '#c9a03a', '#dfba58', '#f2d485'],
  /**
   * Live coals: a dark crust with fire in the cracks. The most saturated thing
   * in the game, on purpose. Fire is the one surface that should be loud.
   */
  ember: ['#3d1608', '#6b2410', '#a63817', '#d95420', '#ff7a2f', '#ffc247'],
  /**
   * Ripe fruit. Exists because the apple's kitbash recipe asks for `ember`, a
   * fire ramp, so a Red Apple renders pumpkin orange in the world and in its
   * icon. Wiring this up needs one line in kitbash.ts's material map and one in
   * the apple recipe; nothing outside those two files has to change.
   */
  fruit: ['#3f1614', '#5e211d', '#802e26', '#a03d31', '#bb5343', '#d1745f'],
} as const

/** A ramp step as a three.js int. `RAMP.grass[3]` and `hex('grass', 3)` agree. */
export function hex(ramp: keyof typeof RAMP, step: number): number {
  const s = RAMP[ramp][Math.max(0, Math.min(RAMP[ramp].length - 1, step))]!
  return parseInt(s.slice(1), 16)
}

export const BAND0 = {
  /** Softened from a 44%-saturation cyan; sky is a large area and it glared. */
  sky: 0x9cc6d6,
  fogNear: 34,
  fogFar: 96,

  // Sampled off RAMP.grass. Reference values for anything needing a flat green;
  // the ground itself is textured.
  grass: [0x5f6f45, 0x4b5836, 0x7b8a5f, 0x39432a],
  dirt: 0x705843,
  sand: 0xa08c68,
  rock: 0x7c7e77,
  water: 0x48727f,
  waterDeep: 0x30474f,

  bark: 0x6b5c48,
  barkDark: 0x453a2d,

  /**
   * Three canopy tints, one per cone tier, multiplied over the pale `foliage`
   * bitmap. Ordered dark to light so the lowest tier of a tree is its deepest
   * green and the crown catches the most sun, which is the cheapest way to make
   * a stack of cones read as a tree rather than as a stack of cones.
   *
   * Held near 36% saturation. Tint times map compounds, so these land at about
   * 43% on screen; anything more saturated here and the canopy goes emerald.
   */
  leaf: [0x4a5738, 0x5c6b45, 0x707f54],

  sun: 0xfff4dc,
  skyLight: 0xb4d2e0,
  groundLight: 0x555c46,

  ember: 0xff7a2f,
  flame: 0xffc247,

  /**
   * The player. Two jobs, and the second one was being failed: the tunic needs
   * a hue that is nowhere else in the scene, *and* a luminance clearly off the
   * ground's, or the character cannot be found in a greyscale check. The old
   * tunic sat at 0.37 against a field averaging 0.42 and disappeared. This one
   * is a deep red at 0.26, well under the field, and the ramp from hair (0.16)
   * through tunic to skin (0.75) gives the figure its own internal contrast.
   */
  tunic: 0x9e332c,
  trouser: 0x2e3752,
  skin: 0xe8b98a,
  hair: 0x33241a,
} as const

/**
 * The flat colour for each item material. Only the transparent kinds actually
 * tint their texture; the rest pass the bitmap through untinted and use these
 * for icon fallbacks. Each one is step 3 or 4 of its ramp, which is the step
 * that reads as "this material in full sun".
 */
export const MATERIAL_COLOR = {
  wood: 0x806c53,
  steel: 0x848c95,
  stone: 0x7c7e77,
  cloth: 0x83755c,
  glass: 0x7ea5b0,
  leaf: 0x5c6b45,
  water: 0x578a98,
  ember: 0xff7a2f,
  gold: 0xc9a03a,
  straw: 0x8a7a54,
  clay: 0x8d6146,
} as const
