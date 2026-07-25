# SINTER: Architecture

How the thing is built. Read `docs/DESIGN.md` first for what it is supposed to do.

## Shape of the codebase

```
src/
  core/            deterministic primitives, no game knowledge
    rng.ts         seeded RNG. The ONLY source of randomness in the project
    clock.ts       fixed timestep accumulator
    serialize.ts   world save/load
  props/           the property vocabulary and how properties combine
    registry.ts    the property list and their metadata
    derive.ts      rules for deriving merged properties from two parents
  ecs/             miniplex world, component definitions, system runner
  sim/             the actual simulation. Reads properties, never item IDs
    fire.ts        ignition, propagation, burnout, byproducts
    fluid.ts       water, flow, soaking, freezing
    electricity.ts conduction through CONDUCTIVE networks
    growth.ts      SEED to plant over time
    structure.ts   support, collapse, what happens when you burn a load bearing wall
    thermal.ts     heat transfer, HOT and COLD spreading
  items/
    catalog.ts     loads the baked catalog
    merge.ts       merge lookup and property derivation
    codex.ts       what the player has discovered, persists across death
  world/
    gen/           procedural generation, one module per band
    region.ts      a self contained generated map
    gateway.ts     connections between regions, and distance-from-home
  agents/          NPC and enemy drives, disposition, perception
  render/
    camera.ts      orthographic isometric rig
    kitbash.ts     assembles item meshes from parametric parts
    bands.ts       per-band palette, fog, lighting
  ui/              inventory, merge bench, codex
  main.ts
tools/
  bake-catalog/    offline LLM pass that generates items and the merge graph
  bake-audio/      offline ElevenLabs pass
  shot.ts          headless screenshot harness
assets/
  parts/           the hand-built Blender kitbash primitives (glTF)
  baked/           generated catalog, textures, audio. Committed
```

## Determinism

Non-negotiable, because the screenshot verification workflow and reproducible bug reports both depend on it.

- `Math.random()` is banned. Everything goes through `core/rng.ts`. Add a lint rule for this early.
- The simulation runs on a **fixed timestep**, decoupled from render framerate. Rendering interpolates.
- Rapier steps inside the fixed tick.
- A seed plus a sequence of inputs must reproduce a run exactly.

Honest caveat: Rapier is deterministic for a given build on a given platform. It is not guaranteed bit-identical across platforms or versions. That is fine for the purposes here (reproducing a bug locally, screenshot diffing in CI on one platform) but do not build a feature that assumes cross-machine replay compatibility.

## Simulation model

miniplex ECS. Entities are bags of components; systems query and act.

The critical discipline: **systems query by property, not by entity type.** The fire system does not look for "fences" and "trees". It looks for entities with a `FLAMMABLE` property above a threshold within propagation range of something `HOT`. This is what makes item 4,000 work on the day it is baked.

Simulation systems run in a fixed order each tick, and the order is itself a design decision to be written down as it stabilizes. Thermal before fire before structure, roughly, so a burning support fails in the same tick it should.

### Spatial queries
Fire spread, explosion, and thermal transfer all need "what is near this". Use a spatial hash rebuilt per tick over the region. Regions are bounded, so this stays cheap. Do not use physics queries for simulation neighborhood lookups; Rapier is for contact and constraint, not for gameplay proximity.

## Rendering

Orthographic camera. True isometric is an elevation of `atan(1/sqrt(2))`, about 35.264 degrees, at 45 degrees azimuth. Camera rotates in 90 degree steps so the player can see behind buildings.

Multi-floor interiors are the reason this is 3D rather than sprites. When the player is inside a structure, cull or fade geometry above their current floor. Get this working early; it is the mechanic most likely to be discovered as painful late.

Band identity is carried by palette, fog, light color, and ambient density, defined per band in `render/bands.ts`. This is cheap and does most of the tonal work.

## Physics

Rapier, via `@dimforge/rapier3d-compat`.

What it is for: rigid bodies, joints, and character control. Ropes are joint chains. Vehicles use the vehicle controller. Crates fall, stack, and crush.

What it is not for: fire, water, growth, electricity, or any gameplay proximity query. Those live in `sim/` and read properties.

Not every object needs to be a rigid body. Static world geometry is static. Promote objects to dynamic bodies when something acts on them.

## World generation

Each region is a self contained generated map with gateways to neighbors. A region's band is a function of its graph distance from home, so the generator picks its module, palette, item pool, and enemy set from that number.

Regions are bounded and fully in memory. This is what makes fire spread, item state, and structural collapse tractable, and it is why this design was chosen over seamless streaming: a fire that crosses a chunk boundary in a streamed world is a genuinely hard problem, and gateways make it disappear.

The player can keep going outward indefinitely. Regions are generated lazily as gateways are crossed and can be discarded behind the player, because nothing persists past death anyway.

## The offline bake

`tools/bake-catalog/` runs a generation pass that produces the item catalog and merge graph, then commits the result. This is a build step, not a runtime dependency. The shipped game makes no network calls and needs no API keys.

Order of operations, roughly:

1. Seed with a hand written set of base items per band, with properties assigned by hand. These set the tone and the quality bar.
2. Expand by generating merge results for pairs, deriving properties by rule and generating name, description, and kitbash assembly by LLM.
3. Validate every generated item: properties in range, no contradictions that break the sim, kitbash parts exist, description passes the prose style rules in `CLAUDE.md`.
4. Commit the catalog.

Because merges are commutative and deterministic and the catalog is closed under merging, the graph can be expanded incrementally without invalidating what is already baked. Do not regenerate the whole catalog on every change; that would make results shift under players.

## Save format

JSON, versioned. Only the meta layer actually needs to persist across sessions: stats, skills, codex, discovery log. Full world serialization should still exist, because it is invaluable for debugging and reproducing a bug at a specific tick.

## Testing

- **Vitest** for simulation logic. Property derivation, fire propagation, structural collapse, and merge determinism are all pure and easy to test. Test them properly, they are the game.
- **Playwright** for the screenshot harness. `npm run shot` boots headless at a fixed seed, ticks forward, writes a PNG.
- The verification loop matters more than coverage. An agent that can look at what it built is worth more than a green test suite.

## Performance notes

Not a concern yet, and premature optimization here would be a mistake. When it becomes one, the likely order of problems is: draw calls for many small items (instance them), spatial hash rebuild cost (make it incremental), and simulation ticks over large entity counts (bucket by activity, most items are inert most of the time).
