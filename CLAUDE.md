# SINTER

Isometric procedural adventure/RPG. Every item can be merged with every other item, irreversibly. The further you wander from home, the stranger the world gets.

Read `docs/DESIGN.md` before writing gameplay code. Read `docs/ARCHITECTURE.md` before writing engine code. Read `PROJECT_STATUS.md` at the start of every session.

## The three rules that must never be broken

These are not style preferences. Violating any of them collapses the game into something much smaller than it is meant to be. If you find yourself about to break one, stop and reconsider the approach instead.

### 1. Obstacles are facts, not locks

An obstacle is never "needs item X". An obstacle is a set of physical and social facts about the world. Anything that changes those facts gets you past it.

A palisade is not a door that wants a key. It is: `WOODEN`, `4m tall`, `guarded by an agent with a disposition`, `on the far bank of a river`. Burn it, climb it, chop it, ram it with a car, bridge the river, freeze the river, bribe the guard, distract the guard, tunnel under, plant a sapling and wait for it to grow, stack crates. None of those solutions are authored per obstacle. They fall out of the simulation.

The test: if a designer had to write down the solution to an obstacle in advance, it is wrong.

### 2. No game code branches on an item ID

All world interaction is mediated by **properties**. Fire spreads to things that are `FLAMMABLE`, not to things whose id is `wooden_fence`. Water conducts to things that are `CONDUCTIVE`. Guards are swayed by things that are `VALUABLE`.

`if (item.id === 'key')` is a bug. Always. If you need new behavior, add a property and a rule that reads it. Never a special case.

This is what makes the item catalog scale. Item number 4,000 works with every mechanic in the game on the day it is generated, because it is just a bag of properties, and the mechanics only ever read properties.

### 3. Merges are irreversible and always yield

Exactly two inputs, exactly one output. Both inputs are destroyed permanently. Every pair produces something (sometimes something bad). There is no unmerge, no workshop refund, no undo. Deciding *whether* to merge is the core strategic tension, and it only exists if the loss is real.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript | |
| Rendering | Three.js, orthographic camera | Orthographic projection gives true isometric for free |
| Physics | Rapier (`@dimforge/rapier3d-compat`) | Rust/WASM, fast, and deterministic for a fixed build, which a seeded roguelike needs |
| ECS | miniplex | Ergonomic and TS-native; the property simulation is naturally an ECS problem |
| Build | Vite | |
| Tests | Vitest | |
| Visual check | Playwright | See "Verify your own work" below |
| Item art | Parametric kitbash + fal.ai textures | See `docs/ASSET_PIPELINE.md` |
| Audio | ElevenLabs (music, ambience, SFX) | No narration, no voice acting. The game is wordless |

A full engine (Babylon, PlayCanvas, Godot) was considered and rejected deliberately. The reasoning is recorded in `docs/DECISIONS.md`. Do not quietly migrate to one.

## Verify your own work

This is the single most important habit in this repo, and the main reason the stack is web based.

Do not report a visual or gameplay change as done because the code looks right. Run it and look at it.

```bash
npm run dev            # dev server
npm run shot           # headless screenshot at a fixed seed, writes to .shots/
npm run shot -- --seed 12345 --at 30s
```

`npm run shot` boots the game headless at a fixed seed, simulates forward a set number of ticks, and writes a PNG. Read that PNG. If you changed how fire spreads, take a shot before and after and compare them.

Never use `Math.random()` anywhere in this codebase. Everything routes through the seeded RNG in `src/core/rng.ts`. A seed must reproduce a run exactly, or the screenshot workflow above is worthless and bugs become unreproducible.

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
