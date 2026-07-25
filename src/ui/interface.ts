/**
 * Pack, property filter, and merge bench.
 *
 * docs/DESIGN.md is explicit that infinite inventory is a UI problem, not a
 * storage problem, and that "show me everything FLAMMABLE" is the single most
 * important query in the game. The filter here is therefore built on property
 * chips rather than on categories or item types, which also means it keeps
 * working for items that did not exist when it was written.
 *
 * Presentation rules this module owes the rest of the game:
 *
 *   - No raw numbers anywhere a player can see. A property is drawn as pips,
 *     because "FLAMMABLE 1.00" is a debug print and pips are a reading.
 *   - One message per state. The bench used to say "empty", "empty", "pick two
 *     things" and show a dead MERGE button all at once, which is four ways of
 *     saying nothing is selected.
 *   - Nothing with a variable name in it ships. The debug block is behind
 *     ?debug=1 or F3; see `mountDebug` below.
 */

import type { ItemDef } from '../items/catalog'
import { canMerge, isDiscovered, mergeId, refusal, tryMerge } from '../items/merge'
import { itemIcon } from '../render/icons'
import { ALL_PROPERTIES, meta, ranked, type PropertyId } from '../props/registry'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Pips per trait. Four reads as a quantity at a glance; ten reads as a number. */
const PIPS = 4

/**
 * Traits shown on a card before the rest collapse into a "+n". Three is what
 * fits on one line at the panel's width, and a card that is always exactly two
 * lines gives the list a rhythm you can scan.
 */
const TRAITS_PER_CARD = 3

/** Group headings for the filter drawer, in the order they are shown. */
const GROUPS: { id: string; label: string }[] = [
  { id: 'material', label: 'Material' },
  { id: 'physical', label: 'Physical' },
  { id: 'energetic', label: 'Energy' },
  { id: 'biological', label: 'Living' },
  { id: 'social', label: 'Social' },
  { id: 'functional', label: 'Function' },
]

export interface UiHooks {
  onMerged: (result: ItemDef, a: ItemDef, b: ItemDef) => void
  onDropped: (def: ItemDef) => void
}

export class Ui {
  readonly pack: ItemDef[] = []
  readonly codex = new Set<string>()

  private filters = new Set<PropertyId>()
  private filtersOpen = false
  private slotA: number | null = null
  private slotB: number | null = null
  private open = false

  /** Live notices by group key, so repeats update in place instead of stacking. */
  private notices = new Map<
    string,
    { node: HTMLElement; body: HTMLElement; tally: HTMLElement; count: number; timer: ReturnType<typeof setTimeout> }
  >()
  /** The pair whose refusal has already been toasted. See `announce`. */
  private announced: string | null = null

  constructor(private hooks: UiHooks) {
    this.buildFilters()
    this.mountDebug()
    this.mountHeadless()

    $('merge-btn').addEventListener('click', () => this.doMerge())
    $('slot-a').addEventListener('click', () => {
      this.slotA = null
      this.render()
    })
    $('slot-b').addEventListener('click', () => {
      this.slotB = null
      this.render()
    })
    $('filter-toggle').addEventListener('click', () => {
      this.filtersOpen = !this.filtersOpen
      this.render()
    })
    $('filter-clear').addEventListener('click', () => {
      this.filters.clear()
      this.render()
    })
    $('items').addEventListener('scroll', () => this.syncFade())

    this.render()
  }

  // ------------------------------------------------------------------ state

  add(def: ItemDef): void {
    this.pack.push(def)
    this.render()
  }

  /** Removes and returns the most recently added item, for dropping. */
  takeLast(): ItemDef | undefined {
    const def = this.pack.pop()
    if (def) {
      this.slotA = null
      this.slotB = null
      this.render()
    }
    return def
  }

  get count(): number {
    return this.pack.length
  }

  toggle(): void {
    this.open = !this.open
    $('inventory').classList.toggle('open', this.open)
  }

  get isOpen(): boolean {
    return this.open
  }

  /** The strongest carried value of a property, for the affordance checks. */
  bestCarried(id: PropertyId): number {
    let best = 0
    for (const def of this.pack) best = Math.max(best, def.props[id] ?? 0)
    return best
  }

  /** Finds a carried item satisfying a property threshold. */
  findCarried(id: PropertyId, min: number): ItemDef | undefined {
    return this.pack.find((d) => (d.props[id] ?? 0) >= min)
  }

  consume(def: ItemDef): void {
    const i = this.pack.indexOf(def)
    if (i >= 0) this.pack.splice(i, 1)
    this.slotA = null
    this.slotB = null
    this.render()
  }

  // ------------------------------------------------------------------- merge

  private doMerge(): void {
    if (this.slotA === null || this.slotB === null) return
    const a = this.pack[this.slotA]
    const b = this.pack[this.slotB]
    if (!a || !b) return
    // D18: a pair either has an authored result or it does not combine, and
    // refusing costs nothing. There are TWO ways to refuse and only one of them
    // is `noMerge`: the common case is an ordinary pair nobody authored, which
    // is most of them. Guarding on `noMerge` alone let apple + sword reach
    // merge(), which throws.
    //
    // Unreachable from the UI now, because the bench announces the refusal as
    // soon as the second slot fills and the button is disabled behind it. Kept
    // so a future caller cannot reach merge() by another route.
    const result = tryMerge(a.id, b.id)
    if (!result) return

    this.codex.add(mergeId(a.id, b.id))

    // Both inputs are destroyed. Splice the higher index first so the lower
    // index stays valid; getting this backwards silently deletes the wrong item.
    const [hi, lo] = this.slotA > this.slotB ? [this.slotA, this.slotB] : [this.slotB, this.slotA]
    this.pack.splice(hi, 1)
    this.pack.splice(lo, 1)
    this.pack.push(result)

    this.slotA = null
    this.slotB = null
    this.render()
    this.hooks.onMerged(result, a, b)
  }

  /** Same path as clicking a card. Used by the `?slots=` dev aid for shots. */
  select(index: number): void {
    if (index >= 0 && index < this.pack.length) this.pick(index)
  }

  private pick(index: number): void {
    if (this.slotA === index) {
      this.slotA = null
    } else if (this.slotB === index) {
      this.slotB = null
    } else if (this.slotA === null) {
      this.slotA = index
    } else if (this.slotB === null) {
      this.slotB = index
    } else {
      this.slotB = index
    }
    this.render()
  }

  // ------------------------------------------------------------------ render

  /**
   * The filter drawer. Twenty-odd properties in one undifferentiated wall is
   * not a filter, it is a legend, so they are grouped by the registry's own
   * grouping and the whole drawer collapses. Active filters stay visible on the
   * collapsed bar, because a hidden filter that is silently on is a trap.
   */
  private buildFilters(): void {
    const host = $('filters')
    host.replaceChildren()

    for (const group of GROUPS) {
      const ids = ALL_PROPERTIES.filter((id) => meta(id).group === group.id)
      if (ids.length === 0) continue

      const box = el('div', 'fgroup')
      box.append(el('div', 'fgroup-name', group.label))

      const chips = el('div', 'fgroup-chips')
      for (const id of ids) chips.append(this.buildChip(id, false))
      box.append(chips)
      host.append(box)
    }
  }

  private buildChip(id: PropertyId, mini: boolean): HTMLElement {
    const chip = el('div', mini ? 'chip mini' : 'chip')
    chip.dataset.prop = id
    chip.style.setProperty('--pcolor', meta(id).color)
    chip.title = meta(id).blurb
    chip.append(el('span', 'dot'), document.createTextNode(id.replace(/_/g, ' ')))
    chip.addEventListener('click', () => {
      if (this.filters.has(id)) this.filters.delete(id)
      else this.filters.add(id)
      this.render()
    })
    return chip
  }

  private renderFilters(): void {
    const drawer = $('filters')
    drawer.hidden = !this.filtersOpen
    $('filter-toggle').setAttribute('aria-expanded', String(this.filtersOpen))

    for (const chip of Array.from(drawer.querySelectorAll<HTMLElement>('[data-prop]'))) {
      chip.classList.toggle('on', this.filters.has(chip.dataset.prop as PropertyId))
    }

    const active = $('filter-active')
    active.replaceChildren()
    for (const id of this.filters) {
      const chip = this.buildChip(id, true)
      chip.classList.add('on')
      active.append(chip)
    }
    ;($('filter-clear') as HTMLButtonElement).hidden = this.filters.size === 0
  }

  private render(): void {
    this.renderFilters()

    const visible = this.pack
      .map((def, index) => ({ def, index }))
      .filter(({ def }) => [...this.filters].every((f) => (def.props[f] ?? 0) > 0.02))

    // Carried count, in the panel and on the one badge that ships in the frame.
    const count = $('inv-count')
    count.replaceChildren()
    if (this.pack.length === 0) {
      count.append('Nothing yet')
    } else {
      count.append(el('b', undefined, String(this.pack.length)), ' Carried')
      if (this.filters.size > 0) count.append(' · ', el('b', undefined, String(visible.length)), ' Shown')
    }

    $('carry').hidden = this.pack.length === 0
    $('carry-n').textContent = String(this.pack.length)

    const host = $('items')
    host.replaceChildren()

    if (visible.length === 0) {
      host.append(
        el(
          'div',
          'empty',
          this.pack.length === 0
            ? 'Walk over something and press F.\nEverything can be picked up.'
            : 'Nothing you carry matches that filter.',
        ),
      )
    }

    for (const { def, index } of visible) host.append(this.buildCard(def, index))

    this.syncFade()
    this.renderBench()
  }

  /**
   * The list fades out at the bottom while there are rows below the fold, which
   * is what stops the bench edge from looking like it has guillotined a card.
   * Driven by the real scroll position, so a list that ends exactly at the
   * bottom is not lied about.
   */
  private syncFade(): void {
    const host = $('items')
    host.classList.toggle('more', host.scrollTop + host.clientHeight < host.scrollHeight - 2)
  }

  private buildCard(def: ItemDef, index: number): HTMLElement {
    const picked = index === this.slotA ? 1 : index === this.slotB ? 2 : 0
    const card = el('div', 'card' + (picked ? ' picked' : ''))
    card.addEventListener('click', () => this.pick(index))

    const swatch = el('img', 'swatch')
    swatch.src = itemIcon(def)
    swatch.alt = ''

    const body = el('div')

    const top = el('div', 'card-top')
    top.append(el('div', 'card-name', def.name))
    // The USE mode badge (IDEAS A11) belongs on this row, right aligned, next
    // to the bench-slot numeral. Nothing declares a mode yet, so nothing is
    // drawn; the row already reserves the height either way.
    if (picked) top.append(el('div', 'card-slot', String(picked)))

    const traits = el('div', 'card-traits')
    const all = ranked(def.props)
    for (const { id, value } of all.slice(0, TRAITS_PER_CARD)) traits.append(this.buildTrait(id, value))
    if (all.length > TRAITS_PER_CARD) {
      traits.append(el('span', 'trait-more', `+${all.length - TRAITS_PER_CARD}`))
    }

    body.append(top, traits)
    card.append(swatch, body)
    return card
  }

  private buildTrait(id: PropertyId, value: number): HTMLElement {
    const trait = el('span', 'trait')
    trait.title = `${id.replace(/_/g, ' ').toLowerCase()}: ${meta(id).blurb}`
    trait.append(id.replace(/_/g, ' '))

    const pips = el('span', 'pips')
    pips.style.setProperty('--pcolor', meta(id).color)
    // Anything present at all earns a pip, so a trace never renders as empty.
    const filled = Math.max(1, Math.min(PIPS, Math.round(value * PIPS)))
    for (let i = 0; i < PIPS; i++) pips.append(el('i', i < filled ? 'pip on' : 'pip'))

    trait.append(pips)
    return trait
  }

  private renderBench(): void {
    const a = this.slotA !== null ? this.pack[this.slotA] : undefined
    const b = this.slotB !== null ? this.pack[this.slotB] : undefined

    const setSlot = (host: HTMLElement, def: ItemDef | undefined) => {
      host.replaceChildren()
      host.classList.toggle('filled', def !== undefined)
      if (!def) return
      const icon = el('img')
      icon.src = itemIcon(def)
      icon.alt = ''
      host.append(icon, el('span', undefined, def.name))
    }
    setSlot($('slot-a'), a)
    setSlot($('slot-b'), b)

    // One empty-state message for the whole bench, on the header row. Ghost
    // slots and a dead button already say "nothing is selected" twice over.
    const hint = $('bench-hint')
    hint.hidden = Boolean(a && b)
    hint.textContent = a || b ? 'Pick one more.' : 'Pick two things.'

    const result = $('result')
    const button = $('merge-btn') as HTMLButtonElement
    const warn = $('warn')

    result.replaceChildren()
    result.classList.remove('refused')

    if (!a || !b) {
      result.hidden = true
      button.disabled = true
      warn.hidden = true
      this.announced = null
      return
    }

    result.hidden = false
    // Covers both refusal kinds, not just `noMerge`.
    const combines = canMerge(a.id, b.id)
    const refusalText = combines ? null : refusal(a.id, b.id)
    if (combines) this.announced = null

    if (refusalText) {
      // D18: a pair that has no result simply does not merge, and the bench
      // says so in the object's own voice. Nothing is consumed, so this is
      // information rather than a warning, and it arrives the instant the
      // second slot fills. Making the player press a dead button to learn it
      // was the complaint.
      result.classList.add('refused')
      const text = el('div', 'rtext')
      text.append(el('div', 'name', 'Nothing to make.'), el('div', 'sub', refusalText))
      result.append(text)
      this.announce(mergeId(a.id, b.id), refusalText)
    } else if (isDiscovered(a.id, b.id, this.codex)) {
      // Known pairs show their result. Undiscovered ones stay a gamble, which
      // is what keeps the irreversibility meaningful.
      const known = tryMerge(a.id, b.id)!
      const icon = el('img')
      icon.src = itemIcon(known)
      icon.alt = ''
      const text = el('div', 'rtext')
      text.append(el('div', 'name', known.name), el('div', 'sub', 'You have made this before.'))
      result.append(icon, text)
    } else {
      result.append(el('span', 'q', '?'), el('span', 'sub', 'Never merged before.'))
    }

    button.disabled = !combines
    warn.hidden = !combines
  }

  /**
   * Say a refusal out loud once per pair. `renderBench` runs on every render,
   * including filter clicks and pickups, so the pair that was last announced is
   * remembered and a toast never repeats itself while the same two things sit
   * on the bench.
   */
  private announce(pair: string, text: string): void {
    if (this.announced === pair) return
    this.announced = pair
    this.toast('Nothing to make', text)
  }

  // ------------------------------------------------------------------ notices

  /**
   * Live notices.
   *
   * The important behaviour here is that repeats COALESCE rather than stack.
   * Chopping a tree fires once per swing and a spreading fire fires once per
   * post, so the naive version buried the screen in boxes saying nearly the
   * same thing. A notice with the same `group` updates the existing box in
   * place, keeps its position so nothing jumps, counts the repeats, and
   * restarts its own timer.
   *
   * Position is deliberately NOT bumped to the end on an update. Reordering on
   * every swing is its own kind of noise.
   */
  toast(
    label: string,
    text: string,
    opts: { kind?: 'normal' | 'fire'; group?: string } | 'normal' | 'fire' = {},
  ): void {
    // Third argument used to be a bare kind. Accept both so no call site lies.
    const o = typeof opts === 'string' ? { kind: opts } : opts
    const kind = o.kind ?? 'normal'

    // Default grouping is by label, so identical labels merge without every
    // call site having to remember to pass a key.
    const key = o.group ?? label

    const host = $('toasts')
    const existing = this.notices.get(key)

    if (existing && existing.node.isConnected) {
      existing.count++
      existing.body.textContent = text
      existing.node.className = 'toast' + (kind === 'fire' ? ' fire' : '')
      if (existing.count > 1) existing.tally.textContent = `x${existing.count}`
      // Retrigger the entry animation so an update is still noticed.
      existing.node.classList.remove('bump')
      void existing.node.offsetWidth
      existing.node.classList.add('bump')
      clearTimeout(existing.timer)
      existing.timer = setTimeout(() => {
        existing.node.remove()
        this.notices.delete(key)
      }, 5200)
      return
    }

    const node = el('div', 'toast' + (kind === 'fire' ? ' fire' : ''))
    const head = el('div', 'label', label)
    const tally = el('span', 'tally')
    head.append(tally)
    const body = el('div', 'body', text)
    node.append(head, body)
    host.append(node)

    // Headless runs never advance the wall clock, so these would pile up
    // forever; cap the list instead of relying on the timer alone. Oldest goes,
    // and its bookkeeping goes with it.
    while (host.children.length > 4) {
      const oldest = host.firstChild as HTMLElement
      for (const [k, v] of this.notices) if (v.node === oldest) this.notices.delete(k)
      host.removeChild(oldest)
    }

    const timer = setTimeout(() => {
      node.remove()
      this.notices.delete(key)
    }, 5200)

    this.notices.set(key, { node, body, tally, count: 1, timer })
  }

  /**
   * The held item strip.
   *
   * A11 says every item must answer "what happens if I press use right now?"
   * and that the answer must never be a silent nothing. This is where that
   * answer lives: what is in hand, and the one line describing what USE does
   * with it. Without this, throwing was a keypress that consumed an item the
   * player never chose and could not see.
   */
  held(icon: string | null, name: string, summary: string, index: number, total: number): void {
    const node = $('held')
    node.classList.toggle('on', icon !== null)
    if (icon === null) return

    node.replaceChildren()
    const img = el('img', 'held-icon')
    img.src = icon
    img.alt = ''

    const text = el('div', 'held-text')
    text.append(el('div', 'held-name', name), el('div', 'held-use', summary))

    node.append(img, text)
    if (total > 1) node.append(el('div', 'held-count', `${index + 1}/${total}`))
  }

  prompt(html: string | null): void {
    const node = $('prompt')
    node.classList.toggle('on', html !== null)
    if (html !== null) node.innerHTML = html
  }

  flash(): void {
    const node = $('flash')
    node.style.opacity = '1'
    setTimeout(() => (node.style.opacity = '0'), 90)
  }

  // -------------------------------------------------------------------- debug

  /**
   * The seed/tick/fps block is a development instrument, not part of the game,
   * so it is off unless asked for: `?debug=1` on the URL, or F3 at any time.
   * `main.ts` keeps writing to it either way; CSS decides whether it is drawn.
   */
  private mountDebug(): void {
    const params = new URLSearchParams(location.search)
    const on = params.has('debug') && params.get('debug') !== '0'
    document.body.classList.toggle('debug', on)

    addEventListener('keydown', (e) => {
      if (e.key !== 'F3') return
      e.preventDefault()
      document.body.classList.toggle('debug')
    })
  }

  /**
   * `tools/shot.ts` renders one frame and screenshots the moment
   * `__sinterReady` flips, while a CSS transition runs on the wall clock that
   * a headless run deliberately does not have. The panel photographed half
   * slid in. Under `?ticks` there is nothing to animate against, so do not.
   */
  private mountHeadless(): void {
    if (new URLSearchParams(location.search).has('ticks')) document.body.classList.add('headless')
  }
}
