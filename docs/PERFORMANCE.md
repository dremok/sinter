# SINTER: Performance

Budgets, how they are measured, and the rule that keeps optimisation honest.

## Why this file exists

Performance does not collapse in one bad commit. It erodes, a little per pass, and by the time anyone notices, the cause is spread across fifty changes and nobody can point at one. A standing budget catches the erosion at the commit that caused it.

## The rule that makes optimisation safe here

**A performance change that alters a single pixel at a fixed seed is a behaviour change, and is rejected.**

This project can enforce that, and most cannot. Everything is seeded, the simulation is a fixed timestep, and `npm run shot` renders a deterministic frame from a seed and a tick count. So the proof obligation for any optimisation is concrete: take a screenshot before, take it after, and the PNGs must be byte-identical.

That turns "this refactor should be equivalent" from a claim into a check.

Where a change legitimately alters output (a better algorithm that is not bit-identical, a quality setting), it is no longer an optimisation. It is an art or design change and goes through the normal review with a stated visual justification.

## Budgets

These are ceilings, not targets. Crossing one is a regression to be explained, not a number to be admired.

Runtime comes first. Bundle size is last on purpose: a slightly larger download is a one-time cost, a dropped frame happens sixty times a second.

### GPU load

Hardware-independent proxies, because they are what actually cause bad frame times and they can be measured reliably anywhere.

| Metric | Budget | How |
|---|---|---|
| Draw calls per frame | 400 | `renderer.info.render.calls` |
| Triangles per frame | 350k | `renderer.info.render.triangles` |
| Shader programs | 40 | `renderer.info.programs.length` |
| Transparent surfaces stacked at any pixel | 4 | count transparent materials in the frame |
| Shadow map | one 2048, tightly fitted | shadow camera bounds vs visible area |

Overdraw is the one to watch. Tree fading, the pond and the flame quads are all transparent, and stacked transparency is usually the largest GPU cost in a scene like this.

### Response

| Metric | Budget | How |
|---|---|---|
| Input to visible response | 1 tick | keypress lands on the next fixed tick, not a frame later |
| Allocation in the render loop | none per frame | audit hot paths; `new THREE.Vector3()` in a loop is the classic |
| Single-frame spikes during play | none | texture generation, icon rendering and part loading belong at boot |
| Frame time, relative | no regression | same seed and framing, before vs after, same machine |

**Never report FPS from the headless harness.** It runs on SwiftShader software rendering, where 10 fps is normal and says nothing about a real machine. Frame time from it is useful only as a relative before-and-after on the same machine. Absolute FPS is a claim only a real GPU can support.

### No clipping

Max called this out specifically, and it covers several distinct faults.

| Fault | Where it bites here |
|---|---|
| Z-fighting | Ground decals on terrain, the pond surface against its bed, the shore ring |
| Depth precision | An orthographic near/far spread wider than the scene wastes precision and causes the above |
| Interpenetration | Objects sunk into or floating above terrain, the character through props |
| Near/far clipping | Tall things sliced off, especially trees near the top of frame |
| Shadow acne, peter-panning | Bias tuning |

A clipping fix legitimately changes pixels, so it is exempt from the byte-identical rule. It is a bug fix, not an optimisation. Show a before and after image instead.

### Size

| Metric | Budget | How |
|---|---|---|
| Bundle, gzipped | 250 kB | `npm run build`, gzip column |
| Parts library | 400 kB | `ls -l assets/parts/parts.glb` |
| Boot to first frame, headless | 6 s | time `npm run shot -- --ticks 1` |
| Simulation, 1000 ticks | 4 s | `--ticks 1000` minus `--ticks 1` |

## Where the costs actually are

Measured, not guessed. Re-measure before optimising; this list goes stale.

- **Texture generation at boot.** The ground tile is 1024x1024 drawn texel by texel. It is the single largest boot cost and it is paid once.
- **Icon rendering.** One offscreen draw per item the player sees, cached forever after. Unbounded in principle, since merges are unbounded, but bounded in practice by what one run touches.
- **Spatial hash rebuild.** Every tick, over every simulated entity. Cheap because regions are bounded; the fix when it stops being cheap is to make it incremental, not to reach for physics queries.
- **Per-instance materials.** Cel-shaded materials are cached per colour and per texture. Cloning one per object is the easiest way to destroy batching.

## Known accepted costs

- **Rapier is out of the runtime** (D13), which removed a WASM payload. It returns for vehicles (A10) and that will cost bundle size. Accepted in advance.
- **Textures are generated rather than loaded**, trading boot time for zero network and full determinism (D14). If boot time becomes the problem, the answer is the offline bake in `ASSET_PIPELINE.md`, not shipping less texture.
