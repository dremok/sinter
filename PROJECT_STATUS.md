# SINTER: Project Status

Read this first every session. Update it immediately after any significant change.

**Last updated:** 2026-07-25
**Current milestone:** M0 complete, M1 not started
**Target:** playable vertical slice (Band 0 only, ~60 items, ~10 property interactions, 3 real obstacles)

---

## Where things stand

The repo is scaffolded and the stack is proven end to end. There is no game yet.

What exists, all of it verified by actually running it:
- Vite + TypeScript + Three.js + Rapier boot successfully together
- Orthographic isometric camera with 90 degree rotation
- Seeded RNG (`src/core/rng.ts`), the only randomness source in the project
- Fixed timestep clock (`src/core/clock.ts`)
- A controllable capsule on a ground plane with seeded scattered crates that fall and settle
- Headless screenshot harness (`npm run shot`), which caught two real rendering bugs already
- Railway deploy config (`railway.json`, `docs/DEPLOY.md`)
- Design, architecture, asset pipeline, deployment, and decisions all documented

Verified: `npm run typecheck` clean, `npm run test` 9/9 passing, `npm run shot` renders correctly with visible shadows.

What does not exist: everything else. No ECS, no properties, no items, no merging, no world generation, no obstacles, no assets, no audio.

Not yet done: the deploy has never actually been run. `railway.json` is written and correct per current Railway docs, but nobody has executed `railway up`, so treat the first deploy as unverified.

---

## Roadmap to the vertical slice

Ordered. Do not skip ahead; each milestone de-risks the next.

### M0: Stack skeleton — DONE
Prove Three.js, Rapier, orthographic iso, fixed timestep, and seeded determinism work together, and that the screenshot harness can see the result.

### M1: Items exist and can be merged
miniplex ECS. Property registry (`src/props/`). Item entities that can be picked up and dropped. Infinite inventory UI with the property filter, which is the query that matters most. Merge bench: two slots, one output, inputs destroyed. Hardcode 20 items by hand for now; no generation yet.

Done when: you can pick up two items, merge them, and the result behaves as its properties say it should.

### M2: The property simulation
The milestone that proves the whole design. Fire first: ignition, propagation through `FLAMMABLE` neighbors, burnout, byproducts. Then thermal transfer, then water and soaking (wet things resist fire), then electricity through `CONDUCTIVE` networks.

Build the spatial hash here. Do not use physics queries for gameplay proximity.

Done when: you set one thing on fire and a chain of consequences happens that nobody explicitly wrote.

### M3: Obstacles as facts
Three obstacles, each with at least five solutions that were never authored as solutions. The worked palisade example in `docs/DESIGN.md` is the model. Includes a first pass at agents with disposition, so bribery and distraction are possible.

Done when: you can get past all three obstacles in five ways each, and you had to discover at least one of them yourself.

### M4: Region generation
Band 0 only. A generated region with terrain, vegetation, a village, and at least one enterable multi-floor building. One gateway leading out. Floor culling for interiors, which is the thing most likely to hurt if discovered late.

### M5: Kitbash pipeline
20 to 30 primitive parts authored in Blender with consistent pivots and sockets. Code-side assembly from parameter sets. Icon rendering from assembled meshes. First fal.ai material set.

### M6: Catalog bake v1
Hand author roughly 25 base items with properties assigned carefully; these set the quality bar for everything generated after. Then the offline pass expands to ~60 with derived properties and generated names, descriptions, and assemblies. Validation gate on every generated item.

### M7: Death and persistence
Run ends on death. Stats, skills, and the codex persist. World regenerates from a new seed. The codex UI.

### M8: Is it fun?
Stop and play it. The whole point of a vertical slice is to answer this before scaling to thousands of items. If merging is not fun at 60 items it will not be fun at 6,000, and the answer is to fix the mechanic, not to add more items.

---

## Deliberately deferred

Not forgotten, just not now. Bands 1 through 3, vehicles, elevators, audio, enemy variety, skills, the full catalog, weather, survival mechanics.

---

## Known risks

- **The affordance system is the whole bet.** If obstacles quietly drift into being locks with keys, the game becomes ordinary. M3 is the checkpoint that catches this, and it should be treated as pass/fail.
- **LLM-generated items may be mechanically incoherent.** The validation gate in M6 is not optional. A generated item whose properties contradict each other will produce nonsense in the simulation.
- **Infinite inventory is a UI problem, not a storage problem.** 300 items in a grid is unusable without the property filter working well.
- **Repo size.** Baked textures and audio accumulate. Check periodically rather than discovering it at 4 GB.
