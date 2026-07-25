# SINTER: Decisions

Why things are the way they are, so nobody relitigates them by accident. Append new entries; do not rewrite old ones.

---

## D1: Three.js plus libraries, not a game engine
**Date:** 2026-07-25

Babylon.js, PlayCanvas, Godot 4, and Unity WebGL were all considered.

The reasoning that decided it: almost all the difficulty in this game lives in procedural generation, the property simulation, the merge graph, and the affordance system. No engine provides any of that. Meanwhile the largest thing an engine sells is a scene editor, and a procedurally generated world barely uses one. That removes a large share of the usual value proposition.

What engines genuinely offer here is physics, animation state machines, audio, input, and asset pipeline. Real, but a few weeks of work against a multi month project, and not the bottleneck.

Godot was rejected specifically because its web export defaults to single threaded (to avoid SharedArrayBuffer cross origin isolation requirements) and carries WASM memory ceilings, but mostly because it costs the agent workflow: an agent that can boot the game headless and screenshot its own work is worth more on a project this size than any built in feature set.

Babylon.js remains the strongest alternative if this decision is ever revisited. It bundles Havok physics, a real character controller, animation, audio, and WebGPU.

**Do not migrate to an engine without an explicit conversation with Max.**

---

## D2: Rapier for physics
**Date:** 2026-07-25

Rust compiled to WASM, joint constraints suitable for ropes, a vehicle controller, and a character controller. Chosen over Cannon and Ammo primarily for determinism: this is a seeded roguelike, and a seed reproducing a run exactly is what makes the screenshot verification workflow and bug reproduction possible.

Caveat recorded honestly: determinism holds for a given build on a given platform, not across platforms or versions.

---

## D3: Regions with gateways, not seamless streaming
**Date:** 2026-07-25

Max's stated ambition is infinite outward travel from home. The naive implementation is a streamed chunk world, which was rejected because cross chunk simulation is genuinely hard: a fire crossing a chunk boundary, a structure spanning two chunks, item state in unloaded regions.

Gateways make the problem disappear. Each region is bounded and fully in memory, so fire, structure, and item state are all trivially consistent. Travel outward is still unbounded because regions generate lazily as gateways are crossed, and nothing needs to persist behind the player since death wipes the world anyway.

This gets the stated goal without the hard part.

---

## D4: Full reset on death, knowledge persists
**Date:** 2026-07-25

Considered and rejected: persistent home base with a stash, world persisting across characters, furthest gateway unlocking as a start point.

Chosen: the world regenerates completely from a new seed. Items, money, and position are lost. Stats, skills, and the recipe codex persist.

This resolves an apparent tension in the design. Reaching the outer bands is gated by accumulated character skill rather than by unlocked shortcuts, so the outward journey is re-earned each run but gets genuinely easier as the player and character both learn. The codex is the real progression, which suits a game about discovering item combinations.

There is no extraction mechanic. A run ends when you die.

---

## D5: Merge is 2 in, 1 out, irreversible, always yields
**Date:** 2026-07-25

Considered: allowing some pairs to fail, allowing 3 to 5 inputs, allowing unmerge at a cost.

Rejected failure because it makes players hoard and stop experimenting, which fights the entire point. Rejected N inputs because the combinatorial space becomes incoherent to generate and impossible for players to reason about. Rejected unmerge because irreversibility *is* the strategic tension; removing it removes the mechanic.

---

## D6: Parametric kitbash for item art
**Date:** 2026-07-25

Considered: individual Blender models per item, AI 3D mesh generation, billboard sprites.

Chosen because it is the only option that scales to thousands of items while staying stylistically coherent, and because merged items can inherit parts from both parents, which makes merge results visually legible. That last property is a genuine gameplay benefit, not just an art convenience.

---

## D7: Single player, wordless
**Date:** 2026-07-25

No multiplayer, now or planned. Recorded explicitly because the alternative (authoritative serializable simulation from day one) is a significant architectural constraint that is now deliberately not being paid for.

No narration and no voice acting. ElevenLabs is used for music, ambience, and property mapped sound effects only.

Desktop only for now. No touch or mobile support.

---

## D8: Railway for hosting, static build
**Date:** 2026-07-25

The game is a static bundle with no backend, so hosting is deliberately boring. Railway using its Railpack builder (which replaced Nixpacks as the default and has first class Vite support), serving `dist/` with `serve` on `$PORT`.

Static files are served by `tools/serve.mjs`, a hand written zero dependency `node:http` server. Railway's docs suggest the `serve` package, which was tried first and rejected: it pulls in a transitive high severity `brace-expansion` DoS advisory, and `npm audit fix --force` resolves it by downgrading `serve` several major versions. Forty lines with no supply chain beats both options for serving one static directory, and it lets us set `application/wasm` explicitly.

`npm audit` reports zero vulnerabilities. Keep it there.

No environment variables are needed in the deployed environment. Keeping it that way is a constraint worth defending: it means the game stays playable offline and that no key can leak through the client bundle.

See `docs/DEPLOY.md`.

---

## D9: Sun azimuth must differ from camera azimuth
**Date:** 2026-07-25

Recorded because it cost a debugging cycle and looks like a bug rather than a setup mistake.

The skeleton initially placed the directional light at nearly the same azimuth as the isometric camera. Every shadow then fell directly behind its own caster and was completely invisible, which reads as "shadows are broken" rather than "the light is in the wrong place".

Keep the sun roughly perpendicular in azimuth to the camera. Since the camera rotates in 90 degree steps, revisit this when camera rotation is wired up properly: either the sun rotates with it, or it is placed so that all four camera angles stay readable.

Fog has a related trap, also fixed: with an orthographic rig every object sits roughly `camera.distance` deep, so hardcoded fog near/far values drown the entire scene instead of just the far edge. Fog must be derived from `IsoCamera.distance`.

---

## D10: simplex-noise for terrain
**Date:** 2026-07-25

Recorded late. The dependency was already in `package.json` before anything used it, which breaks the working agreement in `CLAUDE.md` about noting why a dependency exists. It is now used by `world/region.ts` for the Band 0 heightfield.

Chosen because it is small, has no transitive dependencies, and takes an injected PRNG, which matters here: it is seeded from `rng.fork('terrain')` rather than from `Math.random`, so a seed reproduces a region exactly. A noise library that owned its own randomness would have broken determinism and been unusable.

---

## D11: obstacles block in code, not with physics colliders
**Date:** 2026-07-25

The palisade could have been a row of Rapier colliders. It is instead a row of entities with a `blocker` component, and the player's movement is pushed out of them in `stepSimulation`.

The reason is destruction. An obstacle stops blocking the moment its `blocker` component is removed, which is one line in `sim/fire.ts` and needs no knowledge of physics. With colliders, every way of destroying something would also have to tear down and rebuild collider state, and every new destruction path would have to remember to do it.

This follows the existing split in `docs/ARCHITECTURE.md`: Rapier is for contact and constraint, gameplay questions live in `sim/`. Terrain is still a real Rapier trimesh, because walking on ground genuinely is a physics problem.

---

## D12: fire can be made from scratch, and no item is a firestarter
**Date:** 2026-07-25

`props/derive.ts` has a rule that hard metal merged with hard stone yields `HOT`. That is the only reason striking a nail on a flint lights anything, and it works for any metal and any stone, including ones the generator has not invented yet.

The alternative, an authored `firestarter` item with `HOT` baked in, was rejected because it makes fire a key rather than a consequence, which is rule 1 inverted.

A "hot things with no fuel cool down" reaction was deleted while doing this rather than retuned. Fuel depletion is already modelled properly in `sim/fire.ts`, and the second cruder copy in the merge rules pushed both the sparker and the live ember (each `HOT` with no `FLAMMABLE` of its own) below the ignition threshold. The items whose whole purpose is starting fires could not start one. Two models of the same thing, and the worse one was winning.

---

## D13: the player moves analytically, not through Rapier
**Date:** 2026-07-25

Max's report was that the character "gets stuck everywhere without any reason". The cause was Rapier's character controller resolving against a terrain trimesh: at triangle seams on sloped ground it would catch, and autostep and snap-to-ground made it worse rather than better.

Movement is now: sample the ground height, integrate, then push out of circular blockers over two passes, then clamp to the region bounds. It is simpler, it is exactly reproducible from a seed, and the class of bug is gone rather than tuned down.

This does not overturn D2. Rapier stays the physics choice for the things it is actually good at, which is crates that fall and stack, rope as joint chains, and the vehicle controller. It was simply never buying anything for a walking character on bounded, gentle ground, and it was costing the single most-felt bug in the build. It is not currently imported by the runtime, which also removes its WASM payload from the bundle.

Bring it back when something needs real dynamics, not before.

---

## D14: textures are drawn in code, for now
**Date:** 2026-07-25

Max's read on the first art pass was exact: "the missing part is nice textures, not just punching in 2D effects on top of a vector world." Every surface was a single flat colour, and no amount of palette work, cel shading or pixel-buffer downsampling fixes untextured geometry. It looked like vector art with a filter because that is what it was.

`render/textures.ts` now draws small tiling bitmaps pixel by pixel: grass blades, wood grain with knots, mottled stone, woven cloth, banded water. Drawn in code rather than authored or generated, because the game ships offline with no keys, everything must be reproducible from a seed, and there is no art pipeline yet.

This is explicitly a placeholder for the fal.ai material bake in `docs/ASSET_PIPELINE.md`. The seam is `textures()` and `tiled()`, so the bake can replace the insides of that file without touching a call site.

Two constraints worth keeping whatever generates them: `NearestFilter` always, since linear filtering turns a 32px tile to porridge; and roughly constant texel density per world unit, since mismatched density is what makes textured 3D read as wallpaper.


---

## D15: icons are rendered from the mesh, never authored
**Date:** 2026-07-25

Max asked whether there would be too many merges to create an icon for each. The answer is that it is not a scale problem, it is an impossibility, and the numbers are worth writing down so nobody proposes it again.

The catalog is closed under merging, so results merge again. Ten base items give 45 pairs. Those 55 items give 1,485. The next round gives over a million, the one after that hundreds of billions. There is no authored or generated icon set that covers a space with no upper bound.

So `render/icons.ts` renders each icon on demand from the same kitbash assembly that appears in the world, once per item, cached as a data URL. One small offscreen draw the first time an item is seen, nothing after. A merge result's icon therefore shows the parts it inherited from both parents, which is the readability argument in D6 finally visible in the UI rather than only in the world.

It uses its own renderer and scene rather than borrowing the main one. Sharing would mean saving and restoring camera, size and render target around every icon, and getting that wrong corrupts a frame rather than an icon.

This is also the strongest argument for the Blender parts library: roughly two dozen authored parts give correct icons for unboundedly many items, forever.

---

## D16: the parts library is built headlessly from a committed script
**Date:** 2026-07-25

`tools/blender/build_parts.py` runs under `blender --background` and writes `assets/parts/parts.glb`. There is no Blender MCP connection involved; a committed script is better than an interactive session anyway, because the library is reproducible, reviewable in a diff, and rebuildable by anyone with Blender installed.

Conventions the script enforces, all from `docs/ASSET_PIPELINE.md`, and all of which cause silent, permanent assembly errors if they drift: Z up and metres; the object origin at the part's attachment point rather than its centroid; sockets as named empties; no materials, since material is chosen per recipe at assembly time; and a bevel on everything, because hard 90 degree edges read as untextured boxes under cel shading.

The game throws at load if a recipe names a part the library does not contain. That is deliberate: a missing part should fail loudly at boot, not render as an invisible hole.


---

## D17: authored interactions become a first-class layer, alongside properties
**Date:** 2026-07-25

**This amends rule 2 in `CLAUDE.md`, which previously said no game code may branch on an item id, ever.**

Max's call, after playing it: everything being general made the game feel like a chore. A specific item having a specific effect on a specific obstacle is more fun than a property threshold being met. He is right that pure generality was buying less enjoyment than it cost.

What changes: authored, item-specific interactions are now legitimate content, not a smell.

What does not change: they live in a declared table (`src/items/interactions.ts`), never as `if (item.id === ...)` scattered through `sim/`. The simulation itself stays property-driven. This is the part worth defending, and the reason is practical rather than ideological:

- A declared table can be listed, counted, tested for reachability, and shown in a codex. Scattered conditionals cannot.
- The general layer is what stops the game collapsing into "every obstacle needs its one key". Fire still spreads by `FLAMMABLE`, water still soaks by `WATER`. An authored interaction is a bonus on top of a world that already responds.
- When the catalog grows past what anyone can hand-author, the property layer is what still works. Authored entries become the highlights, not the mechanism.

So the rule becomes: **the simulation reads properties; authored interactions are data.** An obstacle may now have a specific intended answer, as long as the general answers still work too.

Practically, an obstacle should aim for one authored solution that is satisfying to discover, plus at least one property-driven solution that nobody wrote down. If an obstacle has only the authored answer, it is a lock with a key, and that is the thing the whole design was built to avoid.

---

## D18: not every pair merges
**Date:** 2026-07-25

**This reverses D5's "always yields" and rule 3 in `CLAUDE.md`.**

D5 argued that letting pairs fail makes players hoard and stop experimenting. That reasoning was sound in the abstract and wrong in practice: when every pair yields, most results are filler, and filler is worse for experimentation than an honest refusal. Forty five authored pairs read as a recipe book worth exploring. Six hundred derived ones read as noise.

New shape:

- A merge either produces an authored result, or it does not merge.
- A refusal is free. Nothing is consumed, nothing is lost, and the bench says so plainly.
- Irreversibility is unchanged and still the point. When a merge does happen, both inputs are gone.
- Some items never merge at all. A key, a letter, a person's belongings. Flagging an item `noMerge` is now a normal thing to do.

The risk D5 identified is real and is handled differently: since refusals cost nothing, experimenting is free, so players have no reason to hoard. The old design made experimenting expensive and then had to guarantee a payoff to compensate.

---

## D19: NPCs speak, and the game is no longer wordless
**Date:** 2026-07-25

**This reverses the "no narration, no voice acting, the game is wordless" part of D7.**

NPCs now have dialogue, with options. Some progress requires the right thing said while carrying the right item.

Still true from D7: no voice acting. Dialogue is text. ElevenLabs stays scoped to music, ambience and property-mapped sound effects.

The cost being accepted: dialogue is authored content that does not scale the way generated items do, and it has to be written per NPC per band. Band 3 in particular said "items get shorter descriptions, not longer" and the same restraint applies to speech there. An NPC in The Static should say less, not more.

The gain: a guard with a disposition who can be talked around is a far better obstacle than a wall with a hit point count, and it is what makes the palisade example in `docs/DESIGN.md` finally real. Bribery, distraction, disguise and threat all need somebody to be bribed.

---

## D20: no quest markers, no destination hints
**Date:** 2026-07-25

The alpha displayed "Get past the palisade" at the top of the screen. Removed, and nothing like it comes back.

The game has no quest log, no waypoints, no objective text, and no arrow pointing anywhere. Progress is distance from home, plus stats and skills earned along the way. Where to go is the player's decision and the world's job to suggest, through sightlines, light, and what looks worth walking toward.

This is a constraint on level design rather than a UI preference. If a player cannot tell where to go, the answer is to build the world so that it reads, not to add a marker.

---

## D21: a permanent home base
**Date:** 2026-07-25

Every run starts from the same home: a hut, a hearth, a fence, a few familiar faces. The player always departs from here and the surrounding region is always the safest ground in the game.

Why it earns its place, given D4 says the world regenerates completely on death: home is the fixed point that makes distance mean something. "Three regions out" is only a meaningful statement if there is a somewhere to be out from. It also gives the tutorial band a natural shape, gives NPCs a place to be found again, and gives a returning player something recognisable after a run ends.

Open question, deliberately unresolved: whether home itself is generated from the run seed or is hand-authored and identical every time. Hand-authored is better for recognition and worse for replay. Leaning hand-authored for the layout with generated detail on top.


---

## D22: the world must stay procedurally generable
**Date:** 2026-07-26

Max's constraint, and it is a constraint on how we build rather than a feature.

The world is hand-laid right now, and that is correct: at this size an authored clearing beats a generated one, and D21's home is deliberately recognisable. It will eventually be procedural. The rule is that nothing we build in between may make that impossible.

**What that forbids:**

- Hardcoded coordinates outside the generator. If `main.ts` or a system knows that the palisade is at z = -8, generation can never move it. Positions are generator output, and everything else asks.
- Obstacles that only work at one location. An obstacle is facts plus properties; if it needs a specific hill behind it to be solvable, it is a set piece, not a system.
- Authored interactions keyed to a place. D17 lets an item have a specific effect on a specific *kind* of thing. Keying one to a specific instance in a specific region does not survive generation.
- Item placement by literal coordinate, long term. The current hand-placed layout is a legitimate shortcut, but it must stay a table the generator can replace, not spread into the code.
- Anything that assumes exactly one region, one home, or one way out.

**What it requires:**

- Everything spatial comes from the seeded Rng, through forks, so a region is reproducible from a seed alone (already true).
- Placement obeys stated rules rather than taste: "the water source is between home and the obstacle", "the tree line encloses the play area", "items are reachable without crossing the obstacle". A generator can satisfy a rule. It cannot satisfy an intention nobody wrote down.
- Regions expose their meaning, not just their geometry: where home is, where the exits are, what the obstacle is, what solves it. Systems ask the region rather than knowing the map.
- Validation. A generated region that cannot be completed is worse than a boring one, so generation needs a solvability check, which is why the reachability test in `merge.test.ts` computes what is obtainable rather than listing it.

**And the corollary Max stated:** when a new feature makes the world feel too small, that is the signal to expand the world, not to shrink the feature. The region was cut from 120x120 to a clearing because the large one was empty; it grows again when there is something to fill it with. Vehicles (A10) are the clearest example: they need distance, and the answer is multi-region travel rather than an inflated clearing.
