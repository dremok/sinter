/**
 * The items layer. Import THIS from outside `src/items/`, never `./catalog`.
 *
 * WHY THIS FILE EXISTS
 *
 * `CATALOG` is a mutable registry that two modules fill. `catalog.ts` adds the
 * 25 authored objects as it loads, and `merge.ts` adds the 66 merge results
 * from `buildAll()` as IT loads. So a module that imports `./catalog` and
 * nothing else sees a third of the world, with no error and no crash: every
 * merge result is simply absent, `CATALOG[id]` is undefined, and every property
 * read on one silently returns 0.
 *
 * That is the worst failure shape this project has. It already cost a
 * measurement that was nearly reported as a finding: a scan of "the whole
 * catalog" that quietly covered only the base items and returned a confident
 * wrong number.
 *
 * Importing this module guarantees `merge.ts` has been evaluated, so the
 * catalog is whole. `items.test.ts` fails the build if anything outside this
 * directory imports `./catalog` for a value, so the rule is enforced rather
 * than remembered.
 *
 * WHY NOT JUST HAVE `catalog.ts` IMPORT `merge.ts`
 *
 * Tried, and it cannot work. `merge.ts` imports `CATALOG` from `catalog.ts`, so
 * the two would form a cycle: importing `catalog` would run `merge`'s body
 * first, and `buildAll()` would touch `CATALOG` while it is still in the
 * temporal dead zone. A ReferenceError at boot is better than silence, but a
 * barrel that cannot fail is better than both.
 *
 * INSIDE `src/items/` KEEP IMPORTING `./catalog` DIRECTLY. Routing an internal
 * import through here would rebuild exactly the cycle described above.
 */

export * from './catalog'
export * from './merge'
export * from './interactions'
export * from './codex'
