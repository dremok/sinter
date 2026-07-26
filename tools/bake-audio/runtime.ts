/**
 * Does the audio layer actually make a sound, and in the right ear?
 *
 * `npx tsx tools/bake-audio/runtime.ts`
 *
 * The equivalent of `npm run shot` for something that cannot be photographed.
 * It boots a real browser, clicks a button (which is the only way a browser
 * will start an AudioContext), plays cues through the real graph, and reads the
 * samples back off a tap on the master bus. Every claim it prints is a
 * measurement of the audio that came out, not of the code that produced it.
 *
 * What it can check: that a cue is audible at all, that a positional sound is
 * in the correct ear, that walking away makes it quieter, that walking makes
 * footsteps and standing still does not, that the mute mutes, and that a bed
 * keeps running.
 *
 * What it cannot check: whether any of it sounds good. Somebody has to listen.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { chromium, type Page } from 'playwright'

interface Meter {
  peakL: number
  peakR: number
  rmsL: number
  rmsR: number
  frames: number
}

declare global {
  interface Window {
    __audio: {
      ready: () => boolean
      muted: () => boolean
      setMuted: (v: boolean) => void
      status: () => { ready: boolean; muted: boolean; voices: number; baked: number }
      listen: (x: number, z: number, rx: number, rz: number) => void
      play: (id: string, at?: { x: number; z: number }) => void
      bed: (id: string, on: boolean) => void
      field: (id: string, entries: { key: string; x: number; z: number; level: number }[]) => void
      places: (list: { id: string; kind: string; at: { x: number; z: number } }[]) => void
      travel: (x: number, z: number, wood: boolean) => void
      reset: () => void
      read: () => Meter
    }
  }
}

/** The camera's right vector on the ground plane, from `IsoCamera.screenBasis`. */
const RIGHT_X = Math.SQRT1_2
const RIGHT_Z = -Math.SQRT1_2

const checks: { name: string; ok: boolean; detail: string }[] = []

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail })
}

async function startVite(): Promise<{ url: string; proc: ChildProcess }> {
  const proc = spawn('npx', ['vite', '--port', '0'], {
    cwd: resolve(import.meta.dirname, '../..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = await new Promise<string>((res, rej) => {
    const timer = setTimeout(() => rej(new Error('vite did not start within 30s')), 30_000)
    proc.stdout?.on('data', (chunk: Buffer) => {
      const m = /(http:\/\/localhost:\d+)/.exec(chunk.toString())
      if (m?.[1]) {
        clearTimeout(timer)
        res(m[1])
      }
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      rej(new Error(`vite exited early with code ${code}`))
    })
  })
  return { url, proc }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Run something, then report what the master bus did while it ran. */
async function measure(page: Page, ms: number, body: () => Promise<void>): Promise<Meter> {
  await page.evaluate(() => window.__audio.reset())
  await body()
  await sleep(ms)
  return page.evaluate(() => window.__audio.read())
}

const { url, proc } = await startVite()
const browser = await chromium.launch({
  args: [
    // No physical output device in CI or in a headless run. Without this the
    // context still runs and the graph still computes, but nothing is rendered
    // and every measurement comes back zero.
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream',
  ],
})

try {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto(`${url}/tools/bake-audio/probe.html`, { waitUntil: 'load' })

  // Before the gesture there must be no context at all. This is the property
  // that keeps `npm run shot` from hanging.
  const beforeGesture = await page.evaluate(() => window.__audio.ready())
  check('silent until a gesture', beforeGesture === false, `ready=${beforeGesture} before any click`)

  await page.click('#go')
  await sleep(300)
  const ready = await page.evaluate(() => window.__audio.ready())
  check('starts on a gesture', ready === true, `ready=${ready} after one click`)
  if (!ready) throw new Error('no AudioContext after a click; nothing else can be measured')

  await page.evaluate(() => window.__audio.setMuted(false))
  await page.evaluate(
    ([rx, rz]) => window.__audio.listen(0, 0, rx!, rz!),
    [RIGHT_X, RIGHT_Z],
  )
  await sleep(150)

  // ------------------------------------------------------------ every one-shot
  const oneShots = ['chop', 'take', 'drop', 'merge', 'step-grass', 'step-wood']
  for (const id of oneShots) {
    const m = await measure(page, 700, async () => {
      await page.evaluate((cue) => window.__audio.play(cue), id)
    })
    check(`${id} is audible`, m.peakL > 0.01, `peak ${m.peakL.toFixed(4)}`)
  }

  // ------------------------------------------------------------------ silence
  // The merge is 2.4 seconds long and the loop above only waits 700 ms for each
  // cue, so without settling first this measures the merge's own tail and
  // reports it as a leak.
  await sleep(2500)
  const quiet = await measure(page, 400, async () => {})
  check('silent when nothing is playing', quiet.peakL < 0.005, `peak ${quiet.peakL.toFixed(5)}`)

  // ---------------------------------------------------------------- panning
  // A fire eight metres along the camera's right vector belongs in the right
  // ear. This is the check that would have caught a listener placed at the
  // camera instead of at the player.
  const toRight = await measure(page, 700, async () => {
    await page.evaluate(
      ([rx, rz]) => {
        window.__audio.field('fire', [{ key: 'a', x: rx! * 6, z: rz! * 6, level: 1 }])
      },
      [RIGHT_X, RIGHT_Z],
    )
  })
  check(
    'a fire on the right is in the right ear',
    toRight.rmsR > toRight.rmsL * 1.5,
    `L ${toRight.rmsL.toFixed(4)} R ${toRight.rmsR.toFixed(4)}`,
  )

  const toLeft = await measure(page, 700, async () => {
    await page.evaluate(
      ([rx, rz]) => {
        window.__audio.field('fire', [{ key: 'a', x: -rx! * 6, z: -rz! * 6, level: 1 }])
      },
      [RIGHT_X, RIGHT_Z],
    )
  })
  check(
    'a fire on the left is in the left ear',
    toLeft.rmsL > toLeft.rmsR * 1.5,
    `L ${toLeft.rmsL.toFixed(4)} R ${toLeft.rmsR.toFixed(4)}`,
  )

  // ---------------------------------------------------------------- distance
  // Measured over a second and a half each. An emitter starts at a hashed
  // offset into its loop so that two fires are not one fire twice as loud, so a
  // short window can catch a crackle in one case and a lull in the other and
  // compare the wrong things.
  const near = await measure(page, 1500, async () => {
    await page.evaluate(() => window.__audio.field('fire', [{ key: 'a', x: 1, z: 1, level: 1 }]))
  })
  const far = await measure(page, 1500, async () => {
    await page.evaluate(() => window.__audio.field('fire', [{ key: 'a', x: 6, z: 6, level: 1 }]))
  })
  const rmsNear = Math.hypot(near.rmsL, near.rmsR)
  const rmsFar = Math.hypot(far.rmsL, far.rmsR)
  check(
    'further away is quieter',
    rmsFar < rmsNear * 0.7,
    `near ${rmsNear.toFixed(4)} far ${rmsFar.toFixed(4)}`,
  )

  const gone = await measure(page, 900, async () => {
    await page.evaluate(() => window.__audio.field('fire', [{ key: 'a', x: 40, z: 40, level: 1 }]))
  })
  check(
    'past the radius it stops entirely',
    Math.hypot(gone.rmsL, gone.rmsR) < 0.002,
    `rms ${Math.hypot(gone.rmsL, gone.rmsR).toFixed(5)}`,
  )

  // A fire that stops being reported must stop making a noise.
  const dropped = await measure(page, 900, async () => {
    await page.evaluate(() => window.__audio.field('fire', []))
  })
  check(
    'a fire that goes out falls silent',
    Math.hypot(dropped.rmsL, dropped.rmsR) < 0.002,
    `rms ${Math.hypot(dropped.rmsL, dropped.rmsR).toFixed(5)}`,
  )

  // ---------------------------------------------------------------- footsteps
  const walking = await measure(page, 900, async () => {
    await page.evaluate(() => {
      // Ten metres of walking, in 60 frames, which is about seven footfalls.
      for (let i = 0; i <= 60; i++) window.__audio.travel(i * (10 / 60), 0, false)
    })
  })
  check('walking makes footsteps', walking.peakL > 0.01, `peak ${walking.peakL.toFixed(4)}`)

  const standing = await measure(page, 700, async () => {
    await page.evaluate(() => {
      for (let i = 0; i <= 60; i++) window.__audio.travel(10, 0, false)
    })
  })
  check('standing still does not', standing.peakL < 0.005, `peak ${standing.peakL.toFixed(5)}`)

  // -------------------------------------------------------------------- places
  // The region says where its water is; audio asks. (D22)
  const places = await measure(page, 1200, async () => {
    await page.evaluate(() => {
      window.__audio.places([
        { id: 'mill', kind: 'work', at: { x: 4, z: 2 } },
        { id: 'well', kind: 'water', at: { x: 1, z: 1 } },
      ])
    })
  })
  check('a place with a voice is audible', places.peakL > 0.005, `peak ${places.peakL.toFixed(4)}`)

  // ---------------------------------------------------------------------- bed
  const bed = await measure(page, 2500, async () => {
    await page.evaluate(() => window.__audio.bed('ambience', true))
  })
  check('the ambience bed runs', bed.peakL > 0.005, `peak ${bed.peakL.toFixed(4)}`)

  // --------------------------------------------------------------------- mute
  // Muted first, then measured. The mute is a 15 ms ramp rather than an
  // assignment, because a gain that jumps to zero clicks, so a sound started in
  // the same millisecond as the mute is briefly and correctly audible. The
  // question worth asking is whether anything started AFTER the mute is.
  await page.evaluate(() => window.__audio.setMuted(true))
  await sleep(200)
  const muted = await measure(page, 900, async () => {
    await page.evaluate(() => window.__audio.play('merge'))
  })
  check('mute silences everything', muted.peakL < 0.002, `peak ${muted.peakL.toFixed(5)}`)

  await page.evaluate(() => window.__audio.setMuted(false))
  const unmuted = await measure(page, 900, async () => {
    await page.evaluate(() => window.__audio.play('merge'))
  })
  check('and unmute brings it back', unmuted.peakL > 0.01, `peak ${unmuted.peakL.toFixed(4)}`)

  const status = await page.evaluate(() => window.__audio.status())
  console.log(`\nstatus: ${JSON.stringify(status)}`)

  check('no page or console errors', errors.length === 0, errors.join(' | ') || 'none')
} finally {
  await browser.close()
  proc.kill()
}

let failed = 0
console.log('')
for (const c of checks) {
  if (!c.ok) failed++
  console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(42)} ${c.detail}`)
}
console.log(`\n${checks.length - failed}/${checks.length} audio checks passed`)
if (failed > 0) process.exitCode = 1
