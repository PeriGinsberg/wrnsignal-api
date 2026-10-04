// Run: npx tsx tests/identity/no-private-caller-lookups.test.ts
//
// ONE CALLER LOOKUP, asserted against the SOURCE.
//
// Finding "who is calling" by email is where a login whose email sits on
// someone else's profile got that profile. The shared lookup in
// lib/collab/identity.ts refuses that case; a private copy in a route file
// silently does not, and there were 64 of them. This test fails if any file
// under app/api looks up client_profiles by the CALLER's email outside the
// shared lookup.
//
// PENDING is the conversion worklist: files still carrying a private copy.
// It may only shrink. A file listed here that no longer has a private lookup
// fails the test too, so a converted file cannot stay excused by accident.
// When PENDING is empty, delete it.
//
// Lookups by OTHER emails (a client's email the coach typed, an invite email)
// are not caller identity and are not matched: only the variables a route
// reads the caller's own email into (`email`, `callerEmail`).

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

let failures = 0
function ok(label: string, cond: boolean, detail?: string) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`) }
  else console.log(`  ok    ${label}`)
}

const ROOT = process.cwd()
const SHARED = "lib/collab/identity.ts"

// Files still to convert. Grouped as in the plan; each group's commit deletes
// its block.
const PENDING = new Set<string>([
  // Group B: client dashboard and money
  "app/api/applications/[id]/history/route.ts",
  "app/api/feedback/route.ts",
  "app/api/interviews/[id]/prep/generate/route.ts",
  "app/api/interviews/[id]/prep/route.ts",
  "app/api/interviews/[id]/route.ts",
  "app/api/interviews/route.ts",
  "app/api/me/activities/[activity_id]/route.ts",
  "app/api/me/activities/route.ts",
  "app/api/me/activity-notes/[id]/done/route.ts",
  "app/api/me/documents/route.ts",
  "app/api/stripe/refund/route.ts",
  // Group C: Framer and mobile
  "app/api/applications/[id]/route.ts",
  "app/api/applications/route.ts",
  "app/api/personas/[id]/route.ts",
  "app/api/personas/route.ts",
  "app/api/profile-intake/route.ts",
  "app/api/runs/[id]/route.ts",
  "app/api/runs/route.ts",
  // Group D: account entry points
  "app/api/profile/route.ts",
  // JobFit's lookup. Already refuses a live owner; converted so it also gets
  // the deleted-login reconnect the shared lookup has.
  "app/api/_lib/authProfile.ts",
])

// Lookups by an email that is NOT a signed-in caller's: there is no login to
// take a profile from, so the shared lookup does not apply. Each says why.
const NOT_CALLER_IDENTITY: Record<string, string> = {
  "app/api/coach/create-client/route.ts": "\"does an account with this email already exist\" for the NEW client the coach typed in; the coach is found through the shared lookup",
  "app/api/auth/account-ready/route.ts": "checkout success page polls whether the Stripe webhook made the profile; email from the checkout",
  "app/api/auth/check-email-exists/route.ts": "sign-in form asks whether an email has an account; email from the form, before sign-in",
  "app/api/auth/send-link/route.ts": "sends a magic link to the email typed into the form, before sign-in",
  "app/api/full-access-lookup/route.ts": "access lookup by the email in the request body, not a signed-in caller",
  "app/api/iap/revenuecat-webhook/route.ts": "RevenueCat webhook; the email is the purchaser's app_user_id, no caller",
  "app/api/webhooks/stripe/route.ts": "Stripe webhook; the email is the checkout's, no caller",
}

// A client_profiles query that filters on the caller's own email, within one
// statement. 400 chars covers every multi-line chain in the codebase.
const CALLER_LOOKUP = /from\(\s*["']client_profiles["']\s*\)[\s\S]{0,400}?\.(?:eq|ilike)\(\s*["']email["']\s*,\s*(?:email|callerEmail)\s*\)/

// Re-pointing a profile's owner. Only the shared lookup may do it.
const REPOINT = /\.update\(\s*\{\s*user_id\s*:/

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(relative(ROOT, full).replace(/\\/g, "/"))
  }
  return out
}

const files = walk(join(ROOT, "app", "api"))
const withLookup = new Set(files.filter((f) => CALLER_LOOKUP.test(readFileSync(join(ROOT, f), "utf8"))))
const withRepoint = new Set(files.filter((f) => REPOINT.test(readFileSync(join(ROOT, f), "utf8"))))

console.log("no route looks the caller up by email outside the shared lookup")
const stray = [...withLookup].filter((f) => !PENDING.has(f) && !(f in NOT_CALLER_IDENTITY)).sort()
ok(`no private caller lookup outside the worklist (${withLookup.size} remaining, all on it)`, stray.length === 0, stray.join("\n        "))

const strayRepoint = [...withRepoint].filter((f) => !PENDING.has(f) && !(f in NOT_CALLER_IDENTITY)).sort()
ok("no route re-points a profile's owner outside the worklist", strayRepoint.length === 0, strayRepoint.join("\n        "))

console.log("\nthe worklist only shrinks")
const stale = [...PENDING].filter((f) => !withLookup.has(f) && !withRepoint.has(f)).sort()
ok(`every file on the worklist still needs converting (${PENDING.size} listed)`, stale.length === 0,
  `converted, remove from PENDING:\n        ${stale.join("\n        ")}`)

console.log("\nthe shared lookup is the one place")
const shared = readFileSync(join(ROOT, SHARED), "utf8")
ok(`${SHARED} still has the email fall-through`, /\.eq\(\s*["']email["']\s*,\s*email\s*\)/.test(shared))
ok(`${SHARED} refuses a live owner with ForbiddenError`, /throw new ForbiddenError\(/.test(shared))
for (const helper of ["app/api/_lib/coachAuth.ts", "app/api/_lib/meAuth.ts"]) {
  const src = readFileSync(join(ROOT, helper), "utf8")
  ok(`${helper} has no private lookup of its own`, !CALLER_LOOKUP.test(src) && !REPOINT.test(src))
  ok(`${helper} uses the shared lookup`, src.includes("@/lib/collab/identity"))
}

if (failures) { console.error(`\n${failures} assertion(s) failed`); process.exit(1) }
console.log("\nall private-lookup assertions passed")
