/**
 * The player's physical dimensions.
 *
 * Here rather than in `main.ts` because the world generator needs them too, and
 * needs the SAME numbers. Two of the collision bugs in this project were the
 * generator building something the player could not actually use — a deck 0.26m
 * under the bank it meets, a gap 2.81m wide against a 2.16m radii sum — and in
 * both cases the generator had no way to ask how big the player is, so it did
 * not check.
 *
 * Anything that lays down walkable or solid geometry should measure it against
 * these and complain in the build if it does not fit.
 */

/** Radius of the player's collision capsule. */
export const PLAYER_RADIUS = 0.34

/**
 * How high a step up the player can take in one go.
 *
 * Nothing decides this per prop: a surface within reach becomes the ground and
 * anything taller is a wall to walk around. That falls out of the height
 * difference alone, which is what lets a plank dropped by the player become a
 * step without anybody writing that down.
 */
export const STEP_HEIGHT = 0.55

/** The narrowest opening the player fits through. */
export const PLAYER_WIDTH = PLAYER_RADIUS * 2
