#!/usr/bin/env tsx
// The JobEvent `kind` union is declared TWICE — once in the API route that
// emits events, once in the component that renders them — and a mismatch does
// not fail the build.
//
// THE FAILURE THIS PINS. Add a kind to the route and not to JobHistory.tsx and
// the event still arrives, still renders, and `meaningOf()` falls through its
// if-chain to return "idle". The result is a grey dot with a correct label,
// which looks like a deliberate styling choice rather than a bug. Nobody
// reviewing a screenshot would catch it. It cost the coach-response event
// nothing only because it was caught while writing it.
//
// This reads both files as TEXT rather than importing them: the route is a
// server module and the component is a "use client" module with React and
// theme imports, so neither loads cleanly in a bare tsx script. Parsing the
// source is uglier and actually runs.
//
// tsx-script convention (pure logic), same as contactOrder.test.ts.

import { readFileSync } from "node:fs"

let pass = 0, fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`✓ ${label}`) }
  else { fail++; console.error(`✗ ${label}${detail ? ` — ${detail}` : ""}`) }
}

const ROUTE = "app/api/applications/[id]/history/route.ts"
const VIEW = "app/dashboard/tracker/JobHistory.tsx"

const routeSrc = readFileSync(ROUTE, "utf8")
const viewSrc = readFileSync(VIEW, "utf8")

/** The route declares `kind:` as a union of string literals across lines. */
function routeKinds(src: string): string[] {
  const m = src.match(/kind:\s*((?:\s*\|?\s*"[a-z_]+"\s*)+)/)
  if (!m) return []
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1])
}

/** The component declares JOB_EVENT_KINDS as a const array. */
function viewKinds(src: string): string[] {
  const m = src.match(/JOB_EVENT_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/)
  if (!m) return []
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1])
}

const a = routeKinds(routeSrc)
const b = viewKinds(viewSrc)

console.log(`route: ${a.join(", ")}`)
console.log(`view:  ${b.join(", ")}`)
console.log("")

ok("route declares at least one kind (the regex still matches the source)", a.length > 0)
ok("view declares at least one kind (the regex still matches the source)", b.length > 0)

const missingFromView = a.filter((k) => !b.includes(k))
const missingFromRoute = b.filter((k) => !a.includes(k))

ok(
  "every kind the route emits is known to the view",
  missingFromView.length === 0,
  missingFromView.length ? `view is missing: ${missingFromView.join(", ")} (these would render as grey "idle" dots)` : "",
)
ok(
  "the view knows no kinds the route cannot emit",
  missingFromRoute.length === 0,
  missingFromRoute.length ? `route never emits: ${missingFromRoute.join(", ")}` : "",
)

// The specific one this change added. Named explicitly so that deleting it
// fails loudly here rather than silently degrading to a grey dot.
ok("coach_rec_response is emitted by the route", a.includes("coach_rec_response"))
ok("coach_rec_response is known to the view", b.includes("coach_rec_response"))

// meaningOf() must actually branch on it. Membership in the union is not
// enough — the union is types, meaningOf is runtime, and it is the runtime
// fall-through that produces the grey dot.
ok(
  "meaningOf() branches on coach_rec_response",
  /e\.kind === "coach_rec_response"/.test(viewSrc),
  "without this branch the event type-checks and still renders as idle",
)

// Both response values must map to a meaning, or a decline looks identical to
// an acceptance.
ok(
  "the decline value is distinguished inside that branch",
  /coach_rec_response[\s\S]{0,240}not_for_me/.test(viewSrc),
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
