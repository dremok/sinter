# Baked assets

Generated once on a developer machine, committed, and loaded by the game as
static files. Nothing in `src/` ever calls fal.ai, ElevenLabs or anything else.
That is D8 and it is the constraint the whole deploy story rests on: no keys in
the client bundle, no network at runtime, playable offline.

Regenerate with `npm run bake:textures`. See `tools/bake-textures/`.

## textures/

Fourteen tiling albedo maps, one per entry of `TextureSet` in
`src/render/textures.ts`. Indexed (8-bit palette) PNG, sRGB, no alpha.

| File | Size | Covers | What uses it |
|---|---|---|---|
| `grass.png` | 1024 | 85.3 units | the ground plane, one tile across the whole region |
| `sand.png` | 256 | 21.3 units | the shore ring, and tinted for tracks, yards and tilled ground |
| `water.png` | 128 | 10.7 units | the pond surface |
| `bark.png` | 64 | 5.3 units | trunks, palisade posts, logs |
| `foliage.png` | 64 | 5.3 units | canopy cones, lily pads |
| `stone.png` | 64 | 5.3 units | boulders, rubble walls |
| `plank.png` | 64 | 5.3 units | hut walls, fences |
| `straw.png` | 64 | 5.3 units | thatch, reeds, dry pasture |
| `steel.png` | 64 | 5.3 units | tools, fittings |
| `cloth.png` | 64 | 5.3 units | sacking, rope, awnings |
| `clay.png` | 64 | 5.3 units | pots |
| `glass.png` | 64 | 5.3 units | bottles, lenses |
| `gold.png` | 64 | 5.3 units | item material |
| `ember.png` | 64 | 5.3 units | the hearth |

`manifest.json` records the prompt hash, model, seed, byte count and measured
quality metrics for each. It is provenance and cache state for the bake, and the
game must not read it: the loader below hardcodes the fourteen names, so a
missing file is a build error rather than a blank surface at runtime.

### Why these sizes, and why they are not a quality dial

`src/render/textures.ts` fixes `TEXELS_PER_UNIT = 12`, and `tiled()` derives
every repeat from that constant and the bitmap's own pixel size. So a texture's
resolution *is* a statement about how much world one tile covers. A 64px tile
spans 5.3 world units; 1024px spans 85.

These files therefore match the constants already in that file exactly
(`GROUND` 1024, `SHORE` 256, `POOL` 128, `PROP` 64). Doubling one would not add
detail, it would halve the texel density of everything it lands on and make the
surface read as wallpaper, which is the failure D14 names. If higher-resolution
textures are ever wanted, `TEXELS_PER_UNIT` has to move with them, and that is an
art decision affecting every surface at once, not a swap of one file.

Total on disk: see the table in `docs/ASSET_PIPELINE.md`. Every file is indexed
PNG with at most fourteen colours, all of them steps of a ramp in
`src/render/palette.ts`, which is why they compress as hard as they do.

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
