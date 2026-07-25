/**
 * Fixed timestep accumulator.
 *
 * The simulation must advance in fixed increments regardless of framerate, or
 * runs stop being reproducible from a seed. Rendering interpolates between the
 * last two simulation states; it never drives them.
 */

export const TICK_HZ = 60
export const TICK_DT = 1 / TICK_HZ

/** Guard against the spiral of death after a tab stall or a breakpoint. */
const MAX_TICKS_PER_FRAME = 5

export class Clock {
  private accumulator = 0
  private lastTime = 0
  /** Fixed ticks elapsed since start. The canonical simulation time. */
  tick = 0

  /**
   * Feed wall-clock time, get back how many fixed ticks to run.
   * `alpha` is the 0..1 interpolation factor for rendering.
   */
  advance(nowMs: number): { ticks: number; alpha: number } {
    if (this.lastTime === 0) this.lastTime = nowMs
    const frameSeconds = Math.min((nowMs - this.lastTime) / 1000, 0.25)
    this.lastTime = nowMs
    this.accumulator += frameSeconds

    let ticks = 0
    while (this.accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
      this.accumulator -= TICK_DT
      ticks++
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.accumulator = 0

    this.tick += ticks
    return { ticks, alpha: this.accumulator / TICK_DT }
  }

  /** Run N ticks with no wall clock involved. Used by the screenshot harness. */
  forceTicks(n: number): number {
    this.tick += n
    return n
  }

  get elapsedSeconds(): number {
    return this.tick * TICK_DT
  }
}
