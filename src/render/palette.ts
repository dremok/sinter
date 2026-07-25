/**
 * Band 0: Hearth.
 *
 * Palette, fog and light color carry most of the tonal work for a band, which
 * is why they live in one small file per docs/ARCHITECTURE.md. Late afternoon,
 * warm, a little hazy. Nothing here is threatening yet.
 */

export const BAND0 = {
  sky: 0xbcd2d8,
  fogNear: 22,
  fogFar: 108,

  grass: [0x6d8c4a, 0x789a52, 0x648347, 0x82a259],
  dirt: 0x9a8560,
  rock: 0x8d8b86,
  water: 0x4e8fb8,

  barkDark: 0x5a4633,
  bark: 0x6f573f,
  leaf: [0x4f7a35, 0x5c8a3d, 0x456b2e],

  sun: 0xfff0d4,
  skyLight: 0xc6dae6,
  groundLight: 0x54492f,

  ember: 0xff7a2f,
  flame: 0xffb347,
} as const

export const MATERIAL_COLOR = {
  wood: 0xa9784a,
  steel: 0x9aa7b4,
  stone: 0x8d8b86,
  cloth: 0xcbb191,
  glass: 0xa8d4da,
  leaf: 0x5c8a3d,
  water: 0x4e8fb8,
  ember: 0xff6a2a,
  gold: 0xd9c26a,
  straw: 0xc9a95f,
  clay: 0xa97355,
} as const
