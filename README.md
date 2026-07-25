# SINTER

An isometric procedural adventure/RPG about carrying too much and knowing what to give up.

You start at home, in a small pastoral fantasy region, with nothing. You wander outward. You pick up everything, because everything can be picked up and the inventory is infinite. Any two items can be fused into a third, which permanently destroys both, so every merge is a bet you cannot take back.

The world is full of obstacles that were never designed with a solution in mind. A guarded wooden palisade across a river is not a lock waiting for a key. It is a set of facts, and anything that changes those facts gets you through: burn it, climb it, ram it with a car, bridge the river, freeze the river, bribe the guard, plant a sapling and wait.

The further you get from home, the less the world resembles the one you started in. First modernity intrudes without comment, a tarmac road through a wheat field, a sedan with the keys in it. Then it is ruined. Then it is wrong.

You will die out there. You keep what you learned.

*Sintering: fusing particles into a new solid mass with heat, without fully melting them. The originals stop existing as separate things.*

## Status

Early. The stack is scaffolded and proven; the game is not built yet. See [`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## Stack

TypeScript, Three.js with an orthographic camera for true isometric, Rapier for physics, miniplex for the entity component system, Vite, Vitest, Playwright for headless visual verification.

A full game engine was considered and rejected deliberately; the reasoning is in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

WASD to move, Q and E to rotate the camera.

```bash
npm run typecheck
npm run test
npm run shot         # headless screenshot at a fixed seed, writes to .shots/
npm run shot -- --seed hearth-7 --ticks 600
```

The game runs entirely offline and needs no API keys. Keys are only used by the offline asset generation in `tools/`; copy `.env.example` to `.env` if you are working on that.

## Documentation

| Document | What it covers |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | The three rules that must never be broken, and how to work in this repo |
| [`docs/DESIGN.md`](docs/DESIGN.md) | What the game is: the genre gradient, properties, merging, progression |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How it is built: determinism, ECS, simulation, world generation |
| [`docs/ASSET_PIPELINE.md`](docs/ASSET_PIPELINE.md) | Parametric kitbash, fal.ai textures, ElevenLabs audio |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why things are the way they are, so nobody relitigates them by accident |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Deploying to Railway |
| [`PROJECT_STATUS.md`](PROJECT_STATUS.md) | Current state and the roadmap to a vertical slice |

## Deploying

Static build on Railway, configured by [`railway.json`](railway.json). See [`docs/DEPLOY.md`](docs/DEPLOY.md).

```bash
railway up
```

## The three rules

1. **Obstacles are facts, not locks.** If a designer had to write down the solution in advance, it is wrong.
2. **No game code branches on an item ID.** All interaction is mediated by properties, which is what lets item number 4,000 work with every mechanic on the day it is created.
3. **Merges are irreversible and always yield.** Two in, one out, both inputs gone. Deciding whether to merge is the game.

## License

Unlicensed, all rights reserved for now.
