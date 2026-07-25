/**
 * Item icons, rendered from the assembled mesh.
 *
 * The obvious approach is an icon file per item. That is impossible here, and
 * not merely expensive: the catalog is closed under merging, so results merge
 * again and the number of reachable items is unbounded. Ten base items give 45
 * pairs, those 55 items give 1,485, the next round gives over a million. No
 * amount of authoring or generation covers that.
 *
 * So icons are rendered on demand from the same kitbash assembly that appears
 * in the world, once per item, cached as a data URL. The cost is one small
 * offscreen draw the first time an item is seen and nothing thereafter, and a
 * merge result's icon shows the parts it inherited from both parents, which is
 * the whole readability argument in DECISIONS D6 finally showing up in the UI.
 *
 * Deliberately its own renderer and scene. Borrowing the main one would mean
 * saving and restoring its camera, size and render target on every icon, and
 * getting that wrong shows up as a corrupted frame rather than a bad icon.
 */

import * as THREE from 'three'
import type { ItemDef } from '../items/catalog'
import { buildItemMesh } from './kitbash'

const SIZE = 96

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.OrthographicCamera | null = null

const cache = new Map<string, string>()

function init(): void {
  if (renderer) return

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false })
  renderer.setSize(SIZE, SIZE, false)
  renderer.setClearColor(0x000000, 0)

  scene = new THREE.Scene()

  // Lit from the front-ish rather than matching the world's sun. An icon has no
  // context to read depth from, so it needs its own flatter, kinder light or
  // half of every item is a silhouette.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x606060, 2.2))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(2, 3, 4)
  scene.add(key)

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 40)
  // Three-quarter view, so depth reads without matching the isometric angle
  // exactly. A pure iso icon of a flat plank is a line.
  camera.position.set(2.1, 2.0, 2.6)
  camera.lookAt(0, 0, 0)
}

/**
 * A data URL for this item's icon. Same input always gives the same output, and
 * the work happens once.
 */
export function itemIcon(def: ItemDef): string {
  const hit = cache.get(def.id)
  if (hit) return hit

  init()
  const r = renderer!
  const s = scene!
  const cam = camera!

  const mesh = buildItemMesh(def)
  // The world uses a legibility scale that would clip inside a fixed icon frame.
  mesh.scale.setScalar(1)
  s.add(mesh)

  // Frame the item: fit the camera to its bounds so a nail and a plank both
  // fill the tile. Without this, small items are specks in the inventory.
  const box = new THREE.Box3().setFromObject(mesh)
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const centre = sphere.center
  const radius = Math.max(sphere.radius, 0.05) * 1.15

  cam.left = -radius
  cam.right = radius
  cam.top = radius
  cam.bottom = -radius
  cam.position.set(centre.x + radius * 2.1, centre.y + radius * 2.0, centre.z + radius * 2.6)
  cam.lookAt(centre)
  cam.updateProjectionMatrix()

  r.render(s, cam)
  const url = r.domElement.toDataURL('image/png')

  s.remove(mesh)
  mesh.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) m.geometry?.dispose?.()
  })

  cache.set(def.id, url)
  return url
}
