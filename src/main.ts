import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { createRng } from './core/rng'
import { Clock, TICK_DT } from './core/clock'
import { IsoCamera } from './render/camera'
import { BAND0 } from './render/palette'
import { buildRegion } from './world/region'
import { queries, world, type Entity } from './ecs/world'
import { fail, ignite, stepFire } from './sim/fire'
import { spatial } from './sim/spatial'
import { applyReactions } from './props/derive'
import { p, type PropertyId } from './props/registry'
import { buildItemMesh } from './render/kitbash'
import { CATALOG } from './items/catalog'
import { Ui } from './ui/interface'

/**
 * SINTER, alpha slice.
 *
 * Band 0 only: a clearing, a river, an oak wood, and a palisade with no
 * authored solution. Items are property bags, merges are irreversible, and fire
 * reads FLAMMABLE. Everything below is glue; the game is in `sim/`, `props/`
 * and `items/`.
 *
 * The headless contract that `tools/shot.ts` depends on lives at the bottom of
 * this file: `?seed=&ticks=` runs the sim with no wall clock and then sets
 * `window.__sinterReady`. Do not break either branch.
 */

const params = new URLSearchParams(location.search)
const SEED = params.get('seed') ?? 'hearth-0'
const HEADLESS_TICKS = params.has('ticks') ? Number(params.get('ticks')) : 0
/** `?ignite=x,z` lights a fire at world (x,z) on boot, for before/after shots. */
const IGNITE_AT = params.get('ignite')
/** `?at=x,z` starts the player somewhere specific, so a shot can frame a place. */
const START_AT = params.get('at')
/** `?pack=branch,flint` fills the pack and opens it. A dev aid for UI shots. */
const PACK = params.get('pack')

const rng = createRng(SEED)
const clock = new Clock()

await RAPIER.init()

// ---------------------------------------------------------------- rendering

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(BAND0.sky)

const iso = new IsoCamera(innerWidth / innerHeight)
iso.viewSize = 21

// Fog MUST be derived from the camera distance, never hardcoded. With an
// orthographic rig everything sits ~`distance` deep, so absolute fog values
// silently drown the whole scene instead of just the far edge. (DECISIONS D9)
scene.fog = new THREE.Fog(BAND0.sky, iso.distance + BAND0.fogNear, iso.distance + BAND0.fogFar)

scene.add(new THREE.HemisphereLight(BAND0.skyLight, BAND0.groundLight, 1.15))

// The sun's azimuth must differ from the camera's, or every shadow falls
// directly behind its own caster and is invisible from this angle. (DECISIONS D9)
const sun = new THREE.DirectionalLight(BAND0.sun, 2.5)
sun.position.set(42, 46, -34)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.bias = -0.0006
sun.shadow.normalBias = 0.03
const sc = sun.shadow.camera
sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 190
sc.updateProjectionMatrix()
scene.add(sun)
scene.add(sun.target)

// ---------------------------------------------------------------- physics

const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
physics.timestep = TICK_DT

// ---------------------------------------------------------------- region

const region = buildRegion(rng, scene)

if (START_AT) {
  const [sx, sz] = START_AT.split(',').map(Number)
  region.playerStart.set(sx ?? 0, region.heightAt(sx ?? 0, sz ?? 0) + 2, sz ?? 0)
}

// A trimesh built from the exact terrain geometry, so what the player walks on
// is what the player sees. A heightfield would be cheaper but reintroduces the
// risk of physics and visuals disagreeing about which way the grid runs.
{
  const terrain = region.group.children[0] as THREE.Mesh
  const pos = terrain.geometry.attributes.position!
  const idx = terrain.geometry.index!
  physics.createCollider(
    RAPIER.ColliderDesc.trimesh(
      new Float32Array(pos.array),
      new Uint32Array(idx.array),
    ),
    physics.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  )
}

// ---------------------------------------------------------------- player

const PLAYER_RADIUS = 0.34
const PLAYER_HALF_HEIGHT = 0.5
const MOVE_SPEED = 8.5

const playerMesh = new THREE.Group()
{
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HALF_HEIGHT * 2, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xe4dcc8, roughness: 0.7, flatShading: true }),
  )
  body.castShadow = true
  const cloak = new THREE.Mesh(
    new THREE.ConeGeometry(0.46, 0.85, 8),
    new THREE.MeshStandardMaterial({ color: 0x7d5f45, roughness: 1, flatShading: true }),
  )
  cloak.position.y = -0.2
  cloak.castShadow = true
  playerMesh.add(body, cloak)
}
scene.add(playerMesh)

// Start the camera already on the player. The follow is a lerp, so without this
// the headless path (which renders a single frame) shoots the world origin.
iso.target.copy(region.playerStart)
iso.update()

const playerBody = physics.createRigidBody(
  RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    region.playerStart.x,
    region.playerStart.y,
    region.playerStart.z,
  ),
)
const playerCollider = physics.createCollider(
  RAPIER.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS),
  playerBody,
)

const controller = physics.createCharacterController(0.02)
controller.enableAutostep(0.6, 0.25, true)
controller.enableSnapToGround(0.6)
controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180)

let verticalVelocity = 0

// ---------------------------------------------------------------- ui

const ui = new Ui({
  onMerged: (result, a, b) => {
    ui.toast('Merged', `${a.name} + ${b.name} → ${result.name}`)
  },
  onDropped: (def) => ui.toast('Dropped', def.name),
})

// ---------------------------------------------------------------- input

const keys = new Set<string>()
/** Edge-triggered keys, consumed once per tick by the interaction system. */
const pressed = new Set<string>()

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase()
  if (k === 'tab') {
    e.preventDefault()
    ui.toggle()
    return
  }
  if (!keys.has(k)) pressed.add(k)
  keys.add(k)
  if (k === 'q') iso.rotate(-1)
  if (k === 'e') iso.rotate(1)
})
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight)
  iso.setAspect(innerWidth / innerHeight)
})

// ---------------------------------------------------------------- affordances

interface Affordance {
  label: string
  run: () => void
}

/**
 * What the player can do to a thing, given what they are carrying.
 *
 * Read this list and note that the palisade is never mentioned. Each entry asks
 * a question about properties, so every one of them works on a tree, a crate, a
 * hut wall, or anything generated years from now. That is rule 1: obstacles are
 * facts, and anything that changes the facts gets you past them.
 */
function affordances(target: Entity): Affordance[] {
  const out: Affordance[] = []
  const props = target.props ?? {}

  const cut = ui.findCarried('TOOL_CUTTING', 0.45)
  if (cut && target.structure) {
    out.push({
      label: `Chop with ${cut.name}`,
      run: () => {
        const damage = 34 * (cut.props.TOOL_CUTTING ?? 0.5)
        target.structure!.hp -= damage
        ui.toast('Chopped', `${target.structure!.label} takes ${Math.round(damage)}`)
        if (target.structure!.hp <= 0) collapse(target)
      },
    })
  }

  const hot = ui.findCarried('HOT', 0.35)
  if (hot && p(props, 'FLAMMABLE') > 0.15 && !target.burning && !target.spent) {
    out.push({
      label: `Set alight with ${hot.name}`,
      run: () => {
        ignite(target)
        ui.toast('Lit', `${hot.name} touches it off`, 'fire')
        ui.flash()
      },
    })
  }

  const water = ui.findCarried('WATER', 0.5)
  if (water && (target.burning || p(props, 'FLAMMABLE') > 0.15)) {
    out.push({
      label: `Douse with ${water.name}`,
      run: () => {
        target.props = applyReactions({ ...target.props, WATER: 1, WET: 1 })
        if (target.burning) world.removeComponent(target, 'burning')
        ui.consume(water)
        ui.toast('Doused', 'Soaked through. It will not catch now.')
      },
    })
  }

  const ladder = ui.findCarried('LADDER_LIKE', 0.45)
  if (ladder && target.blocker) {
    out.push({
      label: `Climb using ${ladder.name}`,
      run: () => {
        const t = target.transform!
        // Over, not through. Leaves the ladder behind in the world.
        const side = playerPos().z > t.pos.z ? -1 : 1
        placeInWorld(ladder, t.pos.x, t.pos.z - side * 0.9)
        ui.consume(ladder)
        teleport(t.pos.x, t.pos.z + side * 2.4)
        ui.toast('Climbed', `Over the ${target.structure?.label ?? 'obstacle'}`)
      },
    })
  }

  const maul = ui.findCarried('TOOL_STRIKING', 0.5)
  if (maul && target.structure) {
    out.push({
      label: `Batter with ${maul.name}`,
      run: () => {
        const damage = 26 * (maul.props.TOOL_STRIKING ?? 0.5)
        target.structure!.hp -= damage
        ui.toast('Struck', `${target.structure!.label} takes ${Math.round(damage)}`)
        if (target.structure!.hp <= 0) collapse(target)
      },
    })
  }

  return out
}

function collapse(e: Entity): void {
  fail(e, { onStructureFail: onFail })
}

function onFail(e: Entity): void {
  const label = e.structure?.label ?? 'It'
  ui.toast('Fell', `${label} came down`)
  if (e.mesh) {
    e.mesh.rotation.z += 1.25
    e.mesh.position.y -= (e.structure?.height ?? 2) * 0.34
    e.mesh.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
      if (m && 'color' in m) {
        const dark = m.clone()
        dark.color.multiplyScalar(0.35)
        ;(o as THREE.Mesh).material = dark
      }
    })
  }
}

// ---------------------------------------------------------------- world ops

function playerPos(): THREE.Vector3 {
  const t = playerBody.translation()
  return new THREE.Vector3(t.x, t.y, t.z)
}

function teleport(x: number, z: number): void {
  playerBody.setTranslation({ x, y: region.heightAt(x, z) + 1.6, z }, true)
  verticalVelocity = 0
}

function placeInWorld(def: { id: string; name: string; props: Record<string, number | undefined>; parts: unknown }, x: number, z: number): void {
  const full = def as unknown as Parameters<typeof buildItemMesh>[0]
  const y = region.heightAt(x, z) + 0.42
  const mesh = buildItemMesh(full)
  mesh.position.set(x, y, z)
  scene.add(mesh)
  world.add({
    transform: { pos: new THREE.Vector3(x, y, z), ry: 0 },
    mesh,
    props: { ...full.props },
    item: { def: full },
    bob: { phase: 0, baseY: y },
  })
}

// ---------------------------------------------------------------- fire visuals

const flameGeo = new THREE.ConeGeometry(0.42, 1.25, 7)
const flameMat = new THREE.MeshBasicMaterial({ color: BAND0.flame, transparent: true, opacity: 0.85 })

function syncFireVisuals(): void {
  for (const e of queries.burning) {
    if (!e.flame) {
      const sprite = new THREE.Mesh(flameGeo, flameMat)
      const light = new THREE.PointLight(BAND0.ember, 0, 11, 2)
      const at = e.transform.pos
      sprite.position.set(at.x, at.y + 0.7, at.z)
      light.position.copy(sprite.position)
      scene.add(sprite, light)
      world.addComponent(e, 'flame', { light, sprite })
    }
    const f = e.flame!
    const heat = e.burning.heat
    const flicker = 0.82 + Math.sin(e.burning.age * 17) * 0.18
    f.sprite.scale.setScalar(heat * flicker * 1.5)
    f.light.intensity = heat * 22 * flicker
    ;(f.sprite as THREE.Mesh).visible = true
  }

  // Anything that stopped burning loses its flame.
  for (const e of world.entities) {
    if (e.flame && !e.burning) {
      scene.remove(e.flame.sprite, e.flame.light)
      world.removeComponent(e, 'flame')
      if (e.mesh) {
        e.mesh.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
          if (m && 'color' in m) {
            const charred = m.clone()
            charred.color.multiplyScalar(0.28)
            ;(o as THREE.Mesh).material = charred
          }
        })
      }
    }
  }
}

// ---------------------------------------------------------------- interaction

let focus: Entity | null = null
let focusAffordances: Affordance[] = []
const nearby: Entity[] = []

function updateFocus(): void {
  const at = playerPos()

  let bestItem: Entity | null = null
  let bestItemDist = 2.3
  let bestTarget: Entity | null = null
  let bestTargetDist = 3.4

  spatial.near(at.x, at.z, 4, nearby)
  for (const e of nearby) {
    const d = Math.hypot(e.transform!.pos.x - at.x, e.transform!.pos.z - at.z)
    if (e.item && d < bestItemDist) {
      bestItem = e
      bestItemDist = d
    }
    if (!e.item && (e.structure || p(e.props ?? {}, 'FLAMMABLE') > 0.15) && d < bestTargetDist) {
      bestTarget = e
      bestTargetDist = d
    }
  }

  // Picking something up beats acting on scenery when both are in range.
  if (bestItem) {
    focus = bestItem
    focusAffordances = []
    ui.prompt(`<span class="key">F</span> take ${bestItem.item!.def.name}`)
    return
  }

  if (bestTarget) {
    focus = bestTarget
    focusAffordances = affordances(bestTarget)
    if (focusAffordances.length > 0) {
      const label = bestTarget.label ?? bestTarget.structure?.label ?? 'It'
      const lines = focusAffordances
        .map((a, i) => `<span class="key">${i + 1}</span> ${a.label}`)
        .join('&nbsp;&nbsp; ')
      ui.prompt(`${label}&nbsp;&nbsp;${lines}`)
      return
    }
  }

  focus = null
  focusAffordances = []
  ui.prompt(null)
}

function handleInput(): void {
  if (pressed.has('f') && focus?.item) {
    ui.add(focus.item.def)
    if (focus.mesh) scene.remove(focus.mesh)
    world.remove(focus)
    focus = null
  }

  if (pressed.has('g')) {
    const def = ui.takeLast()
    if (def) {
      const at = playerPos()
      const basis = iso.screenBasis()
      placeInWorld(def, at.x + basis.forward.x * 1.4, at.z + basis.forward.z * 1.4)
      ui.toast('Dropped', def.name)
    }
  }

  for (let i = 0; i < focusAffordances.length && i < 5; i++) {
    if (pressed.has(String(i + 1))) {
      focusAffordances[i]!.run()
      break
    }
  }

  pressed.clear()
}

// ---------------------------------------------------------------- simulation

let crossed = false

function stepSimulation(): void {
  // ------------------------------------------------------------- player move
  const { forward, right } = iso.screenBasis()
  const wish = new THREE.Vector3()
  if (keys.has('w')) wish.add(forward)
  if (keys.has('s')) wish.sub(forward)
  if (keys.has('d')) wish.add(right)
  if (keys.has('a')) wish.sub(right)
  if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(MOVE_SPEED * TICK_DT)

  // Blockers are resolved in code, not in physics, so that a structure failing
  // is a single component removal rather than a collider teardown.
  const at = playerPos()
  for (const b of queries.blockers) {
    const dx = at.x + wish.x - b.transform.pos.x
    const dz = at.z + wish.z - b.transform.pos.z
    const r = b.blocker.radius + PLAYER_RADIUS
    const d = Math.hypot(dx, dz)
    if (d < r && d > 1e-4) {
      const push = (r - d) / d
      wish.x += dx * push
      wish.z += dz * push
    }
  }

  verticalVelocity += -9.81 * TICK_DT
  if (controller.computedGrounded()) verticalVelocity = Math.min(verticalVelocity, 0)

  controller.computeColliderMovement(playerCollider, {
    x: wish.x,
    y: verticalVelocity * TICK_DT,
    z: wish.z,
  })

  const moved = controller.computedMovement()
  const now = playerBody.translation()
  playerBody.setNextKinematicTranslation({
    x: now.x + moved.x,
    y: now.y + moved.y,
    z: now.z + moved.z,
  })

  physics.step()

  // ---------------------------------------------------------------- systems
  stepFire(rng.fork(`fire:${clock.tick}`), {
    onIgnite: (e) => {
      if (e.structure) ui.toast('Caught', `${e.structure.label} is alight`, 'fire')
    },
    onStructureFail: onFail,
  })

  // ------------------------------------------------------------- win check
  if (!crossed && playerBody.translation().z < -17.5) {
    crossed = true
    ui.objective('Through.', 'The wood on the far side is older. Keep going.')
    ui.toast('Onward', 'You are past the palisade')
  }
}

function syncMeshes(): void {
  const at = playerPos()
  playerMesh.position.set(at.x, at.y, at.z)

  for (const e of queries.bobbing) {
    e.bob.phase += TICK_DT * 1.6
    e.mesh.position.y = e.bob.baseY + Math.sin(e.bob.phase) * 0.07
    e.mesh.rotation.y += TICK_DT * 0.4
  }

  syncFireVisuals()

  iso.target.lerp(playerMesh.position, 0.16)
  iso.update()
  sun.target.position.copy(iso.target)
  sun.position.set(iso.target.x + 42, iso.target.y + 46, iso.target.z - 34)
}

// ---------------------------------------------------------------- hud

const hud = document.getElementById('hud')!

function updateHud(fps: number): void {
  const at = playerPos()
  let burning = 0
  for (const _ of queries.burning) burning++

  hud.innerHTML = [
    `<b>SINTER</b>  band 0 · hearth`,
    `seed     ${SEED}`,
    `tick     ${clock.tick}`,
    `fps      ${fps.toFixed(0)}`,
    `pos      ${at.x.toFixed(1)} ${at.z.toFixed(1)}`,
    `carried  ${ui.count}`,
    `codex    ${ui.codex.size} merges known`,
    burning > 0 ? `<b style="color:#ff8244">burning  ${burning}</b>` : `burning  0`,
  ].join('\n')
}

// ---------------------------------------------------------------- run

declare global {
  interface Window { __sinterReady?: boolean }
}

if (PACK) {
  for (const id of PACK.split(',')) {
    const def = CATALOG[id.trim()]
    if (def) ui.add(def)
  }
  ui.toggle()
  const slots = params.get('slots')
  if (slots) for (const i of slots.split(',')) ui.select(Number(i))
}

if (IGNITE_AT) {
  const [ix, iz] = IGNITE_AT.split(',').map(Number)
  spatial.rebuild(queries.simulated)
  const found = spatial.near(ix ?? 0, iz ?? 0, 3.5)
  const fuel = found.filter((e) => p(e.props ?? {}, 'FLAMMABLE') > 0.3)
  if (fuel[0]) ignite(fuel[0])
}

if (HEADLESS_TICKS > 0) {
  // Deterministic path for the screenshot harness: no wall clock at all.
  for (let i = 0; i < HEADLESS_TICKS; i++) {
    stepSimulation()
    clock.forceTicks(1)
  }
  syncMeshes()
  updateFocus()
  updateHud(0)
  iso.update()
  renderer.render(scene, iso.camera)
  window.__sinterReady = true
} else {
  let lastFpsSample = performance.now()
  let framesSinceSample = 0
  let fps = 0

  renderer.setAnimationLoop((nowMs) => {
    const { ticks } = clock.advance(nowMs)
    for (let i = 0; i < ticks; i++) stepSimulation()

    updateFocus()
    handleInput()
    syncMeshes()

    framesSinceSample++
    if (nowMs - lastFpsSample > 500) {
      fps = (framesSinceSample * 1000) / (nowMs - lastFpsSample)
      lastFpsSample = nowMs
      framesSinceSample = 0
    }
    updateHud(fps)

    renderer.render(scene, iso.camera)
    window.__sinterReady = true
  })
}
