/**
 * The fourteen `?url` imports, exactly as `src/render/textures.ts` should
 * declare them. Kept here so the loader contract in `assets/baked/README.md` is
 * something that has been run rather than something that was written down, and
 * so the textures agent can copy the block instead of retyping fourteen paths.
 *
 * Nothing under `src/` imports this file; it is the contract's fixture.
 */
import grassUrl from '../../assets/baked/textures/grass.png?url'
import grassDryUrl from '../../assets/baked/textures/grassDry.png?url'
import grassWornUrl from '../../assets/baked/textures/grassWorn.png?url'
import sandUrl from '../../assets/baked/textures/sand.png?url'
import waterUrl from '../../assets/baked/textures/water.png?url'
import barkUrl from '../../assets/baked/textures/bark.png?url'
import foliageUrl from '../../assets/baked/textures/foliage.png?url'
import stoneUrl from '../../assets/baked/textures/stone.png?url'
import plankUrl from '../../assets/baked/textures/plank.png?url'
import strawUrl from '../../assets/baked/textures/straw.png?url'
import steelUrl from '../../assets/baked/textures/steel.png?url'
import clothUrl from '../../assets/baked/textures/cloth.png?url'
import clayUrl from '../../assets/baked/textures/clay.png?url'
import glassUrl from '../../assets/baked/textures/glass.png?url'
import goldUrl from '../../assets/baked/textures/gold.png?url'
import emberUrl from '../../assets/baked/textures/ember.png?url'
import fruitUrl from '../../assets/baked/textures/fruit.png?url'

export const URLS = {
  grass: grassUrl,
  grassDry: grassDryUrl,
  grassWorn: grassWornUrl,
  sand: sandUrl,
  water: waterUrl,
  bark: barkUrl,
  foliage: foliageUrl,
  stone: stoneUrl,
  plank: plankUrl,
  straw: strawUrl,
  steel: steelUrl,
  cloth: clothUrl,
  clay: clayUrl,
  glass: glassUrl,
  gold: goldUrl,
  ember: emberUrl,
  fruit: fruitUrl,
} as const
