# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## SINTER

Isometric procedural adventure/RPG. You leave home, gather things, and combine some of them irreversibly. The further you wander from home, the stranger the world gets.

Read `docs/DESIGN.md` before writing gameplay code. Read `docs/ARCHITECTURE.md` before writing engine code. Read `PROJECT_STATUS.md` at the start of every session.

## The three rules

These shape the whole design. Two of them were amended on 2026-07-25 after playtesting, and the amendments are recorded as D17 and D18 in `docs/DECISIONS.md`. Read those before arguing with the versions below.

### 1. Obstacles are facts, and at least one way past is not authored

An obstacle is a set of physical and social facts about the world. Anything that changes those facts gets you past it.

A palisade is: `WOODEN`, `4m tall`, `guarded by an agent with a disposition`, `on the far bank of a river`. Burn it, climb it, chop it, bridge the river, bribe the guard, distract the guard.

The amendment: an obstacle **may** now have a specific authored answer that is satisfying to discover, and that answer may name a specific item. What it may not have is *only* that. Every obstacle needs at least one route that nobody wrote down, or it is a lock with a key and the design has collapsed into an ordinary adventure game.

The test: if the only way through is the one a designer wrote, it is wrong.

### 2. The simulation reads properties. Authored interactions are data

All world interaction in `sim/` is mediated by **properties**. Fire spreads to things that are `FLAMMABLE`, not to things whose id is `wooden_fence`. This is what lets an item work with every mechanic on the day it is created.

The amendment: item-specific interactions are now legitimate content. They belong in the declared table in `src/items/interactions.ts`, never as `if (item.id === ...)` inside a system.

The difference matters. A table can be listed, counted, tested for reachability and shown to the player in a codex. Scattered conditionals can only be discovered by reading every file. If you find yourself adding an id check to anything under `sim/`, that is still a bug.

### 3. Merges are irreversible, and not every pair merges

Exactly two inputs, exactly one output. Both inputs destroyed permanently. No unmerge, no refund, no undo. Deciding *whether* to merge is the core tension and it only exists if the loss is real.

The amendment: a pair that has no authored result simply does not merge. The bench says so and nothing is consumed. Refusing is free, so experimenting is free, which is what stops players hoarding. Some items never merge at all, and marking one `noMerge` is normal.

The old rule guaranteed every pair yielded something. In practice that produced filler, and filler reads as noise rather than as discovery.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript | |
| Rendering | Three.js, orthographic camera | Orthographic projection gives true isometric for free |
| Physics | Rapier, currently unused | Out of the runtime since D13; returns for crates, rope and vehicles |
| ECS | miniplex | Ergonomic and TS-native; the property simulation is naturally an ECS problem |
| Build | Vite | |
| Tests | Vitest | |
| Visual check | Playwright | See "Verify your own work" below |
| Item art | Parametric kitbash + fal.ai textures | See `docs/ASSET_PIPELINE.md` |
| Audio | ElevenLabs (music, ambience, SFX) | No voice acting. NPC dialogue is text, see D19 |

A full engine (Babylon, PlayCanvas, Godot) was considered and rejected deliberately. The reasoning is recorded in `docs/DECISIONS.md`. Do not quietly migrate to one.

## Commands

```bash
npm install
npm run dev                # dev server on http://localhost:5173
npm run typecheck          # tsc --noEmit
npm run test               # vitest run
npm run test:watch
npm run build              # typecheck, then vite build to dist/
npm run preview            # serve the built bundle via vite
npm start                  # serve dist/ with tools/serve.mjs on $PORT or 3000
```

One test file, or one case by name:

```bash
npx vitest run src/core/rng.test.ts
npx vitest run -t 'forked streams are independent'
```

There is no lint script and no ESLint or Prettier config. `npm run typecheck` is the only static check, and `npm run build` runs it first, so a type error fails the deploy. The ban on `Math.random()` below is documentation, not tooling; nothing catches a violation for you yet.

## Verify your own work

This is the single most important habit in this repo, and the main reason the stack is web based.

Do not report a visual or gameplay change as done because the code looks right. Run it and look at it.

```bash
npm run shot                                          # seed hearth-0, 240 ticks
npm run shot -- --seed hearth-7 --ticks 600
npm run shot -- --ticks 380 --at 0,-4 --ignite 0,-8 --out .shots/fire-after.png
npm run shot -- --at 0,-11 --pack axe,flint,torch --slots 0,1
```

`npm run shot` boots the game headless at a fixed seed, simulates forward a set number of ticks, and writes a PNG. Read that PNG. If you changed how fire spreads, take a shot before and after and compare them.

| Flag | What it does |
|---|---|
| `--seed` | run seed; also the default output filename |
| `--ticks` | fixed ticks to simulate before the single render |
| `--out` | output path, default `.shots/<seed>.png` |
| `--width` `--height` | viewport size |
| `--at x,z` | where the player starts, so a shot can frame a specific place |
| `--ignite x,z` | lights the nearest flammable thing there, for before/after fire shots |
| `--pack a,b,c` | fills the pack with item ids and opens the panel |
| `--slots i,j` | loads two pack indices into the merge bench (needs `--pack`) |

The last four exist only to make things reachable in a single headless frame; nothing in `src/` depends on them. Unknown flags are silently ignored rather than rejected, so a mistyped flag hands you a confident screenshot of the wrong thing. The harness also collects page and console errors and exits non-zero if there were any, which makes it a smoke test as well as a camera.

### Check the case the player is actually in

Two rules, both learned by shipping something bad.

**Verify the COMMON case, not the case you were thinking about.** A depth-inverted silhouette pass was added so the player could be seen through walls. It was verified in exactly that situation, standing behind a building, where it worked. It was never checked standing in the open, which is where a player spends almost all of their time, and there the character's lower body sits behind the ground surface so the silhouette drew over the entire world. It shipped looking, in Max's words, horrible. The screenshot that would have caught it took twenty seconds and was never taken, because the feature was verified against its own intent instead of against ordinary play.

So: after a visual change, take a shot of the ORDINARY view first. Then the special case.

**Look again after deploying.** Frequent deploys are wanted and good, but a deploy is not the end of the change. Pull up what actually went out and look at it. Twice now something reached production that a single glance would have stopped: primary-colour debug decals, and this. In both cases the code was correct by every automated check available.

`npm run typecheck`, the tests and a successful build cannot see any of this. A shader that compiles draws something. A material with the wrong depth function is still a valid material. The picture is the only check that works, and it only works if you look at it.

Never use `Math.random()` anywhere in this codebase. Everything routes through the seeded RNG in `src/core/rng.ts`. A seed must reproduce a run exactly, or the screenshot workflow above is worthless and bugs become unreproducible.

## Architecture

`docs/ARCHITECTURE.md` has the full picture, but note that the `src/` tree it shows is the target layout, not what is on disk. Present today: `core/`, `props/`, `ecs/`, `items/`, `sim/`, `world/`, `render/`, `ui/`. Still absent: `agents/`, `world/gen/` per-band modules, `core/serialize.ts`, `items/codex.ts`, most of `sim/`. Treat the rest of that tree as a map of where things go, not as files that went missing.

The dependency direction is one way: `props/` knows nothing, `items/` reads `props/`, `sim/` reads `props/` and `ecs/`, and `world/` and `ui/` sit on top. Nothing under `sim/` imports from `items/`, which is what keeps the simulation unable to branch on an item id even by accident.

Four things span multiple files and are easy to break by accident.

**The headless contract.** `tools/shot.ts` spawns its own Vite on port 5199, opens `/?seed=<seed>&ticks=<n>`, and waits for `window.__sinterReady === true`. `src/main.ts` reads those two params and branches on them: with `ticks > 0` it runs N `stepSimulation()` calls with no wall clock involved at all, renders exactly one frame, and sets the flag; otherwise it starts `renderer.setAnimationLoop`. Any rework of the boot path must keep both branches and must keep setting `__sinterReady`, or `npm run shot` hangs for 30 seconds and fails. Since `main.ts` uses top-level `await RAPIER.init()`, boot is already async; keep the flag after the first render, not before it.

**Determinism has two halves.** Seeded randomness in `core/rng.ts` and a fixed timestep in `core/clock.ts` (60 Hz, `TICK_DT`). Rapier's `world.timestep` is set to `TICK_DT` and it steps inside the fixed tick, so physics stays on the same clock as everything else. `rng.fork(label)` derives a stream from the base seed and the label alone, never from how much the parent has been consumed, which is exactly what stops a new system from desyncing every existing one. Give each subsystem its own fork. Rapier is deterministic for a given build on a given platform only, so do not build anything that assumes cross-machine replay.

**Orthographic camera traps.** Under this projection every object sits roughly `IsoCamera.distance` deep, so anything depth-based must be derived from that value rather than hardcoded, or fog drowns the whole scene instead of the far edge. The sun's azimuth must also stay roughly perpendicular to the camera's, or every shadow falls behind its own caster and reads as "shadows are broken". Both cost a debugging cycle already and are written up as D9 in `docs/DECISIONS.md`. The camera rotates in 90 degree steps, so revisit the sun when rotation is wired up properly.

**Build config comes in pairs.** `@/*` maps to `src/*` in both `tsconfig.json` and `vite.config.ts`; a new alias has to go in both or neither. Rapier is excluded from Vite's dep pre-bundling because it ships WASM. Rapier also prints a deprecation warning on init from inside the package itself, with no call site to change, so ignore it.

`src/main.ts` is scaffolding that proves the stack works end to end, not architecture. Its own header says to expect deleting most of it as real systems land. Do not build on its shape.

## Working agreements

- Micro-increments. Smallest change that moves forward, verify, then continue.
- Delete code that does not work rather than patching around it. No dead branches kept "just in case".
- No heuristics or workarounds standing in for understanding. If you do not know why something breaks, find out.
- Prefer deleting a system over special-casing it.
- Update `PROJECT_STATUS.md` immediately after any significant change.
- Do not add a dependency without noting why in `docs/DECISIONS.md`.

## Prose style

Anything a player will read (item descriptions, flavor text, UI copy) must not read as LLM output.

- Never use em dashes.
- Never use: delve, leverage, comprehensive, streamline, myriad, tapestry, testament, "it's worth noting", "in a world where".
- Vary sentence length. Short is good. Items in the fantasy band are plain and concrete. Items in the outer bands get quieter and more wrong, not more elaborate.

## Deploying

Railway, static build, configured by `railway.json` at the repo root. Read `docs/DEPLOY.md` before touching deployment.

```bash
railway up        # build and deploy
railway logs      # check it
railway open      # look at it
```

The deployed game needs no environment variables at all; it runs entirely in the browser with no backend. A green build does not mean a working game, because WebGL and WASM fail in ways a build cannot catch. Load the deployed URL and confirm it renders before calling a deploy done.

## Secrets

`.env` (gitignored). Copy `.env.example`.

Max keeps the real values in `~/code/oubli-forever/.env` (`FAL_KEY`, `ELEVENLABS_API_KEY`). Those are needed **only** by the offline asset bake in `tools/`. Never commit them, never add them to Railway, and never read them from anything under `src/`. The shipped game makes no network calls and requires no keys.
