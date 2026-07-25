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
import { isDiscovered, merge, mergeId } from '../items/merge'
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

  constructor(private hooks: UiHooks) {
    this.buildFilters()
    this.mountDebug()

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
    // D18: some things never combine, and the refusal costs nothing.
    if (a.noMerge || b.noMerge) return

    const result = merge(a.id, b.id)
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
      count.append('empty')
    } else {
      count.append(el('b', undefined, String(this.pack.length)), ' carried')
      if (this.filters.size > 0) count.append(' · ', el('b', undefined, String(visible.length)), ' shown')
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

    this.renderBench()
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
    hint.textContent = a || b ? 'one more' : 'pick two'

    const result = $('result')
    const button = $('merge-btn') as HTMLButtonElement
    const warn = $('warn')

    result.replaceChildren()
    result.classList.remove('refused')

    if (!a || !b) {
      result.hidden = true
      button.disabled = true
      warn.hidden = true
      return
    }

    result.hidden = false
    const refusal = a.noMerge ?? b.noMerge

    if (refusal) {
      // D18: a pair that has no result simply does not merge, and the bench
      // says so in the object's own voice. Nothing is consumed.
      result.classList.add('refused')
      result.append(el('span', 'q', '✕'), el('span', 'sub', refusal))
    } else if (isDiscovered(a.id, b.id, this.codex)) {
      // Known pairs show their result. Undiscovered ones stay a gamble, which
      // is what keeps the irreversibility meaningful.
      const known = merge(a.id, b.id)
      const icon = el('img')
      icon.src = itemIcon(known)
      icon.alt = ''
      const text = el('div', 'rtext')
      text.append(el('div', 'name', known.name), el('div', 'sub', 'you have made this before'))
      result.append(icon, text)
    } else {
      result.append(el('span', 'q', '?'), el('span', 'sub', 'never merged before'))
    }

    button.disabled = Boolean(refusal)
    warn.hidden = Boolean(refusal)
  }

  // ------------------------------------------------------------------ notices

  toast(label: string, text: string, kind: 'normal' | 'fire' = 'normal'): void {
    const host = $('toasts')
    const node = el('div', 'toast' + (kind === 'fire' ? ' fire' : ''))
    node.append(el('div', 'label', label), el('div', 'body', text))
    host.append(node)

    // Headless runs never advance the wall clock, so these would pile up
    // forever; cap the list instead of relying on the timer alone.
    while (host.children.length > 4) host.removeChild(host.firstChild!)
    setTimeout(() => node.remove(), 5200)
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
}
