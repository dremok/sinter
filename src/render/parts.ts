/**
 * The kitbash parts library, authored in Blender.
 *
 * `tools/blender/build_parts.py` produces `assets/parts/parts.glb`, one file
 * holding every part as a named mesh. This loads it once and hands out shared
 * geometry by name. Materials are deliberately absent from the file: an item's
 * recipe decides what each part is made of, which is what lets the same
 * `haft_short` be an oak handle on one item and an iron bar on another.
 *
 * Parts are authored with their origin at the attachment point rather than the
 * centroid, so placing one at a socket needs no per-part fudge offsets here.
 * If an assembly looks offset by half a part, the pivot is wrong in the Blender
 * script, not in this file.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import PARTS_URL from '../../assets/parts/parts.glb?url'

const geometries = new Map<string, THREE.BufferGeometry>()

/** Must be awaited before anything builds an item mesh. */
export async function loadParts(): Promise<void> {
  const gltf = await new GLTFLoader().loadAsync(PARTS_URL)

  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return

    const geo = mesh.geometry.clone()
    // Bake the object transform in, so a part is positioned purely by the
    // recipe rather than by whatever transform Blender happened to export.
    mesh.updateWorldMatrix(true, false)
    geo.applyMatrix4(mesh.matrixWorld)
    geo.computeVertexNormals()

    geometries.set(mesh.name, geo)
  })

  if (geometries.size === 0) throw new Error('parts.glb contained no meshes')
}

export function partGeometry(name: string): THREE.BufferGeometry {
  const geo = geometries.get(name)
  if (!geo) {
    throw new Error(`unknown part "${name}". Available: ${[...geometries.keys()].sort().join(', ')}`)
  }
  return geo
}

export function partNames(): string[] {
  return [...geometries.keys()].sort()
}
