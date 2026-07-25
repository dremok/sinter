/**
 * Pack, property filter, and merge bench.
 *
 * docs/DESIGN.md is explicit that infinite inventory is a UI problem, not a
 * storage problem, and that "show me everything FLAMMABLE" is the single most
 * important query in the game. The filter here is therefore built on property
 * chips rather than on categories or item types, which also means it keeps
 * working for items that did not exist when it was written.
 */

import type { ItemDef } from '../items/catalog'
import { isDiscovered, merge, mergeId } from '../items/merge'
import { itemIcon } from '../render/icons'
import { ALL_PROPERTIES, meta, ranked, type PropertyId } from '../props/registry'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

export interface UiHooks {
  onMerged: (result: ItemDef, a: ItemDef, b: ItemDef) => void
  onDropped: (def: ItemDef) => void
}

export class Ui {
  readonly pack: ItemDef[] = []
  readonly codex = new Set<string>()

  private filters = new Set<PropertyId>()
  private slotA: number | null = null
  private slotB: number | null = null
  private open = false

  constructor(private hooks: UiHooks) {
    this.buildFilters()
    $('merge-btn').addEventListener('click', () => this.doMerge())
    $('slot-a').addEventListener('click', () => {
      this.slotA = null
      this.render()
    })
    $('slot-b').addEventListener('click', () => {
      this.slotB = null
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

  private buildFilters(): void {
    const host = $('filters')
    host.replaceChildren()

    for (const id of ALL_PROPERTIES) {
      const chip = document.createElement('div')
      chip.className = 'chip'
      chip.textContent = id.replace(/_/g, ' ')
      chip.addEventListener('click', () => {
        if (this.filters.has(id)) this.filters.delete(id)
        else this.filters.add(id)
        this.render()
      })
      chip.dataset.prop = id
      host.appendChild(chip)
    }
  }

  private render(): void {
    // filter chips
    for (const el of Array.from($('filters').children) as HTMLElement[]) {
      const id = el.dataset.prop as PropertyId
      const on = this.filters.has(id)
      el.classList.toggle('active', on)
      el.style.background = on ? meta(id).color : 'rgba(255,255,255,0.06)'
    }

    const visible = this.pack
      .map((def, index) => ({ def, index }))
      .filter(({ def }) => [...this.filters].every((f) => (def.props[f] ?? 0) > 0.02))

    $('inv-count').textContent =
      this.pack.length === 0
        ? 'nothing yet'
        : `${this.pack.length} carried` + (this.filters.size ? ` · ${visible.length} shown` : '')

    // cards
    const host = $('items')
    host.replaceChildren()

    if (visible.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent =
        this.pack.length === 0
          ? 'Walk over something and press F.\nEverything can be picked up.'
          : 'Nothing carried matches that filter.'
      host.appendChild(empty)
    }

    for (const { def, index } of visible) {
      const card = document.createElement('div')
      card.className = 'card' + (index === this.slotA || index === this.slotB ? ' picked' : '')
      card.addEventListener('click', () => this.pick(index))

      const swatch = document.createElement('img')
      swatch.className = 'swatch'
      swatch.src = itemIcon(def)
      swatch.alt = ''

      const body = document.createElement('div')
      const name = document.createElement('div')
      name.className = 'card-name'
      name.textContent = def.name

      const props = document.createElement('div')
      props.className = 'card-props'
      for (const { id, value } of ranked(def.props).slice(0, 5)) {
        const chip = document.createElement('span')
        chip.className = 'pchip'
        chip.style.background = meta(id).color
        chip.textContent = `${id.replace(/_/g, ' ')} ${value.toFixed(2)}`
        chip.title = meta(id).blurb
        props.appendChild(chip)
      }

      body.append(name, props)
      card.append(swatch, body)
      host.appendChild(card)
    }

    this.renderBench()
  }

  private renderBench(): void {
    const a = this.slotA !== null ? this.pack[this.slotA] : undefined
    const b = this.slotB !== null ? this.pack[this.slotB] : undefined

    const setSlot = (el: HTMLElement, def: ItemDef | undefined) => {
      el.textContent = def ? def.name : 'empty'
      el.classList.toggle('filled', def !== undefined)
    }
    setSlot($('slot-a'), a)
    setSlot($('slot-b'), b)

    const result = $('result')
    result.replaceChildren()

    if (!a || !b) {
      const hint = document.createElement('span')
      hint.style.color = 'var(--dim)'
      hint.textContent = 'pick two things'
      result.appendChild(hint)
    } else if (isDiscovered(a.id, b.id, this.codex)) {
      // Known pairs show their result. Undiscovered ones stay a gamble, which
      // is what keeps the irreversibility meaningful.
      const known = merge(a.id, b.id)
      const swatch = document.createElement('img')
      swatch.className = 'swatch'
      swatch.src = itemIcon(known)
      swatch.alt = ''
      const label = document.createElement('span')
      label.textContent = known.name
      result.append(swatch, label)
    } else {
      const q = document.createElement('span')
      q.className = 'q'
      q.textContent = '?'
      const label = document.createElement('span')
      label.style.color = 'var(--dim)'
      label.textContent = 'never merged before'
      result.append(q, label)
    }

    ;($('merge-btn') as HTMLButtonElement).disabled = !a || !b
  }

  // ------------------------------------------------------------------ notices

  toast(label: string, text: string, kind: 'normal' | 'fire' = 'normal'): void {
    const host = $('toasts')
    const el = document.createElement('div')
    el.className = 'toast' + (kind === 'fire' ? ' fire' : '')

    const l = document.createElement('div')
    l.className = 'label'
    l.textContent = label
    const t = document.createElement('div')
    t.textContent = text

    el.append(l, t)
    host.appendChild(el)

    // Headless runs never advance the wall clock, so these would pile up
    // forever; cap the list instead of relying on the timer alone.
    while (host.children.length > 4) host.removeChild(host.firstChild!)
    setTimeout(() => el.remove(), 5200)
  }

  prompt(html: string | null): void {
    const el = $('prompt')
    el.classList.toggle('on', html !== null)
    if (html !== null) el.innerHTML = html
  }


  flash(): void {
    const el = $('flash')
    el.style.opacity = '1'
    setTimeout(() => (el.style.opacity = '0'), 90)
  }
}
