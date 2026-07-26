#!/usr/bin/env node
/**
 * Where the frame actually goes.
 *
 * Two separate measurements, because they answer different questions and only
 * one of them is deterministic:
 *
 *   scene   what is in the frame. Draw calls, triangles, programs, and the
 *           duplicate (geometry, material) pairs that instancing would collapse.
 *           Exact, repeatable, hardware-independent, and the thing the budgets
 *           in docs/PERFORMANCE.md are written against.
 *
 *   passes  what each pass costs, by A/B against the same scene in the same
 *           run. Shadows off vs on, outline hulls hidden vs drawn, the grade
 *           skipped vs applied. Reported as a RATIO, never as fps: the harness
 *           renders on SwiftShader, so absolute milliseconds here describe a
 *           software rasteriser and nothing else. A ratio survives that.
 *
 *   loop    the real `setAnimationLoop`, split into simulation and render, by
 *           wrapping `Grade.render`. Only this mode runs the game live, so it
 *           is the only one that can see the clock's tick cap.
 *
 * Nothing here writes to the page's own state permanently; every config is
 * restored before the next one is measured, and `--verify` re-renders the
 * baseline at the end and checks the pixels came back.
 *
 *   node tools/perf.mjs                       # all three
 *   node tools/perf.mjs --mode passes --frames 40
 *   node tools/perf.mjs --seed hearth-7 --ticks 600
 */

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}

const SEED = arg('seed', 'hearth-0')
const TICKS = Number(arg('ticks', '200'))
const FRAMES = Number(arg('frames', '24'))
const WIDTH = Number(arg('width', '1600'))
const HEIGHT = Number(arg('height', '900'))
const MODE = arg('mode', 'all')

async function startDevServer() {
  const proc = spawn('npx', ['vite', '--port', '0'], {
    cwd: resolve(import.meta.dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('vite did not start within 30s')), 30_000)
    proc.stdout?.on('data', (chunk) => {
      const m = /(http:\/\/localhost:\d+)/.exec(chunk.toString())
      if (m?.[1]) {
        clearTimeout(timer)
        res(m[1])
      }
    })
    proc.stderr?.on('data', (c) => process.stderr.write(c))
    proc.on('exit', (code) => {
      clearTimeout(timer)
      rej(new Error(`vite exited early with code ${code}`))
    })
  })
  return { url, proc }
}

// ------------------------------------------------------------------ in-page

/**
 * Everything below runs in the browser. It reaches the live renderer through
 * `liveFrame()` in `src/render/toon.ts`, which the first rendered frame fills
 * in. Vite's dev server keys modules by URL, so importing that path here
 * returns the module instance `main.ts` is already using, not a second copy.
 */

const SCENE_STATS = async () => {
  const { liveFrame } = await import('/src/render/toon.ts')
  const f = liveFrame()
  if (!f) throw new Error('no frame hook: nothing has rendered yet')
  const { renderer, scene, camera } = f

  renderer.info.autoReset = false
  renderer.info.reset()
  f.grade.render(renderer, scene, camera)
  const info = {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    lines: renderer.info.render.lines,
    points: renderer.info.render.points,
    programs: renderer.info.programs?.length ?? 0,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
  }
  renderer.info.autoReset = true

  // Every visible mesh, bucketed by the pair that decides whether two draws can
  // become one. Buckets with a high count are instancing candidates; buckets of
  // one are not, however many of them there are.
  const buckets = new Map()
  let meshes = 0
  let hulls = 0
  let transparent = 0
  let shadowCasters = 0
  let tris = 0
  const named = new Map()

  scene.traverseVisible((o) => {
    if (!o.isMesh) return
    meshes++
    const geo = o.geometry
    const mat = Array.isArray(o.material) ? o.material[0] : o.material
    const idx = geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0)
    const t = idx / 3
    tris += t
    if (o.userData.outlineHull) hulls++
    if (mat?.transparent) transparent++
    if (o.castShadow) shadowCasters++

    const key = `${geo.uuid}|${mat?.uuid}`
    const b = buckets.get(key)
    if (b) {
      b.n++
    } else {
      buckets.set(key, {
        n: 1,
        tris: t,
        hull: o.userData.outlineHull === true,
        label: o.name || o.parent?.name || geo.type,
        mat: mat?.type ?? '?',
        color: mat?.color?.getHexString?.() ?? '-',
      })
    }

    const label = o.name || o.parent?.name || geo.type
    const n = named.get(label) ?? { n: 0, tris: 0 }
    n.n++
    n.tris += t
    named.set(label, n)
  })

  // The individually heavy meshes. A frame can blow the triangle budget two
  // ways, and they need completely different fixes: thousands of small meshes
  // (instancing) or a handful of enormous ones (tessellation). This is the
  // second list, with how many times each one is submitted per frame, because
  // "drawn once" and "drawn in the colour pass, the shadow pass and as a hull"
  // are a 3x difference that a triangle count alone hides.
  const heavy = []
  scene.traverseVisible((o) => {
    if (!o.isMesh) return
    const geo = o.geometry
    const t = (geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0)) / 3
    if (t < 2000) return
    const chain = []
    for (let p = o; p && p !== scene; p = p.parent) chain.push(p.name || p.type)
    let kids = 0
    o.traverse((c) => {
      if (c !== o && c.isMesh) kids++
    })
    heavy.push({
      tris: Math.round(t),
      label: o.name || geo.type,
      hull: o.userData.outlineHull === true,
      castShadow: o.castShadow,
      receiveShadow: o.receiveShadow,
      kids,
      chain: chain.reverse().join(' > '),
    })
  })
  heavy.sort((a, b) => b.tris - a.tris)

  const dupes = [...buckets.values()]
    .filter((b) => b.n > 1)
    .sort((a, b) => b.n - a.n)
    .slice(0, 30)

  const wasted = [...buckets.values()].reduce((s, b) => s + (b.n - 1), 0)

  return {
    info,
    meshes,
    hulls,
    transparent,
    shadowCasters,
    tris: Math.round(tris),
    buckets: buckets.size,
    wasted,
    dupes,
    heavy,
    named: [...named.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 25),
  }
}

const PASS_TIMING = async (frames) => {
  const { liveFrame } = await import('/src/render/toon.ts')
  const f = liveFrame()
  if (!f) throw new Error('no frame hook')
  const { renderer, scene, camera, grade } = f
  const gl = renderer.getContext()

  const hulls = []
  const transparents = []
  const casters = []
  scene.traverse((o) => {
    if (!o.isMesh) return
    if (o.userData.outlineHull) hulls.push(o)
    const mat = Array.isArray(o.material) ? o.material[0] : o.material
    if (mat?.transparent && !o.userData.outlineHull) transparents.push(o)
    if (o.castShadow) casters.push(o)
  })

  const setVisible = (list, v) => {
    for (const o of list) o.visible = v
  }
  const restore = new Map()
  const remember = (list) => {
    for (const o of list) if (!restore.has(o)) restore.set(o, o.visible)
  }
  remember(hulls)
  remember(transparents)
  remember(casters)

  const measure = (draw) => {
    // Warm: first draw of a new material combination compiles a program, and a
    // shader compile in the sample is worth more than every frame after it.
    for (let i = 0; i < 4; i++) draw()
    gl.finish()
    const samples = []
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now()
      draw()
      gl.finish()
      samples.push(performance.now() - t0)
    }
    samples.sort((a, b) => a - b)
    return {
      median: samples[Math.floor(samples.length / 2)],
      min: samples[0],
      max: samples[samples.length - 1],
    }
  }

  const withInfo = (draw) => {
    renderer.info.autoReset = false
    renderer.info.reset()
    draw()
    const calls = renderer.info.render.calls
    const triangles = renderer.info.render.triangles
    renderer.info.autoReset = true
    return { calls, triangles }
  }

  const full = () => grade.render(renderer, scene, camera)

  const configs = []

  const run = (name, setup, teardown, draw = full) => {
    setup?.()
    const t = measure(draw)
    const i = withInfo(draw)
    teardown?.()
    configs.push({ name, ...t, ...i })
  }

  // Baseline first and last, so drift across the run is visible rather than
  // silently attributed to whichever config happened to be measured late.
  run('full', null, null)

  run(
    'no outline hulls',
    () => setVisible(hulls, false),
    () => {
      for (const o of hulls) o.visible = restore.get(o)
    },
  )

  run(
    'no transparency',
    () => setVisible(transparents, false),
    () => {
      for (const o of transparents) o.visible = restore.get(o)
    },
  )

  // The shadow PASS, not shadow support. `autoUpdate = false` stops the depth
  // render; every material still compiles and samples the (now stale) map, so
  // nothing recompiles and the difference is the pass and only the pass.
  // Turning `shadowMap.enabled` off instead would rebuild 1177 programs, and
  // the compile would be most of what got timed.
  run(
    'shadow pass skipped',
    () => {
      renderer.shadowMap.autoUpdate = false
      renderer.shadowMap.needsUpdate = false
    },
    () => {
      renderer.shadowMap.autoUpdate = true
    },
  )

  // The grade's cost is its fullscreen pass, so measure the scene render on its
  // own into an equivalent offscreen target and subtract.
  //
  // The obvious version of this config renders the scene straight to the canvas
  // instead, and it is a trap: pushing three thousand draws at the default
  // framebuffer under SwiftShader took 200x longer than the same draws into a
  // render target AND left every config measured after it 60x slow. Every
  // config here must therefore end up in an offscreen target, or the run is
  // measuring the compositor.
  const solo = grade.target.clone()
  run('scene only, grade pass skipped', null, null, () => {
    renderer.setRenderTarget(solo)
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)
  })

  // The single heaviest mesh in the frame, whatever it turns out to be. Named
  // in the output rather than assumed here, because "the ground is the big one"
  // is exactly the kind of thing that stops being true after a content change.
  let heaviest = null
  let heaviestTris = 0
  scene.traverseVisible((o) => {
    if (!o.isMesh || o.userData.outlineHull) return
    const geo = o.geometry
    const t = (geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0)) / 3
    if (t > heaviestTris) {
      heaviestTris = t
      heaviest = o
    }
  })
  if (heaviest) {
    remember([heaviest])
    run(
      `heaviest mesh hidden (${heaviest.name || heaviest.geometry.type}, ${Math.round(heaviestTris)} tris)`,
      () => {
        heaviest.visible = false
      },
      () => {
        heaviest.visible = restore.get(heaviest)
      },
    )
  }

  run('full (repeat)', null, null)

  for (const [o, v] of restore) o.visible = v
  full()

  return { configs, counts: { hulls: hulls.length, transparents: transparents.length, casters: casters.length } }
}

const LOOP_TIMING = async (seconds) => {
  const mod = await import('/src/render/toon.ts')
  const original = mod.Grade.prototype.render
  const frames = []
  let renderEnter = 0
  let renderExit = 0

  mod.Grade.prototype.render = function (...a) {
    renderEnter = performance.now()
    original.apply(this, a)
    renderExit = performance.now()
  }

  await new Promise((res) => {
    let last = 0
    let stop = false
    setTimeout(() => {
      stop = true
    }, seconds * 1000)
    const tick = (now) => {
      // This callback is queued from inside the same rAF turn the game uses, so
      // it lands after the game's own callback for that frame: `renderExit` is
      // this frame's, not the previous one's.
      if (last > 0 && renderEnter > last) {
        frames.push({
          period: now - last,
          beforeRender: renderEnter - last,
          render: renderExit - renderEnter,
        })
      }
      last = now
      if (stop) {
        mod.Grade.prototype.render = original
        res()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  const med = (key) => {
    const v = frames.map((f) => f[key]).sort((a, b) => a - b)
    return v.length ? v[Math.floor(v.length / 2)] : 0
  }
  return {
    frames: frames.length,
    period: med('period'),
    beforeRender: med('beforeRender'),
    render: med('render'),
    ticksPerFrame: (med('period') / 1000) * 60,
  }
}

/**
 * Hide one thing, re-render, and let the caller screenshot it.
 *
 * The point of this mode is to settle "is this draw doing anything?" the only
 * way that counts. A draw that costs 96,800 triangles and changes no pixel is
 * not a tuning question, it is a bug, and the two look identical in a profile.
 */
const ABLATE = async (which) => {
  const { liveFrame } = await import('/src/render/toon.ts')
  const f = liveFrame()
  if (!f) throw new Error('no frame hook')
  const { renderer, scene, camera, grade } = f

  const restore = []
  const hide = (o) => {
    restore.push([o, 'visible', o.visible])
    o.visible = false
  }

  let biggest = null
  let biggestTris = 0
  scene.traverseVisible((o) => {
    if (!o.isMesh || o.userData.outlineHull) return
    const g = o.geometry
    const t = (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3
    if (t > biggestTris) {
      biggestTris = t
      biggest = o
    }
  })

  let hidden = 0
  if (which === 'baseline') {
    // nothing
  } else if (which === 'ground-hull') {
    biggest?.traverse((o) => {
      if (o.userData.outlineHull) {
        hide(o)
        hidden++
      }
    })
  } else if (which === 'all-hulls') {
    scene.traverse((o) => {
      if (o.userData.outlineHull && o.visible) {
        hide(o)
        hidden++
      }
    })
  } else if (which === 'ground-shadow') {
    if (biggest) {
      restore.push([biggest, 'castShadow', biggest.castShadow])
      biggest.castShadow = false
      hidden++
    }
  } else {
    throw new Error(`unknown ablation ${which}`)
  }

  renderer.shadowMap.needsUpdate = true
  grade.render(renderer, scene, camera)

  // Parked on the window rather than returned: `page.evaluate` can only hand
  // back structured-cloneable data, and the undo list is object references.
  window.__perfUndo = () => {
    for (const [o, k, v] of restore) o[k] = v
    renderer.shadowMap.needsUpdate = true
    grade.render(renderer, scene, camera)
  }

  return {
    hidden,
    target: biggest ? `${biggest.name || biggest.geometry.type} ${Math.round(biggestTris)} tris` : 'none',
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  }
}

// ------------------------------------------------------------------- driver

const { url, proc } = await startDevServer()
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})

const pct = (a, b) => `${(((a - b) / a) * 100).toFixed(1)}%`
const ms = (n) => n.toFixed(2).padStart(8)

try {
  const errors = []

  if (MODE === 'all' || MODE === 'scene' || MODE === 'passes') {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await page.goto(`${url}/?seed=${encodeURIComponent(SEED)}&ticks=${TICKS}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 60_000 })

    if (MODE === 'all' || MODE === 'scene') {
      const s = await page.evaluate(SCENE_STATS)
      console.log(`\n=== SCENE   seed=${SEED} ticks=${TICKS} ${WIDTH}x${HEIGHT} ===\n`)
      console.log(`draw calls     ${String(s.info.calls).padStart(7)}   budget 400`)
      console.log(`triangles      ${String(s.info.triangles).padStart(7)}   budget 350k`)
      console.log(`programs       ${String(s.info.programs).padStart(7)}   budget 40`)
      console.log(`geometries     ${String(s.info.geometries).padStart(7)}`)
      console.log(`textures       ${String(s.info.textures).padStart(7)}`)
      console.log()
      console.log(`visible meshes ${String(s.meshes).padStart(7)}   of which ${s.hulls} are outline hulls`)
      console.log(`transparent    ${String(s.transparent).padStart(7)}`)
      console.log(`shadow casters ${String(s.shadowCasters).padStart(7)}`)
      console.log(
        `unique (geometry, material) pairs ${s.buckets}; ` +
          `${s.wasted} draws are a repeat of a pair already drawn`,
      )
      console.log(`\n  n   tris/ea  hull  material              colour   label`)
      for (const d of s.dupes) {
        console.log(
          `${String(d.n).padStart(4)}  ${String(d.tris).padStart(8)}  ${d.hull ? 'hull' : '    '}  ` +
            `${d.mat.padEnd(20)}  ${d.color.padEnd(7)}  ${d.label}`,
        )
      }
      console.log(`\n    tris  cast  recv  kids  hull  path (meshes over 2000 triangles)`)
      for (const h of s.heavy) {
        console.log(
          `${String(h.tris).padStart(8)}  ${h.castShadow ? ' y  ' : ' .  '}  ${h.receiveShadow ? ' y  ' : ' .  '}  ` +
            `${String(h.kids).padStart(4)}  ${h.hull ? 'hull' : '    '}  ${h.chain}`,
        )
      }
      console.log(`\n  n     tris  label (by name, hulls included)`)
      for (const n of s.named) {
        console.log(`${String(n.n).padStart(4)}  ${String(Math.round(n.tris)).padStart(7)}  ${n.label}`)
      }
    }

    if (MODE === 'all' || MODE === 'passes') {
      const p = await page.evaluate(PASS_TIMING, FRAMES)
      console.log(`\n=== PASSES   ${FRAMES} frames each, median, SwiftShader ===`)
      console.log(`(milliseconds are software-rasteriser milliseconds. Read the ratios.)\n`)
      const base = p.configs.find((c) => c.name === 'full')
      console.log(`   median      min      max    calls      tris   saved  config`)
      for (const c of p.configs) {
        console.log(
          `${ms(c.median)} ${ms(c.min)} ${ms(c.max)} ${String(c.calls).padStart(8)}  ` +
            `${String(c.triangles).padStart(8)}  ${pct(base.median, c.median).padStart(6)}  ${c.name}`,
        )
      }
      console.log(
        `\nhulls ${p.counts.hulls}, transparent ${p.counts.transparents}, shadow casters ${p.counts.casters}`,
      )
    }
    await page.close()
  }

  if (MODE === 'ablate') {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await page.goto(`${url}/?seed=${encodeURIComponent(SEED)}&ticks=${TICKS}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 60_000 })

    console.log(`\n=== ABLATIONS   seed=${SEED} ticks=${TICKS} ===\n`)
    for (const which of ['baseline', 'ground-hull', 'all-hulls', 'ground-shadow']) {
      const r = await page.evaluate(ABLATE, which)
      const out = `.shots/ablate-${which}.png`
      await page.screenshot({ path: out })
      await page.evaluate(() => window.__perfUndo())
      console.log(
        `${which.padEnd(14)} hid ${String(r.hidden).padStart(5)}  ` +
          `calls ${String(r.calls).padStart(5)}  tris ${String(r.triangles).padStart(7)}  -> ${out}`,
      )
      if (which === 'baseline') console.log(`               heaviest mesh: ${r.target}`)
    }
    await page.close()
  }

  if (MODE === 'all' || MODE === 'loop') {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await page.goto(`${url}/?seed=${encodeURIComponent(SEED)}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__sinterReady === true, undefined, { timeout: 60_000 })
    const l = await page.evaluate(LOOP_TIMING, 6)
    console.log(`\n=== LIVE LOOP   ${l.frames} frames of the real setAnimationLoop ===\n`)
    console.log(`frame period          ${l.period.toFixed(2)} ms   (median)`)
    console.log(`  sim + sync + hud    ${l.beforeRender.toFixed(2)} ms   ${pct(l.period, l.period - l.beforeRender)}`)
    console.log(`  grade.render        ${l.render.toFixed(2)} ms   ${pct(l.period, l.period - l.render)}`)
    console.log(
      `\nticks owed per frame at this rate: ${l.ticksPerFrame.toFixed(1)}  ` +
        `(MAX_TICKS_PER_FRAME is 5; above that the world runs slow)`,
    )
    await page.close()
  }

  if (errors.length) {
    console.error(`\n${errors.length} console error(s):`)
    for (const e of errors) console.error(`  ${e}`)
    process.exitCode = 1
  }
} finally {
  await browser.close()
  proc.kill()
}
