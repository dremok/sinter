import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CATALOG, RECIPES, STARTING_ITEMS } from './index'

/**
 * The load-order landmine, closed.
 *
 * `CATALOG` is filled by two modules: `catalog.ts` adds the authored objects,
 * `merge.ts` adds the results when `buildAll()` runs at ITS load. Import
 * `./catalog` alone and you get a third of the world, silently, with every
 * merge result simply absent and every property read on one returning 0.
 *
 * `index.ts` guarantees `merge.ts` has been evaluated. This file is what stops
 * anybody bypassing it, because a barrel nothing is required to use is a
 * comment asking people to remember.
 */

const SRC = new URL('../', import.meta.url).pathname

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsFiles(full))
    else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('the catalog cannot be seen half built', () => {
  it('is whole the moment the items layer is imported', () => {
    // The thing the barrel exists to guarantee, asserted rather than assumed.
    expect(STARTING_ITEMS.length).toBeGreaterThan(10)
    for (const r of RECIPES) {
      expect(CATALOG[r.id], `${r.id} is missing, so buildAll() has not run`).toBeDefined()
    }
    expect(Object.keys(CATALOG).length).toBe(
      Object.values(CATALOG).filter((d) => !d.from).length + RECIPES.length,
    )
  })

  it('is not imported directly from outside src/items/', () => {
    /**
     * A VALUE import of `items/catalog` from outside this directory is the bug.
     * `import type` is fine and stays allowed: types are erased at build time,
     * so a type-only import cannot observe a partial catalog and cannot pull in
     * a module at runtime either.
     *
     * If this fails, the fix is one line in the offending file: import from
     * `@/items` (or `../items`) instead of `@/items/catalog`.
     */
    /**
     * The three that exist today, in files the items layer does not own.
     *
     * A RATCHET, and it must reach zero. Each is a one line change: import
     * `CATALOG` and `STARTING_ITEMS` from `@/items` rather than
     * `@/items/catalog`. Nothing else about them changes.
     *
     * The list is checked in both directions. A new direct importer fails this
     * test, and so does a stale entry, so fixing one of these forces its line
     * here to be deleted rather than left behind as decoration.
     */
    const PENDING = ['ui/interface.ts', 'world/region.ts']

    const offenders: string[] = []

    for (const file of tsFiles(SRC)) {
      if (file.includes('/items/')) continue
      const source = readFileSync(file, 'utf8')

      for (const line of source.split('\n')) {
        if (!/from\s+['"].*items\/catalog['"]/.test(line)) continue
        // `import type { ... }` and `import { type A, type B }` are harmless.
        if (/^\s*import\s+type\s/.test(line)) continue
        const named = line.match(/import\s*\{([^}]*)\}/)
        if (named && named[1]!.split(',').every((s) => s.trim() === '' || s.trim().startsWith('type '))) {
          continue
        }
        offenders.push(`${file.slice(SRC.length)}: ${line.trim()}`)
      }
    }

    const files = offenders.map((o) => o.split(':')[0]!)

    const added = files.filter((f) => !PENDING.includes(f))
    expect(added, `import from '@/items' instead:\n${offenders.join('\n')}`).toEqual([])

    const fixed = PENDING.filter((f) => !files.includes(f))
    expect(fixed, `fixed already: delete ${fixed.join(', ')} from PENDING`).toEqual([])
  })

  it('reads its own directory, so the check cannot silently scan nothing', () => {
    // Guards the guard. A path mistake would make the test above pass by
    // finding no files at all, which is the failure mode of every check that
    // walks a tree.
    const files = tsFiles(SRC)
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => f.endsWith('main.ts'))).toBe(true)
  })
})
