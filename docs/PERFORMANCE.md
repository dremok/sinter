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

| Metric | Budget | How to measure |
|---|---|---|
| Bundle, gzipped | 250 kB | `npm run build`, read the gzip column |
| Bundle, raw | 900 kB | same |
| Parts library `parts.glb` | 400 kB | `ls -l assets/parts/parts.glb` |
| Boot to first frame, headless | 6 s | time `npm run shot -- --ticks 1` |
| Simulation, 1000 ticks | 4 s | time `npm run shot -- --ticks 1000` against `--ticks 1` |
| Draw calls, typical frame | 400 | `renderer.info.render.calls` |
| Triangles, typical frame | 350k | `renderer.info.render.triangles` |
| Live fps, desktop GPU | 60 sustained | in-game HUD, not the headless run |

Do not read fps from the headless harness. It runs on SwiftShader software rendering, where 10 fps is normal and says nothing about a real machine.

## Where the costs actually are

Measured, not guessed. Re-measure before optimising; this list goes stale.

- **Texture generation at boot.** The ground tile is 1024x1024 drawn texel by texel. It is the single largest boot cost and it is paid once.
- **Icon rendering.** One offscreen draw per item the player sees, cached forever after. Unbounded in principle, since merges are unbounded, but bounded in practice by what one run touches.
- **Spatial hash rebuild.** Every tick, over every simulated entity. Cheap because regions are bounded; the fix when it stops being cheap is to make it incremental, not to reach for physics queries.
- **Per-instance materials.** Cel-shaded materials are cached per colour and per texture. Cloning one per object is the easiest way to destroy batching.

## Known accepted costs

- **Rapier is out of the runtime** (D13), which removed a WASM payload. It returns for vehicles (A10) and that will cost bundle size. Accepted in advance.
- **Textures are generated rather than loaded**, trading boot time for zero network and full determinism (D14). If boot time becomes the problem, the answer is the offline bake in `ASSET_PIPELINE.md`, not shipping less texture.
