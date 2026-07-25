# SINTER: Asset Pipeline

How thousands of items get art without thousands of hours of modeling.

## The problem

The catalog targets a few thousand items. Modeling each one individually is not possible, and generating each one with AI 3D tools produces style drift and unusable topology. Neither approach survives contact with the actual number.

## The approach: parametric kitbash

Hand build a small library of primitive **parts** in Blender, then assemble every item in code from a parameter set.

An item is not a mesh. It is a recipe:

```ts
{
  parts: [
    { part: 'blade_straight', scale: [0.9, 1.4, 1.0], at: 'tip',   material: 'steel_worn' },
    { part: 'guard_cross',    scale: [1.0, 1.0, 1.0], at: 'mid',   material: 'steel_worn' },
    { part: 'grip_wrapped',   scale: [1.0, 0.8, 1.0], at: 'base',  material: 'leather_dark' },
  ]
}
```

Roughly 100 to 150 parts covers an enormous space: blades, hafts, grips, guards, tubes, panels, wheels, cloth drapes, containers, lenses, coils, brackets, nozzles, straps, gems, bones, circuit boards.

### Why this wins

- **It scales.** New items cost a parameter set, not a modeling session.
- **It is coherent by construction.** Everything is made of the same parts in the same style, so a catalog of 4,000 items cannot drift.
- **Merged items are visually legible.** This is the real payoff. A merge result can inherit parts from both parents, so a torch fused with a bottle actually looks like both. The player can often guess what something is made of by looking at it, which makes the merge system readable instead of arbitrary.
- **Parts are reusable across bands.** The same `tube` part is a Band 0 pipe and a Band 2 conduit with a different material.

### Where fal.ai comes in

fal.ai generates **materials and textures**, not meshes. A modest set of materials times a large set of part combinations is where the variety actually comes from.

The Band 0 material set is built and committed. `npm run bake:textures` writes fourteen tiling maps to `assets/baked/textures/`, one per entry of `TextureSet` in `src/render/textures.ts`. `assets/baked/README.md` has the loader contract, the per-file table and an honest note about the two that came out worse than the code they would replace.

Four things about it are worth knowing before touching it.

**Albedo only.** This file used to ask for roughness and normal maps as well. Nothing can load them: every surface is a `MeshToonMaterial`, which has no roughness input at all, and cel shading quantises light into three hard bands, so a normal map moves a band boundary around rather than shading anything. They would be a third more per texture and megabytes of files nothing reads. Reinstate them when there is a lit path that wants them, not before.

**Structure from the model, colour from `palette.ts`.** Every texel is snapped to the nearest step of a small palette taken from the ramps the renderer already reads. On-palette therefore cannot fail, and the whole set restyles by editing `palette.ts` and re-running. It is also what keeps the files tiny: 110 kB for all fourteen, because a 64px tile of six colours is mostly PNG header.

**Resolution is world footprint, not quality.** `TEXELS_PER_UNIT = 12` and `tiled()` derive every repeat from the bitmap's own size, so a 64px tile *is* a claim that one tile covers 5.3 metres. The baked sizes match the constants already in `textures.ts` exactly. Raising one without raising `TEXELS_PER_UNIT` zooms a texture out, it does not sharpen it.

**The bake is cache-aware in two layers.** Committed output is keyed by a hash of prompt, parameters, palette and pipeline version; raw model output is cached separately under a gitignored directory and keyed only by what the model was asked for. So tuning a gamma or a reduction reprocesses fourteen textures for nothing, and only a changed prompt or seed costs money. The full set is about $0.70 from cold.

**Nothing is trusted.** Each result is measured before it is committed: that opposite edges meet, that the value range survives a three-band toon shader, that it is shapes rather than noise, and that the material came back the right colour. A failure regenerates on a new seed, with a clause naming the fault only when the fault is one a prompt controls. `npm run bake:verify` re-derives all of that from the committed bytes and needs no key.

fal.ai also generates **inventory icons**. With 300 items in an infinite inventory the icon grid is what the player actually reads, and icons are 2D, which is exactly what image generation is good at. Prefer rendering icons from the assembled 3D mesh where possible (free, perfectly consistent) and use fal.ai for stylistic passes and for anything the kitbash cannot express.

### Where Blender MCP comes in

Building and maintaining the parts library. That is a bounded, high value, human-scale task: 100 to 150 good parts, made carefully, on a consistent grid with consistent pivots and attachment points. Do not use Blender MCP to model individual catalog items.

**Part authoring conventions** (get these right early or every assembly will be subtly wrong):
- Consistent unit scale and up axis.
- Named attachment sockets as empties: `socket_base`, `socket_tip`, `socket_mid`.
- Pivot at the attachment point, not the centroid.
- No baked materials; materials are assigned at assembly time.
- Export glTF to `assets/parts/`.

## Audio

ElevenLabs, offline bake, committed to `assets/baked/audio/`.

- **Music and ambience per band.** Four bands, each with a distinct bed. This does a large share of the tonal work for very little effort, and it is the cheapest way to make crossing a gateway feel like something.
- **SFX for item interactions.** Generated sound effects matter here specifically because the catalog is huge and hand recording per item is impossible. Map sounds to **properties**, not items, exactly as with everything else: `METAL` + `TOOL_STRIKING` picks from a metal impact set. This means a new item is audible on the day it is baked.
- **No narration. No voice acting.** The game is wordless.

Band 3 audio design deserves specific thought: silence where sound is expected is more effective than added strangeness, and it costs nothing to generate.

## Rules

- Everything generated is **committed**. The game runs offline with no keys.
- Generation tools live in `tools/`, never in `src/`. Nothing in the shipped bundle makes a network call.
- Keys live in `.env`, gitignored. `FAL_KEY`, `ELEVENLABS_API_KEY`.
- Watch repo size. Textures and audio add up fast. Use sensible compression, keep source files out, and check total size periodically before it becomes a problem that is annoying to fix retroactively.
- **Every bake caches, resumes and estimates before it spends.** A re-run that silently regenerates everything is the normal failure mode of a script like this, and it is only noticed after the fourth time. `--plan` prints the bill and calls nothing.
- **Look at what came back.** Metrics catch seams and noise; they do not catch a texture that is technically perfect and artistically wrong. The bark tile passed every check as a picket fence.

## Current state

| Asset | Where | Status |
|---|---|---|
| Parts library | `assets/parts/parts.glb` | built, `tools/blender/build_parts.py` |
| Band 0 textures | `assets/baked/textures/` | baked, 110 kB, awaiting the loader swap in `src/render/textures.ts` |
| Inventory icons | rendered at runtime | done differently, see D15 |
| Audio | `assets/baked/audio/` | not started |
