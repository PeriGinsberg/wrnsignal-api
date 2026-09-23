#!/usr/bin/env tsx
// The library access ladder. Pure, so no database.
// Run: npx tsx app/api/_lib/coachClientDocuments.test.ts
//
// The library routes shipped checking only "does this coach own the
// coach_clients row", which is a different question from "may they use it".
// A coach at 'view' could add and delete documents, and a paused or revoked
// coach kept working access. These pin the rule the rest of the coach surface
// already follows: read needs view, write needs full, and the relationship must
// be active either way.

import { libraryAccessDenied } from "./coachClientDocuments"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}`) }
}
const rel = (status: string, access_level: string) => ({ status, access_level })
const allowed = (s: string, l: string, need: "read" | "write") => libraryAccessDenied(rel(s, l), need) === null

console.log("an active relationship, by level")
ok("full may read", allowed("active", "full", "read"))
ok("full may write", allowed("active", "full", "write"))
ok("annotate may read", allowed("active", "annotate", "read"))
ok("annotate may NOT write", !allowed("active", "annotate", "write"))
ok("view may read", allowed("active", "view", "read"))
ok("view may NOT write", !allowed("active", "view", "write"))

console.log("\nthe relationship must be active, whatever the level")
for (const status of ["pending", "paused", "revoked"]) {
  ok(`'${status}' may not read, even at full`, !allowed(status, "full", "read"))
  ok(`'${status}' may not write, even at full`, !allowed(status, "full", "write"))
}

console.log("\nthe message says which wall was hit")
ok("an inactive relationship says so", libraryAccessDenied(rel("revoked", "full"), "read") === "This coaching relationship is not active.")
ok("a write refusal names full access", String(libraryAccessDenied(rel("active", "annotate"), "write")).includes("Full access"))

console.log("\nan unknown level is not a free pass")
ok("garbage level cannot read", !allowed("active", "superuser", "read"))
ok("garbage level cannot write", !allowed("active", "superuser", "write"))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
