# SINTER: Idea Quarry

A stockpile of material for the game: properties, interactions, systems, items, merges, obstacles, situations, creatures, and weirdness. None of it is implemented. None of it is committed to.

**This document is not a spec.** `docs/DESIGN.md` is the source of truth for what the game is. This is raw supply for when the game is ready to grow. Everything here is a candidate, and candidates are cheap.

## How to use this

- When a milestone needs content, come here first rather than inventing from scratch under time pressure. Picking from a wide list beats generating three ideas and taking the best of three.
- Take what fits, adapt it, ignore the rest. Nothing here has authority.
- **Everything here still obeys the three rules in `CLAUDE.md`.** If an entry appears to need an item-ID branch, either it is written badly or it is a bad idea. Rewrite it in terms of properties or drop it. Section 15 lists ideas that fail this test, on purpose, so nobody rediscovers them and thinks they are clever.
- When an idea gets built, delete it from here and let the code and `docs/DESIGN.md` carry it. When an idea gets tried and rejected, move it to section 15 with a one-line reason. This file should churn, not just grow.
- Concrete examples below (named items, named merge results) are **illustrative targets**, not data to paste into `catalog.ts`. They exist so you can sanity-check derivation rules: "if I merge a rag and a flask of oil, do the rules give me something that reads as an oily rag?" If the rules produce that without knowing what a rag is, the rules are right.

Current state of the vocabulary: `src/props/registry.ts` ships 27 properties. `docs/DESIGN.md` lists about 60. This document proposes several hundred more. That gap is deliberate. Add a property when a system will read it in the next hour, not before.

---

# Part 1: Properties

The vocabulary. A property earns its place only when at least one system reads it and at least two different items would carry it. A property that only one item has is an item ID wearing a disguise.

Values are scalars in `[0,1]` unless noted. Each entry below has a short note on what would read it, because a property nothing reads is dead weight in every merge derivation forever.

## 1.1 Material

What a thing is made of. These blend on merge, and they are the base that most emergent rules read from. `WATER` is already the exception in the shipped registry, where it combines as `max` because a bucket poured over straw soaks it rather than making it half wet. Expect one or two more exceptions as this group grows, and expect each one to need the same kind of comment.

| Property | Read by | Note |
|---|---|---|
| `WOODEN` | fire, buoyancy, cutting, structure | shipped |
| `METAL` | thermal, electricity, magnetism, edge retention | shipped |
| `STONE` | mass, structure, heat capacity | shipped |
| `GLASS` | optics, shatter, cutting when broken | shipped |
| `CLOTH` | soaking, fire speed, wearable | shipped |
| `PLANT` | growth, edibility, fire | shipped |
| `WATER` | everything | shipped |
| `FLESH` | rot, edibility, damage, scent | living things and what is left of them |
| `BONE` | rigid but brittle, carves well, sacred in some cultures | |
| `EARTH` | digging, growth medium, smothering fire | |
| `SAND` | pours, smothers, becomes glass when hot enough | |
| `CLAY` | plastic when wet, rigid when fired | phase change by heat, not by recipe |
| `PAPER` | writing, tinder, destroyed by water | |
| `CERAMIC` | rigid, brittle, holds liquid, survives fire | |
| `PLASTIC` | melts rather than burns, insulates, does not rot | band 1 onward |
| `RUBBER` | insulating, elastic, burns filthy | band 1 onward |
| `CONCRETE` | structure, mass, cracks under heat | band 2 |
| `ICE` | temporary platform, slippery, becomes water | the best timed obstacle material in the game |
| `WAX` | melts low, seals, burns with a wick | |
| `OIL` | flammable, floats on water, lubricates | distinct from `FLAMMABLE`: oil spreads |
| `SALT` | preserves, melts ice, ruins soil, wards in some cultures | |
| `ASH` | fertilizer, fouls water, marks a trail | |
| `LEATHER` | tough, insulating, wearable, smells | |
| `SILK` | strong for its mass, valuable, burns instantly | |
| `RESIN` | adhesive, flammable, hardens over time | |
| `FUNGAL` | spreads, glows sometimes, edible sometimes | good band 2 and 3 material |
| `CHITIN` | armor on things that are not people | |
| `RUST` | what metal becomes, weaker but still metal | a state, tracked as material |
| `SOOT` | marks things, blinds, hides you | |
| `GLASS_MOLTEN` | probably not a material, probably `GLASS` + high heat | flagged as a modeling question |

**Modeling note.** `RUST` and `SOOT` blur the line between material and state. Consider a rule: a material property is anything a merge should blend. If it should not blend, it is a state and belongs in `physical`.

## 1.2 Physical

| Property | Read by | Note |
|---|---|---|
| `FLAMMABLE` `HEAVY` `SHARP` `RIGID` `BUOYANT` `WET` | shipped | |
| `FRAGILE` | drop damage, thermal shock, projectile impact | breaking should create children, see 5.4 |
| `BRITTLE` | fails suddenly under load rather than bending | distinct from `FRAGILE`, which is about impact |
| `ELASTIC` | springs, slings, bounce, ropes with give | |
| `FLEXIBLE` | fits through gaps, wraps, cannot bear load | |
| `ABRASIVE` | sharpens, wears down, starts sparks | whetstone, sandpaper, a rough wall |
| `POROUS` | soaks up liquid, filters, muffles sound | |
| `ABSORBENT` | probably the same as `POROUS`, decide once | |
| `ADHESIVE` | sticks two things together in world, not just in merge | |
| `SLIPPERY` | movement, dropped items, agents falling over | |
| `VISCOUS` | flows slowly, clogs, coats | |
| `GRANULAR` | pours, fills, smothers, can be sieved | |
| `HOLLOW` | floats, resonates, can be filled, crushes loudly | |
| `INSULATING` | thermal blocking, electrical blocking, wearable warmth | |
| `CONDUCTIVE` | electricity networks, also thermal | consider splitting into two |
| `MAGNETIC` | attracts `FERROUS`, wrecks compasses and tapes | |
| `FERROUS` | what magnets attract | the passive half of magnetism |
| `TRANSPARENT` | see through, light passes, guards see you through it | |
| `REFLECTIVE` | signalling, redirecting light or heat, blinding | |
| `REFRACTIVE` | lenses, starting fires with sunlight, reading small text | |
| `AERODYNAMIC` | thrown range, glide, wind catches it | |
| `LIGHTER_THAN_AIR` | balloons, rises, carries things up | band 1 onward, expensive but delightful |
| `DENSE` | sinks, punches through, blocks radiation | maybe just `HEAVY` at high values |
| `TOP_HEAVY` | falls over when nudged, stacks badly | tiny property, huge comedy |
| `PRESSURIZED` | ruptures violently when heated or punctured | |
| `SPRING_LOADED` | releases stored motion when triggered | traps, launchers |
| `TENSIONED` | a rope under load, cutting it releases energy | |
| `INTERLOCKING` | stacks stably, builds structures | crates, bricks, pallets |
| `SEALING` | closes a container, stops flow, blocks gas | cork, tape, tar, a wad of cloth |
| `HOOKED` | catches on things, grapples, hangs | |
| `TOOTHED` | saws, gears, grips | |
| `PERFORATED` | leaks, sieves, breathes | the failure state of `CONTAINER` |

## 1.3 Energetic

| Property | Read by | Note |
|---|---|---|
| `HOT` `LUMINOUS` `EXPLOSIVE` | shipped | |
| `COLD` | freezing, preserving, brittleness, damage | mirror of `HOT`, or a negative range on one scalar |
| `ELECTRIFIED` | live current right now | |
| `CHARGED` | stored energy waiting to be released | battery vs live wire, keep separate |
| `FUEL` | stored chemical energy, what fire consumes | distinct from `FLAMMABLE` which is ease of ignition |
| `OXIDIZER` | plus `FUEL` gives `EXPLOSIVE` without either parent being explosive | the best emergent rule in this section |
| `VOLATILE` | evaporates, fumes, ignites from a spark at range | |
| `LOUD` | agent hearing, structural collapse triggers, avalanche | |
| `RESONANT` | rings, shatters glass, carries far | |
| `ULTRASONIC` | animals hear it, people do not | dog whistle logic, works on the bestiary |
| `RADIOACTIVE` | slow damage, glows, ruins food and film | band 2 |
| `PHOSPHORESCENT` | glows after being lit, dies down | a light you have to charge |
| `SMOKING` | blocks vision, chokes, rises, marks your position from far off | |
| `STEAMING` | scalds, obscures, condenses | |
| `FLASH` | blinds agents briefly, sets tinder alight at range | |
| `MAGNETIZING` | makes `FERROUS` things `MAGNETIC` on contact | |

## 1.4 Biological

| Property | Read by | Note |
|---|---|---|
| `EDIBLE` `SEED` `LIVING` | shipped | |
| `NUTRITIOUS` | how much hunger it actually solves | `EDIBLE` is willingness, this is value |
| `TOXIC` | damage over time to `LIVING`, kills plants, fouls water |
| `MEDICINAL` | heals, cures poison, sometimes both at low doses |
| `SOPORIFIC` | puts agents to sleep, best delivered inside something `EDIBLE` |
| `STIMULANT` | agents get faster and less careful |
| `INTOXICATING` | disposition up, alertness down | the friendliest solution to a guard |
| `ADDICTIVE` | an agent will trade badly for it, repeatedly |
| `ROTTING` | degrades over time, attracts scavengers, becomes `TOXIC` |
| `FERMENTING` | becomes `INTOXICATING` given time and warmth |
| `CONTAGIOUS` | spreads to `LIVING` neighbors | a fire system for disease, same shape |
| `PARASITIC` | attaches to a host, drains, spreads |
| `SPORE` | spreads without being planted, prefers dark and damp |
| `FERTILE` | a growth medium, makes `SEED` faster and bigger |
| `SCENTED` | animals track it, guards notice it, predators come |
| `REPELLENT` | animals avoid it, some agents do too |
| `PHEROMONE` | herds move toward it, insects swarm it |
| `ANTISEPTIC` | stops `ROTTING` and `CONTAGIOUS` |
| `BLOOD` | tracks you, attracts predators, marks a trail | grim and useful |
| `EGG` | fragile, becomes `LIVING` given warmth and time |
| `VENOMOUS` | toxic on contact rather than on eating |
| `CARRION` | what dead `FLESH` becomes, the top of the scavenger food chain |

## 1.5 Social

The properties agents read. Everything here is only meaningful because something can perceive it.

| Property | Read by | Note |
|---|---|---|
| `VALUABLE` `SACRED` | shipped | |
| `CONTRABAND` | guards react badly to seeing it | faction-scoped, see 1.7 |
| `IDENTIFYING` | you read as a member of a group | uniforms, badges, a particular hat |
| `AUTHORITATIVE` | agents obey or defer | a seal, a clipboard, a helmet |
| `FRIGHTENING` | agents flee, or freeze | |
| `BEAUTIFUL` | agents approach, stare, want it |
| `COMFORTING` | lowers fear in agents and possibly in the player |
| `FAMILIAR` | belongs in this band, agents ignore it |
| `ALIEN` | does not belong here, agents react badly | the property that carries band drift |
| `TABOO` | worse than contraband, provokes even neutral agents |
| `PERSONAL` | has an owner who will recognize it | stealing has consequences |
| `GIFT` | given freely, changes what an exchange means |
| `MOURNFUL` | funerals, graves, the wrong thing to interrupt |
| `CHILDLIKE` | a toy, a drawing, the thing that makes a fight feel bad |
| `LEGAL_TENDER` | some agents accept only this, some accept anything |

## 1.6 Functional

Affordances. These are the properties that get you past things.

| Property | Note |
|---|---|
| `CONTAINER` `ROPE_LIKE` `LADDER_LIKE` `PLATFORM` `TOOL_CUTTING` `TOOL_STRIKING` | shipped |
| `TOOL_DIGGING` | earth, snow, sand, graves |
| `TOOL_PRYING` | hinges, crates, boarded windows, manhole covers |
| `TOOL_BORING` | holes in things, drills, augers |
| `TOOL_JOINING` | nails, glue, welding, lashings |
| `VESSEL` | holds liquid specifically, unlike `CONTAINER` which holds objects |
| `WICK` | draws fuel to a flame and slows it down |
| `LENS` | focuses light or heat |
| `MIRROR` | redirects |
| `LEVER` | multiplies force, needs a `FULCRUM` nearby |
| `FULCRUM` | the other half |
| `WEDGE` | splits, jams a door open or shut |
| `PULLEY` | lifts more than you can carry |
| `WHEELED` | rolls, rams, carries |
| `HANDLE` | makes an otherwise unusable thing usable | possibly the most reusable merge input in the game |
| `HAFT` | the specific case of a handle for a striking or cutting head |
| `PROJECTILE` | can be thrown usefully |
| `LAUNCHER` | throws things further than an arm |
| `WEARABLE` | goes on the body, applies its other properties to you |
| `WRITTEN` | carries information, readable if `LUMINOUS` is nearby |
| `MAP` | reveals part of the region |
| `SIGNAL` | tells an agent something at range |
| `DECOY` | makes agents believe something is where it is not |
| `TRAP` | triggers when something crosses it |
| `TIMER` | delays an effect, the input every good plan needs |
| `TRIGGER` | fires an effect when a condition is met |
| `SWITCH` | changes a world state, usually electrical or mechanical |
| `PUMP` | moves fluid against gravity |
| `BELLOWS` | moves air, makes fire hotter, clears smoke |
| `NET` | catches things that move |
| `ANCHOR` | stops something drifting or falling |
| `CLAMP` | holds two things together while you do something else |
| `INSTRUMENT` | makes sound deliberately, changes agent mood |
| `SIEVE` | separates by size, filters water |
| `MEASURING` | probably not a game property, listed to be crossed off |

## 1.7 Property shapes we may need beyond a scalar

Real question, worth deciding before the vocabulary gets large.

- **Scalar `[0,1]`.** The default. Works for most things.
- **Signed scalar.** `HOT` and `COLD` are one axis, not two. A single `TEMPERATURE` in `[-1,1]` may be cleaner and stops "hot and cold at 0.5 each" from being expressible. Downside: it breaks `max` combining.
- **Absolute quantity.** Mass, volume, and stored fuel are not fractions of anything. A `CONTAINER(0.8)` that holds two liters and one that holds two hundred are different things.
- **Tagged scalar.** `IDENTIFYING` needs to know which faction. `CONTRABAND` needs to know for whom. `PERSONAL` needs an owner. Consider a payload field on a small number of social properties rather than one property per faction.
- **Directional.** `SHARP` on one edge, `HOOKED` on one end. Probably out of scope, but a spear and a caltrop differ mostly in where the point is.
- **Rate vs amount.** `FLAMMABLE` is how easily it catches. `FUEL` is how long it burns. Straw is `FLAMMABLE(1.0) FUEL(0.1)`. An oak beam is `FLAMMABLE(0.3) FUEL(0.9)`. This one distinction would make the fire system dramatically better than a single property allows.

## 1.8 Properties that are traps

Listed so nobody adds them.

- `UNLOCKS_GATE_3`, `QUEST_ITEM`, `KEY`. Obviously.
- `USEFUL`, `POWERFUL`, `QUALITY`, `TIER`. Not properties, just designer opinions with a number attached.
- `MAGICAL`. Means nothing to any system. If a thing does something strange, the strange thing is the property.
- `WEAPON`. Too coarse. A weapon is `SHARP` or `HEAVY` or `TOXIC` or `LOUD`, and which one it is determines what it is good for.
- `INDESTRUCTIBLE`. The moment one thing cannot burn, players stop believing anything can.

---

# Part 2: Interactions

The reason properties exist. Bottom-up: take pairs and triples of properties, ask what should happen, and the game writes itself.

Format is `A + B -> outcome`. None of these mention an item.

## 2.1 Heat

- `HOT` + `FLAMMABLE` -> ignition, scaled by how flammable and how hot
- `HOT` + `FUEL` -> duration of the resulting fire
- `HOT` + `WET` -> the wet burns off first, steam, then normal ignition. Buys the player time and makes rain matter.
- `HOT` + `ICE` -> water, and whatever the ice was holding up falls
- `HOT` + `WATER` -> steam, `HOT` drops, scalds anything `LIVING` nearby
- `HOT` + `METAL` -> the metal becomes `HOT` fast and stays hot long, burns `FLESH` on contact
- `HOT` + `STONE` -> heats slowly, holds heat for a very long time. A hot stone is a portable, slow fire.
- `HOT` + `GLASS`/`CERAMIC` + `FRAGILE` -> thermal shock, shatters, becomes `SHARP` fragments
- `HOT` + `WAX`/`PLASTIC` -> melts, becomes `VISCOUS`, flows downhill, re-solidifies in whatever shape it settled into
- `HOT` + `CLAY` -> fires it, permanently `RIGID`, no longer softens in water
- `HOT` + `SAND` -> glass, given enough heat
- `HOT` + `EDIBLE` -> cooked, `NUTRITIOUS` up, `ROTTING` reset, `TOXIC` down for some things
- `HOT` + `TOXIC` + `PLANT` -> fumes, an area effect nobody had to author
- `HOT` + `PRESSURIZED` -> rupture, violent
- `HOT` + `SEED` -> dead, unless the species needs fire to germinate, which is a lovely thing to hide in the world
- `HOT` + `SNOW`/`ICE` terrain -> meltwater, which floods low ground, which changes the map
- `COLD` + `WATER` -> ice, which is `PLATFORM` and `SLIPPERY` and temporary
- `COLD` + `LIVING` -> damage, slowed, eventually still
- `COLD` + `FLESH`/`EDIBLE` -> preserved, `ROTTING` halted
- `COLD` + `METAL` -> brittle, shatters under `TOOL_STRIKING` instead of denting
- `COLD` + `RUBBER`/`PLASTIC` -> brittle, the cheap way past a band 2 seal
- `COLD` + `SALT` -> no ice, the counter to a freezing solution

## 2.2 Water and fluids

- `WATER` + `POROUS` -> soaked, `HEAVY` up, `FLAMMABLE` way down, `INSULATING` down
- `WATER` + `PAPER` -> `WRITTEN` destroyed. Information is destructible and that should hurt.
- `WATER` + `EARTH` -> mud: `SLIPPERY`, slows movement, holds tracks, smothers fire
- `WATER` + `SEED` + time -> growth
- `WATER` + `OIL` -> does not mix, oil floats, oil on water still burns. Fire crossing a river is a genuinely great moment.
- `WATER` + `ELECTRIFIED` -> the whole puddle is live, and everything standing in it
- `WATER` + `SALT` -> no longer drinkable, no longer freezes, corrodes metal faster
- `WATER` + `METAL` + time -> `RUST`, which is weaker, so a rusted grate can be broken by hand eventually
- `WATER` + `CLAY` -> workable again
- `WATER` + `GRANULAR` -> heavy sludge, or a dam
- `WATER` + `LIGHTER_THAN_AIR` -> nothing. Included because not every pair does something interesting, and the merge system still has to yield.
- flowing water carries `BUOYANT` things downstream, which is a delivery mechanism and also a way to lose an item forever
- deep water and `HEAVY` items: it sinks, it is still there, you need something to get it back

## 2.3 Electricity

- `ELECTRIFIED` + `CONDUCTIVE` -> propagation through the network, however long the chain is
- `ELECTRIFIED` + `WET` `FLESH` -> much worse than dry flesh
- `ELECTRIFIED` + `INSULATING` -> stops, which is what makes rubber boots a solution
- `ELECTRIFIED` + `VOLATILE`/`SMOKING` gas -> ignition at range, no flame needed
- `CHARGED` + `CONDUCTIVE` path + `SWITCH` -> a circuit the player built
- `CHARGED` + `WATER` -> it discharges and is gone. Batteries have a lifespan and rain is an enemy.
- `MAGNETIC` + `CHARGED` + coil-shaped `CONDUCTIVE` -> motion. Motors, in principle, from parts.
- `MAGNETIC` + `FERROUS` -> retrieve a thing from a grate, disarm a guard, pull a hatch, ruin a compass

## 2.4 Structure and mass

- `HEAVY` dropped on `FRAGILE` -> breaks it, and the pieces are `SHARP`
- `HEAVY` on `PLATFORM` with insufficient support -> collapse, and everything under it is now involved
- remove a `RIGID` support -> load redistributes, then fails, then falls. Burning a load-bearing beam should collapse a building.
- `LEVER` + `FULCRUM` + `HEAVY` -> moves what you cannot carry
- `PULLEY` + `ROPE_LIKE` + `ANCHOR` -> lifts
- `INTERLOCKING` items -> stack stably, so you can build a staircase out of crates
- `TOP_HEAVY` + any nudge -> falls, and falls in a direction
- `TENSIONED` `ROPE_LIKE` + `TOOL_CUTTING` -> releases stored energy, drops whatever it held
- `WEDGE` + gap -> holds a door, or splits a log, depending on which way you drive it
- stacked mass on a surface with a limit -> the limit is a fact, not a trigger. Bridges have capacities.

## 2.5 Light, sound, and being noticed

- `LUMINOUS` -> agents see you at range, and so do things you would rather not meet
- `LUMINOUS` + darkness -> you can read `WRITTEN`, find small things, see a pit before you fall in it
- `LUMINOUS` at night -> attracts insects, which attracts what eats insects
- `LENS` + strong light -> `HOT` at a point. Fire without a flame.
- `MIRROR` + light -> redirect around a corner, blind a guard, signal an ally, aim a lens
- `LOUD` -> agents investigate, sleepers wake, birds scatter and give you away
- `LOUD` + unstable structure -> collapse, avalanche, the ceiling of a mine
- `LOUD` + `DECOY` placement -> agents go there instead of here, which is the whole distraction mechanic and needs no dialogue
- `RESONANT` + the right frequency -> glass breaks. Probably too fiddly, kept for the band 3 list.
- `ULTRASONIC` -> animals react, people do not. Herd livestock, empty a kennel.
- `SMOKING` -> blocks line of sight both ways, chokes `LIVING`, rises so it fills upper floors first
- silence: an absence, but agents notice when a mill stops turning

## 2.6 Smell and biology

- `SCENTED`/`BLOOD` -> predators track it, which means you can lead them somewhere
- `ROTTING` -> scavengers arrive, and they are a hazard that is also a distraction
- `PHEROMONE` -> herds and swarms move toward it. Move a herd through a gate, past a guard, over a bridge.
- `REPELLENT` -> the reverse, cheaper, less interesting
- `TOXIC` + `EDIBLE` -> delivered poison, which works on guards and dogs and anything that eats
- `SOPORIFIC` + `EDIBLE` -> the non-lethal version, which should generally be harder and better
- `CONTAGIOUS` + a crowd -> a spreading problem that behaves exactly like fire, sharing most of the system
- `SPORE` + damp dark -> growth that fills a corridor over time, sometimes `LUMINOUS`, sometimes `TOXIC`
- `MEDICINAL` + `TOXIC` -> the same plant at different doses, which is true and makes for good items
- `SEED` + `FERTILE` + `WATER` + time -> a tree, which is a `PLATFORM`, a `LADDER_LIKE`, a source of `FUEL`, and eventually an obstacle of its own

## 2.7 Social

- `VALUABLE` vs an agent's greed -> bribery, and the threshold is a fact about the agent
- `IDENTIFYING` matching a faction -> the agent treats you as one of theirs until something breaks the illusion
- `AUTHORITATIVE` -> agents defer, which is a different and better feeling than fighting
- `FRIGHTENING` vs an agent's courage -> flight, and where they flee to matters
- `INTOXICATING` given to an agent -> alertness falls over minutes, not instantly
- `SACRED` destroyed in view of an agent who cares -> permanent hostility, from a whole faction
- `PERSONAL` taken -> the owner recognizes it later. Selling stolen goods back to their owner should be possible and should go badly.
- `BEAUTIFUL` -> agents approach it, so it is a distraction that does not require noise
- `CHILDLIKE` -> some agents will not fight near it
- `ALIEN` in band 0 -> people react. Carrying a band 2 object into a village is a social event.

## 2.8 Chemistry

Kept deliberately small, because a full chemistry model is a different game.

- `OXIDIZER` + `FUEL` -> `EXPLOSIVE`, no explosive parent required
- `CORROSIVE` + `METAL` -> dissolves over time, quietly, which is the patient way through a grate
- `CORROSIVE` + `FLESH` -> exactly what you would expect
- `ADHESIVE` + two things -> they act as one object, mass adds, and it does not come apart
- `ANTISEPTIC` + `ROTTING` -> stopped
- quicklime analogue: a `GRANULAR` thing that becomes `HOT` when it meets `WATER`. A heat source that survives the rain and works underwater.
- `SALT` + ice -> melts, `SALT` + food -> preserved, `SALT` + soil -> nothing grows there again

## 2.9 Wind and weather

- wind + `FLAMMABLE` -> fire spreads faster and in one direction
- wind + `LUMINOUS` open flame -> blown out unless sheltered
- wind + `SCENTED` -> carried downwind, which tells you where to stand relative to a dog
- wind + `AERODYNAMIC` -> travels further, or is taken from you
- wind + `LIGHTER_THAN_AIR` -> goes where the wind goes, which is a delivery system with a mind of its own
- rain -> everything outdoors becomes `WET`, so the fire strategy stops working and the electricity strategy gets dangerous
- rain -> rivers rise, fords become impassable, and low ground floods
- snow -> tracks, cold, insulation, and a surface that shows where everyone has been
- lightning -> a free ignition source and a free `ELECTRIFIED` event, aimed at whatever is tallest and most `CONDUCTIVE`
- fog -> vision falls for you and for agents equally, which is not neutral because you know where you are going

---

# Part 3: Systems that could exist

Candidate modules for `sim/`. Each entry: what it reads, what it writes, what emerges, and roughly what it costs.

`fire` and the spatial hash it queries through are built. Everything else below is unwritten.

| System | Reads | Writes | Emerges | Cost |
|---|---|---|---|---|
| `fire` | `FLAMMABLE` `FUEL` `HOT` `WET` wind | `HOT`, destruction, `ASH`, `SMOKING` | most of the game | **built** as `sim/fire.ts`. `FUEL`, wind, `ASH` and `SMOKING` are what this table would still add |
| `thermal` | `HOT` `COLD` `CONDUCTIVE` `INSULATING` | temperature | cooking, thermal shock, survival | medium |
| `fluid` | `WATER` `POROUS` `BUOYANT` terrain height | `WET`, flow, level | flooding, soaking, drowning | high, do it coarsely |
| `electricity` | `CONDUCTIVE` `CHARGED` `INSULATING` `WET` | `ELECTRIFIED` | circuits the player builds | medium |
| `growth` | `SEED` `FERTILE` `WATER` light time | new entities | slow solutions, patience as a tool | low cost, high novelty |
| `structure` | `RIGID` `HEAVY` support graph | collapse | burning a wall drops a roof | high value, hard |
| `decay` | `ROTTING` `RUST` time `WET` | material change | the world ages during a run | low |
| `contagion` | `CONTAGIOUS` `LIVING` proximity | infection | a fire system for bodies | low, reuses fire |
| `scent` | `SCENTED` `BLOOD` wind | scent field | tracking, luring, hiding | medium |
| `sound` | `LOUD` occlusion | heard events | distraction, stealth | medium, big payoff |
| `light` | `LUMINOUS` occlusion | lit field | visibility both ways | medium |
| `optics` | `LENS` `MIRROR` `REFLECTIVE` | beams | fire from sunlight, signalling | low cost, feels magic |
| `magnetism` | `MAGNETIC` `FERROUS` | forces | retrieval, disarming | low |
| `chemistry` | `OXIDIZER` `FUEL` `CORROSIVE` `ADHESIVE` | property change | explosives from parts | low if kept small |
| `pressure` | `PRESSURIZED` `SEALING` `HOT` | rupture | boilers, canisters, hissing | low |
| `wind` | region wind vector | modifies fire, scent, sound | direction matters | very low, do it early |
| `weather` | band, time | rain, fog, snow, storm | strategies stop working | medium |
| `ecology` | drives, `EDIBLE` `CARRION` | agent movement | a world that moves without you | medium |
| `economy` | `VALUABLE` `LEGAL_TENDER` agent greed | trades | bribery, markets | low |
| `reputation` | witnessed acts, factions | disposition | consequences that follow you | medium |
| `terrain` | `TOOL_DIGGING` `EARTH` | heightfield edits | tunnels, ditches, dams | high, defer |
| `friction` | `SLIPPERY` `ABRASIVE` | movement | ice, mud, oil slicks | low |
| `stacking` | `INTERLOCKING` `PLATFORM` `HEAVY` | stable placements | player-built structures | medium, mostly Rapier |
| `time` | tick count | day, night, seasons? | patience as a mechanic | low |

**Order of implementation, if it were up to this document:** wind before fire (one vector, changes everything), fuel-vs-flammable split before fire, sound before agents get complicated, growth early because it is cheap and nothing else in the genre does it, structure last because it is the hardest.

---

# Part 4: Items

Illustrative pools. Not a catalog. The purpose is breadth: when the bake needs 200 band 0 items, this is the raw list to sharpen, not the finished thing.

Properties are given only where they are not obvious.

## 4.1 Band 0: Hearth

**Wood and plant.** branch, log, kindling, plank, beam, stake, dowel, barrel stave, wicker basket, broom, besom, hay bale, straw bundle, thatch bundle, reed bundle, birch bark (`FLAMMABLE` even wet), pine resin (`ADHESIVE` `FLAMMABLE`), oak gall (`CORROSIVE` mild, ink), sawdust (`GRANULAR` `FLAMMABLE`), charcoal (`FUEL` high, `FLAMMABLE` low), firewood, fence rail, cart axle, ladder rung, wheel, yoke, hoe handle

**Stone and earth.** flint nodule, river cobble, whetstone, millstone fragment, grindstone, slate shingle, chalk (`WRITTEN` enabler), clay lump, fired brick, quicklime (heat with water), sand, gravel, iron ore, salt block, ash pile, peat brick (`FUEL` `SMOKING`)

**Metal.** iron nail, horseshoe, sickle, scythe blade, billhook, axe head, hammer head, chisel, awl, needle, fish hook, chain length, iron hoop, cauldron, trivet, tongs, plough share, key blank (`FERROUS`, not a key), bell (`LOUD` `RESONANT`), lock plate, hinge, latch, cowbell, brand iron (`IDENTIFYING` when hot), scrap tin

**Cloth and hide.** linen rag, wool fleece, blanket (`INSULATING`), sack, tarp, hemp rope, twine, fishing net, leather strap, boot, glove, hooded cloak, apron, sail cloth, bandage, wick cord, felt pad, saddle, harness

**Vessels.** wooden bucket, clay jar, sealed crock, glass bottle, waterskin, tin cup, cooking pot, churn, funnel, beehive skep, birdcage, lantern, oil flask, bellows, sieve, colander, ladle, cask

**Food and drink.** apple, turnip, onion, wheat sheaf, flour sack, bread loaf, cheese wheel, salt pork, smoked fish, honeycomb (`ADHESIVE` `EDIBLE`), beer jug (`INTOXICATING`), cider, milk pail, eggs, mushrooms (some `TOXIC`), berries (some `TOXIC`), herbs (`MEDICINAL`), nettles, garlic (`REPELLENT` to something), lard, tallow

**Growing things.** acorn, apple pip, wheat seed, bean seed, oak sapling, potted herb, ivy cutting (`ROPE_LIKE` when grown), thorn cutting, mistletoe (`SACRED`), fungus bracket, moss, wildflower bunch (`BEAUTIFUL`), turf sod

**Fire.** live ember, tinder box, flint and steel, tallow candle, rush light, pitch pot, torch, oil lamp, brazier, hot stone, coal lump, sulphur (`OXIDIZER`, if band 0 will take it), fatwood

**Social and made things.** silver coin, copper penny, brooch, wedding ring (`PERSONAL` `VALUABLE`), carved icon (`SACRED`), church key (heavy, iron, not a puzzle key), sealed letter (`WRITTEN` `PERSONAL`), tally stick, hunting horn (`LOUD` `SIGNAL`), drum, whistle, fiddle, doll (`CHILDLIKE`), toy horse, dice, playing cards, ledger, painted sign, wanted notice, grave marker (`MOURNFUL` `SACRED`), guild badge (`IDENTIFYING`), militia helm (`AUTHORITATIVE`)

**Livestock and creatures as items or entities.** chicken, goose, goat, pig, sheep, dog, cat, ox, donkey, beehive, fish in a bucket, caged songbird, dead rabbit (`CARRION` `EDIBLE`), wasp nest, adder (`VENOMOUS`)

**Structure and furniture.** crate, pallet, ladder, door, shutter, bench, trestle table, cartwheel, handcart, wheelbarrow, well bucket on a rope, gate, stile, hurdle fence, scaffold pole, roof beam, tombstone

## 4.2 Band 1: The Turn

The catalog roughly doubles here. Everything modern arrives without comment.

**Power and electrical.** car battery (`CHARGED` `CORROSIVE`), torch battery, jumper cables, extension cord, light bulb, fluorescent tube (`FRAGILE` `TOXIC`), fuse, breaker, transformer, copper wire spool, electric fence unit, generator, solar lamp, radio, walkie talkie, cattle prod, doorbell, alarm clock (`TIMER`), egg timer, car horn (`LOUD`)

**Fuel and chemicals.** jerrycan of petrol, diesel can, engine oil, brake fluid, propane cylinder (`PRESSURIZED`), butane lighter, aerosol can (`PRESSURIZED` `VOLATILE`), fertilizer sack (`OXIDIZER`), weedkiller (`TOXIC`), bleach, drain cleaner (`CORROSIVE`), paint tin, thinner, antifreeze (`TOXIC` `EDIBLE`, cruel and true), grease gun, road flare (`FLASH` `HOT`), matches

**Vehicles and parts.** bicycle, moped, sedan with keys in it, tractor, trailer, wheelbarrow, shopping trolley, jack, tyre, inner tube (`ELASTIC` `LIGHTER_THAN_AIR` when filled), wheel rim, exhaust pipe, radiator, seat belt (`ROPE_LIKE`), windscreen (`GLASS` `TRANSPARENT`), fuel hose (`PUMP` with a mouth), spark plug, engine block (`HEAVY`)

**Tools.** crowbar, hacksaw, angle grinder, drill, chainsaw, bolt cutters, sledgehammer, shovel, pickaxe, wire cutters, screwdriver, wrench, blowtorch, welding rod, tape measure, spirit level, ladder (aluminium), stepladder, scaffold tube, clamp, vice, duct tape (`ADHESIVE`, the universal merge input), zip ties, rope (nylon), ratchet strap, tarpaulin, wheelbarrow

**Domestic.** kettle, microwave, fridge door, mattress, umbrella, plastic chair, bin bag, bucket (plastic), mop, hosepipe, sprinkler, garden gnome, birdfeeder, lawn mower, pesticide, matches, candles, first aid kit (`MEDICINAL`), aspirin, sleeping pills (`SOPORIFIC`), vodka bottle (`INTOXICATING` `FLAMMABLE`), cigarettes, lighter fluid

**Information and social.** road sign, hi-vis vest (`IDENTIFYING` `AUTHORITATIVE`), hard hat, clipboard (`AUTHORITATIVE`, absurdly effective), ID card, banknote (`LEGAL_TENDER`), lottery ticket, map (paper), road atlas, camera, film roll (ruined by light or radiation), cassette tape (ruined by `MAGNETIC`), newspaper, mobile phone (`LUMINOUS`, no signal ever), payphone handset, key fob, padlock, chain and padlock

**Infrastructure.** powerline pylon, transformer box, streetlight, traffic light, manhole cover (`HEAVY`, needs `TOOL_PRYING`), storm drain grate, culvert pipe, fire hydrant, petrol pump, phone box, bus shelter, fence panel, barbed wire, chain link, concrete bollard, speed bump, level crossing

## 4.3 Band 2: Rust

Everything here is a worse version of something that used to work.

**Salvage.** rebar, scrap plate, corrugated sheet, cable drum, burnt-out engine, pipe section, valve wheel, pressure gauge, respirator (`WEARABLE`, filters `SMOKING` and `TOXIC`), gas mask filter (expires), geiger counter, dosimeter, lead sheet (blocks `RADIOACTIVE`), hazmat suit, welding mask, riot shield, helmet, body armour, rope ladder, climbing harness, carabiner, piton, crampons

**Power gone bad.** dead battery bank, capacitor (`CHARGED`, dangerous), solar panel (cracked), fuel cell, wind turbine blade, cable spool, live wire in water, substation, backup generator with no fuel, hand crank dynamo

**Chemical and dangerous.** unstable canister, oxygen tank, acetylene bottle, ammonium sack, mercury (`TOXIC` `HEAVY` `LIQUID`), spent fuel rod (`RADIOACTIVE`), medical waste (`CONTAGIOUS`), industrial solvent, foam extinguisher, sand bucket, thermite (if the chemistry system exists, this falls out of `OXIDIZER` plus metal powder rather than being authored)

**Biological.** rat, dog pack, crow flock, feral pig, tunnel fish (blind, `EDIBLE`, possibly `TOXIC` depending on what it ate), fungal bloom (`SPORE` `LUMINOUS`), rust wasps, carrion beetles, mould colony, contaminated water, dried rations, seed vault packet (`SEED` at high quality, genuinely valuable)

**Structures and hazards.** collapsed overpass, elevator shaft, counterweight, flooded stairwell, subway carriage, escalator, scaffolding, crane, cooling tower, cracked dam, sinkhole, unstable floor, glass curtain wall, roof access hatch, fire door (`SEALING`, holds back fire and smoke), sprinkler system with pressure left in it

**Social.** scavenger token (`LEGAL_TENDER` in one camp only), faction rag (`IDENTIFYING`), radio codebook (`WRITTEN`), ration card, shrine of junk (`SACRED`), memorial wall (`MOURNFUL`), painted territory mark, a child's drawing (`CHILDLIKE`, and finding one here should land badly)

## 4.4 Band 3: The Static

Fewer items, and they are quieter. Descriptions get shorter here, not longer. Every item still obeys the property simulation exactly.

- a door with no wall, which is still `RIGID` and still `SEALING` when closed
- a length of rope that is warm at one end
- a jar of something that is `COLD` and does not get warmer
- a stone that is `HEAVY` only while you are looking at it
- a lamp that is `LUMINOUS` and casts no light on anything but you
- a key for nothing, `FERROUS`, `PERSONAL`, and someone will want it
- a photograph of this room, taken from where you are standing
- a bell that is `LOUD` in the next region rather than this one
- a coat that is `WEARABLE` and `IDENTIFYING` as a faction that does not exist
- water that is `WATER` but does not extinguish anything
- a seed that grows into a copy of the last thing you burned
- a container that is larger inside, which is only a property with a bigger number
- an item that is `ALIEN(1.0)` and `FAMILIAR(1.0)` at once, which the social system has to handle without crashing
- a nail that is `HOT` when the region is quiet
- a mirror that reflects light but not you
- a chair, entirely ordinary, in a place where no ordinary thing should be. `FAMILIAR(1.0)` as a hostile act.
- a tape that is `WRITTEN` in a way you cannot read but an agent can
- bread that is `EDIBLE`, `NUTRITIOUS`, and `MOURNFUL`
- a wheel that turns the ground rather than itself
- ash from a fire that has not happened yet

**Design constraint, repeated because it is the one that gets broken:** every item above has honest properties and behaves consistently under every system. The strangeness is in what the properties are, never in the rules bending for them.

---

# Part 5: Merges

Merges are baked from derivation rules, not authored. These are targets. If the rules produce something recognizably like these results without knowing the item IDs, the rules are good.

## 5.1 Merge archetypes

The shapes that most good merges take. Worth encoding as emergent rules, since each covers hundreds of pairs.

| Archetype | Rule shape | Examples it covers |
|---|---|---|
| Head plus haft | `SHARP` or `HEAVY` plus `RIGID` rod -> `TOOL_*` with a bonus | axe, hammer, spear, hoe, mace |
| Fuel plus wick | `FLAMMABLE` plus `POROUS` cord -> longer burn, controllable flame | candle, lamp, torch |
| Fuel plus vessel plus rag | `FLAMMABLE` liquid plus `CONTAINER` plus `WICK` -> `PROJECTILE` `EXPLOSIVE` | the obvious one |
| Binder plus two things | `ADHESIVE` or `ROPE_LIKE` -> the two act as one object | lashing, taping, gluing |
| Container plus content | `CONTAINER` plus anything -> carries it, applies it on break | jar of bees, bucket of water |
| Blade plus abrasive | `ABRASIVE` plus `SHARP` -> sharper | whetstone on anything |
| Cloth plus liquid | `POROUS` plus liquid -> a soaked thing that carries the liquid's properties | oiled rag, wet blanket |
| Rigid plus rigid | -> longer, or a frame, or a `LADDER_LIKE` | poles lashed into a ladder |
| Seed plus medium | `SEED` plus `FERTILE` or `WATER` -> a planted thing with a timer | |
| Mass plus rope | `HEAVY` plus `ROPE_LIKE` -> pendulum, anchor, grapple, flail | |
| Oxidizer plus fuel | -> `EXPLOSIVE` from two innocent parents | the best surprise in the system |
| Toxin plus food | `TOXIC` plus `EDIBLE` -> a delivery mechanism | works on any agent that eats |
| Identity plus wearer | `IDENTIFYING` plus `WEARABLE` -> a disguise | |
| Light plus lens | `LUMINOUS`/sunlight plus `LENS` -> `HOT` at range | |
| Cold plus liquid | `COLD` plus `WATER` -> `PLATFORM` that expires | |
| Insulator plus wearable | -> survival gear | |
| Noise plus timer | `LOUD` plus `TIMER` -> a distraction you are not standing next to | the merge that makes plans possible |
| Two of the same | -> more of it, or a bigger version, or a bundle | should never be a dead end |

## 5.2 Concrete merges worth checking the rules against

Grouped by what they teach.

**Band 0, obvious and satisfying.**
branch + flint -> hand axe. branch + rag -> torch head. torch head + ember -> lit torch. rag + oil -> oily rag. oily rag + bottle -> firebomb. rope + hook -> grapple. rope + plank -> rope ladder. plank + plank -> longer plank, or a raft with enough of them. crate + crate -> a stack you can climb. bucket + water -> the thing you throw at a fire. flint + steel -> reliable ignition. straw + ember -> a fire you regret. sickle + whetstone -> sharper sickle. nail + plank -> a board with a spike, which is a `TRAP`. wax + cord -> candle. clay + fire -> pot. sand + fire -> glass. glass + hammer -> shards, which are `SHARP` and also `FRAGILE`. honeycomb + cloth -> sticky cloth. beehive + rope -> a thing you can lower onto someone. herb + water -> medicine, weak. herb + alcohol -> medicine, strong, and `INTOXICATING`. mushroom + bread -> food, or poison, depending on the mushroom, and the player should have to find out.

**Band 0, less obvious.**
salt + water -> brine, which preserves and also kills a field. ash + water + fat -> soap, which is `ANTISEPTIC` and `SLIPPERY` and a fine trap. chalk + water -> paint, `WRITTEN` enabler. oak gall + water -> ink. bell + rope -> an alarm you install rather than carry. sapling + fertile earth -> a tree in twenty minutes of real time, which is a solution you set up and walk away from. horn + tar -> a lantern pane. fleece + oil -> waterproof, `INSULATING` even when wet. net + weights -> a thrown net. dead rabbit + sun -> `CARRION`, which is a lure. dog + food -> a follower, if agents can be won rather than owned.

**Band 1, the arrival of chemistry and current.**
battery + wire -> a live circuit. battery + wire + wool -> ignition without flame. petrol + bottle + rag -> the obvious. fertilizer + fuel -> the thing the chemistry system produces without anyone authoring it, and which should be genuinely dangerous to carry. aerosol + lighter -> a directional flame. propane + fire -> a very short conversation. duct tape + anything + anything -> the universal binder, and it should feel like it. jumper cables + fence -> the fence is now the hazard. hosepipe + tank -> a siphon. inner tube + fork -> a slingshot. car + rope -> a way to pull a wall down. tyre + fire -> smoke you can see from the next region. bleach + ammonia -> `TOXIC` gas, which the chemistry system gives you for free and which should be discoverable and awful. sleeping pills + food -> a guard asleep at his post. hi-vis vest + clipboard -> the strongest disguise in band 1, and it should work, because it works.

**Band 2, scarcity and consequence.**
rebar + rebar -> a longer bar, which is a lever, which moves a slab. respirator + filter -> breathable air, for a while. lead sheet + cloth -> a `WEARABLE` that is `HEAVY` and blocks `RADIOACTIVE`. capacitor + wire -> one enormous discharge. crank dynamo + anything electrical -> power without fuel. geiger counter + nothing -> information, which is a legitimate merge output. seed packet + fertile soil -> the only thing in the band that grows on purpose. faction rag + faction rag -> a bigger claim, or a lie. contaminated water + filter -> water, mostly.

**Band 3, where results stop being reassuring.**
warm rope + cold jar -> something with a temperature it should not have. photograph + mirror -> two of the same room. bell + region -> unclear, and the codex entry should just say what happened. seed + ash -> whatever burned, again. key for nothing + door with no wall -> exactly what you expect and none of what you want.

## 5.3 Junk outcomes

"Always yields" means junk is a real result. Junk should still be honest.

- **Lump.** Both parents' materials blended, no functional properties survived. Heavy, useless, still `FUEL` if it was wooden. Should be sellable, because even junk is `VALUABLE(0.05)`.
- **Ruined.** One parent's function survives at a fraction. A sickle merged with a millstone is a sickle that barely cuts.
- **Contaminated.** The merge picked up `TOXIC` or `ROTTING` from somewhere. Still `EDIBLE`, and that is the joke.
- **Fused mess.** `ADHESIVE` in the mix, and now it is one object that does two things badly.
- **Ash and slag.** Both parents were `HOT` and `FLAMMABLE`. The result is what is left.

The rule: junk is never "nothing happens". The player made a bad bet and got a thing. The thing goes in the codex so the bet is never made blindly twice.

## 5.4 Merge outcomes that are not simple items

Worth considering, all of them risky.

- **A merge that produces a creature.** `LIVING` plus `SEED` plus something. Probably a band 3 exclusive.
- **A merge that produces terrain.** A big enough `EARTH` result is a mound, not an item.
- **A merge that produces two things.** Violates "exactly one output". Do not. Listed to be crossed off.
- **A merge with a delay.** The output appears after a timer, and the inputs are gone immediately. Preserves the rule, adds tension.
- **A merge that produces something that immediately acts.** `EXPLOSIVE` at 1.0 could simply detonate on the bench. The player made it, the player owns the consequence.
- **Breaking as the inverse of merging.** Not unmerging: a `FRAGILE` item destroyed by force yields fragments with a subset of its properties. That is a different operation with different rules, and it does not return the parents. It is legal.

---

# Part 6: Obstacles

The heart of it. Each entry is a set of facts. Solutions are listed to prove the fan exists, and none of them should be authored anywhere in code.

## 6.1 The template

State facts, never intentions. A fact is something a system already reads. If you have to invent a property to describe an obstacle, that is fine, but then something else in the world should carry that property too.

## 6.2 Terrain

**A river, 8m wide, 2m deep, moderate flow.**
`WATER`, cold, carries `BUOYANT` things downstream.
Bridge with `PLATFORM`. Fell a tree across. Freeze it with `COLD`. Dam it upstream with `GRANULAR` or a collapsed structure. Float across on anything `BUOYANT` and large. Swim, and lose everything `HEAVY`. Wade at a shallow point if one exists. Cross on a `WHEELED` thing with momentum. Rope across from two `ANCHOR` points. Wait for a dry season if there is one. Divert it by digging.

**A ravine, 12m across.**
No `WATER`, high fall damage.
Nothing spans it in one piece, so the solution has to be assembled or found. `ROPE_LIKE` plus `ANCHOR` plus `HOOKED`. Collapse the near wall into it. Fell something tall. Find where it narrows. Build down instead of across.

**A bog.**
`WATER` plus `EARTH`, slows movement, swallows `HEAVY` things, hides what is in it.
Lay `PLATFORM` objects. Freeze it. Drain it. Go around. Drop something `HEAVY` and step on it. Burn the dry reeds first, which reveals the firm ground.

**A cliff, 15m.**
`RIGID` `STONE`, vertical.
`LADDER_LIKE`. Grapple. Stack. Grow something. Collapse part of it into a ramp. Find the watercourse that cut it. Have something `LIGHTER_THAN_AIR` do the work.

**A scree slope.**
`GRANULAR`, `SLIPPERY`, `LOUD` when disturbed, and the noise brings something.
Cross slowly. Cross at night. Cross loudly on purpose, elsewhere. Stabilize it with water. Wait for frost.

## 6.3 Structures

**A guarded wooden palisade on the far bank of a river.**
The worked example in `docs/DESIGN.md`. Not repeated here.

**A stone wall, 5m, unguarded, no gate on this side.**
`STONE(1)` `RIGID(0.95)`, mortar `POROUS`.
Over it with `LADDER_LIKE` or stacked `PLATFORM`. Through it with `EXPLOSIVE` or sustained `TOOL_STRIKING` at the mortar. Under it with `TOOL_DIGGING`, if the ground is `EARTH`. Grow ivy up it and climb. Freeze water in the mortar joints and let ice do the work over time. Drive something `WHEELED` and `HEAVY` into it. Find where a tree root has already cracked it.

**A door, oak, barred from the other side.**
`WOODEN(0.9)` `FLAMMABLE(0.5)` `RIGID(0.8)`, hinges `FERROUS` and on this side.
Burn it. Chop it. Pry the hinges. Pry the boards. Break a panel and reach through, which needs an arm and a light. Lift the bar with something thin through the gap. Knock and see who answers. Go through the wall next to it, which is usually weaker than the door.

**A portcullis.**
`METAL` grid, `HEAVY(1)`, gaps 15cm, counterweight mechanism somewhere above.
Lift it with `LEVER` plus `FULCRUM`, or `PULLEY`. Cut it with anything that beats hardened iron, which is rare. Corrode it over time. Find the counterweight and cut its rope. Reach through the gaps with something long. Send something small through the gaps, if you have something small and `LIVING` that will do what you want. Wait for it to be raised and jam it with a `WEDGE`.

**A collapsed tunnel.**
`STONE` rubble, unstable, `HEAVY`, air beyond unknown.
Dig, slowly, and risk collapse. Shore it with `RIGID` `PLATFORM` as you go. Blow it, and probably make it worse. Find the ventilation shaft, which exists because tunnels need air. Flood the low side and float debris out, which is absurd and might work.

**A sealed vault door.**
`METAL(1)` `RIGID(1)`, no visible mechanism, hinges internal.
This one should be genuinely hard, and the solution should be "not through the door". The wall, the ceiling, the floor, the ventilation, the power supply to whatever holds it shut, or the person who knows how it opens.

**A dead elevator shaft, 8 floors.**
Vertical, `METAL` cables intact, counterweight present, no power.
Climb the cables if you have `HOOKED` or grip. Restore power. Cut the counterweight and ride it, which is a wonderful idea and should mostly kill you. Use the maintenance ladder, which is rusted at floor 3. Fill the shaft with water and swim up, if you have the water. Descend instead.

**A window, 4m up, shuttered.**
Reachable with `LADDER_LIKE`. Openable with `TOOL_PRYING`. Breakable, `LOUD`. Reachable by growing something. Reachable from the roof of the next building. Reachable if the cart under it were moved.

## 6.4 Environmental

**A wall of fire across a corridor.**
`HOT(1)`, consuming `FLAMMABLE` floor, `SMOKING`.
Put it out with `WATER` or `GRANULAR`. Starve it by removing fuel ahead of it. Soak yourself and run, taking damage. Wait, if you can afford the time and the fire has limited fuel. Go around through the smoke, which is its own hazard. Let it burn through and cross the ash.

**A flooded corridor, ceiling clearance 20cm.**
Drain it. Pump it. Freeze it and walk. Swim it and lose anything not `SEALING`. Break a wall to let the water go somewhere lower. Raise yourself on something `BUOYANT`. Find the level above.

**A pocket of `TOXIC` gas, heavier than air, in a cellar.**
`TOXIC`, settles low, sometimes `VOLATILE`.
Ventilate with `BELLOWS` or by opening a second door. Wear a filter. Ignite it deliberately from a distance, which clears it and destroys everything in the cellar. Displace it with water. Hold your breath and be quick, which should be a real option with a real cost.

**Total darkness.**
`LUMINOUS` of any kind. Fire, which is also risk. Phosphorescent fungus. A lens and a beam of daylight from a hole. Learn the room in one flash and move in the dark. Send something that does not need light.

**Lethal cold.**
`INSULATING` wearables. A fire, if there is fuel. `STIMULANT`. Move fast and do not stop. Shelter and wait for the weather system to turn. Something `HOT` carried, which is why hot stones are in the item list.

**A radiation zone.**
`RADIOACTIVE` field, strongest at a source.
Shield with `DENSE`. Cross quickly, take the dose. Shift the source with something long. Bury it. Go around. Note that food and seeds carried through are ruined, which is a cost that is not damage.

## 6.5 Social

**A tollman on a bridge.**
Agent, greed 0.7, alertness 0.5, courage 0.3, faction: village.
Pay with `VALUABLE`. Overpay and gain disposition. Get him drunk with `INTOXICATING`. Distract with `LOUD` elsewhere. Frighten with `FRIGHTENING`, and lose the village. Impersonate with `IDENTIFYING` or `AUTHORITATIVE`. Wait for his shift to end, because agents have routines. Cross the river elsewhere, which is the point: he is a fact about the bridge, not about the river.

**A checkpoint with two guards and a queue.**
Two agents, a crowd, a fact that everyone is being looked at.
Join the queue with nothing `CONTRABAND`. Cache your contraband and come back for it. Create a `LOUD` event, and the queue becomes cover. Give one guard something `VALUABLE` where the other cannot see. Wear the uniform. Send the herd through first. Arrive with something `AUTHORITATIVE` and be waved past.

**A hostile camp between you and the gateway.**
Six agents, drives include territory and hunger, a fire, stores of `EDIBLE`.
Sneak at night with no `LUMINOUS`. Poison the stores. Set the wind-side of the camp on fire and go through the gap. Trade, because some of them will. Frighten them with something `ALIEN`. Lead a predator to them with `SCENTED` bait. Wait for them to sleep, which they do, because agents have routines. Fight, which is allowed and rarely best.

**A dog on a chain.**
`LIVING`, hearing high, smell high, chain `FERROUS` `RIGID`, anchored.
Feed it. Feed it something `SOPORIFIC`. Stay downwind. Cut the chain and deal with a loose dog. Distract with `ULTRASONIC`. Befriend it over multiple visits, which requires agents to have memory. Kill it, and if anyone sees, that is a social fact now.

**A funeral in the square you need to cross.**
Crowd, `MOURNFUL`, high sensitivity to anything `TABOO`.
Wait. Cross respectfully, slowly. Go around. Interrupt it and be remembered for the rest of the run. Join it, if you are dressed for it.

**A market gate that only admits traders.**
`IDENTIFYING` as a trader. Carry enough `VALUABLE` to be plausible. Bribe. Enter with the cart that is going in anyway. Enter over the wall, which is a different obstacle.

## 6.6 Biological

**A thorn wall.**
`PLANT` `SHARP` `FLAMMABLE(0.4)`, dense, regrows.
Burn it, which is loud and visible. Cut it, slowly, and take damage. Lay something `PLATFORM` over it. Wear `LEATHER`. Kill it at the root with `SALT` or `TOXIC`. Wait for winter. Have an animal eat through it.

**A hornets' nest above a doorway.**
`LIVING` swarm, triggered by vibration or smoke or noise.
Smoke them out, calmly. Burn it, and get stung. Knock it down and run. Come at night, when they are still. Use it: knock it down somewhere else, onto someone else.

**A fungal bloom filling a corridor.**
`FUNGAL` `SPORE` `TOXIC(0.3)` `LUMINOUS(0.4)`, spreads in the damp.
Burn it, which releases `SPORE` and makes it worse. Dry the corridor and it recedes. Cut through and be contaminated. Wear a filter. Harvest it, because it is `LUMINOUS` and free light is worth something.

**A predator with a territory.**
Hunting drive, `SCENTED` tracking, territory bounds, hunger level.
Feed it elsewhere. Mask your scent. Be upwind. Lead it into a trap the world already contains. Give it something else to hunt. Cross its territory when it is fed, which requires observing it. Fight it, which is the worst option and always available.

## 6.7 Mechanical

**A drawbridge, raised, mechanism on the far side.**
`WOODEN` `HEAVY`, chains `FERROUS`, winch across the gap.
Cut the chains with something at range, and it falls. Weight the far end. Reach the mechanism with something long. Burn the chains' anchor points. Freeze the mechanism. Send something across that can turn a winch.

**A generator with no fuel.**
Fuel it with anything `FUEL` and liquid. Crank it by hand. Replace it with a different `CHARGED` source. Bypass what it powers. Decide the thing does not need power after all, and open it another way.

**A rusted hatch.**
`RUST` `METAL` `RIGID`, seized.
`TOOL_PRYING` with a lever long enough. Heat it so it expands, then cool it. Lubricate with `OIL`. Break it, because `RUST` is weaker than the metal was. Corrode it further and wait.

**A pressure door held by a working system.**
`PRESSURIZED` on one side, `SEALING`.
Equalize the pressure, which means finding where the other side vents. Cut the power to the pump. Break the seal, violently, and be somewhere else when it goes. Enter through the part of the system that is not a door.

## 6.8 Band 3 obstacles

Still honest, still property-driven, and the strangeness is in the facts rather than the rules.

- **A corridor that returns you to its entrance.** Fact: the exit's position is a function of something in the region. Find the something. It could be light, or sound, or what you are carrying.
- **A door that is open only in the dark.** Fact: its `SEALING` is a function of local light. Every light-based tool you own is now a liability, and that inversion is the puzzle.
- **A room where sound does not carry.** All `LOUD` solutions fail. Everything else still works, which is the point.
- **A bridge that holds only what does not belong here.** Fact: load capacity reads `ALIEN` rather than mass. The band 2 junk in your bag is suddenly the answer.
- **A wall that is `FLAMMABLE` only while nothing is watching it.** Set the fire, look away, and trust it.
- **A room that repeats with one property changed each time.** The player has to notice which one. This is a property-inspection puzzle and it is only possible because the game has an inspector.
- **A gateway that will not open while you are carrying anything `PERSONAL`.** A toll paid in attachment.
- **Stairs that only go down.** Fact about the region's connectivity, not about the stairs.

---

# Part 7: Situations and set pieces

Top-down. Scenes with a shape, built out of the systems above. These are the things a region generator could be asked to place, and the reason to build a system is often that it makes one of these possible.

**The mill and the millpond.** A working mill, a sluice gate, a pond above and a stream below. Open the sluice and the wheel turns, which powers a millstone, which grinds, which is `LOUD`, which covers something. Or the pond drains, and what was under it is now reachable. Two solutions to two different problems from one lever.

**The burning granary.** A fire starts, by you or by chance. The village fights it. If it burns, the village starves later in the run and their disposition drops permanently. If you help, they open doors that were closed. Nobody says any of this out loud.

**The bull in the field.** The shortest route crosses a field with a bull. The bull is `LIVING`, territorial, and charges anything moving fast. It is also a solution to the wall on the far side, if you can point it in the right direction.

**The beekeeper's row.** Twelve hives. Honey is `EDIBLE` and `ADHESIVE` and `VALUABLE`. Bees are a weapon, a hazard, and a livelihood. Taking one hive is theft. Taking all twelve is an event.

**The flooded ford.** Passable in dry weather, impassable in rain. Teaches that the weather system exists and that waiting is a legitimate move.

**The pylon.** Band 1. A powerline crosses a valley. The pylon is `LADDER_LIKE` and `CONDUCTIVE` and `ELECTRIFIED` and 40m tall. Climbing it is the fastest way across and the fastest way to die.

**The sedan with the keys in it.** Band 1. It is `WHEELED`, it has `FUEL`, it is a ram, a generator, a shelter, a source of battery and wire and glass and a mirror, and it is the single richest item in the band. Most players will drive it into something. Both readings are correct.

**The petrol station serving an ox-cart village.** Band 1's thesis in one location. Fuel, in quantity, next to a place where nobody knows what it is for.

**The supermarket.** Band 1 or 2. Everything is `EDIBLE` and most of it has rotted. The freezers are dark. What is left is `PRESERVED`, and the shelves are `PLATFORM` and the trolleys are `WHEELED`.

**The counterweight.** Band 2. An elevator car at the top, a counterweight at the bottom, a cable between. Cut the cable and something falls. Ride either end. The physics is real, so the plan can be real.

**The dam with a crack.** Band 2. It holds a lake above a valley you need to cross. Widening the crack drains the lake and floods the valley. Both maps are traversable. Neither is the same afterward.

**The scavenger market.** Band 2. Agents who trade rather than fight. `VALUABLE` and `LEGAL_TENDER` both work but not equally. The only place in the band where being carefully dressed matters.

**The metro tunnel.** Band 2. Flooded at one end, dark throughout, `SPORE` in the damp sections, and a stalled train that is a series of `SEALING` `CONTAINER` rooms strung together.

**The room with your own footprints in it.** Band 3. No mechanism, no solution, nothing to do. Not every place needs to be a puzzle.

**The house that is the house from band 0.** Band 3. The same generated layout, the same furniture, all the properties intact, and one thing different. Players who remember will look for it.

**The last gateway.** Whatever is furthest out. It should be a place, not a boss.

---

# Part 8: Agents, creatures, and factions

## 8.1 Drives

An agent is a bag of properties plus a bag of drives. Drives are scalars too, and they compete each tick. No behavior trees with named states if it can be avoided.

`hunger` `fear` `greed` `curiosity` `territory` `loyalty` `fatigue` `pain` `duty` `grief`

Perception: sight cone and range, hearing radius modified by occlusion, smell modified by wind. Memory: what they have seen, who did it, how long ago.

Property reactions that need no per-creature code:
- approaches `EDIBLE` when `hunger` is high, and approaches faster if `SCENTED`
- flees `FRIGHTENING` scaled against courage
- approaches `BEAUTIFUL` and `LUMINOUS` out of `curiosity`
- investigates `LOUD` at its source, then loses interest
- accepts `VALUABLE` against `greed`, with a threshold
- defers to `AUTHORITATIVE` against `duty`
- attacks what threatens `territory`
- avoids `HOT` and `ELECTRIFIED` and standing in water when there is current nearby, because self-preservation is just another drive

## 8.2 Band 0 bestiary and cast

Sheep, goat, pig, ox, chicken, goose (`LOUD` and genuinely hostile), dog, sheepdog, farm cat, rat, crow, bees, wasps, adder, boar, deer, fox, mill horse.

People: miller, smith, priest, tollman, shepherd, drunk, children, militia, thatcher, beekeeper, widow, traveling trader, night watch.

## 8.3 Band 1

Chained dogs, dairy herd in a truck, security guard with a torch, motorist, farmhand with a tractor, pest control van, wasps in a substation, pigeons, road crew in hi-vis, a bus driver on an empty route.

## 8.4 Band 2

Scavengers (trade or fight, depending on disposition), dog packs (real pack behavior falls out of drives plus flocking), rats in numbers, feral pigs, crows that follow you because you produce `CARRION`, rust wasps, blind tunnel fish, a lone trader, a drone with a light, someone else's dog that has been waiting a long time.

## 8.5 Band 3

Mostly not creatures. Things that occupy space and have drives that do not map to hunger or fear. Suggestions: something that follows at a fixed distance and never closes. Something that takes one item from the ground each time you leave a room. Something that is only present in reflections but is `HEAVY` enough to trip a pressure plate. A person, entirely ordinary, doing something ordinary, in the wrong place.

## 8.6 Factions

Faction is a tag with a disposition per player, moved by witnessed acts. Keep the list short: village, militia, church, traders, scavengers, and whatever band 3 has instead. `IDENTIFYING` and `CONTRABAND` and `TABOO` all need a faction reference, so factions have to exist before those properties do.

---

# Part 9: Time, weather, and world clocks

Things that change without the player.

- **Day and night.** Light, agent routines, temperature, what is awake.
- **Weather.** Rain, fog, wind direction and strength, snow, storm. Wind first, because it is one vector and it improves fire, sound, and scent all at once.
- **Fire that keeps burning.** A fire you start in minute 3 is still consuming the region in minute 40. That is the best argument for regions being bounded and fully in memory.
- **Growth.** Plants you started. Trees take real time, which makes the plant-and-return solution meaningful.
- **Rot and rust.** Food spoils, metal weakens. A rusted grate is a solution that arrives on its own if you can wait.
- **Tide, if there is a coast.** A cyclical obstacle that is also a cyclical solution.
- **Agent routines.** Shifts change, people sleep, herds are driven in at dusk. All of it observable, none of it explained.
- **Melt.** Ice you made is a platform with a deadline. Ice the world made melts by afternoon.
- **The run clock.** Optional and dangerous: does the world get worse the longer a run lasts? It would push players outward. It might also just be a stress mechanic. Flagged, not recommended.

---

# Part 10: Band 3 specifically

The reward for mastery and the actual point of the game. Ideas that keep the promise "surreal geometry, honest physics".

**Geometry.** Corridors longer inside than out. A staircase that is a loop. Two doors in one room that both lead to the room. A window that looks onto a place that is not adjacent. A region that is the same region rotated.

**Repetition.** A room you have already been in, with one property changed. A house from band 0, rebuilt exactly. Your own footprints. An item you merged three regions ago, on the floor, whole.

**Absence.** Sound drops out. Shadows are missing. A fire that gives heat and no light. Weather that stops at a line on the ground. An NPC who does everything a person does except look at you.

**Property inversions that are still consistent.** Things that are `HEAVY` only when observed. Fire that spreads to `WET` things instead of dry. A material that is `COLD` and ignites `FLAMMABLE` neighbors. The rule to hold: whatever the inversion is, it applies every time and the player can learn it. An inconsistent world is not surreal, it is broken, and players can tell the difference immediately.

**Social wrongness.** An agent with `loyalty` to you and no reason for it. A faction that recognizes your `IDENTIFYING` item but not you. A crowd that is `MOURNFUL` for something that has not happened.

**Tone.** Quieter, not louder. Items get shorter descriptions. The palette loses saturation rather than gaining it. Fewer things per room, and each one more specific. The temptation will be to make band 3 elaborate. Resist it.

---

# Part 11: Progression, codex, and death

- **Codex as a graph, not a list.** Every discovered merge is an edge. The player's codex is a subgraph of the real one, growing over runs. Showing it as a graph makes the accumulated knowledge visible, which is the whole progression.
- **Lineage.** Every item knows its parents (`from` already exists on `ItemDef`). Showing a chain back to two band 0 sticks is a good feeling and free.
- **Discovery log.** Items seen, creatures seen, regions reached. Furthest band reached should be prominent, because it is the score.
- **Skills.** Open question in `docs/DESIGN.md`. Candidates: carry speed, cold resistance, climbing, quieter movement, better trade prices, faster merging, seeing one property tier deeper on unknown items, surviving one lethal hit per run. Keep the list short and make each one felt.
- **What death takes.** Everything material. What it leaves: the codex, the log, the skills, and the specific memory of what killed you.
- **Death as information.** A short honest summary at death: what you were carrying, what you had discovered that run, how far you got. No score screen with a letter grade.
- **The first ten seconds of a run.** You have nothing, and you are next to a hearth. The first item should always be within sight. The second should require a choice.
- **A run that ends by choice.** There is no extraction, by design. Consider whether walking home is possible and what it would mean if it were.

---

# Part 12: UI ideas

The property filter, the merge bench, and the `?` on undiscovered pairs are built in `src/ui/interface.ts`. The rest of this section is unwritten.

- **Property filter as the primary interface.** Not search. The filter is the query that matters and it should be one keypress away. Built.
- **Filter by capability, not by name.** "Show me everything that could get me over a 4m wall" is a property query with a threshold, and it is the single most useful thing the UI could do.
- **Live property inspection.** Hovering an item shows its property bars. This is how players learn the vocabulary, and it is how band 3 puzzles become solvable.
- **Inventory items are simulated.** Your torch goes out. Your bread rots. Your rag gets wet in the rain. The inventory needs to show what changed since you last looked, or players will never notice.
- **Merge bench with an honest unknown.** Known pairs show the result. Unknown pairs show a question mark and both inputs' properties, so the player can reason about what should come out. Reasoning about it is the game. Built, except for showing both inputs' properties on the bench.
- **A merge preview that shows derived properties but not the name.** Tempting, and it might remove all the tension. Flagged as a tuning decision, not a design one.
- **The codex graph as a map of what you know.**
- **No tooltips explaining mechanics.** The properties are the explanation.
- **Item comparison.** Two items side by side, property bars aligned. Necessary once there are 200 items.
- **Pinning and loadouts.** With infinite inventory, the working set is what matters.

---

# Part 13: Audio

The game is wordless, so audio carries everything narration would.

- Per-band ambient beds. Band 0 has birds and wind in wheat. Band 2 has structure noise and water in pipes. Band 3 has the absence of something you only notice when it returns.
- Material-driven impact sounds. Sounds are selected by material properties, not by item ID, exactly like everything else. A merge result made of half metal and half wood should sound like it.
- Fire as an audio event with distance and size. You should hear a fire you started two regions of the map away.
- Sound as a gameplay signal that agents share. If you can hear it, so can they.
- Silence used deliberately, and rarely.
- Music that responds to distance from home rather than to combat.

---

# Part 14: Wildcards

Deliberately unpredictable. Some of these are bad. The point is that the good ones are not reachable by careful incremental design.

- **An NPC who merges things.** A trader who takes two items and gives you what the rules produce, for a fee. Now the merge system has a second interface and a social cost.
- **A creature that eats items and excretes merges.** Grotesque, funny, and mechanically identical to the bench.
- **Items that remember.** An item merged from a `PERSONAL` object stays `PERSONAL`, and the owner recognizes it three merges later.
- **Fire that NPCs fight.** A village that puts out fires changes what arson means.
- **A region where it has already burned.** Generated post-fire. All the `FLAMMABLE` solutions are gone, and the map is more open.
- **Wind fixed per region and visible.** Smoke, flags, wheat. The player reads it without a UI element.
- **A herd you can drive.** `PHEROMONE` or food or noise, and thirty animals become a battering ram, a distraction, and a wall.
- **Graffiti from previous runs.** Not player data, just the codex: names of items you discovered in earlier runs appear scratched into walls. Costs nothing, feels enormous.
- **The bands leak.** Rarely, a band 2 object in a band 0 region. Nobody comments. It is `ALIEN`, so the villagers react, but only in the way the property system already handles.
- **An item whose properties depend on distance from home.** Carries the genre gradient into the inventory itself.
- **Seasons that persist across runs.** Run 4 happens in the same world's autumn. Cosmetic and cheap and slightly haunting.
- **A merge that produces a region.** Two items with the right properties open a gateway. Absurd, band 3 only, and possibly the best idea in this document.
- **Something that follows you home.** Whatever that means, since home is where you start and the world regenerates.
- **A single item that survives death.** Violates the design. Listed because it is the most requested feature in every game like this, and the answer should be a deliberate no, written down.
- **The tutorial that is a house fire.** Your first lesson is that fire spreads, taught by losing the hearth.
- **A merge that consumes time instead of an item.** Not two items: one item and an hour of world clock. Breaks the two-input rule, which is why it is here rather than in Part 5.
- **Weight that matters only for what you carry in your hands.** Infinite inventory, but two hands. Reintroduces scarcity without reintroducing inventory management.
- **Everything in a region is one fire away from being ash.** Test it. If a player can burn an entire region to the ground and the game keeps working, the simulation is real.

---

# Part 15: Traps and rejected ideas

Written down so nobody rediscovers them and thinks they are new. Add to this list every time something is tried and dropped.

- **Keys and locks.** The whole design exists to avoid this. A locked thing is a set of facts: material, thickness, hinges, who is watching it.
- **Recipes as unlockable blueprints.** The codex records what you discovered. It never grants permission.
- **A crafting UI with a recipe list.** Reduces the game to a lookup table. The bench has two slots and a question mark, and that is the whole interface.
- **Item tiers.** Bronze, iron, steel, mythril. Reintroduces progression by item ID through the back door and kills the property system's reason to exist.
- **Elemental rock-paper-scissors.** Fire beats plant, water beats fire, and so on as a damage table. The property simulation already produces these relationships honestly, and a table would override it with something worse.
- **Damage types and resistances.** Same problem. A thing takes damage because of what happened to it physically.
- **Enemy health bars.** Enemies are entities with properties. If the player cannot tell how hurt something is by looking at it, fix the visuals.
- **Quest markers, objectives, and a journal.** No story, no quests, per `docs/DESIGN.md`.
- **An unmerge, at any price.** Named in the design doc as a permanent no.
- **Two outputs from a merge.** Breaks the closure property that makes the catalog tractable.
- **A "correct" solution to any obstacle.** If a designer wrote it down in advance, it is wrong.
- **`INDESTRUCTIBLE` anything.** One exception teaches players that the simulation is a facade.
- **Item-ID special cases for "important" objects.** The gateway, the hearth, and the final door are all just entities with properties. If the hearth cannot be put out with a bucket of water, the hearth is a lie.
- **Randomized merge results.** Merges are globally deterministic. A random result destroys the codex, which is the entire progression.
- **Difficulty settings.** Distance from home is the difficulty curve.

---

## Appendix: promoting an idea out of this document

1. Name the property or system it needs. If it needs neither, it is content and can go straight into the catalog.
2. Check the property is read by at least one system and carried by at least two items. If not, the idea is not ready.
3. Check no step requires branching on an item ID. If one does, restate it in properties or drop it.
4. Add the property to `src/props/registry.ts` and a derivation rule to `src/props/derive.ts` if it needs one.
5. Write the test first. Property derivation and simulation rules are pure and easy to test, and they are the game.
6. Run `npm run shot` before and after if it is visible at all.
7. Delete the entry from this file, and note it in `PROJECT_STATUS.md`.


---

# Part A: Post-pivot content (added 2026-07-25)

Written after the pivot recorded as D17 through D21. Everything below assumes:
merges are curated rather than total, item-specific interactions are legitimate
content, NPCs speak, there is a permanent home, and there are no quest markers.

Same rules as the rest of this document: nothing here is committed to, and
anything built should be deleted from here and carried by the code instead.

## A1. Home

Hand-authored layout, generated detail on top. The player sees it every run, so
it has to reward recognition rather than novelty.

| Feature | What it is for |
|---|---|
| The hearth | Where a run begins. Also the only guaranteed source of `HOT` in Band 0 |
| The codex shelf | Every merge and interaction discovered, across all runs. The real progression |
| The well | Free `WATER`. Makes water a tool rather than a lucky find |
| Kitchen garden | Slow-growing `SEED` plants. Something that changes between runs without being told to |
| Woodpile | Renewable `WOODEN` and `FLAMMABLE` stock |
| The gate | The one road out. Everything past it is a region away from home |
| A grave marker | Names the last character who died, and how far out. Progress made visible with no UI |

NPCs who live here and are always present:

- **The Keeper.** Elderly, runs the hearth. Explains nothing unless asked, and only answers what is asked. First place a player learns that dialogue has options.
- **Wren, the smith's daughter.** Bored, curious, will trade. The tutorial merge partner: she suggests combinations without ever calling them recipes.
- **The Ferryman.** Sits by the gate. Will not tell you where to go. Will tell you what he has seen come back.

## A2. Items that do not merge

Marking an item `noMerge` is normal now. Candidates, and why each is better inert:

| Item | Why it should not merge |
|---|---|
| Sealed letter | Its value is who you show it to. Fusing it into a "letter axe" destroys that |
| Brass key | Opens one thing. A key that becomes a hybrid is just a worse key |
| Signet ring | Identity. It proves who you are, and hybridising it makes it prove nothing |
| Grave token | Carried from home. Sentimental, and the player should feel the refusal |
| Living animal | You do not fuse a goat into a plank. If this ever becomes possible it should be Band 3 only, and horrifying |
| The codex itself | Obviously |

The refusal message matters as much as the merge. It should say something about
the object rather than "these cannot be combined".

## A3. Merge results worth building toward

Written as chains rather than pairs, because a chain is what makes a recipe book
feel deep. Each row is: inputs, result, and what it opens up.

**Fire chain**
- flint + iron → fire striker → the base of everything hot
- striker + straw → tinder kit → portable ignition
- torch + oil → pitch torch → burns long enough to cross a region at night
- pitch torch + rope → fire flail → reaches things you cannot stand next to
- lantern + firefly jar → cold lamp → light without ignition, for places where fire kills you

**Reach chain**
- plank + rope → rope ladder → over walls
- ladder + hook → grapple ladder → over walls with nothing to lean on
- pole + hook → boat hook → pulls things toward you across water
- rope + weight → plumb line → measures depth, finds the bottom of a shaft

**Quiet chain**
- cloth + fat → muffled boots → guards do not hear you
- soot + oil → face black → guards do not see you at night
- bell + wax → dead bell → carry it past something that listens

**Social chain**
- coin + cloth → purse → bribery becomes possible as an act rather than a check
- wax + signet → forged seal → an authored interaction with exactly one official
- wine + herb → dosed wine → gets somebody to sleep without killing them
- letter + forged seal → false writ → the single most valuable thing in Band 1

## A4. Specific interactions

The new authored layer. Format: item, target, effect. Each one needs at least one
property-driven alternative to exist alongside it, or the obstacle is a lock.

| Item | Target | Effect | Unauthored alternative |
|---|---|---|---|
| Brass key | The mill door | Opens it | Burn the door, or the wall it sits in |
| Crowbar | Nailed shutters | Pries them off | Break them, or go through the roof |
| Bellows | Any fire | Turns a small fire into a spreading one | Add fuel and wait |
| Salt | Slug-thing in the cellar | Kills it outright | Fire, water, or a heavy object |
| Fishing net | Anything `LIVING` and small | Catches it alive | Trap it, corner it, or bait it |
| Signal horn | The ferryman across the water | He comes and gets you | Swim, raft, or bridge it |
| Lodestone | The lock on the granary | Draws the iron pin | Break it, or find the key |
| Mirror | Anything that must not see you | Redirects its attention | Darkness, distance, or a distraction |

## A5. NPCs and dialogue

Structure per NPC: disposition, drives, one thing they want, one thing they fear,
and at least two ways to get what you need from them.

**The Gate Guard (Band 0, the palisade)**

- Disposition: neutral. Greed 0.6, alertness 0.4, boredom 0.8
- Wants: to be somewhere else. Fears: his sergeant
- Routes through:
  - Bribe with anything `VALUABLE` above his greed
  - Bore him into waving you through, by talking long enough with the right dull options
  - Show a false writ (authored interaction)
  - Distract him with anything `LOUD` thrown elsewhere
  - Or ignore him entirely and burn the wall down, which the simulation already allows

Dialogue sketch, showing gating:

    "Nobody through after dark. Sergeant's orders."
      > "Whose orders?"                          [always]
      > "It's worth a coin to me."                [needs VALUABLE >= 0.5]
      > "Sergeant sent me."                       [needs false writ]
      > "There's a fire behind you."              [true only if something is burning]
      > (say nothing, wait)                       [always; boredom rises]

The fourth option being *true or not* is the interesting part. Lying when nothing
is burning should cost disposition. The world should be checkable.

**Wren (home)** teaches merging without a tutorial. She asks what you found, and
suggests one combination per run based on what you are carrying, phrased as
curiosity rather than instruction.

**The Ferryman (home gate)** is the anti-quest-marker. Asked where to go, he
describes what he has seen people bring back, and never where they went.

## A6. Obstacles suited to the new shape

Each with an authored answer and at least one emergent one.

- **A locked mill.** Key opens it. Or burn it, or pry the shutters, or flood the race and walk in through the wheel housing.
- **A bridge with a toll.** Pay it. Or bore the collector, or cross upstream, or freeze the water, or float across.
- **A dog that will not let you past.** Feed it. Or frighten it, or befriend it over several visits, or simply outrun it.
- **A cellar full of something that hunts by sound.** Dead bell. Or muffled boots, or throw something loud the other way, or kill it, or never go down there.
- **A sleeping household.** Dosed wine so they stay asleep. Or move slowly, or go in through the roof, or wake them and talk your way out.

## A7. Skills and stats, since progress is now defined as these

D20 says progress is distance plus stats plus skills. That needs actual content.

Candidate stats: **Vigour** (carry, survive), **Wits** (dialogue options, spotting
things), **Hands** (merging speed, tool effectiveness), **Nerve** (how far the
world can get before it starts costing you).

Candidate skills, all earned by doing rather than by spending points:

| Skill | Earned by | Gives |
|---|---|---|
| Firecraft | Lighting things | Fires you start spread further |
| Haggling | Successful bribes | Greed thresholds drop |
| Reading | Finding written things | Written items become legible and gate new dialogue |
| Quiet step | Getting past without being seen | Larger stealth radius |
| Butchery | Using edged tools on living things | More from what you take |
| Cold blood | Surviving Band 2 | Fear effects reduced, which is what gates Band 3 |

The gate to Band 3 should be a skill threshold rather than an item, so that
reaching it is re-earned but genuinely easier each run.


## A8. Objects Max asked for (2026-07-25)

Requested directly. Band assignments are proposals, not decisions. The point of
placing them by band is that the genre gradient is the spine of the game, and an
object arriving in the wrong band spends its surprise early.

**Band 0, Hearth**

| Object | Properties | Notes |
|---|---|---|
| Rock | `STONE 1, HEAVY 0.5` | The most basic thing in the game. Should exist from the first minute |
| Rope | `ROPE_LIKE 1, CLOTH 0.5, FLAMMABLE 0.5` | Already in |
| Knife | `METAL 0.8, SHARP 0.9, TOOL_CUTTING 0.6, RIGID 0.7` | Smaller and faster than the axe; worse on structures, better on `LIVING` |
| Sword | `METAL 0.9, SHARP 0.95, TOOL_CUTTING 0.7, RIGID 0.85, VALUABLE 0.5` | Also `FRIGHTENING`. Carrying one openly should change how NPCs greet you |
| Crossbow | `LAUNCHER 0.9, RIGID 0.8, WOODEN 0.5, METAL 0.4` | Needs a `PROJECTILE`. Reach without approach, which is a genuinely new verb |
| Slingshot | `LAUNCHER 0.5, ELASTIC 0.8, WOODEN 0.4` | The cheap version. Pairs with Rock, which is the joke and the point |
| Key | `METAL 0.7, noMerge` | The flagship for D18's "some things do not merge". Opens exactly one thing |
| Poison | `TOXIC 0.9, EDIBLE 0.2` | Only useful delivered. Wants `EDIBLE` or a blade to coat |
| Chili fruit | `EDIBLE 0.6, PLANT 0.7, CAUSTIC 0.5` | Eaten, thrown, or rubbed on something. Blinds and burns |
| Glasses | `GLASS 0.9, FRAGILE 0.8, IDENTIFYING 0.3` | Two uses: focus sunlight to start a fire, and read small print. Both earned, not stated |

**Band 1, The Turn** (modernity intrudes without comment)

| Object | Properties | Notes |
|---|---|---|
| Balloon | `BUOYANT 1, FRAGILE 0.9, ELASTIC 0.6` | Lift. Carries a light thing up, or over. Pops on anything `SHARP` |
| Rubber band | `ELASTIC 1, RUBBER 0.9` | The enabling part for every launcher. Also binds things |
| Gun | `LAUNCHER 1, METAL 0.9, LOUD 1, FRIGHTENING 0.9` | The loudest object in the game. Should solve some things and ruin others |
| Magazine (printed) | `PAPER 0.9, FLAMMABLE 0.9, WRITTEN 0.6` | Tinder, or reading, depending on how desperate you are |
| Magazine (ammunition) | `METAL 0.8, PROJECTILE 0.9` | Listed separately because the word is ambiguous and both are worth having |
| Orange | `EDIBLE 0.9, PLANT 0.5, CAUSTIC 0.2` | Out of place in a pastoral fantasy region, which is the point in Band 1 |
| Banana | `EDIBLE 0.9, PLANT 0.5, SLIPPERY 0.8` | The peel is the item. A `SLIPPERY` thing on a floor is a real tool |

**New properties these would need**

`ELASTIC`, `RUBBER`, `PAPER`, `CAUSTIC`, `TOXIC`, `SLIPPERY`, `FRAGILE`,
`LAUNCHER`, `PROJECTILE`, `LOUD`, `FRIGHTENING`, `WRITTEN`.

Several are already listed in `docs/DESIGN.md` but absent from
`src/props/registry.ts`. Per the standing rule, add each one only when a system
is about to read it in the next hour.

**Merges these unlock**

- rubber band + forked stick → slingshot
- slingshot + rock → loaded sling; the first ranged option
- crossbow + rope → windlass crossbow, faster to span
- knife + poison → coated blade
- poison + orange → dosed fruit, which is how you get something to eat it
- glasses + sunlight → fire without flint (an interaction, not a merge)
- balloon + rope → tethered lift
- balloon + rock → it does not lift. An honest failure worth having
- magazine (printed) + oil → firelighter
- chili + rag → face wrap that hurts to remove
- banana peel + oil → very slippery, comedic, effective

**Specific interactions they unlock**

| Item | Target | Effect | Unauthored alternative |
|---|---|---|---|
| Key | The one lock it fits | Opens it | Break the door, burn it, go round |
| Glasses | Dry tinder in sunlight | Starts a fire | Flint and iron, or a hearth |
| Banana peel | A floor an NPC walks | They fall | Trip line, grease, or distraction |
| Gun | Any NPC | Everyone in earshot reacts, mostly badly | Threaten with a sword, or do not |
| Chili | Anything with eyes | Blinds it briefly | Smoke, darkness, or a sack |
| Balloon | Something light you cannot reach past | Floats it over | Throw it, or find another route |

**Design note on the gun.** It is the strongest object on this list and the one
most likely to flatten the game. Suggested constraint: it is `LOUD 1` and the
world genuinely reacts, so firing it solves the immediate problem and creates a
larger one. That keeps it exciting without making it the answer to everything.


## A9. Item HUDs: things you USE, not just carry

Max's idea, and it generalises further than the example. Some items should open
their own interface when used, rather than resolving into a single effect.

The pattern: an item declares an optional `hud`. Pressing use with it selected
opens a small purpose-built panel. The panel is the item, and the item is a
puzzle surface rather than a verb.

Why this is worth building: it is the strongest possible expression of D17. A
specific item having a specific effect is good; a specific item having its own
*interface* is a different order of thing, and it is what makes an object feel
authored rather than generated. It also gives the outer bands somewhere to go
that is not just harder combat.

| Item | HUD | What it is really for |
|---|---|---|
| Phone (Band 1) | Keypad, recent calls, battery, signal bars | Dial a number found written somewhere. Signal depends on where you stand, so it becomes a reason to climb. Battery is a real resource |
| Radio (Band 2) | Tuning dial, static, a signal meter | Tune to a frequency scrawled on a wall. Some stations only broadcast in some regions. Static is a proximity sensor for something |
| Map and compass | Hand-drawn map that fills in as you walk | The anti-quest-marker. It shows where you HAVE been, never where to go |
| Lockpicks | Tension and pick, a feel-based minigame | Skill-gated. Better Hands means fewer pins to hold |
| Camera | Viewfinder, limited film | Photograph things for the codex. Film is finite, so what you choose to record matters |
| Ledger or letter | Readable text, gated on the Reading skill | Illegible until you can read. Names, numbers, a lock combination |
| Music box / cassette | Play, stop | Sound as a tool. Attracts, soothes, or drives things off |
| Bomb timer (Band 2) | Countdown, dial to set | Set the delay, then the tension is entirely yours to create |
| Terminal (Band 3) | A prompt that answers wrongly | It should not make sense. Band 3 says less, not more |

**Design rules for item HUDs, so they do not become minigame soup:**

1. A HUD must let you *do* something the world cannot express otherwise. If it
   could have been a button press, it should have been a button press.
2. It must be usable in under ten seconds once understood. This is an adventure
   game, not a puzzle box collection.
3. It must be diegetic. The phone has a battery because phones do, not because
   we wanted a resource.
4. It must be able to FAIL informatively. Dialling a wrong number should tell you
   something.
5. No more than five in the whole game. Scarcity is what makes them special.

**Implementation shape, when it happens:** a `hud` field on `ItemDef` naming a
registered panel; a registry in `src/ui/huds/` mapping name to a component that
gets the item instance and a handle back into the world; the pack gets a USE
action alongside merge. Panels are DOM, like the rest of the UI, so they can be
authored quickly and styled like real devices.

The phone is the right first one to build. It is the most recognisable, it makes
signal and elevation matter, and a number written on a wall somewhere is exactly
the kind of discovery this game is about.


## A10. Vehicles

Max's, and eventual rather than soon. Worth writing down carefully because
vehicles touch more of the existing design than they appear to.

**One per band, which is the point.** The genre gradient is the spine of the
game, and the way you travel is one of the loudest signals of where you are.

| Band | Vehicle | What it says about the world |
|---|---|---|
| 0, Hearth | Horse | Alive, wilful, has to be won over |
| 1, The Turn | Bicycle | Nobody comments on it, which is the joke |
| 2, Rust | Car | Fast, loud, drinks fuel, and everything hears you coming |
| 3, The Static | Something that should not carry you | Deliberately unresolved |

### Why this is already half-designed

- `docs/DESIGN.md` already lists `WHEELED` as a property and already offers
  "ram it with a car" as a palisade solution. Vehicles are promised by the
  existing affordance table, not new to it.
- Band 1 already has "a parked sedan with the keys in it" and "a petrol station
  serving a village that still uses oxen" in its description.
- Band 2 already has dead elevator shafts and flooded metro tunnels, which is a
  world built for something with wheels to be useless in, on purpose.
- The `apple + horseshoe` merge is already called Horse Treat. That was a joke
  when it was written and becomes a mechanic here.

### A horse is an agent, not a vehicle

The most interesting one, and the reason to build it first despite being the
earliest band. A horse is `LIVING`, so it has a disposition and drives, exactly
like the NPCs in D19. You do not press a button and mount it.

- It has to be approached, calmed, fed, or owned.
- `EDIBLE` gets you closer. `LOUD` and `FRIGHTENING` push it away. Fire terrifies it.
- A skill (Riding) makes it easier, which is progression that is not a stat bar.
- It can be spooked out from under you, which is a real failure state.
- It can be stolen, and somebody will mind.

This means the vehicle system and the agent system share their foundations, and
the horse should be built after NPCs rather than before.

### What riding actually changes

1. **Speed**, obviously. Which only matters if there is distance to cover, and
   that is the tension below.
2. **Camera.** It has to pull back with speed or the player outruns their own
   sightline. This is a real feel problem, not a setting.
3. **What you can do while moving.** Trample, ram, carry more, reach a high
   shelf from horseback, outrun something.
4. **What you cannot do.** Doorways, stairs, dense wood, anything narrow. A
   vehicle should close options as well as open them, or it is strictly better
   and therefore boring.
5. **Upkeep as a property problem, not a fuel bar.** A horse wants `EDIBLE` and
   rest. A car wants something `FLAMMABLE` and liquid, which is the same
   property fire already reads. A bicycle wants nothing, which is why it
   survives Band 2 better than the car does.

### The tension worth stating up front

Vehicles only feel good when there is distance to cover, and the current region
is a deliberately small 36 by 32 clearing that was cut down precisely because
the bigger one felt empty. Both of those are right, and they conflict.

The likely resolution is that vehicles arrive with multi-region travel rather
than inside one region: a horse is how you cross between gateways at speed, not
how you cross a clearing. That also stops the starting area needing to be
inflated to justify them.

Do not build vehicles to make the map feel bigger. Build them when the map
already is.

### This is what brings Rapier back

D13 removed Rapier from the runtime and said explicitly that it returns for
crates, rope and vehicles. This is that trigger.

Rapier has a raycast vehicle controller, which is the right tool for the car,
and joint chains for anything towed. The horse is probably NOT a Rapier vehicle;
it is an agent with a movement model, closer to the player's analytic movement
than to a chassis with suspension.

So the likely split is: horse and bicycle stay analytic and cheap; the car gets
real physics, because that is where the fun of a car lives. Revisit D13 when
this happens rather than quietly reintroducing the dependency.
