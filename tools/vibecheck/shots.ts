/**
 * The sweep: where the camera goes, and what each place is supposed to be.
 *
 * Two kinds of entry. The GRID exists so the whole region gets looked at rather
 * than the handful of spots somebody already suspects; it is what would have
 * caught "the character draws on top of every tree", because that bug was
 * invisible at the one place it was tested and obvious everywhere else. The
 * PLACES are the composed bits, where a defect is a defect of authoring rather
 * than of rendering.
 *
 * `note` is what the shot is supposed to show. It is not decoration: on a later
 * pass it is the only record of whether an empty frame is a bug or the point.
 */

export interface ShotSpec {
  name: string
  x: number
  z: number
  note: string
}

/** Region bounds, mirrored from src/world/region.ts BOUNDS. */
export const BOUNDS = { minX: -28, maxX: 28, minZ: -22, maxZ: 20 }

/**
 * A coarse lattice over the walkable region. Four by four, inset from the
 * bounds so the player is never standing inside the tree line, which is a place
 * the player cannot actually reach and therefore not a case worth a shot.
 */
const GRID: ShotSpec[] = []
{
  const xs = [-22, -8, 8, 22]
  const zs = [-18, -7, 5, 16]
  for (const z of zs) {
    for (const x of xs) {
      GRID.push({
        name: `grid_x${x < 0 ? 'm' : ''}${Math.abs(x)}_z${z < 0 ? 'm' : ''}${Math.abs(z)}`,
        x,
        z,
        note: `grid sample at ${x},${z}`,
      })
    }
  }
}

/** The composed places, plus the ordinary case the player is in most of the time. */
const PLACES: ShotSpec[] = [
  { name: 'home_hearth', x: 0, z: 11.9, note: 'the hearth and the two cottages, yard around them' },
  { name: 'home_yard_gate', x: 0.8, z: 8.6, note: 'looking back at home from the yard gate, main track underfoot' },
  { name: 'home_well', x: 3.0, z: 11.3, note: 'the well, washing line, vegetable patch' },
  { name: 'chopping_block', x: 10.4, z: 10.9, note: 'chopping block and the wood east of the yard' },
  { name: 'old_oak', x: 10.6, z: 8.8, note: 'the great oak on the knoll, the one landmark visible from everywhere' },
  { name: 'pond_shore', x: -11.8, z: 8.5, note: 'pond from the north shore: waterline, reeds, lily pads' },
  { name: 'pond_jetty', x: -8.5, z: 5.2, note: 'the dipping platform, player standing on the deck' },
  { name: 'pond_log', x: -8.2, z: 7.6, note: 'the felled trunk half in the water' },
  { name: 'ford_plank', x: 0.1, z: -1.25, note: 'the plank crossing where the track meets the brook' },
  { name: 'brook_east', x: 8.0, z: 1.2, note: 'the brook running east toward the mill' },
  { name: 'mill', x: 18.9, z: 4.75, note: 'the mill, downstream' },
  { name: 'barn', x: -22.6, z: 16.4, note: 'the barn at the top of the wheat field' },
  { name: 'wheat_field', x: -19.5, z: 9.0, note: 'the wheat field' },
  { name: 'palisade_gate', x: 0, z: -6.0, note: 'the gate, seen from the track on the near side' },
  { name: 'palisade_patch', x: -6.5, z: -6.6, note: 'the patched section of the palisade, west of the gate' },
  { name: 'beyond_arch', x: -1.2, z: -13.6, note: 'the ruined arch beyond the wall' },
  { name: 'beyond_tower', x: -8.6, z: -17.5, note: 'the tower beyond the wall, near the north tree line' },
  { name: 'treeline_south', x: -20.0, z: 18.4, note: 'deep in the tree line behind home, player among trunks' },
  { name: 'treeline_east', x: 25.5, z: -2.0, note: 'against the east tree line' },
  { name: 'open_ground', x: 5.5, z: 4.0, note: 'THE ORDINARY CASE: standing in the open with nothing nearby' },
  { name: 'open_ground_2', x: -4.4, z: -3.8, note: 'ordinary case again, on the parched pasture south of the wall line' },
]

export const SHOTS: ShotSpec[] = [...PLACES, ...GRID]
