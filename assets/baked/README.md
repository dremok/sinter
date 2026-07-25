# Baked assets

Generated once on a developer machine, committed, and loaded by the game as
static files. Nothing in `src/` ever calls fal.ai, ElevenLabs or anything else.
That is D8 and it is the constraint the whole deploy story rests on: no keys in
the client bundle, no network at runtime, playable offline.

```bash
npm run bake:textures                 # anything missing or stale
npm run bake:textures -- --plan       # what it would spend, calls nothing
npm run bake:verify                   # check the committed files, calls nothing
```

See `tools/bake-textures/`.

## textures/

Seventeen tiling albedo maps, one per entry of `TextureSet` in
`src/render/textures.ts`. Indexed (8-bit palette) PNG, sRGB, no alpha.
**175 kB for the set**, of which the three ground tiles are 157 kB.

| File | Size | Covers | On disk | What uses it |
|---|---|---|---|---|
| `grass.png` | 1024 | 85.3 units | 92.7 kB | the ground plane, one tile across the whole region |
| `grassWorn.png` | 512 | 42.7 units | 39.0 kB | ground variant, blended by noise in region.ts |
| `grassDry.png` | 512 | 42.7 units | 25.3 kB | ground variant, blended by noise in region.ts |
| `sand.png` | 256 | 21.3 units | 5.7 kB | the shore ring, and tinted for tracks, yards and tilled ground |
| `water.png` | 128 | 10.7 units | 1.4 kB | the pond surface |
| `cloth.png` | 64 | 5.3 units | 1.4 kB | sacking, rope, awnings |
| `foliage.png` | 64 | 5.3 units | 1.3 kB | canopy cones, lily pads |
| `ember.png` | 64 | 5.3 units | 1.2 kB | the hearth |
| `bark.png` | 64 | 5.3 units | 1.1 kB | trunks, palisade posts, logs |
| `stone.png` | 64 | 5.3 units | 1.0 kB | boulders, rubble walls |
| `straw.png` | 64 | 5.3 units | 1.0 kB | thatch, reeds, dry pasture |
| `glass.png` | 64 | 5.3 units | 0.9 kB | bottles, lenses |
| `plank.png` | 64 | 5.3 units | 0.7 kB | hut walls, fences |
| `gold.png` | 64 | 5.3 units | 0.7 kB | item material |
| `fruit.png` | 64 | 5.3 units | 0.7 kB | the apple, once kitbash stops asking it for `ember` |
| `steel.png` | 64 | 5.3 units | 0.6 kB | tools, fittings |
| `clay.png` | 64 | 5.3 units | 0.6 kB | pots |

Every prop tile is under 1.5 kB, which is not a typo. Each is at most ten
colours, all of them steps of a ramp in `src/render/palette.ts`, so an indexed
PNG of a 64px tile is mostly header. The whole set costs less than half the
400 kB the parts library is budgeted in `docs/PERFORMANCE.md`, and it removes the
largest boot cost that file lists: the ground tiles are no longer drawn texel by
texel at startup.

`npm run bake:verify` re-derives size, palette conformance and seam ratios from
the committed bytes. It needs no key and calls nothing, so it is safe in CI.
Note what it catches: because the palette is read live from
`src/render/palette.ts`, a ramp edit that the bake has not been re-run against
fails the check rather than quietly shipping textures in last week's colours.

### Two of these should probably not be adopted

`stone.png` and `ember.png` are worse than what `src/render/textures.ts` already
draws, and the reason is the same for both.

Each is a cellular pattern whose cell size is the entire design: a granite block
wants to be about nine texels, an ember crust plate about four. `textures.ts`
does both with a Voronoi diagram, which sets cell size directly by choosing a
seed count, and gets hard joints and a directional bevel for free. A diffusion
model has no such control. Asked for seven blocks across, it returns fourteen
small ones with soft joints; asked for five or six with strong tone separation,
it returns a chessboard of light and dark squares with no joints at all. The
ember tile is worse still: the model paints an accurate bed of coals, a dark
crust with fissures one texel wide, and a hearth renders at about twelve texels,
where an accurate bed of coals reads as a patch of dirt with orange specks on it.

The files are committed anyway, because they are on-palette and seamless and
having them is free at 2 kB, and because the comparison is worth being able to
re-run. But the recommendation is to load fifteen of the seventeen and leave those
two drawn. `tools/bake-textures/compare.ts` renders both side by side if you want
to disagree.

`manifest.json` records the prompt hash, model, seed, byte count and measured
quality metrics for each. It is provenance and cache state for the bake, and the
game must not read it: the loader below hardcodes the seventeen names, so a
missing file is a build error rather than a blank surface at runtime.

### Why these sizes, and why they are not a quality dial

`src/render/textures.ts` fixes `TEXELS_PER_UNIT = 12`, and `tiled()` derives
every repeat from that constant and the bitmap's own pixel size. So a texture's
resolution *is* a statement about how much world one tile covers. A 64px tile
spans 5.3 world units; 1024px spans 85.

These files therefore match the constants already in that file exactly
(`GROUND` 1024, `GROUND_VARIANT` 512, `SHORE` 256, `POOL` 128, `PROP` 64). Doubling one would not add
detail, it would halve the texel density of everything it lands on and make the
surface read as wallpaper, which is the failure D14 names. If higher-resolution
textures are ever wanted, `TEXELS_PER_UNIT` has to move with them, and that is an
art decision affecting every surface at once, not a swap of one file.

### Why every pixel is a palette step

The model decides structure and `src/render/palette.ts` decides colour. Every
texel is snapped to the nearest step of a small palette assembled from the ramps
in that file, measured in Oklab with chroma weighted so that a brown patch inside
a grass tile chooses the dirt ramp and value chooses the step within it.

That makes three things true by construction rather than by inspection. The
committed art cannot be off-palette, so "too saturated, hurts my eyes" cannot
come back through this door. The ramps stay the single source of colour, so
editing `palette.ts` and re-running the bake restyles the whole set. And
posterising to six or ten steps restores the hard edges that averaging sixteen
source pixels into one destroyed, which is the only reason a 1024px generation
survives reduction to a 64px tile at all.

## The loader contract

`src/render/textures.ts` currently draws these bitmaps texel by texel at boot.
Replacing that means changing the insides of three things and no call sites,
which is what D14 promised.

### 1. Import the files, do not fetch them

Follow the existing precedent in `src/render/parts.ts`:

```ts
import grassUrl from '../../assets/baked/textures/grass.png?url'
import sandUrl from '../../assets/baked/textures/sand.png?url'
// ...one per texture

const FILES: Record<keyof TextureSet, string> = {
  grass: grassUrl,
  sand: sandUrl,
  // ...
}
```

`tools/bake-textures/urls.ts` has all seventeen imports written out, so that
block can be copied rather than retyped. Nothing under `src/` imports it; it
exists because the probe that proved this contract works needed the same list,
and a contract that has been run beats one that has been written down.

Vite rewrites each to a content-hashed URL at build time, so the files are part
of the build output and a rename fails the build rather than 404ing in a player's
browser. Do not `fetch()` a path, and do not read `manifest.json`.

### 2. Build the Texture with exactly these settings

```ts
function fromImage(img: HTMLImageElement): THREE.Texture {
  const tex = new THREE.Texture(img)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}
```

Every line of that is load-bearing and matches what `build()` already does:

- **`NearestFilter` on both.** D14 says it twice and it is still true. Linear
  filtering turns a 64px tile into porridge, and it is worse here than it was for
  the drawn tiles, because these are quantised to six or ten palette steps and
  interpolation invents colours that are in no ramp.
- **No mipmaps.** The tiles are non-power-of-two in effect (they are POT, but the
  repeats are fractional) and mipmapping a nearest-filtered pixel tile
  reintroduces the blur `NearestFilter` exists to prevent.
- **`RepeatWrapping` on both.** `tiled()` sets fractional repeats well above 1.
- **`SRGBColorSpace`.** These were quantised in Oklab against ramps read as sRGB.
  Loading them as linear washes every ramp out by roughly a stop.

### 3. Preloading is async, and it must finish before the first frame

This is the one real change in shape. `textures()` is synchronous today because
it draws into a canvas; an image has to decode first.

```ts
export async function preloadTextures(): Promise<void> {
  if (cached) return
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([name, url]) => {
      const img = new Image()
      img.src = url
      await img.decode()
      return [name, fromImage(img)] as const
    }),
  )
  cached = Object.fromEntries(entries) as unknown as TextureSet
}

export function textures(_rng: Rng): TextureSet {
  if (!cached) throw new Error('preloadTextures() must be awaited before region build')
  return cached
}
```

`await preloadTextures()` goes in `src/main.ts`, alongside the existing
`await RAPIER.init()` and before the region is built.

**Do not** use `new THREE.TextureLoader().load(url)` without awaiting its
callback. It returns a Texture immediately and fills the image in later, which is
fine for a render loop and fatal here: `tools/shot.ts` runs N ticks and renders
**exactly one frame**, so every surface would come out untextured in every
screenshot, and `window.__sinterReady` would be set on a frame that is a lie.

`img.decode()` is the right await because it resolves after the bitmap is ready
to draw, not merely after the bytes have arrived.

### 4. `tiled()` keeps its logic and widens its type

The body does not change. The parameter type does, since these are no longer
`CanvasTexture`:

```ts
export function tiled(tex: THREE.Texture, worldW: number, worldH: number): THREE.Texture {
  const t = tex.clone()
  t.needsUpdate = true
  const img = tex.image as { width: number; height: number }
  const per = (world: number, texels: number) =>
    Math.max(MIN_TEXELS / texels, (world * TEXELS_PER_UNIT) / texels)
  t.repeat.set(per(worldW, img.width), per(worldH, img.height))
  return t
}
```

`HTMLImageElement` has `width` and `height` like a canvas does, so the arithmetic
is unchanged. Keep the fractional repeat, keep `MIN_TEXELS`, keep
`TEXELS_PER_UNIT = 12`: the tiles were generated against that number, and the
feature scale in every one of them (four texels to a plank board, eight to a
thatch course, two to a woven thread) is chosen for it.

`TextureSet`, `loadedTextures()` and every call in `src/world/region.ts` stay
exactly as they are.

### This has been run, not just written

`tiled()`'s arithmetic was executed in a real browser against these seventeen
files loaded through the `?url` imports above. All seventeen decode, keep
`NearestFilter` and `SRGBColorSpace`, and produce a ground repeat of 1.078 and a
bark repeat of 0.281 x 0.563, which are the same numbers the current canvas
textures produce for tiles of the same size. There were no page errors. The swap
really is mechanical.

### 5. What happens to the seed

`textures(rng)` can keep its parameter and ignore it, or drop it and lose one
argument at the single call site in `region.ts`. Either is safe, and this is
worth stating because it looks like it should not be: `rng.fork(label)` in
`src/core/rng.ts` is `createRng(\`${base}:${label}\`)`, which derives a stream
from the base seed and the label alone and **consumes nothing from the parent**.
Removing the `fork('textures')` call therefore cannot shift any other stream, and
no other subsystem's output moves.

Determinism improves rather than degrades: the textures are now the same bytes on
every machine and every seed, instead of the same only for a given seed.

## What is not baked, and why

**No normal, roughness, metalness or height maps**, although the fal.ai endpoint
returns all five and `docs/ASSET_PIPELINE.md` asks for three.

Every surface in the game is a `MeshToonMaterial` (see `src/render/toon.ts`).
That material has no roughness or metalness input at all, so two of the five
would be dead files. A normal map it does accept, but cel shading quantises
lighting into three hard bands, so a normal map does not shade a surface, it
moves the band boundary around inside it: the result is a torn, wandering edge
across a flat colour rather than the shape one is imagining. The whole look
depends on lighting arriving in flat bands, and the drawn tiles get their sense
of depth from bevels and directional edges baked into the albedo instead.

Generating them would cost a third more per texture and add megabytes to the
repo for files nothing loads. If the renderer ever grows a lit path that wants
them, `maps` in `tools/bake-textures/bake.ts` is a one-word change.

**No `dirt` texture.** There is a `RAMP.dirt` but no `dirt` entry in
`TextureSet`: worn soil lives inside the grass tile, and `region.ts` tints the
sand bitmap for tracks, yards and tilled ground. The baked `grass.png` carries
its bare-earth patches in the same four dirt ramp steps, so both paths behave as
before.
