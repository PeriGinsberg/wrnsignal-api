#!/usr/bin/env tsx
// Pure-logic test for the "← Back" target, in the repo's tsx-script convention.
// The routing rules are all decidable without a DOM; only sessionStorage needs a
// stub, which is three lines.

import { isRecordRoute, rememberOrigin, readBackTarget, DEFAULT_BACK } from "./backTarget"

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`✓ ${label}`) }
  else { fail++; console.error(`✗ ${label}`) }
}

// Minimal sessionStorage stub — the module guards every access in try/catch, so
// this also exercises the "storage works" path rather than the fallback.
const store = new Map<string, string>()
;(globalThis as any).sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

console.log("backTarget: origin recording + fallback")

// A record page must never become its own back target — otherwise Back is a no-op.
ok("record route is recognised", isRecordRoute("/dashboard/network/contacts/abc-123") === true)
ok("record route with trailing slash is recognised", isRecordRoute("/dashboard/network/contacts/abc-123/") === true)
ok("the contacts LIST is not a record route", isRecordRoute("/dashboard/network/contacts") === false)
ok("the worklist is not a record route", isRecordRoute("/dashboard/network") === false)
ok("the company board is not a record route", isRecordRoute("/dashboard/network/companies") === false)

// Fallback: nothing recorded (direct URL, fresh tab) → Contacts, NOT Today.
store.clear()
ok("no origin recorded → falls back to the Contacts list", readBackTarget() === DEFAULT_BACK)
ok("the fallback is Contacts, not Today", DEFAULT_BACK === "/dashboard/network/contacts")

// Each origin returns the user to that origin.
store.clear(); rememberOrigin("/dashboard/network")
ok("from the worklist → back to the worklist", readBackTarget() === "/dashboard/network")

store.clear(); rememberOrigin("/dashboard/network/companies")
ok("from the company board → back to the board", readBackTarget() === "/dashboard/network/companies")

store.clear(); rememberOrigin("/dashboard/network/contacts")
ok("from the spreadsheet → back to the spreadsheet", readBackTarget() === "/dashboard/network/contacts")

// The query string survives, so a filtered list is returned to still filtered.
store.clear(); rememberOrigin("/dashboard/network/contacts?standalone=1")
ok("filters are preserved on the way back",
  readBackTarget() === "/dashboard/network/contacts?standalone=1")

// Opening a record must not overwrite the origin — otherwise Back points at the
// record you are already on.
store.clear()
rememberOrigin("/dashboard/network/companies")
rememberOrigin("/dashboard/network/contacts/abc-123")
ok("visiting a record does NOT overwrite the recorded origin",
  readBackTarget() === "/dashboard/network/companies")

// A stored value from outside the tracker degrades to the default.
store.clear(); store.set("network:origin", "https://example.com/evil")
ok("a non-internal stored value falls back to the default", readBackTarget() === DEFAULT_BACK)
store.clear(); rememberOrigin("/dashboard/coach/clients")
ok("a route outside the tracker is never recorded", readBackTarget() === DEFAULT_BACK)

console.log(`\n${pass}/${pass + fail} assertions passed`)
if (fail > 0) process.exit(1)
