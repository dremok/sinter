import * as THREE from 'three'
import { createRng } from './core/rng'
import { Clock, TICK_DT } from './core/clock'
import { IsoCamera } from './render/camera'
import { BAND0 } from './render/palette'
import { Grade, groundBlob, sizeToPixelBuffer, toonUnique } from './render/toon'
import { Flame } from './render/flame'
import { loadParts } from './render/parts'
import { Character } from './render/character'
import { BOUNDS, buildRegion } from './world/region'
import { queries, world, type Entity } from './ecs/world'
import { fail, ignite, stepFire } from './sim/fire'
import { spatial } from './sim/spatial'
import { applyReactions } from './props/derive'
import { p } from './props/registry'
import { buildItemMesh } from './render/kitbash'
import { CATALOG, type ItemDef } from './items/catalog'
import { Ui } from './ui/interface'

/**
 * SINTER, alpha slice.
 *
 * One small Band 0 clearing with ten items and a palisade that has no authored
 * solution. Items are property bags, merges are irreversible, fire reads
 * FLAMMABLE. Everything here is glue; the game is in `sim/`, `props/`, `items/`.
 *
 * The headless contract that `tools/shot.ts` depends on lives at the bottom:
 * `?seed=&ticks=` runs the sim with no wall clock and then sets
 * `window.__sinterReady`. Do not break either branch.
 */

const params = new URLSearchParams(location.search)
const SEED = params.get('seed') ?? 'hearth-0'
const HEADLESS_TICKS = params.has('ticks') ? Number(params.get('ticks')) : 0
const IGNITE_AT = params.get('ignite')
const START_AT = params.get('at')
const PACK = params.get('pack')

const rng = createRng(SEED)
const clock = new Clock()

// TEMP PERF INSTRUMENTATION
const __t: Record<string, number> = { moduleStart: performance.now() }

// The kitbash library has to be in memory before anything assembles an item.
// Top-level await, so the headless harness still sees a single settled frame.
await loadParts()
__t.parts = performance.now()

// ---------------------------------------------------------------- rendering

const renderer = new THREE.WebGLRenderer({ antialias: false })
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
document.body.appendChild(renderer.domElement)

// Antialiasing is off and the buffer is tiny on purpose: crisp pixel edges are
// the entire look, and AA would smear them back into mush.
sizeToPixelBuffer(renderer, innerWidth, innerHeight)

// One fullscreen pass on the way to the canvas: shoulder, split tone, contrast,
// vignette. No post-processing dependency, one extra draw.
const grade = new Grade()

const scene = new THREE.Scene()

const iso = new IsoCamera(innerWidth / innerHeight)
iso.viewSize = 13

/**
 * Aerial perspective.
 *
 * The far end of the clearing should lose contrast and drift toward the colour
 * of the air, which is not the colour of the sky directly overhead: it is the
 * sky with the low sun bleeding into it. Fog and background share it, so the
 * tree line dissolves rather than ending at a hard edge.
 *
 * Range comes from `IsoCamera.fogRange()`, never from absolute numbers. (D9)
 */
const HAZE = new THREE.Color(BAND0.sky).lerp(new THREE.Color(0xf7e6cc), 0.22)
scene.background = HAZE
const fogRange = iso.fogRange()
scene.fog = new THREE.Fog(HAZE, fogRange.near, fogRange.far)

/**
 * Three lights, and each one has a job.
 *
 * The hemisphere is the sky landing on upward faces. The key makes the time of
 * day and is the only thing that casts. The fill comes from the opposite side,
 * cool and low, and exists so the shadow side of everything is a colour rather
 * than an absence: a single directional light plus ambient gives you lit and
 * unlit, which is what made the first pass look like flat vector art.
 *
 * The warm/cool contrast is deliberately built three times over, because each
 * layer reaches somewhere the others cannot. The ramp in `toon.ts` tints the
 * key's own falloff. The fill tints geometry the key never reaches. The grade's
 * split tone catches cast shadows, where the key is switched off entirely and
 * neither of the other two has anything to say.
 */
scene.add(new THREE.HemisphereLight(BAND0.skyLight, BAND0.groundLight, 0.8))

// Sun azimuth must differ from the camera's, or shadows hide behind their own
// casters and read as broken. `iso.sunOffset()` owns that now, at every camera
// angle rather than only the starting one. (DECISIONS D9)
const sun = new THREE.DirectionalLight(new THREE.Color(BAND0.sun).lerp(new THREE.Color(0xffc46a), 0.5), 3.1)
sun.castShadow = true

/**
 * Shadow bounds, sized to what is on screen rather than to the region.
 *
 * The visible ground is about 23 by 22 metres, so ±19 covers it plus the
 * overhang of anything tall enough to cast in from outside the frame. At 2048
 * that is roughly 2cm per texel, which is what makes a fence post read as
 * standing on the ground instead of hovering over a smear.
 *
 * near/far bracket the sun's actual distance for the same reason: a shadow
 * camera 1 to 90 deep spends most of its depth precision on empty air.
 */
const SHADOW_EXTENT = 19
const SUN_REACH = iso.sunOffset().length()
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.022
const sc = sun.shadow.camera
sc.left = -SHADOW_EXTENT; sc.right = SHADOW_EXTENT; sc.top = SHADOW_EXTENT; sc.bottom = -SHADOW_EXTENT
sc.near = Math.max(1, SUN_REACH - SHADOW_EXTENT - 12)
sc.far = SUN_REACH + SHADOW_EXTENT + 12
sc.updateProjectionMatrix()
scene.add(sun, sun.target)

const fill = new THREE.DirectionalLight(new THREE.Color(BAND0.skyLight).lerp(new THREE.Color(0x3f6fc0), 0.6), 0.65)
scene.add(fill, fill.target)

const sunOffset = new THREE.Vector3()

/** Both lights ride with the camera, so the shadow map never wastes texels on
 *  ground the player cannot see and the key stays square to the screen. */
function placeLights(): void {
  iso.sunOffset(sunOffset)
  sun.target.position.copy(iso.target)
  sun.position.copy(iso.target).add(sunOffset)
  // Opposite side, and much lower, so it fills what the key leaves dark instead
  // of doubling it. A fill at the same elevation just washes the whole frame.
  fill.target.position.copy(iso.target)
  fill.position.set(iso.target.x - sunOffset.x * 0.9, iso.target.y + 12, iso.target.z - sunOffset.z * 0.9)
}

// ---------------------------------------------------------------- region

// TEMP PERF INSTRUMENTATION: textures() caches, and forks from the base seed by
// label alone, so pulling it forward here measures it without changing it.
const __tex = await import('./render/textures')
__tex.textures(rng)
__t.textures = performance.now()

// TEMP: per-generator cost. Second copies, thrown away; only the clock matters.
const __texMs: Record<string, number> = {}
if (params.has('texprofile')) {
  const r2 = rng.fork('probe')
  for (const name of [
    'grass', 'sand', 'bark', 'foliage', 'stone', 'plank',
    'straw', 'steel', 'cloth', 'clay', 'water', 'glass', 'gold', 'ember',
  ] as const) {
    const a = performance.now()
    ;(__tex as unknown as Record<string, (r: typeof r2) => unknown>)[name]!(r2)
    __texMs[name] = +(performance.now() - a).toFixed(1)
  }
}

const region = buildRegion(rng, scene)
__t.region = performance.now()

if (START_AT) {
  const [sx, sz] = START_AT.split(',').map(Number)
  region.playerStart.set(sx ?? 0, region.heightAt(sx ?? 0, sz ?? 0), sz ?? 0)
}

// ---------------------------------------------------------------- player

/**
 * Movement is analytic: sample the ground height, move, then push out of
 * blockers. Rapier's character controller on a terrain trimesh was what made
 * the player "get stuck everywhere for no reason", and for a bounded clearing
 * with a dozen circular obstacles a physics engine was never buying anything.
 * Recorded as D13. Rapier comes back when crates, ropes and vehicles need it.
 */
const PLAYER_RADIUS = 0.34
const MOVE_SPEED = 6.5

const character = new Character()
scene.add(character.group)

const player = {
  pos: region.playerStart.clone(),
  speed01: 0,
  heading: null as number | null,
}

iso.target.copy(player.pos)
iso.update()

// ---------------------------------------------------------------- ui

const ui = new Ui({
  onMerged: (result, a, b) => ui.toast('Merged', `${a.name} + ${b.name} → ${result.name}`),
  onDropped: (def) => ui.toast('Dropped', def.name),
})

// ---------------------------------------------------------------- input

const keys = new Set<string>()
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
})

// Camera rotation is deliberately unbound. Q and E used to step the azimuth 90
// degrees, and hitting one by accident was disorienting: the whole world snaps
// and the movement basis rotates under you mid-stride. IsoCamera keeps the
// capability, because the sun and the movement basis are both derived from the
// azimuth and the design still wants "see behind buildings" eventually. It just
// needs to be a considered gesture rather than a stray keypress.
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))
/**
 * Scroll to zoom.
 *
 * Deliberately a narrow range around the default. A wide zoom would let the
 * player pull back until the world is a diorama, which flatters an isometric
 * scene and ruins the sense of being in it; and push in until the fixed camera
 * angle stops working. This is a comfort adjustment, not a strategic view.
 *
 * Fog is derived from viewSize (D9), so zooming changes the fog range too and
 * the far edge stays consistently hazed rather than snapping.
 */
const ZOOM_MIN = 9
const ZOOM_MAX = 19
let zoomTarget = iso.viewSize

addEventListener(
  'wheel',
  (e) => {
    // Trackpads report small deltas continuously and mice report large ones in
    // steps, so scale by magnitude rather than treating every event as a notch.
    const step = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY) * 0.01, 0.8)
    zoomTarget = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomTarget + step))
  },
  { passive: true },
)

addEventListener('resize', () => {
  sizeToPixelBuffer(renderer, innerWidth, innerHeight)
  iso.setAspect(innerWidth / innerHeight)
})

// ---------------------------------------------------------------- affordances

interface Affordance {
  label: string
  run: () => void
}

/**
 * What the player can do to a thing, given what they carry.
 *
 * The palisade is never mentioned. Every entry asks a question about
 * properties, so all of them work on an oak, a rock, or anything generated
 * years from now. That is rule 1: obstacles are facts.
 */
function affordances(target: Entity): Affordance[] {
  const out: Affordance[] = []
  const props = target.props ?? {}

  const cut = ui.findCarried('TOOL_CUTTING', 0.45)
  if (cut && target.structure) {
    out.push({
      label: `Chop with ${cut.name}`,
      run: () => {
        const damage = 30 * (cut.props.TOOL_CUTTING ?? 0.5)
        target.structure!.hp -= damage
        const left = Math.max(0, Math.round((target.structure!.hp / target.structure!.maxHp) * 100))
        ui.toast('Chopped', `${target.structure!.label} at ${left}%`)
        if (target.structure!.hp <= 0) fail(target, { onStructureFail: onFail })
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
        const side = player.pos.z > t.pos.z ? -1 : 1
        placeInWorld(ladder, t.pos.x, t.pos.z - side * 0.9)
        ui.consume(ladder)
        player.pos.set(t.pos.x, region.heightAt(t.pos.x, t.pos.z + side * 2.2), t.pos.z + side * 2.2)
        ui.toast('Climbed', `Over the ${target.label ?? 'obstacle'}`)
      },
    })
  }

  const maul = ui.findCarried('TOOL_STRIKING', 0.5)
  if (maul && target.structure) {
    out.push({
      label: `Batter with ${maul.name}`,
      run: () => {
        target.structure!.hp -= 24 * (maul.props.TOOL_STRIKING ?? 0.5)
        ui.toast('Struck', `${target.structure!.label} shudders`)
        if (target.structure!.hp <= 0) fail(target, { onStructureFail: onFail })
      },
    })
  }

  return out
}

function onFail(e: Entity): void {
  ui.toast('Fell', `${e.label ?? 'It'} came down`)
  if (e.mesh) {
    e.mesh.rotation.z += 1.3
    e.mesh.position.y -= (e.structure?.height ?? 2) * 0.3
    darken(e.mesh, 0.4)
  }
}

function darken(root: THREE.Object3D, factor: number): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    const m = mesh.material as THREE.MeshToonMaterial | undefined
    if (m && 'color' in m) {
      const dark = m.clone()
      dark.color.multiplyScalar(factor)
      mesh.material = dark
    }
  })
}

// ---------------------------------------------------------------- world ops

function placeInWorld(def: ItemDef, x: number, z: number): void {
  const y = region.heightAt(x, z) + 0.45
  const mesh = buildItemMesh(def)
  mesh.position.set(x, y, z)
  region.group.add(mesh)
  world.add({
    transform: { pos: new THREE.Vector3(x, y, z), ry: 0 },
    mesh,
    props: { ...def.props },
    item: { def },
    bob: { phase: 0, baseY: y },
  })
}

// ---------------------------------------------------------------- fire visuals

const fires = new Map<Entity, Flame>()
const alight: { e: Entity; at: THREE.Vector3; heat: number; near: number }[] = []

/**
 * How hard a thing is visibly burning, which is not the same question as
 * whether the fire sim is consuming it.
 *
 * Reading HOT and LUMINOUS rather than the `burning` component is what gives
 * the hearth a real fire: it is HOT 1 with no fuel of its own, so it is a
 * permanent ignition source that `sim/fire.ts` never touches. Anything else
 * that ends up hot and glowing, including a merge result nobody has invented
 * yet, lights up for the same reason. No id is involved. (Rule 2)
 */
function fireHeat(e: Entity): number {
  if (e.burning) return e.burning.heat
  const props = e.props ?? {}
  const hot = p(props, 'HOT')
  return hot >= 0.5 && p(props, 'LUMINOUS') >= 0.3 ? hot * 0.85 : 0
}

/** How tall the flame stands on a given thing. A burning palisade is a column
 *  of fire; a tuft of dry grass is a handful. */
function fireSize(e: Entity): number {
  return e.structure ? Math.min(1.9, 0.5 + e.structure.height * 0.36) : 0.8
}

/**
 * Point lights are forward-shaded: every one of them costs every material in
 * the scene, and the palisade can have seventeen posts alight at once. The
 * nearest few get a real light and spill onto the ground; the rest keep their
 * flame and their embers and lose only the pool of warmth nobody was looking at.
 */
const MAX_FIRE_LIGHTS = 6

function syncFireVisuals(): void {
  alight.length = 0
  for (const e of queries.simulated) {
    const heat = fireHeat(e)
    if (heat <= 0.02) continue
    alight.push({ e, at: e.transform.pos, heat, near: e.transform.pos.distanceToSquared(iso.target) })
  }
  alight.sort((a, b) => a.near - b.near)

  // Anything not driven by `burning.age` needs a clock, and the tick counter is
  // the only one the headless path advances.
  const now = clock.tick * TICK_DT

  for (let i = 0; i < alight.length; i++) {
    const { e, at, heat } = alight[i]!
    let fx = fires.get(e)
    if (!fx) {
      fx = new Flame(at)
      scene.add(fx.group)
      fires.set(e, fx)
    }
    fx.update(at, heat, fireSize(e), e.burning ? e.burning.age : now, i < MAX_FIRE_LIGHTS)
  }

  for (const [e, fx] of fires) {
    if (fireHeat(e) > 0.02) continue
    scene.remove(fx.group)
    fx.dispose()
    fires.delete(e)
    if (e.spent && e.mesh) darken(e.mesh, 0.32)
  }
}

/**
 * Shadow flags, applied to whatever is in the scene.
 *
 * Half the scene graph was built without them, so loose items and the character
 * cast nothing and read as stickers laid over a picture of ground. A contact
 * shadow is most of what makes an object sit in a world.
 *
 * Re-run when the region gains children, which is the only way a mesh appears
 * after boot: dropping an item, or planting a ladder against a wall.
 */
let groundedChildren = -1

function groundEverything(): void {
  if (region.group.children.length === groundedChildren) return
  const first = groundedChildren < 0
  groundedChildren = region.group.children.length

  for (const root of [region.group, character.group]) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || mesh.userData.noShadow) return
      mesh.castShadow = true
      mesh.receiveShadow = true
    })
  }

  // Parented to the character rather than moved each frame: the group already
  // sits at the player's feet, so following is free and cannot drift.
  if (first) character.group.add(groundBlob(0.62, 0.5))
}

// ---------------------------------------------------------------- interaction

let focus: Entity | null = null
let focusAffordances: Affordance[] = []
const nearby: Entity[] = []

function updateFocus(): void {
  let bestItem: Entity | null = null
  let bestItemDist = 1.9
  let bestTarget: Entity | null = null
  let bestTargetScore = -Infinity

  // Which way the character is actually looking. Targeting used to be purely
  // nearest-wins, so a post you had already felled stayed the closest thing and
  // kept stealing focus from the one you were standing in front of.
  const face = player.heading
  const fx = face === null ? 0 : Math.sin(face)
  const fz = face === null ? 0 : Math.cos(face)

  spatial.near(player.pos.x, player.pos.z, 3.4, nearby)
  for (const e of nearby) {
    const dx = e.transform!.pos.x - player.pos.x
    const dz = e.transform!.pos.z - player.pos.z
    const d = Math.hypot(dx, dz)

    if (e.item && d < bestItemDist) {
      bestItem = e
      bestItemDist = d
      continue
    }

    if (e.item) continue
    // A felled or burnt-out thing is scenery. Targeting it is what produced
    // "chop: 0%" while standing in front of a post that was still up.
    if (e.spent) continue
    if (e.structure && e.structure.hp <= 0) continue
    if (!e.structure && !e.blocker && p(e.props ?? {}, 'FLAMMABLE') <= 0.15) continue
    if (d > 2.8) continue

    // Prefer what is in front. Alignment dominates, distance breaks ties, so
    // turning to face a post is enough to select it even if another is nearer.
    const align = d > 1e-4 && face !== null ? (dx / d) * fx + (dz / d) * fz : 0
    if (align < -0.15) continue

    // Built things outrank scenery. Without this a tuft of grass at your feet
    // beats the wall you are standing against, purely because it is nearer,
    // and the player cannot work out why the wall will not respond.
    const weight = e.structure ? 1.4 : e.blocker ? 0.7 : 0
    const score = align * 2.2 - d * 0.5 + weight

    if (score > bestTargetScore) {
      bestTarget = e
      bestTargetScore = score
    }
  }

  if (bestItem) {
    focus = bestItem
    focusAffordances = []
    ui.prompt(`<span class="key">F</span> take ${bestItem.item!.def.name}`)
    return
  }

  if (bestTarget) {
    focus = bestTarget
    focusAffordances = affordances(bestTarget)
    const label = bestTarget.label ?? 'It'
    if (focusAffordances.length > 0) {
      const lines = focusAffordances
        .map((a, i) => `<span class="key">${i + 1}</span> ${a.label}`)
        .join('&nbsp;&nbsp; ')
      ui.prompt(`<b>${label}</b>&nbsp;&nbsp;${lines}`)
    } else {
      // Say why nothing is on offer. Silence here is what made it unclear how
      // to use anything: the player could not tell "no options" from "no UI".
      ui.prompt(`<b>${label}</b>&nbsp;&nbsp;<span class="muted">nothing you carry acts on this</span>`)
    }
    return
  }

  focus = null
  focusAffordances = []
  ui.prompt(null)
}

function handleInput(): void {
  if (pressed.has('f') && focus?.item) {
    ui.add(focus.item.def)
    ui.toast('Took', focus.item.def.name)
    // removeFromParent, not scene.remove: world items are children of the
    // region group, so scene.remove silently did nothing and the mesh stayed on
    // the ground after being picked up.
    focus.mesh?.removeFromParent()
    world.remove(focus)
    focus = null
  }

  if (pressed.has('g')) {
    const def = ui.takeLast()
    if (def) {
      const basis = iso.screenBasis()
      placeInWorld(def, player.pos.x + basis.forward.x * 1.3, player.pos.z + basis.forward.z * 1.3)
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

function movePlayer(): void {
  const { forward, right } = iso.screenBasis()
  const wish = new THREE.Vector3()
  if (keys.has('w')) wish.add(forward)
  if (keys.has('s')) wish.sub(forward)
  if (keys.has('d')) wish.add(right)
  if (keys.has('a')) wish.sub(right)

  const moving = wish.lengthSq() > 0
  if (moving) {
    wish.normalize()
    player.heading = Math.atan2(wish.x, wish.z)
    player.pos.x += wish.x * MOVE_SPEED * TICK_DT
    player.pos.z += wish.z * MOVE_SPEED * TICK_DT
  }
  player.speed01 = moving ? 1 : 0

  // Two resolution passes, so a player pressed into the corner between two
  // blockers gets pushed clear instead of wedging.
  for (let pass = 0; pass < 2; pass++) {
    spatial.near(player.pos.x, player.pos.z, 3, nearby)
    for (const b of nearby) {
      if (!b.blocker) continue
      const dx = player.pos.x - b.transform!.pos.x
      const dz = player.pos.z - b.transform!.pos.z
      const r = b.blocker.radius + PLAYER_RADIUS
      const d = Math.hypot(dx, dz)
      if (d < r && d > 1e-4) {
        player.pos.x += (dx / d) * (r - d)
        player.pos.z += (dz / d) * (r - d)
      }
    }
  }

  player.pos.x = Math.min(BOUNDS.maxX, Math.max(BOUNDS.minX, player.pos.x))
  player.pos.z = Math.min(BOUNDS.maxZ, Math.max(BOUNDS.minZ, player.pos.z))
  player.pos.y = region.heightAt(player.pos.x, player.pos.z)
}

function stepSimulation(): void {
  movePlayer()

  stepFire(rng.fork(`fire:${clock.tick}`), {
    onIgnite: (e) => {
      if (e.structure) ui.toast('Caught', `${e.structure.label} is alight`, 'fire')
    },
    onStructureFail: onFail,
  })

  // No objective text and no marker (D20). Crossing is acknowledged once, in
  // the same transient channel as everything else, and then the player is on
  // their own again.
  if (!crossed && player.pos.z < -10) {
    crossed = true
    ui.toast('Onward', 'The wood on the far side is older')
  }
}

function syncMeshes(dt: number): void {
  // Ease toward the scroll target. Applying the wheel delta directly makes a
  // trackpad flick feel like a lurch.
  if (Math.abs(iso.viewSize - zoomTarget) > 0.001) {
    iso.viewSize += (zoomTarget - iso.viewSize) * Math.min(1, dt * 12)
    iso.setAspect(innerWidth / innerHeight)
    const fog = scene.fog as THREE.Fog | null
    if (fog) {
      const r = iso.fogRange()
      fog.near = r.near
      fog.far = r.far
    }
  }

  character.group.position.copy(player.pos)
  character.update(dt, player.speed01, player.heading)

  for (const e of queries.bobbing) {
    e.bob.phase += dt * 2
    e.mesh.position.y = e.bob.baseY + Math.sin(e.bob.phase) * 0.08
    e.mesh.rotation.y += dt * 0.6
  }

  iso.target.lerp(player.pos, 0.2)
  iso.update()

  groundEverything()
  syncFireVisuals()
  placeLights()
}

// ---------------------------------------------------------------- hud

const hud = document.getElementById('hud')!

function updateHud(fps: number): void {
  let burning = 0
  for (const _ of queries.burning) burning++

  hud.innerHTML = [
    `<b>SINTER</b>  band 0 · hearth`,
    `seed     ${SEED}`,
    `tick     ${clock.tick}`,
    `fps      ${fps.toFixed(0)}`,
    `carried  ${ui.count}`,
    `codex    ${ui.codex.size} merges known`,
    burning > 0 ? `<b style="color:#ff8244">burning  ${burning}</b>` : `burning  0`,
  ].join('\n')
}

// ---------------------------------------------------------------- run

declare global {
  interface Window {
    __sinterReady?: boolean
    /**
     * Debug hook for `tools/verify-movement.mjs`. Screen-space position is what
     * the player actually judges controls by: "D goes right" is a claim about
     * pixels, not about world axes, so the test has to be able to see pixels.
     */
    __sinter?: {
      pos: () => { x: number; y: number; z: number }
      project: (x: number, y: number, z: number) => { x: number; y: number }
      speed: () => number
    }
  }
}

window.__sinter = {
  pos: () => ({ x: player.pos.x, y: player.pos.y, z: player.pos.z }),
  /**
   * Project an arbitrary world point with the camera as it stands right now.
   *
   * Deliberately not "where is the player on screen": the camera follows the
   * player, so that answer is always roughly the middle and says nothing about
   * which way the controls go. Projecting the before and after positions
   * through one camera pose isolates the movement itself.
   */
  project: (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).project(iso.camera)
    return { x: v.x, y: v.y }
  },
  speed: () => player.speed01,
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
  const fuel = spatial.near(ix ?? 0, iz ?? 0, 3).filter((e) => p(e.props ?? {}, 'FLAMMABLE') > 0.3)
  if (fuel[0]) ignite(fuel[0])
}

if (HEADLESS_TICKS > 0) {
  __t.simStart = performance.now()
  for (let i = 0; i < HEADLESS_TICKS; i++) {
    stepSimulation()
    clock.forceTicks(1)
  }
  __t.simEnd = performance.now()
  syncMeshes(TICK_DT)
  updateFocus()
  updateHud(0)
  iso.update()
  __t.renderStart = performance.now()
  grade.render(renderer, scene, iso.camera)
  __t.renderEnd = performance.now()

  // TEMP: renderer.info resets per render() call and grade.render() does two,
  // so a plain read only ever reports the fullscreen quad. Turn autoReset off
  // and take a second frame; totals are then scene pass + 1 quad draw / 2 tris.
  renderer.info.autoReset = false
  renderer.info.reset()
  grade.render(renderer, scene, iso.camera)
  const drawInfo = { ...renderer.info.render }
  renderer.info.autoReset = true

  // TEMP PERF INSTRUMENTATION
  {
    let meshes = 0
    let objects = 0
    let sceneTris = 0
    const mats = new Set<unknown>()
    const geos = new Set<unknown>()
    const maps = new Set<unknown>()
    const sources = new Set<unknown>()
    scene.traverse((o) => {
      objects++
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      meshes++
      geos.add(m.geometry)
      const idx = m.geometry.index
      const posAttr = m.geometry.getAttribute('position')
      sceneTris += (idx ? idx.count : (posAttr?.count ?? 0)) / 3
      for (const mm of Array.isArray(m.material) ? m.material : [m.material]) {
        mats.add(mm)
        const map = (mm as THREE.MeshToonMaterial).map
        if (map) {
          maps.add(map)
          sources.add(map.source)
        }
      }
    })
    let entities = 0
    for (const _ of world.entities) entities++
    ;(window as unknown as { __perf: unknown }).__perf = {
      ticks: HEADLESS_TICKS,
      ms: {
        toParts: +(__t.parts! - __t.moduleStart!).toFixed(1),
        textures: +(__t.textures! - __t.parts!).toFixed(1),
        region: +(__t.region! - __t.textures!).toFixed(1),
        sim: +(__t.simEnd! - __t.simStart!).toFixed(1),
        msPerTick: +((__t.simEnd! - __t.simStart!) / HEADLESS_TICKS).toFixed(4),
        firstRender: +(__t.renderEnd! - __t.renderStart!).toFixed(1),
        moduleStartSinceNav: +__t.moduleStart!.toFixed(1),
        totalSinceNav: +__t.renderEnd!.toFixed(1),
      },
      render: drawInfo,
      programs: renderer.info.programs?.length ?? -1,
      memory: { ...renderer.info.memory },
      textureBreakdown: __texMs,
      scene: {
        objects,
        meshes,
        geometries: geos.size,
        materials: mats.size,
        mapTextures: maps.size,
        textureSources: sources.size,
        sceneTriangles: Math.round(sceneTris),
        entities,
      },
    }
  }
  window.__sinterReady = true
} else {
  let lastFpsSample = performance.now()
  let framesSinceSample = 0
  let fps = 0
  let lastFrame = performance.now()

  renderer.setAnimationLoop((nowMs) => {
    const { ticks } = clock.advance(nowMs)
    for (let i = 0; i < ticks; i++) stepSimulation()

    const dt = Math.min((nowMs - lastFrame) / 1000, 0.1)
    lastFrame = nowMs

    updateFocus()
    handleInput()
    syncMeshes(dt)

    framesSinceSample++
    if (nowMs - lastFpsSample > 500) {
      fps = (framesSinceSample * 1000) / (nowMs - lastFpsSample)
      lastFpsSample = nowMs
      framesSinceSample = 0
    }
    updateHud(fps)

    grade.render(renderer, scene, iso.camera)
    window.__sinterReady = true
  })
}
