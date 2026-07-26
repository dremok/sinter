# SINTER: Project Status

Read this first every session. Update it immediately after any significant change.

**Last updated:** 2026-07-26
**Current milestone:** M0-M2 done, M3 partially done, art pass 3 done, collision rebuilt
**Target:** playable vertical slice (Band 0 only, ~60 items, ~10 property interactions, 3 real obstacles)

## Pass 4: the collision engine, the campfire, and a face (2026-07-26)

Six player-reported bugs, all fixed and deployed. Every one of them was a
disagreement between representations rather than a bad number, so the fixes are
structural and there is a check for each.

**One collision shape, and it is a rectangle.** `core/footprint.ts` is an
oriented box grown outward by a radius. A circle is `hx = hz = 0`; a wall is a
long thin box. Blockers and standables both use it. This replaced circles-only,
which had produced four separate bugs: the barn wall you walked through, the
~30 circles per building that fixed it, the gate's 1.9m invisible bubble in
front of a 0.35m plank, and the crossing whose five discs overhung its own ends.
Blockers went 200 -> 77.

**Nothing types a collision size any more.** `world/measure.ts` measures the
footprint from the geometry between knee and shoulder height. Hand-typed extents
are a second description of an object and a second description drifts: the
cottage grew a chimney standing 0.53m proud of its wall and the footprint did
not. Two constructors, `solidBuilt` (measured box) and `solidRound` (measured
circle); the choice between them is a fact about the shape, not a number.

**Crossings are derived from the terrain they cross.** The deck sits at whichever
bank is higher so it can never bury itself in one, and abutment treads are walked
outward one riser at a time, never below the ground they sit on.

**The campfire strobe.** The flame picked a new silhouette 7-19 times a second
and snapped to it. The scrolling alpha mask on the EDGE stays fast, because that
is what reads as burning; the shape now eases between the same steps at half the
rate. Measured on consecutive frames: 231px of flame area changing per frame ->
73px.

**Shadows.** The shadow camera is sized from what the camera can see rather than
a typed +-16 that was smaller than the visible ground, and it is snapped to its
own texel grid so edges move a whole texel or not at all. Contact-shadow blobs
are for small things only; they were being drawn 4.4m across under objects that
already cast a real shadow, and those were the dark green polygons on the grass.

**Home has room.** Everything moved outward from the hearth. Open ground 75.3%
-> 80.6%, squeeze points 6 -> 2.

**A head, in two masses.** Cranium with hair, narrower jaw with a lighter face,
fringe at the brow. It was one pale block with a plate on the front, which reads
as a helmet. Three things had each been separately concluded impossible and were
not: face features are excluded from the outline pass (the pass is a fixed
world-space width, so it was merging them, which is why the face had been two
pixels for so long); the face plane is tipped back to meet a camera that looks
down 35 degrees; and a short-range fill parented to the character lights the
face, which is otherwise on the plane the sun reaches least.

**Worn equipment is visible.** `setEquipment` existed and was never called from
anywhere, so worn spectacles had never appeared on the character.

### Tools added this pass

| Command | What it answers |
|---|---|
| `node tools/probe.mjs x,z [x2,z2 step]` | What is actually at a place, in all three layers that can disagree: terrain height, footprints, drawn meshes. |
| `node tools/walkmap.mjs [x z half]` | How much free floor there is, one character per half metre. |
| `npm run verify:still [at frames]` | Flicker, on real consecutive frames captured inside the page. Reports concentration per cell, not frame-wide movement. |
| `npm run verify:collision` | Both directions: nothing invisible, nothing walk-through, nothing buried, no gaps, nothing destructible standing in for something permanent. |
| `npm run shot -- --wear glasses` | Screenshot worn kit. Worn kit that cannot be screenshotted cannot be verified. |

Two tooling faults fixed, both of which had been making checks lie:
`verify:movement` defaulted to a hardcoded `localhost:5199` and started no
server, so a leftover dev server was answering it; and it asserted distances
against a wall clock, which measures the machine, because `Clock` caps at five
ticks per frame.

---

# Earlier passes

## Latest pass: simplify and make it beautiful

Playtest feedback was blunt and correct: ugly, too big, too many items, movement bad, character looked like nothing, unclear how to use anything, and the player got stuck constantly. What changed:

- **Map cut from 120x120 to a 36x32 clearing**, with 10 hand-placed items instead of 52 scattered ones. Every item now affords a route through the palisade.
- **Real textures.** `render/textures.ts` draws tiling pixel-art bitmaps in code (grass, bark, stone, cloth, water, plank). Flat colours plus a pixel filter read as vector art with an effect on it; the missing thing was always texture. See D14.
- **Cel shading and a 240-line pixel buffer** upscaled with hard edges, plus a much more saturated palette.
- **A character instead of a capsule**: blocky humanoid with a walk cycle, opposed limb swing, bob, and facing.
- **Movement rewritten analytically** and Rapier dropped from the runtime. This was the cause of getting stuck. See D13. Side effect: bundle went from 2.8 MB to 587 kB.
- **Left/right were genuinely reversed.** `screenBasis` negated the camera right vector.
- **Items now vanish when taken.** `scene.remove` was called on meshes parented to the region group, so it silently did nothing.
- **Prompts say why nothing is available**, instead of showing nothing at all.

## Pass 3: legibility, distinct results, targeting

Second round of playtest feedback, all acted on:

- **Resolution middle ground.** 240 lines made a held item ~10px tall and upscaled to blur. Now 400: under 3x upscale, silhouettes survive, pixel grid still visible. Items also render 1.9x rather than 1.55x.
- **Every combination is now a distinct item, and proven so.** The old namer drew an adjective and a noun from two small pools, so unrelated merges kept landing on the same name and merging felt pointless. All 45 pairs of the starting ten are now hand-authored with real names and descriptions, and a test asserts no two pairs can share a name. The procedural fallback is a bijection over parent epithets and nouns, so it cannot collide either.
- **Ten recognizable items** replace the previous obscure set: torch, flint, iron horseshoe, rope, plank, bucket of water, axe, straw bale, oil flask, apple. Nobody can reason about combining objects they cannot identify.
- **Targeting bug fixed.** Felled posts stayed valid targets forever and, being nearest, kept stealing focus, so chopping reported 0% while standing in front of a standing post. Targeting now excludes spent and zero-hp structures, weights by facing direction, and ranks built structures above scenery so a tuft of grass cannot outrank the wall you are against.
- **`npm run verify:movement`** drives the real build with real key presses: 13 checks covering direction, camera-relative controls, diagonal speed, sticking, and the targeting regression. A static screenshot could never have caught "left and right are reversed", which shipped once.

Still to do: proper Blender-authored models rather than code primitives (Blender 5.2 LTS is installed and scriptable headlessly; no Blender MCP is connected).

---

## Where things stand

There is a playable alpha. You can walk into a generated Band 0 region, pick things up, merge them irreversibly, and get through a palisade in more than one way without any of those ways having been authored as a solution.

Stack, all of it verified by actually running it:
- Vite + TypeScript + Three.js, orthographic iso camera, seeded RNG, fixed timestep clock (Rapier is out of the runtime, see D13)
- Headless screenshot harness (`npm run shot`), which caught two rendering bugs during the scaffold and three more during the alpha
- Railway deploy config (`railway.json`, `docs/DEPLOY.md`)
- Design, architecture, asset pipeline, deployment, and decisions all documented

Game, added in the alpha pass:
- **Property registry** (`src/props/registry.ts`): 27 properties as scalars, each with a combine rule
- **Merge derivation** (`src/props/derive.ts`): commutative and deterministic, with emergent rules. An edge on a haft cuts, rope on a rigid span climbs, metal on stone sparks, water soaks and quenches
- **Catalog** (`src/items/catalog.ts`): 10 recognizable hand-authored items, each a property bag plus a parametric kitbash recipe
- **Merging** (`src/items/merge.ts`): two in, one out, always yields; results inherit parts from both parents so they look like what made them
- **miniplex ECS** (`src/ecs/world.ts`) with property-driven queries
- **Spatial hash** (`src/sim/spatial.ts`), rebuilt per tick, carrying all gameplay proximity
- **Fire** (`src/sim/fire.ts`): ignition, propagation, drying, burnout, structural failure
- **Region** (`src/world/region.ts`): a 36x32 clearing, noise terrain, a pond, tree line, dry pasture, the palisade and its rock spurs
- **Pack UI** (`src/ui/interface.ts`): property filter, merge bench, undiscovered results hidden behind a `?`

Verified: `npm run typecheck` clean, `npm run test` 33/33 passing, `npm run verify:movement` 13/13 passing against the live build, and screenshots confirm the palisade catching, cascading, and collapsing into a gap you can walk through.

What does not exist: agents and disposition (so no bribery, distraction or disguise), gateways between regions, death and persistence, the codex UI, any item generation beyond the hand-authored 10, Blender kitbash parts (meshes are code primitives for now), and all audio.

Deployed and verified: **https://sinter-production.up.railway.app**. Checked with `npm run verify:deploy`, which loads the live site in a real browser, confirms a canvas exists and the tick counter is advancing, and fails on any console or request error.

---

## Roadmap to the vertical slice

Ordered. Do not skip ahead; each milestone de-risks the next.

### M0: Stack skeleton — DONE
Prove Three.js, Rapier, orthographic iso, fixed timestep, and seeded determinism work together, and that the screenshot harness can see the result.

### M1: Items exist and can be merged — DONE
miniplex ECS. Property registry (`src/props/`). Item entities that can be picked up and dropped. Infinite inventory UI with the property filter, which is the query that matters most. Merge bench: two slots, one output, inputs destroyed. Hardcode 20 items by hand for now; no generation yet.

Done when: you can pick up two items, merge them, and the result behaves as its properties say it should. **Met.** 10 items, all 45 pairs authored, and the merge guarantees including name-distinctness are tested over every pair.

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
