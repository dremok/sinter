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
