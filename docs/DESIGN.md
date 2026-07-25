# SINTER: Design

Source of truth for what the game is. If code and this document disagree, one of them is wrong; decide which and fix it.

`docs/IDEAS.md` is the opposite of this document: an unfiltered stockpile of properties, interactions, items, merges, obstacles, situations, and creatures that could be built. Nothing in it is committed to and nothing in it has authority. Go there when a milestone needs content, rather than inventing three options under time pressure.

## One paragraph

You begin at home, in a small pastoral fantasy region. You wander outward. You pick up everything, because everything can be picked up. Any two items can be fused into a third, permanently destroying both, so every merge is a bet. The world is full of obstacles that were never designed with a specific solution, and the further you get from home the less the world resembles the one you started in: first recognizably modern, then ruined, then wrong. You will die out there. You keep what you learned.

## Core loop

1. Spawn at home with nothing.
2. Explore outward through connected regions. Each gateway crossed moves you one step further from home.
3. Collect items. The inventory is infinite, so collection is never the constraint. Understanding is.
4. Merge pairs of items to make things you need. Both inputs are gone forever.
5. Get past obstacles using whatever the simulation allows.
6. Die.
7. Keep stats, skills, and the recipe codex. The world regenerates from a new seed. Go again.

There is no extraction, no banking, no safe exit. A run ends when you die. Play as long as you can survive.

## The genre gradient

The spine of the game. Distance from home is simultaneously the difficulty curve, the spatial progression, and the tonal arc. One axis carries all three.

### Band 0: Hearth
Pastoral fantasy. Villages, wheat fields, oak woods, a mill, a well. Wooden tools, iron nails, rope, lanterns, livestock. People are ordinary and mostly friendly. Nothing here will kill you quickly.

Purpose: teach the systems in a legible world where physical intuition works perfectly. Burning wood behaves exactly as expected. This band is the tutorial and it never says so.

### Band 1: The Turn
Modernity intrudes without comment. A tarmac road cuts through a wheat field. Powerlines. A parked sedan with the keys in it. A petrol station serving a village that still uses oxen. Nobody remarks on any of it, and no explanation is ever offered.

Purpose: the first destabilization. Also where the item catalog roughly doubles, because now you have batteries, fuel, glass, plastic, electricity.

### Band 2: Rust
Post-apocalyptic. Cities gone feral. Skyscrapers with dead elevator shafts you can climb or fall down. Flooded metro tunnels as dungeons. Scavengers who will fight or trade. Weather turns hostile. Structures collapse.

Purpose: the survival layer bites here. Temperature and hunger stop being decorative. Most runs will end in this band for a long time.

### Band 3: The Static
Surreal. Lynch, Tarkovsky, von Trier. Geometry stops obeying. A corridor connects two places that cannot both exist. Sound drops out where it should not. Rooms repeat with one thing changed. Items here have properties that do not quite make sense together and descriptions that get shorter, not longer.

Purpose: the reward for mastery, and the actual point of the game. Genuinely hard to reach on early runs, gated by accumulated character skill rather than by an unlock.

Design constraint on this band: it may break spatial and tonal expectations freely, but it must **never** break the property simulation. Players still have to reason about affordances to survive. Surreal geometry, honest physics.

### What shifts between bands
Architecture, item pool, enemy behavior and drives, color palette, audio bed, ambient density, weather, and the degree to which NPCs behave like people. The property system and the physics do not shift. Ever.

## The affordance system

The reason this game exists. See rule 1 in `CLAUDE.md`.

Obstacles are described as facts. Solutions are not authored. A worked example:

> **A guarded wooden palisade on the far bank of a river.**
>
> Facts: `WOODEN(0.9)`, `height 4m`, `spans 30m`, `guard: agent, disposition neutral, greed 0.6, alertness 0.4`, `river: WATER, width 6m, depth 2m, flow 0.3`

Solutions the simulation should permit without anyone having written them down:

| Approach | Requires |
|---|---|
| Burn it | Anything `HOT` plus the fire propagation system finding `FLAMMABLE` neighbors |
| Chop through | Anything `TOOL_CUTTING` with enough mass |
| Blow it open | Anything `EXPLOSIVE` |
| Ram it | Anything `WHEELED` with enough momentum |
| Climb it | Anything `LADDER_LIKE`, or stacked `PLATFORM` objects, or a grapple (`ROPE_LIKE` + `SHARP`) |
| Grow over it | A `SEED` plus water plus time plus possibly an accelerant |
| Bridge the river | `PLATFORM` objects spanning, or felled trees |
| Freeze the river | Anything sufficiently `COLD` |
| Float across | Anything `BUOYANT` and large |
| Bribe the guard | Anything `VALUABLE` weighed against guard greed |
| Distract the guard | Anything `LOUD` thrown elsewhere |
| Disguise | Anything `IDENTIFYING` matching the faction |
| Scare the guard | Anything `FRIGHTENING` |
| Tunnel under | Anything `TOOL_DIGGING` |
| Poison the guard | `TOXIC` plus `EDIBLE` delivered plausibly |

Around thirty more obstacles written in this format, covering terrain, structures, environmental hazards, social situations, biology, and mechanisms, are in `docs/IDEAS.md`.

Fifteen approaches, zero of them special-cased for this obstacle. That is the bar. Every obstacle in the game should have a comparable fan of solutions, and the interesting ones should come from combinations nobody predicted.

**Implementation consequence:** obstacles do not contain solution logic. They contain state. Systems act on state. An obstacle is "solved" when its facts no longer block passage, and the game does not care how they changed.

## Properties

The vocabulary the entire game is written in. Mostly scalars in `[0,1]`, not booleans, because a soaked plank is `FLAMMABLE(0.2)` and a dry one is `FLAMMABLE(0.9)` and that difference should matter.

**Material:** `WOODEN` `METAL` `STONE` `GLASS` `FLESH` `CLOTH` `PLASTIC` `ICE` `WATER` `EARTH` `PAPER` `CERAMIC`

**Physical:** `FLAMMABLE` `CONDUCTIVE` `MAGNETIC` `BUOYANT` `HEAVY` `FRAGILE` `RIGID` `ELASTIC` `SHARP` `ADHESIVE` `CORROSIVE` `INSULATING` `TRANSPARENT` `POROUS` `SLIPPERY`

**Energetic:** `HOT` `COLD` `ELECTRIFIED` `EXPLOSIVE` `LUMINOUS` `LOUD` `RADIOACTIVE`

**Biological:** `EDIBLE` `TOXIC` `LIVING` `SEED` `MEDICINAL` `ROTTING` `INTOXICATING`

**Social:** `VALUABLE` `SACRED` `CONTRABAND` `IDENTIFYING` `FRIGHTENING` `BEAUTIFUL`

**Functional:** `CONTAINER` `ROPE_LIKE` `LADDER_LIKE` `WHEELED` `PLATFORM` `TOOL_CUTTING` `TOOL_DIGGING` `TOOL_PRYING` `TOOL_STRIKING` `PROJECTILE` `LAUNCHER` `WEARABLE` `WRITTEN`

This list will grow. Adding a property is cheap and correct. Adding a special case is neither.

Several hundred further candidates are listed in `docs/IDEAS.md`, each with a note on which system would read it. A property nothing reads is dead weight in every merge derivation forever, so take from that list only when something is about to query it.

## Merging

- **Exactly 2 inputs, exactly 1 output.** Keeps the catalog tractable and the UI honest.
- **Always yields something.** Never "nothing happens". Sometimes the result is junk, and junk is a real outcome, but the player is never told their idea was invalid.
- **Irreversible.** Both inputs destroyed. No unmerge at any price.
- **Globally deterministic.** `merge(A, B)` is the same for every player in every run forever. Baked at build time, not decided at runtime.
- **Commutative.** `merge(A, B) === merge(B, A)`.
- **Property inheritance is rule based, naming and appearance are LLM baked.** The result's properties are derived by deterministic rules from the inputs. Its name, description, and visual assembly come from the offline generation pass. This split matters: it means merge results are always mechanically sensible even when their names are strange.

The interesting consequence of "always yields": since every pair produces something, the catalog is closed under merging, and a player with two items always has a move.

## Progression

**Persists through death:** character stats, skills, the recipe codex (every merge you have ever discovered, permanently), and the discovery log of items and creatures seen.

**Lost on death:** every item, all world state, position, and the world itself.

The codex is the real progression. Run 40 is easier than run 1 not because your character is stronger, though it is somewhat, but because you know that a particular pair makes something that gets you through Band 2 reliably. Knowledge is the thing that survives, which is thematically the entire point.

## Combat

Real time. Enemies exist and combat is one solution among many, never the only one. Enemies are entities with properties and drives, so they burn, freeze, drown, get crushed by a dropped crate, get bribed, get frightened, and get poisoned, all through the same systems that handle everything else. No separate combat subsystem with its own rules.

## Survival

Deliberately light and band-scaled. Hunger and temperature are nearly free in Band 0 and genuinely dangerous in Band 2 and 3. Survival exists to give outward travel a cost and to make `EDIBLE` and `INSULATING` matter, not to become a chore loop.

## Inventory

Infinite capacity. The design problem is not storage, it is that the player will be holding 300 items and needs to think. UI requirements:

- Search by name.
- **Filter by property.** "Show me everything FLAMMABLE" is the single most important query in the game.
- Sort by recency, name, mass, value.
- Pin favorites.
- A merge bench taking two slots, showing the result only if already discovered. Undiscovered pairs show a question mark and stay a gamble.

## Non-goals

- No multiplayer. Single player only.
- No narration or voice acting. The game is wordless.
- No mobile or touch support for now. Desktop only.
- No story, quests, or dialogue trees. The world is the content.
- No unmerge mechanic, at any price, ever.

## Open questions

Deliberately unresolved; decide when the vertical slice makes them concrete.

- How do skills work, and how do they gate reaching Band 3?
- Does money exist? Bribery needs *something* `VALUABLE`, but that could just be items.
- How does the player know how far from home they are? A compass, a map, or nothing at all?
- How are regions and gateways laid out? A graph, a ring, a spiral?
- What happens if the player walks back toward home? Does the world get safer again?
