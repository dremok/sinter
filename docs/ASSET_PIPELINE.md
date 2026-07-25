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

fal.ai generates **materials and textures**, not meshes. Tileable albedo, roughness, and normal maps, plus a palette per band. A modest set of materials times a large set of part combinations is where the variety actually comes from.

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
