// Run: npx tsx lib/network-tracker/reminderFlagDismissal.test.ts
//
// The follow-up flag's memory. The property that matters is that a dismissal
// is scoped to ONE due date, so waving away today's reminder says nothing
// about the next one and old keys expire by themselves.

import { isFlagDismissed, dismissFlag, clearAllFlagDismissals, flagKey } from "./reminderFlagDismissal"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const A = "profile-a"
const B = "profile-b"
const C1 = "contact-1"
const AUG = "2026-08-01T00:00:00Z"
const SEP = "2026-09-01T00:00:00Z"

function fakeStorage(opts: { throwOnSet?: boolean; throwOnGet?: boolean } = {}) {
  const map = new Map<string, string>()
  return {
    getItem(k: string) { if (opts.throwOnGet) throw new Error("blocked"); return map.get(k) ?? null },
    setItem(k: string, v: string) { if (opts.throwOnSet) throw new Error("quota"); map.set(k, v) },
    removeItem(k: string) { map.delete(k) },
  } as any
}
function withStorage(s: any) { (globalThis as any).window = { localStorage: s } }

function main() {
  console.log("\nthe basics")
  withStorage(fakeStorage())
  ok("nothing dismissed to start", !isFlagDismissed(A, C1, AUG))
  dismissFlag(A, C1, AUG)
  ok("a dismissal sticks", isFlagDismissed(A, C1, AUG))

  console.log("\nscoped to ONE due date, which is the whole design")
  ok("the NEXT reminder is a fresh question", !isFlagDismissed(A, C1, SEP))
  dismissFlag(A, C1, SEP)
  ok("...and can be dismissed independently", isFlagDismissed(A, C1, SEP))
  ok("the first is still dismissed", isFlagDismissed(A, C1, AUG))

  console.log("\nscoped per contact and per account")
  ok("another contact is unaffected", !isFlagDismissed(A, "contact-2", AUG))
  ok("another account sees none of it", !isFlagDismissed(B, C1, AUG))

  console.log("\nno date, no dismissal")
  ok("null due date is never dismissed", !isFlagDismissed(A, C1, null))
  ok("dismissing a null date stores nothing", (() => {
    dismissFlag(A, C1, null); return !isFlagDismissed(A, C1, null)
  })())
  ok("empty ids are ignored", !isFlagDismissed("", C1, AUG) && !isFlagDismissed(A, "", AUG))

  console.log("\nthe key is contact + date")
  ok("key composes both", flagKey(C1, AUG).includes(C1) && flagKey(C1, AUG).includes(AUG))
  ok("different dates are different keys", flagKey(C1, AUG) !== flagKey(C1, SEP))

  console.log("\nhostile storage, and none of it may throw")
  withStorage(fakeStorage({ throwOnSet: true }))
  ok("a throwing setItem does not throw out",
    (() => { try { dismissFlag(A, C1, AUG); return true } catch { return false } })())
  withStorage(fakeStorage({ throwOnGet: true }))
  ok("a throwing getItem reads as not dismissed", !isFlagDismissed(A, C1, AUG))

  console.log("\nno window at all (SSR)")
  delete (globalThis as any).window
  ok("reads as not dismissed", !isFlagDismissed(A, C1, AUG))
  ok("dismiss does not throw", (() => { try { dismissFlag(A, C1, AUG); return true } catch { return false } })())
  ok("clear does not throw", (() => { try { clearAllFlagDismissals(); return true } catch { return false } })())
}

main()
console.log(failures === 0 ? "\nall reminder-flag assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
