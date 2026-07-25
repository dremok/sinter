/**
 * Band 0: Hearth.
 *
 * Tuned for a 16-bit console look rather than a naturalistic one. That means
 * high saturation, few hues, and clear separation between neighbouring
 * surfaces, because the frame is rendered at 240p and then upscaled with hard
 * pixel edges. Muddy, closely related colours turn to noise at that size; the
 * previous olive-and-tan palette read as sludge once pixellated.
 *
 * Rule of thumb when adding a colour here: if you cannot tell it apart from its
 * neighbour in a 16x16 thumbnail, it is wrong.
 */

export const BAND0 = {
  sky: 0x7ec8e3,
  fogNear: 34,
  fogFar: 96,

  grass: [0x7ab648, 0x6aa63e, 0x8cc456, 0x5f9c38],
  dirt: 0xc9a06b,
  sand: 0xdcc48e,
  rock: 0x9a9a96,
  water: 0x3f9ed6,
  waterDeep: 0x2e7cb0,

  bark: 0x8b5a2b,
  barkDark: 0x6d4520,
  leaf: [0x4fa03f, 0x3f8a33, 0x66b84d],

  sun: 0xfff4dc,
  skyLight: 0xa8d8ee,
  groundLight: 0x4a5c30,

  ember: 0xff7a2f,
  flame: 0xffc247,

  // The player. A saturated tunic against saturated grass needs a hue that is
  // nowhere else in the scene, or the character vanishes into the field.
  tunic: 0xc8443c,
  trouser: 0x3c4a7a,
  skin: 0xe8b98a,
  hair: 0x4a3220,
} as const

export const MATERIAL_COLOR = {
  wood: 0xb07840,
  steel: 0xb8c4d0,
  stone: 0x9a9a96,
  cloth: 0xe0c9a6,
  glass: 0x9fdce6,
  leaf: 0x4fa03f,
  water: 0x3f9ed6,
  ember: 0xff7a2f,
  gold: 0xf0d264,
  straw: 0xdcc06a,
  clay: 0xc07a52,
} as const
