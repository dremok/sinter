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
