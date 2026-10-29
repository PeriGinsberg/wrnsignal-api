#!/usr/bin/env tsx
// The CC a coach adds to an email to a client: what is accepted, the order,
// and what is dropped.
// Run: npx tsx tests/email/cc.test.ts

import { badCc, resolveCc, splitCc } from "../../lib/email/cc"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const to = "alex@example.com"
const r = (args: { ccParent?: unknown; cc?: unknown; parentEmail?: string | null }) =>
  resolveCc({ ccParent: args.ccParent, cc: args.cc, parentEmail: args.parentEmail ?? null, to })
const line = (x: ReturnType<typeof resolveCc>) => (x.ok ? x.cc : `error: ${x.error}`)

ok("split on commas, semicolons, spaces and newlines", JSON.stringify(splitCc(" a@x.com,b@x.com; c@x.com\nd@x.com ")) === JSON.stringify(["a@x.com", "b@x.com", "c@x.com", "d@x.com"]))
ok("badCc: empty is fine", badCc("  ") === null)
ok("badCc: names the bad one", badCc("a@x.com, Pat Rivera") === "Pat")
ok("nothing ticked or typed: no CC", line(r({})) === null)
ok("parent only", line(r({ ccParent: true, parentEmail: " p@x.com " })) === "p@x.com")
ok("parent first, then typed", line(r({ ccParent: true, parentEmail: "p@x.com", cc: "m@x.com" })) === "p@x.com, m@x.com")
ok("parent not ticked: not added", line(r({ parentEmail: "p@x.com", cc: "m@x.com" })) === "m@x.com")
ok("duplicates dropped, any case", line(r({ ccParent: true, parentEmail: "p@x.com", cc: "P@X.com, m@x.com, M@x.com" })) === "p@x.com, m@x.com")
ok("the client's own address dropped", line(r({ cc: "ALEX@example.com" })) === null)
ok("ticked with no parent email refused", !r({ ccParent: true }).ok)
ok("not an address refused", !r({ cc: "m@x.com, nope" }).ok)
ok("non-string refused", !r({ cc: 5 }).ok)
ok("10 accepted", r({ cc: Array.from({ length: 10 }, (_, i) => `p${i}@x.com`).join(",") }).ok)
ok("11 refused", !r({ cc: Array.from({ length: 11 }, (_, i) => `p${i}@x.com`).join(",") }).ok)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
