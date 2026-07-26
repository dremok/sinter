/**
 * The miniplex world and the component vocabulary.
 *
 * Systems query by COMPONENT and then read PROPERTIES. No system anywhere is
 * allowed to look at `item.def.id` to decide behavior. If a system needs to
 * know whether something burns, it reads FLAMMABLE.
 */

import * as THREE from 'three'
import { World } from 'miniplex'
import type { Footprint } from '../core/footprint'
import type { ItemDef } from '../items/catalog'
import type { Properties } from '../props/registry'

export interface Entity {
  /** Where it is. Everything simulated has one. */
  transform?: { pos: THREE.Vector3; ry: number }

  /** Its scene graph node, kept in sync from `transform`. */
  mesh?: THREE.Object3D

  /**
   * Live properties. Starts as a copy of the item definition's, then diverges
   * as the world acts on it: rain soaks it, fire dries and then consumes it.
   */
  props?: Properties

  /** A thing that can be picked up and merged. */
  item?: { def: ItemDef }

  /** Currently on fire. `fuel` counts down; at zero it stops. */
  burning?: { heat: number; fuel: number; age: number }

  /** What to call it in the prompt. Scenery has one; loose items use their def. */
  label?: string

  /** Built world geometry that can be destroyed: the palisade, a hut wall. */
  structure?: { hp: number; maxHp: number; height: number; label: string }

  /**
   * Blocks movement while it stands. Removed when the structure falls.
   *
   * A `Footprint`, not a radius: a circle cannot be a rectangle, and pretending
   * otherwise is what put an invisible two-metre bubble in front of the gate
   * and a walk-through hole in the barn wall. See `core/footprint.ts`.
   */
  blocker?: Footprint

  /** Something the player can climb, if it is tall enough and near a blocker. */
  climbAid?: { height: number }

  /** Purely visual bobbing, so loose items read as pickup-able. */
  bob?: { phase: number; baseY: number }

  /** Fire and smoke visuals, driven by the sim rather than driving it. */
  flame?: { light: THREE.PointLight; sprite: THREE.Object3D }

  /** Burnt out. Kept in the scene as a scorch mark. */
  spent?: true
}

export const world = new World<Entity>()

export const queries = {
  simulated: world.with('transform', 'props'),
  burning: world.with('burning', 'props', 'transform'),
  items: world.with('item', 'transform', 'props'),
  meshed: world.with('mesh', 'transform'),
  structures: world.with('structure', 'transform', 'props'),
  blockers: world.with('blocker', 'transform'),
  bobbing: world.with('bob', 'mesh'),
}

/** Reset between runs. Death wipes the world; only the codex survives. */
export function clearWorld(): void {
  for (const e of [...world.entities]) world.remove(e)
}
