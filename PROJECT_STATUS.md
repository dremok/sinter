# SINTER: Project Status

Read this first every session. Update it immediately after any significant change.

**Last updated:** 2026-07-25
**Current milestone:** M0–M2 done, M3 partially done
**Target:** playable vertical slice (Band 0 only, ~60 items, ~10 property interactions, 3 real obstacles)

---

## Where things stand

There is a playable alpha. You can walk into a generated Band 0 region, pick things up, merge them irreversibly, and get through a palisade in more than one way without any of those ways having been authored as a solution.

Stack, all of it verified by actually running it:
- Vite + TypeScript + Three.js + Rapier, orthographic iso camera, seeded RNG, fixed timestep clock
- Headless screenshot harness (`npm run shot`), which caught two rendering bugs during the scaffold and three more during the alpha
- Railway deploy config (`railway.json`, `docs/DEPLOY.md`)
- Design, architecture, asset pipeline, deployment, and decisions all documented

Game, added in the alpha pass:
- **Property registry** (`src/props/registry.ts`): 27 properties as scalars, each with a combine rule
- **Merge derivation** (`src/props/derive.ts`): commutative and deterministic, with emergent rules. An edge on a haft cuts, rope on a rigid span climbs, metal on stone sparks, water soaks and quenches
- **Catalog** (`src/items/catalog.ts`): 24 hand-authored items, each a property bag plus a parametric kitbash recipe
- **Merging** (`src/items/merge.ts`): two in, one out, always yields; results inherit parts from both parents so they look like what made them
- **miniplex ECS** (`src/ecs/world.ts`) with property-driven queries
- **Spatial hash** (`src/sim/spatial.ts`), rebuilt per tick, carrying all gameplay proximity
- **Fire** (`src/sim/fire.ts`): ignition, propagation, drying, burnout, structural failure
- **Region** (`src/world/region.ts`): noise terrain, a carved river, 90 oaks, dry pasture, the palisade, seeded scatter
- **Pack UI** (`src/ui/interface.ts`): property filter, merge bench, undiscovered results hidden behind a `?`

Verified: `npm run typecheck` clean, `npm run test` 30/30 passing, screenshots confirm the palisade catching, cascading, and collapsing into a gap you can walk through.

What does not exist: agents and disposition (so no bribery, distraction or disguise), gateways between regions, death and persistence, the codex UI, any item generation beyond the hand-authored 24, Blender kitbash parts (meshes are code primitives for now), and all audio.

Deployed and verified: **https://sinter-production.up.railway.app**. Checked with `npm run verify:deploy`, which loads the live site in a real browser, confirms a canvas exists and the tick counter is advancing, and fails on any console or request error.

---

## Roadmap to the vertical slice

Ordered. Do not skip ahead; each milestone de-risks the next.

### M0: Stack skeleton — DONE
Prove Three.js, Rapier, orthographic iso, fixed timestep, and seeded determinism work together, and that the screenshot harness can see the result.

### M1: Items exist and can be merged — DONE
miniplex ECS. Property registry (`src/props/`). Item entities that can be picked up and dropped. Infinite inventory UI with the property filter, which is the query that matters most. Merge bench: two slots, one output, inputs destroyed. Hardcode 20 items by hand for now; no generation yet.

Done when: you can pick up two items, merge them, and the result behaves as its properties say it should. **Met.** 24 items, and the merge guarantees are tested over all 625 pairs.

### M2: The property simulation — DONE for fire
The milestone that proves the whole design. Fire first: ignition, propagation through `FLAMMABLE` neighbors, burnout, byproducts. Then thermal transfer, then water and soaking (wet things resist fire), then electricity through `CONDUCTIVE` networks.

Build the spatial hash here. Do not use physics queries for gameplay proximity.

Done when: you set one thing on fire and a chain of consequences happens that nobody explicitly wrote. **Met for fire and for water/soaking.** Thermal transfer and electricity are not built; `CONDUCTIVE` is not yet in the registry.

### M3: Obstacles as facts — PARTIAL
Three obstacles, each with at least five solutions that were never authored as solutions. The worked palisade example in `docs/DESIGN.md` is the model. Includes a first pass at agents with disposition, so bribery and distraction are possible.

Done when: you can get past all three obstacles in five ways each, and you had to discover at least one of them yourself.

Where it actually stands: **one** obstacle with **five** working solutions, none of them authored against it. Burn it, chop it with anything `TOOL_CUTTING`, batter it with anything `TOOL_STRIKING`, climb it with anything `LADDER_LIKE`, or douse the ground first with anything `WATER` to control where the fire goes. The affordance list in `main.ts` names properties only, so all five work on the oaks too.

Still missing for M3: two more obstacles, and agents with disposition, which is what unlocks bribery, distraction, disguise and poisoning. That is the largest single gap in the alpha, and it is the half of the palisade example that is not yet real.

### M4: Region generation — PARTIAL
Band 0 only. A generated region with terrain, vegetation, a village, and at least one enterable multi-floor building. One gateway leading out. Floor culling for interiors, which is the thing most likely to hurt if discovered late.

Done so far: seeded terrain, a carved river, oak woods, dry pasture, and seeded item scatter. Not done: the village, any enterable building, floor culling, and real gateways. The gate ring past the palisade is a goal marker, not a working region transition.

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

## Where content comes from

`docs/IDEAS.md` is a stockpile for exactly these deferred things: several hundred candidate properties with the system that would read each one, property interaction rules, a menu of possible `sim/` modules with rough costs, item pools for all four bands, merge archetypes and concrete merges to check the derivation rules against, about thirty obstacles written as fact sets, set pieces, a bestiary, agent drives, UI ideas, and a list of traps that look like good ideas and are not.

Nothing in it is implemented or committed to. When a milestone needs content, take from there instead of inventing under time pressure, then delete what gets built. The appendix at the end of that file is the checklist for promoting an idea into the game.

---

## Known risks

- **The affordance system is the whole bet.** If obstacles quietly drift into being locks with keys, the game becomes ordinary. M3 is the checkpoint that catches this, and it should be treated as pass/fail.
- **LLM-generated items may be mechanically incoherent.** The validation gate in M6 is not optional. A generated item whose properties contradict each other will produce nonsense in the simulation.
- **Infinite inventory is a UI problem, not a storage problem.** 300 items in a grid is unusable without the property filter working well.
- **Repo size.** Baked textures and audio accumulate. Check periodically rather than discovering it at 4 GB.
