// Run: npx tsx lib/network-tracker/stripDismissal.test.ts
//
// The empty-company strip's memory. Small surface, but it is the one piece of
// this screen with no server behind it, so the edges it has to survive are
// storage being absent, storage throwing, and two accounts sharing a browser.

import { dismissedFor, dismiss, pruneTo, clearAllDismissals } from "./stripDismissal"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const A = "profile-a"
const B = "profile-b"

/** A localStorage good enough to be wrong in the ways the real one is. */
function fakeStorage(opts: { throwOnSet?: boolean; throwOnGet?: boolean } = {}) {
  const map = new Map<string, string>()
  return {
    getItem(k: string) { if (opts.throwOnGet) throw new Error("blocked"); return map.get(k) ?? null },
    setItem(k: string, v: string) { if (opts.throwOnSet) throw new Error("quota"); map.set(k, v) },
    removeItem(k: string) { map.delete(k) },
  } as any
}

function withStorage(s: any) {
  ;(globalThis as any).window = { localStorage: s }
}

function main() {
  console.log("\nthe basics")
  withStorage(fakeStorage())
  ok("nothing dismissed to start", dismissedFor(A).size === 0)
  dismiss(A, "co-1")
  ok("a dismissal sticks", dismissedFor(A).has("co-1"))
  dismiss(A, "co-2")
  ok("...and accumulates", dismissedFor(A).size === 2)
  dismiss(A, "co-1")
  ok("dismissing twice is not two entries", dismissedFor(A).size === 2)

  console.log("\nscoped per profile")
  ok("the other account sees none of it", dismissedFor(B).size === 0)
  dismiss(B, "co-9")
  ok("...and keeps its own", dismissedFor(B).has("co-9") && !dismissedFor(B).has("co-1"))
  ok("...without disturbing the first", dismissedFor(A).size === 2)

  console.log("\npruning: a company that empties again should ask again")
  pruneTo(A, ["co-1"])
  ok("co-2 is forgotten once it is no longer empty", !dismissedFor(A).has("co-2"))
  ok("co-1 is still dismissed", dismissedFor(A).has("co-1"))
  ok("the other profile is untouched by a prune", dismissedFor(B).has("co-9"))

  console.log("\nhostile storage")
  withStorage(fakeStorage({ throwOnSet: true }))
  ok("a throwing setItem does not throw out", (() => {
    try { dismiss(A, "co-3"); return true } catch { return false }
  })())
  withStorage(fakeStorage({ throwOnGet: true }))
  ok("a throwing getItem reads as empty", dismissedFor(A).size === 0)

  console.log("\nno window at all (SSR)")
  delete (globalThis as any).window
  ok("dismissedFor is empty", dismissedFor(A).size === 0)
  ok("dismiss does not throw", (() => { try { dismiss(A, "x"); return true } catch { return false } })())
  ok("clearAllDismissals does not throw", (() => { try { clearAllDismissals(); return true } catch { return false } })())

console.log("\nthe wipe-on-load trap")
  // The bug this pins: pruneTo keeps ONLY the ids it is given, so calling it
  // with [] deletes the store. That is correct when the board genuinely has
  // no empty companies left, and catastrophic when the list has simply not
  // loaded yet, which is every page load: the fetch has not returned when the
  // session resolves. The caller must pass null, not [], while it does not
  // know. EmptyCompanyStrip s prop type is what enforces that now.
  withStorage(fakeStorage())
  dismiss(A, "co-1")
  dismiss(A, "co-2")
  ok("pruning to [] DOES wipe, correct for a board with none left", pruneTo(A, []).size === 0)
  ok("...and the store really is empty afterwards", dismissedFor(A).size === 0)
  dismiss(A, "co-1")
  ok("pruning to the same list is a no-op", pruneTo(A, ["co-1"]).size === 1)

    console.log("\nempty inputs")
  withStorage(fakeStorage())
  ok("no profile id means no dismissals", dismissedFor("").size === 0)
  ok("an empty company id is not stored", dismiss(A, "").size === 0)
}

main()
console.log(failures === 0 ? "\nall stripDismissal assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
