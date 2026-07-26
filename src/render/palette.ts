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
  /**
   * Parched grass, for the thin patches in the ground bitmap.
   *
   * Its six luminances match `grass` step for step, deliberately. The patches
   * are dithered against the green ramp at the same index, so what varies
   * across the boundary is hue alone and the field stays continuous in value —
   * no blob appears in a greyscale check, and there is no stipple of two
   * complementary hues to resolve into red.
   *
   * Hue sits at ~53 degrees, well clear of the ~26 degrees of `dirt` and of the
   * tints region.ts uses for tracks (0xbb9160) and the yard (0x9c7a4e), and at
   * noticeably lower saturation than either. That separation is the whole
   * point: see the note on `dirt` below.
   */
  dryGrass: ['#302f21', '#403d28', '#545033', '#6a6542', '#867f57', '#a69e78'],
  /**
   * Bare soil. Warmer and redder than bark, so earth reads as earth.
   *
   * Used for stones and shore pebbles, and NOT for patches in the ground
   * bitmap. region.ts lays worn tracks and a trodden yard as authored geometry,
   * and under D20 that worn ground *is* the navigation system: it is how the
   * world says somebody walks here. A texture that scatters tan patches of the
   * same hue and size across the clearing competes with that signal directly,
   * and two of them beyond the palisade read as a path junction that means
   * nothing. So the split is: the ground bitmap owns grass, region.ts owns
   * bare earth.
   */
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

/** Six steps, dark to light. Every ramp in every band has exactly this shape. */
export type Ramp = readonly [string, string, string, string, string, string]

/** The material ramps a band bakes its textures from. Same keys in every band:
 *  `textures.ts` has one generator per key and it must work in all of them. */
export type Ramps = Readonly<Record<keyof typeof RAMP, Ramp>>

/**
 * Band 1: The Turn. One word: **municipal**.
 *
 * ## What "quieter and more wrong" means here specifically
 *
 * `docs/DESIGN.md` is precise about this band and it is not a fantasy-decay
 * band: modernity intrudes without comment. Tarmac through a wheat field,
 * powerlines, a parked sedan, a petrol station serving a village that still
 * uses oxen, and nobody remarks on any of it.
 *
 * So the wrongness is not rot or magic. It is the specific deadness of
 * infrastructure: concrete, galvanised steel, weathered fencing nobody paints,
 * roadside verge grass that is never watered. Colour that was made in a factory
 * and then left out. That reads as quieter AND wronger at the same time, which
 * uniform fading does not — a merely faded Band 0 is just Band 0 at dusk.
 *
 * ## How these numbers were made, and the one rule that must not be broken
 *
 * Derived from the Band 0 table above by a per-ramp drift in hue and chroma,
 * then **luminance-locked back to the Band 0 value, step for step**.
 *
 * That lock is the whole reason this is safe to drop in. `palette.ts` says
 * value does the reading, and Band 0's values are tuned against each other in
 * ways that are easy to destroy by accident: `dryGrass` matches `grass` step
 * for step so the dithered boundary between them is invisible in greyscale, and
 * `cloth` tops out below `sand` so a rope does not vanish on a beach. A naive
 * HSV drift breaks all of that silently, because desaturating a colour also
 * changes how bright it is. Measured before the lock was added, `wood` and
 * `clay` collapsed from 2.4% apart in value to 0.2%, and water drifted into
 * steel so a bucket would have disappeared against a pond.
 *
 * With the lock, Band 1 differs from Band 0 in hue and chroma ONLY. Every value
 * span is identical to the decimal, and a separation check over all 136 ramp
 * pairs scores exactly the same as Band 0 does.
 *
 * The drift, by role:
 *   - **Living things go wrong.** Grass, dry grass and canopy rotate about 60
 *     degrees cold, to a hue with no yellow left in it, at half the chroma.
 *     Chlorophyll green has yellow in it; verge green does not.
 *   - **Earth and timber only fade.** They keep their own hue order, so soil
 *     still reads as soil beside a plank. Weathered, not sick.
 *   - **Made things barely move.** Steel, glass and gold are within a few
 *     percent of Band 0. Iron is iron in any band, and that is the point: the
 *     manufactured things look MORE at home here than the grass does.
 *   - **Fire does not move at all.** `ember` is byte-identical to Band 0. The
 *     one thing still fully saturated in this band is the fire you brought with
 *     you, and everything around it looks worse for being next to it.
 *
 * Hue also rotates *cold* as each ramp lightens, inverting Band 0's "hue
 * rotates warm as a ramp lightens". A highlight that goes cold is the signature
 * of light that is not sunlight, and it costs nothing to say it here.
 */
export const RAMP1: Ramps = {
  grass: ['#2a302d', '#36423c', '#46574e', '#596e64', '#74897f', '#97a7a0'],
  dryGrass: ['#2b3029', '#373e33', '#485242', '#5b6854', '#73836c', '#92a28b'],
  dirt: ['#322a23', '#423930', '#54493e', '#675a4d', '#7c6e5f', '#928473'],
  leaf: ['#57615b', '#6c7772', '#818c87', '#96a19d', '#abb6b2', '#c0cbc7'],
  bark: ['#312b27', '#423a35', '#544b44', '#665c53', '#7a7064', '#908577'],
  wood: ['#3b332d', '#50453e', '#65584f', '#7a6d60', '#938676', '#b6ab9b'],
  /** Concrete rather than granite: cooler and flatter than Band 0's stone. */
  stone: ['#353736', '#4a4d4b', '#616661', '#797f78', '#979d94', '#bec4bb'],
  sand: ['#4f493b', '#655f4e', '#7c7662', '#948e77', '#afaa91', '#d0cdb9'],
  straw: ['#403c31', '#545042', '#696453', '#7f7b66', '#9a9780', '#bfbea7'],
  water: ['#384547', '#46595b', '#576f72', '#6a868a', '#84a0a4', '#a6bec3'],
  steel: ['#40464f', '#565d66', '#6d747e', '#868b96', '#a4a9b3', '#c7ccd3'],
  cloth: ['#443c36', '#574e46', '#6b6156', '#7f7568', '#958b7d', '#aea495'],
  clay: ['#463330', '#58423d', '#6b524a', '#7e6358', '#937869', '#a98f7f'],
  glass: ['#465b65', '#5b737f', '#708a98', '#89a2b1', '#a5bcc9', '#c4d5df'],
  gold: ['#644e1c', '#846a27', '#a38734', '#bca346', '#d2bd62', '#e7d78b'],
  /** Byte-identical to Band 0. Fire is the one thing that is still right. */
  ember: ['#3d1608', '#6b2410', '#a63817', '#d95420', '#ff7a2f', '#ffc247'],
  fruit: ['#2e1a1f', '#46272d', '#61353c', '#7d454c', '#9a5a5f', '#ba7879'],
}

/**
 * Everything the renderer needs to know about how one band looks.
 *
 * A band is data, not a branch. Nothing under `render/` or `world/` should ever
 * ask "which band is this" and choose colours in an `if`; it should be handed a
 * `Band` and read from it, for the same reason `sim/` may not branch on an item
 * id. Adding Band 2 should be a new entry in `BANDS` and no other change.
 */
export interface Band {
  /** Stable identifier. Also the RNG fork label, so it must never change once
   *  a band has shipped: see `seedLabel`. */
  readonly id: string
  /** Human name, from `docs/DESIGN.md`. */
  readonly name: string
  /**
   * The label `textures.ts` forks the texture RNG with.
   *
   * Band 0's is the bare string `'textures'` and must stay that way forever.
   * `rng.fork` derives a stream from the label alone, so renaming it would
   * reseed every texture in the game, change every existing screenshot, and
   * make every before/after comparison in this repo meaningless.
   */
  readonly seedLabel: string
  readonly ramps: Ramps
  readonly sky: number
  /**
   * Vestigial. Nothing reads these: fog is derived from `IsoCamera.fogRange()`
   * in `main.ts` because under an orthographic rig it has to bracket the
   * camera's own distance (D9). Kept only so the two bands have one shape.
   * Delete from both at the same time or from neither.
   */
  readonly fogNear: number
  readonly fogFar: number
  readonly grass: readonly number[]
  readonly dirt: number
  readonly sand: number
  readonly rock: number
  readonly water: number
  readonly waterDeep: number
  readonly bark: number
  readonly barkDark: number
  readonly leaf: readonly number[]
  readonly sun: number
  readonly skyLight: number
  readonly groundLight: number
  readonly ember: number
  readonly flame: number
  /**
   * The player, who does NOT change colour when they cross a border. These are
   * identical in every band on purpose; they are here because they were here,
   * and they would be better off in their own export.
   */
  readonly tunic: number
  readonly trouser: number
  readonly skin: number
  readonly hair: number
}

/** A ramp step as a three.js int. `RAMP.grass[3]` and `hex('grass', 3)` agree. */
export function hex(ramp: keyof typeof RAMP, step: number): number {
  const s = RAMP[ramp][Math.max(0, Math.min(RAMP[ramp].length - 1, step))]!
  return parseInt(s.slice(1), 16)
}

export const BAND0 = {
  id: 'hearth',
  name: 'Hearth',
  // Never change this string. See `Band.seedLabel`.
  seedLabel: 'textures',
  ramps: RAMP,
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
} as const satisfies Band

/**
 * Band 1: The Turn.
 *
 * The ramps carry the surfaces; these carry the light and the air. Two rules
 * ran through every number below.
 *
 * **The sky stops being weather.** Band 0's sky is a 27%-saturation blue with a
 * time of day in it. This one is a 7%-saturation overcast that could be any
 * hour, which is most of what makes a place feel municipal: nothing about the
 * light tells you when you are.
 *
 * **The sun stops being warm.** Band 0's key is lerped toward orange in
 * `main.ts` and lands near hue 41. This one sits at 3% saturation, so a surface
 * lit by it is very nearly its own colour and nothing gets the flattering warm
 * pass that makes Band 0 look like an afternoon. Combined with the drained
 * ramps that is the whole effect: a world lit by a bright grey sky.
 *
 * Fire is untouched, and the player is untouched.
 */
export const BAND1 = {
  id: 'turn',
  name: 'The Turn',
  seedLabel: 'textures:turn',
  ramps: RAMP1,
  /** An overcast with no hour in it. */
  sky: 0xb2bec0,
  fogNear: 34,
  fogFar: 96,

  grass: [0x596e64, 0x46574e, 0x74897f, 0x36423c],
  dirt: 0x675a4d,
  sand: 0x948e77,
  rock: 0x797f78,
  water: 0x576f72,
  waterDeep: 0x384547,

  bark: 0x665c53,
  barkDark: 0x423a35,

  /**
   * Verge green: the same three-tier structure as Band 0, rotated about 60
   * degrees cold and halved in chroma, so it lands near hue 144 at ~17%. Band 0
   * holds these near 36% and warns that tint times map compounds; at 17% the
   * canopy comes out around 21% on screen, which is drab without going grey.
   */
  leaf: [0x47564d, 0x576a5f, 0x697e71],

  sun: 0xe9eff0,
  skyLight: 0xc0ccd0,
  groundLight: 0x4e5654,

  ember: 0xff7a2f,
  flame: 0xffc247,

  tunic: 0x9e332c,
  trouser: 0x2e3752,
  skin: 0xe8b98a,
  hair: 0x33241a,
} as const satisfies Band

/**
 * Every band, indexed by distance from home. `world/` picks one and hands it
 * down; nothing downstream should know there is more than one.
 */
export const BANDS: readonly Band[] = [BAND0, BAND1]

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
  /**
   * Step 3 of `RAMP.fruit`. Nothing reads this yet: kitbash only tints the
   * transparent kinds, and `fruit` is opaque, so it falls through to the plain
   * `toonUnique({ map })` branch and takes its colour from the bitmap.
   *
   * It exists because kitbash indexes this table by `MaterialKind`, so the key
   * has to be here before `fruit` joins that union or the lookup is a type
   * error. Safe to land ahead of the recipe change for the same reason.
   */
  fruit: 0xa03d31,
} as const
