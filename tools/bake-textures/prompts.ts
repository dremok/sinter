/**
 * What gets baked, and the art direction that decides how it looks.
 *
 * ## The two numbers that matter more than the prompt
 *
 * `size` is not a quality setting. `src/render/textures.ts` pins texel density
 * at `TEXELS_PER_UNIT = 12` and derives every repeat from the bitmap's own pixel
 * size, so a tile's resolution *is* its world footprint: 64px covers 5.3 metres,
 * 1024px covers 85. These sizes therefore match the constants already in that
 * file exactly (GROUND / SHORE / POOL / PROP), which is what makes the swap a
 * change of loader and nothing else. Raising one without raising
 * TEXELS_PER_UNIT would not add detail, it would zoom the texture out.
 *
 * `worldUnits` is that footprint written down. It is not, however, a framing to
 * hand the model: saying "five metres of trunk" gets a painting of five trees.
 * What it is for is the arithmetic above `SPECS`, which converts each material's
 * wanted feature pitch in texels into a count the prompt can ask for.
 *
 * ## The style contract
 *
 * From Max's last round of feedback and from `src/render/palette.ts`: muted,
 * desaturated, earthy, clear deliberate shapes rather than photographic detail,
 * flat lighting with nothing baked in. The colour half of that is enforced by
 * the palette snap in `image.ts` and cannot fail. The shape half can only be
 * asked for, which is what these prompts spend their words on.
 */

import { RAMP } from '../../src/render/palette'

/**
 * Prepended to every prompt.
 *
 * Two sentences of this earn their place by having been wrong first.
 *
 * "A flat surface of the material itself, filling the entire frame edge to edge,
 * with no background and no objects" is the fix for the single worst failure of
 * the first pass. Asked for "the bark of a standing tree trunk", the model
 * returned a painting of five tree trunks standing against a cream wall, which
 * is a perfectly good illustration and a completely useless texture. A material
 * model still wants to compose a picture unless it is told the frame *is* the
 * surface.
 *
 * The negations are kept short and at the end. They are in the prompt at all
 * only because the PATINA endpoint takes no negative prompt, and a long tail of
 * "no X" is worse than useless: it dilutes the positive direction and these
 * models half honour it anyway. The positive form ("completely flat even
 * ambient light") does most of the work that "no cast shadows" was failing to.
 */
const STYLE =
  'Hand-painted stylised game texture. ' +
  'A flat surface of the material itself, filling the entire frame edge to edge, ' +
  'seen straight on, with no background and no separate objects. ' +
  'Muted desaturated earthy colours, low saturation. ' +
  'Bold simple deliberate shapes, painterly, in the style of Don\'t Starve. ' +
  'Completely flat even ambient light, matte. ' +
  'Not photographic, no shadows, no highlights, no border.'

export interface TextureSpec {
  /** Must match a key of `TextureSet` in `src/render/textures.ts`. */
  name: string
  /** Committed pixel size. Matches the constants in `textures.ts`. */
  size: number
  /** Generation resolution. Must be an integer multiple of `size`. */
  source: number
  /** What one tile covers in world units, at TEXELS_PER_UNIT = 12. Documentation. */
  worldUnits: number
  prompt: string
  /** Every colour the committed file is allowed to contain. */
  palette: readonly string[]
  /** 0..1, how hard to stretch the model's value range onto the palette's. */
  stretch: number
  /** >1 pushes light, <1 pushes dark. */
  gamma: number
  /** One-texel unsharp amount, applied after reduction to restore hard edges. */
  sharpen: number
  /**
   * How much of the tile's own large-scale lighting to subtract, 0 to 1.
   *
   * High for anything the cel shader lights (every prop): a gradient baked into
   * the albedo is a second, wrong light source that does not move with the sun.
   * Zero for the ground, whose regional drift is deliberate art.
   */
  flatten: number
  /** Why this one is set up the way it is. */
  notes: string
}

/** Ramp steps `from`..`to` inclusive. */
const steps = (ramp: readonly string[], from: number, to: number) => ramp.slice(from, to + 1)

/**
 * Every prompt below counts its features out loud, and the counts are arithmetic
 * rather than taste.
 *
 * A prop tile is 64 texels covering 5.3 world units, and the things it lands on
 * are small: a trunk 1.5 units wide shows eighteen texels of it. For grain to
 * read as grain on that trunk it needs three or four ridges inside those
 * eighteen texels, which is a pitch of four or five texels, which is fourteen
 * ridges across the whole tile. The first pass asked for "four or five broad
 * ridges", got exactly that, and produced a picket fence: at a sixteen-texel
 * pitch a tree trunk shows one ridge.
 *
 * So each count here is the code-drawn version's own pitch, restated as a number
 * the model can act on. That file spent a pass discovering these (four texels to
 * a board, eight to a thatch course, two to a woven thread) and there is no
 * reason to rediscover them.
 */

export const SPECS: readonly TextureSpec[] = [
  {
    name: 'grass',
    size: 1024,
    source: 2048,
    worldUnits: 85.3,
    prompt:
      `${STYLE} Short stylised meadow grass seen from directly above. Broad soft ` +
      'drifts of lusher and drier grass about a sixth of the image across, and three ' +
      'or four ragged patches of bare brown earth worn through the turf, each about a ' +
      'tenth of the image wide. Densely covered in small individual tufts of grass ' +
      'blades a few pixels across, so it reads as separate plants rather than as a ' +
      'uniform carpet. Olive and sage green, never emerald, never bright.',
    palette: [...RAMP.grass, ...steps(RAMP.dirt, 0, 3)],
    stretch: 0.85,
    gamma: 1,
    sharpen: 0.4,
    flatten: 0,
    notes:
      'The most important texture in the game: it is most of what is on screen. ' +
      'One tile spans the whole 92-unit region, so nothing in it may repeat, and it ' +
      'is the one texture that wants variation at three separate scales. The dirt ' +
      'ramp is in the palette because worn soil belongs inside the grass tile, ' +
      'exactly as in the code-drawn version, but it is taken from the dark end: ' +
      'steps 1 to 4 put a mid red-brown patch against sage green and it read as raw ' +
      'meat, which is precisely the kind of thing Max meant by too saturated. Value ' +
      'separates the soil from the turf here, not chroma.',
  },
  {
    name: 'sand',
    size: 256,
    source: 1024,
    worldUnits: 21.3,
    prompt:
      `${STYLE} Damp shore sand seen from directly above. About thirteen soft broad ` +
      'ripple bands of wetter and drier sand curving gently across the image, low ' +
      'contrast, and about fifty small waterworn pebbles scattered over it. Warm ' +
      'greyish tan, dusty, restful.',
    palette: [...RAMP.sand, ...steps(RAMP.dirt, 1, 2), ...steps(RAMP.stone, 2, 3)],
    stretch: 0.75,
    gamma: 1,
    sharpen: 0.5,
    flatten: 0.5,
    notes:
      'region.ts tints this same bitmap for tracks, yards and tilled ground, so the ' +
      'banding has to stay low contrast: a bold ripple reads as wood grain once it is ' +
      'tinted brown. Stretch is held back for the same reason.',
  },
  {
    name: 'water',
    size: 128,
    source: 1024,
    worldUnits: 10.7,
    prompt:
      `${STYLE} The surface of a still shallow pond seen from directly above. About ` +
      'nine slow broad ripple bands across the image, soft and low contrast, wandering ' +
      'rather than regular, with deeper darker water toward one side. Nothing sharp, ' +
      'no foam, no reflections, no sparkle. Muted blue-grey teal.',
    palette: [...RAMP.water],
    stretch: 0.7,
    gamma: 1,
    sharpen: 0,
    flatten: 0.5,
    notes:
      'The one surface where fine detail is actively wrong: mipmaps are off, so ' +
      'per-texel variation shimmers the moment the camera moves. No sharpening at all, ' +
      'and the lowest busyness ceiling of the set.',
  },
  {
    name: 'bark',
    size: 64,
    source: 1024,
    worldUnits: 5.3,
    prompt:
      `${STYLE} Rough tree bark, close up, filling the frame. About fourteen long ` +
      'vertical ridges and deep grooves running the full height of the image, bending ' +
      'around three or four dark round knots. Warm dark brown.',
    palette: [...RAMP.bark],
    stretch: 0.9,
    gamma: 1,
    sharpen: 0.6,
    flatten: 1,
    notes:
      'A trunk 1.5 units wide shows about eighteen texels of this tile, so the grain ' +
      'period has to be four or five texels or a tree renders as a flat brown pole. ' +
      'That is why the prompt counts the ridges out loud.',
  },
  {
    name: 'foliage',
    size: 64,
    source: 1024,
    worldUnits: 5.3,
    prompt:
      `${STYLE} A dense mass of stylised foliage seen from above, made of about ` +
      'eighty overlapping rounded leaf clusters each a few pixels across, with ragged ' +
      'dark gaps between them that you could see through. Each cluster is a simple ' +
      'bold shape, not individual leaves. Nearly colourless pale grey-green, almost ' +
      'neutral, very low saturation, and pale rather than dark.',
    palette: [...RAMP.leaf],
    stretch: 0.85,
    gamma: 1.15,
    sharpen: 0.6,
    flatten: 0.7,
    notes:
      'region.ts multiplies this by a per-tier leaf tint, and multiplication compounds ' +
      'both saturation and darkness. So the ramp is deliberately pale and near-neutral ' +
      'and the gamma pushes light: any chroma or shadow baked in here is something the ' +
      'tint cannot take back, and the trees go black.',
  },
  {
    name: 'stone',
    size: 64,
    source: 1024,
    worldUnits: 5.3,
    prompt:
      `${STYLE} A wall of rough hewn granite blocks seen flat on, about seven large ` +
      'blocks across the image and seven down. Thin dark joints between the blocks, ' +
      'each block a distinctly different flat tone from its neighbours, one or two ' +
      'chipped corners, one crack. Nearly neutral warm grey.',
    palette: [...RAMP.stone],
    stretch: 0.8,
    gamma: 1,
    sharpen: 0.6,
    flatten: 1,
    notes:
      'Blocks rather than a rock face, because the joints are what survives reduction ' +
      'to 64px. A mottled boulder becomes grey soup; a block pattern keeps a readable ' +
      'grid of hard edges at any size. ' +
      'This is the one material in the set where the code-drawn version is better and ' +
      'the bake should probably not be adopted. A granite block wants to be about nine ' +
      'texels here, and asking for seven blocks across reliably returns fourteen small ' +
      'ones with soft joints. Asking for five or six with strong tone separation ' +
      'returned a chessboard of light and dark squares with no joints at all. The ' +
      'Voronoi in textures.ts gets block size, hard joints and a directional bevel ' +
      'exactly right by construction, and nothing in a prompt competes with that.',
  },
  {
    name: 'plank',
    size: 64,
    source: 1024,
    worldUnits: 5.3,
    prompt:
      `${STYLE} A wall of sawn wooden planks laid horizontally, about sixteen narrow ` +
      'boards stacked from top to bottom of the image. Clear dark gaps between the ' +
      'boards, long straight lengthwise grain, a few staggered butt joints where ' +
      'boards end. The boards alternate between lighter and darker at random, evenly ' +
      'over the whole image, with no overall progression from the top of the image to ' +
      'the bottom. Warm pale yellow-brown, dry and weathered.',
    palette: [...RAMP.wood],
    stretch: 0.85,
    gamma: 1,
    sharpen: 0.7,
    flatten: 1,
    notes:
      'Sixteen boards over 5.3 units is four texels per board, which is the pitch the ' +
      'code-drawn version uses and which puts about five boards up a hut wall. Fewer, ' +
      'wider boards were what the first draft asked for and a wall showed two of them.',
  },
  {
    name: 'straw',
    size: 64,
    source: 1024,
    worldUnits: 5.3,
    prompt:
      `${STYLE} A thatched roof seen flat on, laid in six broad horizontal courses ` +
      'stacked from top to bottom of the image. Each course is one bold flat band of ' +
      'straw with a strong dark shadow line along its top edge where the course above ' +
      'overlaps it, and a paler band of cut ends along its lower edge. Only a few ' +
      'large clumps of stalks are picked out; the rest of each band is flat. Grey ' +
      'weathered sun-bleached straw, dull greyish brown rather than gold, dusty, ' +
      'barely any colour in it at all.',
    palette: [...RAMP.straw],
    stretch: 0.85,
    gamma: 1,
    sharpen: 0.2,
    flatten: 1,
    notes:
      'Courses, not fur. Eight courses over 5.3 units is eight texels each, so a ' +
      'cottage roof shows three or four of them, which is what makes it read as thatch ' +
      'rather than as a brown blanket.',
  },
  {
    name: 'steel',
    size: 64,
    source: 1024,
    worldUnits: 5.3,
    prompt:
      `${STYLE} A sheet of hammered wrought iron seen flat on, worn and old. Broad ` +
      'soft horizontal brushed banding across the image, and about sixteen shallow ' +
      'hammer dents scattered over it. Cool desaturated blue-grey, matte and dull, ' +
      'not shiny, no reflections at all.',
    palette: [...RAMP.steel],
    stretch: 0.8,
    gamma: 1,
    sharpen: 0.6,
    flatten: 1,
    notes:
      'Matte is stated twice because every model wants to put a specular highlight on ' +
      'metal, and a baked highlight on a cel-shaded surface reads as a smear that does ' +
      'not move with the light.',
  },
  {
    name: 'cloth',
    size: 64,
    source: 1024,
    worldUnits: 5.3,
    prompt:
      `${STYLE} Coarse woven linen or sackcloth seen flat on. A clear regular ` +
      'diagonal twill weave with visibly thick threads, about thirty threads across, ' +
      'and a few slubs where a thread runs thicker. Undyed oatmeal beige, dull.',
    palette: [...RAMP.cloth],
    stretch: 0.8,
    gamma: 1,
    sharpen: 0.7,
    flatten: 1,
    notes:
      'Thirty threads over 64 texels is two texels a thread, which is the finest ' +
      'anything in this set is allowed to be. Any finer and the weave aliases into ' +
      'moire the moment the camera moves.',
  },
  {
    name: 'clay',
    size: 64,
    source: 1024,
    worldUnits: 5.3,
    prompt:
      `${STYLE} The side of a fired terracotta pot seen flat on. Broad horizontal ` +
      'throwing ridges left by the wheel, about ten of them, slightly wavering, with a ' +
      'soft band of glaze along a few. Warm dull red-brown earthenware, matte.',
    palette: [...RAMP.clay],
    stretch: 0.8,
    gamma: 1,
    sharpen: 0.5,
    flatten: 1,
    notes: 'Wheel ridges are the one feature that says "thrown pot" at ten texels.',
  },
  {
    name: 'glass',
    size: 64,
    source: 1024,
    worldUnits: 5.3,
    prompt:
      `${STYLE} A pane of old cloudy hand-blown glass seen flat on. Soft diagonal ` +
      'streaks and swirls from the blowing, and about eight round trapped bubbles. ' +
      'Pale desaturated blue-green, translucent, cloudy rather than clear. No ' +
      'reflections, no highlights, nothing behind it.',
    palette: [...RAMP.glass],
    stretch: 0.75,
    gamma: 1.1,
    sharpen: 0.4,
    flatten: 0.8,
    notes:
      'Glass materials in region.ts are tinted and often transparent, so the map has ' +
      'to carry structure without carrying a scene. "Nothing behind it" stops the model ' +
      'painting a window with a view.',
  },
  {
    name: 'gold',
    size: 64,
    source: 1024,
    worldUnits: 5.3,
    prompt:
      `${STYLE} A sheet of beaten gold seen flat on. Broad soft diagonal bands of ` +
      'lighter and darker metal across the whole frame, four or five of them, with ' +
      'faint hammer facets. Rich warm yellow, matte and burnished rather than mirror ' +
      'polished.',
    palette: [...RAMP.gold],
    stretch: 0.9,
    gamma: 1,
    sharpen: 0.5,
    flatten: 0.8,
    notes:
      'The one texture allowed real chroma: palette.ts says gold that is not loud is ' +
      'just brass. It is an item material, and items are the spotlight.',
  },
  {
    name: 'ember',
    size: 64,
    source: 1024,
    worldUnits: 5.3,
    prompt:
      `${STYLE} A bed of live coals seen from directly above. A crust of dark charred ` +
      'plates, about fifteen across the image and fifteen down, each only a few pixels ' +
      'wide, with bright hot orange fire glowing in the narrow cracks between them. ' +
      'Extreme contrast between the near-black crust and the glowing fissures. This ' +
      'one may be strongly saturated.',
    palette: [...RAMP.ember],
    stretch: 1,
    gamma: 1.25,
    sharpen: 0.6,
    flatten: 0.6,
    notes:
      'The loudest surface in the game on purpose, and the one place the desaturation ' +
      'rule is suspended. ' +
      'Like stone, this is a texture the bake loses and the code-drawn version should ' +
      'be kept. A hearth is about a metre across, so it renders at twelve texels, and ' +
      'the model gives an accurate bed of coals: a dark crust with fissures one texel ' +
      'wide. At twelve texels an accurate bed of coals reads as a patch of dirt with ' +
      'orange specks on it. Pushing gamma light barely moved it, because the problem is ' +
      'the proportion of crust to fire rather than the exposure. The Voronoi in ' +
      'textures.ts sets crust plate size directly, which is the one control that ' +
      'matters, and its hearth reads as fire from across the map.',
  },
]

export const SPEC_BY_NAME = new Map(SPECS.map((s) => [s.name, s]))

/**
 * Bumped whenever anything in the pipeline changes what a committed PNG would
 * look like for an unchanged prompt: the reducer, the snapper, the model, the
 * shared style string. It is hashed alongside each spec, so bumping it is how a
 * pipeline change invalidates the cache without anyone editing fourteen prompts.
 */
export const PIPELINE_VERSION = 12

/** The fal.ai endpoint. PATINA is fal's tiling material model; see ASSET_PIPELINE. */
export const MODEL = 'fal-ai/patina/material'
