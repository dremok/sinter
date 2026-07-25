import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { createRng } from './core/rng'
import { Clock, TICK_DT } from './core/clock'
import { IsoCamera } from './render/camera'

/**
 * Vertical slice skeleton.
 *
 * This exists to prove the stack works end to end: orthographic isometric
 * rendering, Rapier physics on a fixed timestep, seeded determinism, and a
 * controllable character. It is NOT the game and it is NOT the architecture.
 * See docs/ARCHITECTURE.md for where things actually belong. Expect to delete
 * most of this file as real systems land.
 */

const params = new URLSearchParams(location.search)
const SEED = params.get('seed') ?? 'hearth-0'
const HEADLESS_TICKS = params.has('ticks') ? Number(params.get('ticks')) : 0

const rng = createRng(SEED)
const clock = new Clock()

await RAPIER.init()

// ---------------------------------------------------------------- rendering

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x9db9c4)

const iso = new IsoCamera(innerWidth / innerHeight)

// Fog MUST be derived from the camera distance, never hardcoded. With an
// orthographic rig everything sits ~`distance` deep, so absolute fog values
// silently drown the whole scene instead of just the far edge.
scene.fog = new THREE.Fog(0x9db9c4, iso.distance + 20, iso.distance + 90)

scene.add(new THREE.HemisphereLight(0xbfd4e0, 0x4a4335, 1.0))

// The sun's azimuth must differ from the camera's, or every shadow falls
// directly behind its own caster and is invisible from this angle. Roughly
// perpendicular gives lit faces AND readable shadows.
const sun = new THREE.DirectionalLight(0xfff2d8, 2.6)
sun.position.set(38, 52, -32)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.bias = -0.0005
const sc = sun.shadow.camera
sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.far = 160
sc.updateProjectionMatrix()
scene.add(sun)
scene.add(sun.target)

// ---------------------------------------------------------------- physics

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
world.timestep = TICK_DT

/** Everything that needs its mesh synced from a rigid body each frame. */
const bodies: { mesh: THREE.Object3D; body: RAPIER.RigidBody }[] = []

function addGround(size: number): void {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, 1, size),
    new THREE.MeshStandardMaterial({ color: 0x6f8f4f, roughness: 1 }),
  )
  mesh.position.y = -0.5
  mesh.receiveShadow = true
  scene.add(mesh)

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0))
  world.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, 0.5, size / 2), body)
}

function addCrate(x: number, y: number, z: number, s: number, color: number): void {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(s, s, s),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
  )
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z))
  world.createCollider(RAPIER.ColliderDesc.cuboid(s / 2, s / 2, s / 2), body)
  bodies.push({ mesh, body })
}

addGround(80)

// A seeded scatter of crates, so the same seed always produces the same scene.
const woodTones = [0x8b6b43, 0x9c7c4f, 0x7a5c3a, 0xa88a5c] as const
for (let i = 0; i < 40; i++) {
  addCrate(
    rng.range(-18, 18),
    rng.range(0.5, 9),
    rng.range(-18, 18),
    rng.range(0.7, 1.5),
    rng.pick(woodTones),
  )
}

// ---------------------------------------------------------------- player

const PLAYER_RADIUS = 0.4
const PLAYER_HALF_HEIGHT = 0.55
const MOVE_SPEED = 7

const playerMesh = new THREE.Mesh(
  new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HALF_HEIGHT * 2, 6, 12),
  new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.6 }),
)
playerMesh.castShadow = true
scene.add(playerMesh)

const playerBody = world.createRigidBody(
  RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 4, 0),
)
const playerCollider = world.createCollider(
  RAPIER.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS),
  playerBody,
)

const controller = world.createCharacterController(0.02)
controller.enableAutostep(0.5, 0.2, true)
controller.enableSnapToGround(0.5)
controller.setApplyImpulsesToDynamicBodies(true)

let verticalVelocity = 0

// ---------------------------------------------------------------- input

const keys = new Set<string>()
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase()
  if (k === 'q') iso.rotate(-1)
  if (k === 'e') iso.rotate(1)
  keys.add(k)
})
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight)
  iso.setAspect(innerWidth / innerHeight)
})

// ---------------------------------------------------------------- simulation

function stepSimulation(): void {
  const { forward, right } = iso.screenBasis()
  const wish = new THREE.Vector3()
  if (keys.has('w')) wish.add(forward)
  if (keys.has('s')) wish.sub(forward)
  if (keys.has('d')) wish.add(right)
  if (keys.has('a')) wish.sub(right)
  if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(MOVE_SPEED * TICK_DT)

  verticalVelocity += -9.81 * TICK_DT
  if (controller.computedGrounded()) verticalVelocity = Math.min(verticalVelocity, 0)

  controller.computeColliderMovement(playerCollider, {
    x: wish.x,
    y: verticalVelocity * TICK_DT,
    z: wish.z,
  })

  const moved = controller.computedMovement()
  const at = playerBody.translation()
  playerBody.setNextKinematicTranslation({
    x: at.x + moved.x,
    y: at.y + moved.y,
    z: at.z + moved.z,
  })

  world.step()
}

function syncMeshes(): void {
  for (const { mesh, body } of bodies) {
    const t = body.translation()
    const r = body.rotation()
    mesh.position.set(t.x, t.y, t.z)
    mesh.quaternion.set(r.x, r.y, r.z, r.w)
  }
  const p = playerBody.translation()
  playerMesh.position.set(p.x, p.y, p.z)
  iso.target.lerp(playerMesh.position, 0.15)
  iso.update()
}

// ---------------------------------------------------------------- run

const hud = document.getElementById('hud')!
let fps = 0

function updateHud(): void {
  const p = playerBody.translation()
  hud.textContent = [
    `SINTER  skeleton`,
    `seed    ${SEED}`,
    `tick    ${clock.tick}`,
    `fps     ${fps.toFixed(0)}`,
    `pos     ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
    ``,
    `WASD move   Q/E rotate camera`,
  ].join('\n')
}

declare global {
  interface Window { __sinterReady?: boolean }
}

if (HEADLESS_TICKS > 0) {
  // Deterministic path for the screenshot harness: no wall clock at all.
  for (let i = 0; i < HEADLESS_TICKS; i++) stepSimulation()
  clock.forceTicks(HEADLESS_TICKS)
  syncMeshes()
  iso.update()
  updateHud()
  renderer.render(scene, iso.camera)
  window.__sinterReady = true
} else {
  let lastFpsSample = performance.now()
  let framesSinceSample = 0

  renderer.setAnimationLoop((now) => {
    const { ticks } = clock.advance(now)
    for (let i = 0; i < ticks; i++) stepSimulation()
    syncMeshes()

    framesSinceSample++
    if (now - lastFpsSample > 500) {
      fps = (framesSinceSample * 1000) / (now - lastFpsSample)
      lastFpsSample = now
      framesSinceSample = 0
      updateHud()
    }

    renderer.render(scene, iso.camera)
    window.__sinterReady = true
  })
}
