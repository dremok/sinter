/**
 * Dark outlines, by inverted hull.
 *
 * The loudest signature in the reference (Don't Starve), and the structural fix
 * for a frame where 76% of pixels sat in one hue bucket and the player could
 * not be found in greyscale. Tuning colours cannot solve that, because the
 * problem is not which greens are used, it is that a green object in front of
 * green ground has no boundary. An outline guarantees the boundary exists
 * whatever ends up behind whatever.
 *
 * Each outlined mesh gets a second draw: the same geometry with `BackSide`, a
 * flat unlit dark material, and every vertex pushed out along its normal. Only
 * the part that pokes past the real mesh survives the depth test, which is
 * exactly the silhouette.
 *
 * Two things make it work rather than nearly work:
 *
 * 1. **Baked smooth normals.** Pushing along the shading normal tears hard-
 *    surface geometry apart: a box has three normals at every corner, so the six
 *    faces fly apart and the outline is six disjoint quads with holes at every
 *    corner. Nearly all this file is the fix, which is to average normals across
 *    vertices that share a position and push along *that*. The result is stored
 *    as a second attribute on the source geometry, so the real mesh still shades
 *    with its true hard normals and only the hull uses the smoothed ones.
 *
 * 2. **The push happens in view space.** Object space would be scaled by
 *    whatever non-uniform scale the mesh carries, and half the props here are
 *    unit cylinders scaled to length, so their outlines would be thin on one
 *    axis and fat on another. `normalMatrix` handles that correctly, and under
 *    an orthographic camera a constant view-space width is a constant width on
 *    screen.
 */

import * as THREE from 'three'

/** Warm-dark rather than black, so the line sits inside the palette instead of
 *  on top of it. Pure black against warm ground reads as a missing pixel. */
export const OUTLINE_COLOR = 0x241a16

const SMOOTH = 'aSmoothNormal'

/**
 * Average the normals of every vertex that shares a position, and store the
 * result on the geometry as `aSmoothNormal`.
 *
 * Additive: the source geometry keeps its own `normal`, so nothing about how the
 * mesh shades changes. Idempotent, and cheap enough to run at load for every
 * distinct geometry in the scene.
 */
function bakeSmoothNormals(geo: THREE.BufferGeometry): boolean {
  if (geo.getAttribute(SMOOTH)) return true

  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!pos) return false
  if (!geo.getAttribute('normal')) geo.computeVertexNormals()
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute

  // Quantised to a tenth of a millimetre. Vertices that were split for shading
  // or for UVs sit at bit-identical positions, so this only merges what was one
  // point to begin with.
  const key = (i: number): string =>
    `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`

  const sums = new Map<string, THREE.Vector3>()
  for (let i = 0; i < pos.count; i++) {
    const k = key(i)
    const acc = sums.get(k)
    if (acc) acc.set(acc.x + nrm.getX(i), acc.y + nrm.getY(i), acc.z + nrm.getZ(i))
    else sums.set(k, new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)))
  }

  const out = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.copy(sums.get(key(i))!)
    // A vertex whose normals cancel exactly (a zero-thickness fin) has no
    // meaningful direction to grow in. Fall back to its own normal.
    if (v.lengthSq() < 1e-8) v.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i))
    v.normalize()
    out[i * 3] = v.x
    out[i * 3 + 1] = v.y
    out[i * 3 + 2] = v.z
  }

  geo.setAttribute(SMOOTH, new THREE.BufferAttribute(out, 3))
  return true
}

const VERT = /* glsl */ `
attribute vec3 aSmoothNormal;
uniform float uWidth;
#include <common>
#include <fog_pars_vertex>

void main() {
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  mvPosition.xyz += normalize( normalMatrix * aSmoothNormal ) * uWidth;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAG = /* glsl */ `
uniform vec3 uColor;
#include <common>
#include <fog_pars_fragment>

void main() {
  gl_FragColor = vec4( uColor, 1.0 );
  #include <fog_fragment>
}
`

const materials = new Map<string, THREE.ShaderMaterial>()

function outlineMaterial(width: number, color: number): THREE.ShaderMaterial {
  const id = `${width}:${color}`
  const hit = materials.get(id)
  if (hit) return hit

  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uWidth: { value: width }, uColor: { value: new THREE.Color(color) } },
    ]),
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    // Fogged, so a distant outline fades into the haze with the thing it is
    // drawn around. An unfogged outline stays jet black at the tree line and
    // pins the far edge of the world to the front of the frame.
    fog: true,
  })
  materials.set(id, m)
  return m
}

/** Set on both the source mesh and the hull, so a second pass never doubles up
 *  and the shadow pass never treats a hull as geometry. */
const MARK = 'outlined'

function isOutlineHull(o: THREE.Object3D): boolean {
  return o.userData.outlineHull === true
}

/**
 * Give every mesh under `root` an outline.
 *
 * Skips anything already outlined, anything flagged `userData.noOutline`, and
 * anything the caller's `skip` rejects.
 */
export function applyOutlines(
  root: THREE.Object3D,
  width: number,
  skip?: (mesh: THREE.Mesh) => boolean,
): void {
  const pending: THREE.Mesh[] = []

  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    if (isOutlineHull(mesh) || mesh.userData[MARK] || mesh.userData.noOutline) return
    if (skip?.(mesh)) return
    pending.push(mesh)
  })

  for (const mesh of pending) {
    mesh.userData[MARK] = true
    if (!bakeSmoothNormals(mesh.geometry)) continue

    const hull = new THREE.Mesh(mesh.geometry, outlineMaterial(width, OUTLINE_COLOR))
    hull.userData.outlineHull = true
    // It is a silhouette, not an object. It must not cast, receive, or be
    // picked up by anything that walks the scene looking for geometry.
    hull.userData.noShadow = true
    hull.castShadow = false
    hull.receiveShadow = false
    hull.frustumCulled = mesh.frustumCulled
    // Drawn before the mesh it belongs to, so the mesh's own depth writes trim
    // it back to the rim rather than the other way round.
    hull.renderOrder = mesh.renderOrder - 1
    mesh.add(hull)
  }
}
