// tests/identity/route-matrix.ts
//
// EVERY CONVERTED ROUTE, called as every kind of caller, with REAL logins
// against dev. The companion to no-private-caller-lookups.test.ts: that one
// proves no route carries its own email lookup; this one proves each route,
// on the shared lookup, still signs the right people in and refuses the
// conflict.
//
// For every row:
//   owner          the rightful caller (fixture coach on coach routes, alex on
//                  client routes): the route's normal answer.
//                    list route  -> 200
//                    id route    -> handled: not 401, not 403, not 5xx (ids
//                                   that do not exist answer 404/400, which
//                                   still proves sign-in passed)
//   intruder       a login whose email sits on a CLIENT profile another live
//                  login owns: exactly 403, and that profile untouched.
//   coach intruder (coach routes) a login whose email sits on a COACH profile
//                  another live login owns, which has full access to alex:
//                  exactly 403, profile untouched. Before this work some coach
//                  checks accepted the email match outright.
//   new login      no profile at all: never a 2xx, and no profile created or
//                  taken.
//
// Write routes are called with an empty body against ids that do not exist,
// so the identity check runs first and nothing is ever written.
//
// The claim and reconnect cases live in the shared lookup, so they run once
// through a client route and once through a coach route (section 2), not per
// row: an unowned profile is claimed; a profile whose owning login was DELETED
// is reconnected to the new login with that email (decision 1b).
//
// Creds from process.env only (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// NEXT_PUBLIC_SUPABASE_ANON_KEY). Dev only. Uses the dev fixture coach and
// alex+test (password dev-test-1234). Everything it creates is deleted in
// `finally`.
//
//   npx tsx tests/identity/route-matrix.ts            all rows
//   npx tsx tests/identity/route-matrix.ts A B        only those groups (0 = step 0)

import { createClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
if (!url.includes(DEV_REF)) throw new Error(`Refusing to run: SUPABASE_URL is not dev (${DEV_REF})`)
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
if (!SERVICE || !ANON) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY")
const BASE = process.env.BASE || "http://localhost:3100"
const FIXTURE_PASSWORD = process.env.FIXTURE_PASSWORD || "dev-test-1234"
const COACH_EMAIL = process.env.COACH_EMAIL || "peri@localtest.com"
const CLIENT_EMAIL = "alex+test@example.com"
const NONE = "00000000-0000-4000-8000-000000000000"

const db = createClient(url, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const stamp = Date.now()
const PASSWORD = `rm-${stamp}-Aa1!`
const mail = (tag: string) => `matrix-${tag}-${stamp}@example.test`

type Ctx = { alexId: string; coachLinkId: string }
type Row = {
  group: string
  role: "coach" | "client"
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  path: (c: Ctx) => string
  /** "list": owner must get 200. "id": owner must be handled (not 401/403/5xx). */
  kind: "list" | "id"
  /** A refusal AFTER the identity check that is fine for the owner (e.g. a beta gate). */
  ownerAlsoOk?: (status: number, body: string) => boolean
  /** Skip the owner call: it would have a real side effect (e.g. send an email). */
  skipOwner?: string
}

const coach = (method: Row["method"], path: (c: Ctx) => string, kind: Row["kind"], group = "0", extra: Partial<Row> = {}): Row =>
  ({ group, role: "coach", method, path, kind, ...extra })
const client = (method: Row["method"], path: (c: Ctx) => string, kind: Row["kind"], group = "0", extra: Partial<Row> = {}): Row =>
  ({ group, role: "client", method, path, kind, ...extra })
/** The shared lookup's refusal, as the routes report it. */
const CONFLICT = /profile email conflict|"error":"forbidden"/
const betaGated = { ownerAlsoOk: (s: number, b: string) => s === 403 && /calendar_beta_gated|not_in_beta/.test(b) }

// ── the table ───────────────────────────────────────────────────────────────
const ROWS: Row[] = [
  // Step 0: every route behind coachAuth.resolveCoach, and the meAuth route.
  coach("GET", (c) => `/api/coach/briefs?client_profile_id=${c.alexId}`, "list"),
  coach("GET", () => `/api/coach/briefs/${NONE}`, "id"),
  coach("PATCH", () => `/api/coach/briefs/${NONE}`, "id"),
  coach("GET", (c) => `/api/coach/coach-clients/${c.coachLinkId}/documents`, "list"),
  coach("PATCH", (c) => `/api/coach/coach-clients/${c.coachLinkId}/documents/${NONE}`, "id"),
  coach("GET", (c) => `/api/coach/coach-clients/${c.coachLinkId}/drive-folder`, "list"),
  coach("GET", (c) => `/api/coach/coach-clients/${c.coachLinkId}/engagements`, "list"),
  coach("GET", (c) => `/api/coach/coach-clients/${c.coachLinkId}/engagements/${NONE}`, "id"),
  coach("PATCH", (c) => `/api/coach/coach-clients/${c.coachLinkId}/engagements/${NONE}/activities`, "id"),
  coach("PATCH", (c) => `/api/coach/coach-clients/${c.coachLinkId}/engagements/${NONE}/activities/${NONE}`, "id"),
  coach("GET", (c) => `/api/coach/coach-clients/${c.coachLinkId}/engagements/${NONE}/activities/${NONE}/notes`, "id"),
  coach("PUT", (c) => `/api/coach/coach-clients/${c.coachLinkId}/engagements/${NONE}/activities/${NONE}/notes/${NONE}`, "id"),
  coach("PATCH", (c) => `/api/coach/coach-clients/${c.coachLinkId}/engagements/${NONE}/deliverables/${NONE}`, "id"),
  coach("GET", (c) => `/api/coach/coach-clients/${c.coachLinkId}/events`, "list"),
  coach("GET", (c) => `/api/coach/coach-clients/${c.coachLinkId}/ghl-contact`, "list"),
  coach("GET", () => "/api/coach/document-categories", "list"),
  coach("PATCH", () => `/api/coach/document-categories/${NONE}`, "id"),
  coach("POST", () => `/api/coach/milestones/${NONE}/activities`, "id"),
  coach("PATCH", () => `/api/coach/milestones/${NONE}/activities/${NONE}`, "id"),
  coach("GET", () => "/api/coach/packages", "list"),
  coach("GET", () => `/api/coach/packages/${NONE}`, "id"),
  coach("POST", () => `/api/coach/packages/${NONE}/deliverables`, "id"),
  coach("DELETE", () => `/api/coach/packages/${NONE}/deliverables/${NONE}`, "id"),
  coach("GET", () => `/api/coach/prospects/${NONE}/consult`, "id"),
  coach("POST", () => `/api/coach/prospects/${NONE}/consult/booked`, "id"),
  coach("POST", () => `/api/coach/prospects/${NONE}/consult/outcome`, "id"),
  coach("GET", () => "/api/coach/tasks", "list"),
  coach("GET", () => "/api/coach/tasks/assignees", "list"),
  coach("PATCH", () => `/api/coach/tasks/${NONE}`, "id"),
  client("GET", () => "/api/me/proof-project", "list"),

  // Group A: coach routes (and the three /coach routes a CLIENT calls)
  client("POST", () => "/api/coach/accept-invite", "id", "A"),
  coach("POST", () => "/api/coach/annotate", "id", "A"),
  coach("GET", () => "/api/coach/applications-recent", "list", "A"),
  coach("GET", () => "/api/coach/calendar/connect", "id", "A", betaGated),
  coach("DELETE", () => "/api/coach/calendar/disconnect", "id", "A", betaGated),
  coach("GET", () => "/api/coach/calendar/today", "id", "A", betaGated),
  coach("PATCH", (c) => `/api/coach/clients/${c.alexId}/applications/${NONE}/status`, "id", "A"),
  coach("GET", (c) => `/api/coach/clients/${c.alexId}/coaches`, "list", "A"),
  coach("GET", (c) => `/api/coach/clients/${c.alexId}/metrics`, "list", "A"),
  coach("GET", (c) => `/api/coach/clients/${c.alexId}/needs-attention`, "list", "A"),
  coach("PUT", (c) => `/api/coach/clients/${c.alexId}/note-feed/${NONE}`, "id", "A"),
  coach("GET", (c) => `/api/coach/clients/${c.alexId}/note-feed`, "list", "A"),
  coach("PATCH", (c) => `/api/coach/clients/${c.alexId}/notes`, "id", "A"),
  coach("PATCH", (c) => `/api/coach/clients/${c.alexId}/personas/${NONE}`, "id", "A"),
  coach("GET", (c) => `/api/coach/clients/${c.alexId}/personas`, "list", "A"),
  coach("GET", (c) => `/api/coach/clients/${c.alexId}/profile`, "list", "A"),
  coach("PATCH", (c) => `/api/coach/clients/${c.alexId}`, "id", "A"),
  coach("POST", (c) => `/api/coach/clients/${c.alexId}/send-invite`, "id", "A", { skipOwner: "would email the fixture client an invite" }),
  coach("GET", (c) => `/api/coach/clients/${c.alexId}/since-last-visit`, "list", "A"),
  coach("GET", (c) => `/api/coach/clients/${c.alexId}/tracker`, "list", "A"),
  coach("GET", () => "/api/coach/clients", "list", "A"),
  coach("POST", () => `/api/coach/coach-clients/${NONE}/send-invite`, "id", "A"),
  coach("POST", () => `/api/coach/coach-clients/${NONE}/setup-account`, "id", "A"),
  coach("POST", () => "/api/coach/create-client", "id", "A"),
  coach("POST", () => "/api/coach/engagement-signals/dismiss", "id", "A"),
  coach("POST", () => "/api/coach/engagement-signals/restore", "id", "A"),
  coach("GET", () => "/api/coach/home", "list", "A"),
  coach("POST", () => "/api/coach/invite", "id", "A"),
  coach("GET", () => `/api/coach/milestones/${NONE}`, "id", "A"),
  coach("GET", () => "/api/coach/milestones", "list", "A"),
  client("PATCH", () => `/api/coach/my-recommendations/${NONE}/respond`, "id", "A"),
  client("GET", () => "/api/coach/my-recommendations", "list", "A"),
  coach("POST", () => "/api/coach/notifications/mark-seen", "id", "A"),
  coach("GET", () => "/api/coach/notifications", "list", "A"),
  coach("GET", () => "/api/coach/pipeline", "list", "A"),
  coach("PUT", () => `/api/coach/prospects/${NONE}/notes/${NONE}`, "id", "A"),
  coach("GET", () => `/api/coach/prospects/${NONE}/notes`, "id", "A"),
  coach("GET", () => `/api/coach/prospects/${NONE}`, "id", "A"),
  coach("PATCH", () => `/api/coach/prospects/${NONE}/stage`, "id", "A"),
  coach("PATCH", () => `/api/coach/prospects/${NONE}/status`, "id", "A"),
  coach("GET", () => "/api/coach/prospects", "list", "A"),
  coach("POST", () => "/api/coach/recommend-job", "id", "A"),
  coach("PATCH", () => `/api/coach/recommendations/${NONE}`, "id", "A"),

  // Group B: client dashboard and money
  client("GET", () => `/api/applications/${NONE}/history`, "id", "B"),
  coach("POST", () => "/api/feedback", "id", "B"),
  client("POST", () => `/api/interviews/${NONE}/prep/generate`, "id", "B"),
  client("GET", () => `/api/interviews/${NONE}/prep`, "id", "B"),
  client("PUT", () => `/api/interviews/${NONE}`, "id", "B"),
  client("GET", () => "/api/interviews", "list", "B"),
  client("PATCH", () => `/api/me/activities/${NONE}`, "id", "B"),
  client("GET", () => "/api/me/activities", "list", "B"),
  client("PATCH", () => `/api/me/activity-notes/${NONE}/done`, "id", "B"),
  client("GET", () => "/api/me/documents", "list", "B"),
  // The fixture client has no purchase, so the owner gets "no active
  // purchase" (409) before any Stripe call; nobody is refunded.
  client("POST", () => "/api/stripe/refund", "id", "B"),
]

// ── harness ─────────────────────────────────────────────────────────────────
let failed = 0
let passed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; return }
  failed++
  console.log(`  FAIL  ${label}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`)
}

const made = { users: [] as string[], profiles: [] as string[], links: [] as string[] }

async function newLogin(email: string): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error) throw error
  made.users.push(data.user.id)
  return data.user.id
}
async function jwtFor(email: string, password = PASSWORD): Promise<string> {
  const anon = createClient(url, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`)
  return data.session.access_token
}
async function callFull(method: string, path: string, jwt: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
    body: method === "GET" ? undefined : "{}",
  })
  return { status: res.status, body: await res.text().catch(() => "") }
}
async function call(method: string, path: string, jwt: string): Promise<number> {
  return (await callFull(method, path, jwt)).status
}
async function profile(fields: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.from("client_profiles")
    .insert({ profile_text: "route-matrix test profile", updated_at: new Date().toISOString(), ...fields })
    .select("id").single()
  if (error) throw error
  made.profiles.push(data.id)
  return data.id
}
async function ownerOf(id: string) {
  return (await db.from("client_profiles").select("user_id").eq("id", id).single()).data?.user_id ?? null
}

/**
 * Is the victim profile still its owner's? If a route took it, put it back, so
 * one leaking route cannot make every later row look like it leaks too (or
 * hide whether it does): each row is judged on its own.
 */
async function untouched(victim: string, rightful: string): Promise<boolean> {
  const now = await ownerOf(victim)
  if (now === rightful) return true
  await db.from("client_profiles").update({ user_id: rightful }).eq("id", victim)
  return false
}

async function main() {
  const only = process.argv.slice(2)
  const rows = only.length ? ROWS.filter((r) => only.includes(r.group)) : ROWS

  try {
    // ── setup ────────────────────────────────────────────────────────────────
    const coachJwt = await jwtFor(COACH_EMAIL, FIXTURE_PASSWORD)
    const alexJwt = await jwtFor(CLIENT_EMAIL, FIXTURE_PASSWORD)
    const { data: coachRow } = await db.from("client_profiles").select("id").eq("email", COACH_EMAIL).single()
    const { data: alexRow } = await db.from("client_profiles").select("id").eq("email", CLIENT_EMAIL).single()
    const { data: link } = await db.from("coach_clients").select("id")
      .eq("coach_profile_id", coachRow!.id).eq("client_profile_id", alexRow!.id).eq("status", "active").single()
    const ctx: Ctx = { alexId: alexRow!.id, coachLinkId: link!.id }

    // A client profile owned by a live login, carrying the intruder's email.
    const clientOwner = await newLogin(mail("client-owner"))
    const intruderEmail = mail("intruder")
    const clientVictim = await profile({ user_id: clientOwner, email: intruderEmail })
    await newLogin(intruderEmail)
    const intruderJwt = await jwtFor(intruderEmail)

    // A COACH profile owned by a live login, with full access to alex,
    // carrying the coach intruder's email.
    const coachOwner = await newLogin(mail("coach-owner"))
    const coachIntruderEmail = mail("coach-intruder")
    const coachVictim = await profile({ user_id: coachOwner, email: coachIntruderEmail, is_coach: true, name: "Matrix Victim Coach" })
    const { data: vLink, error: vErr } = await db.from("coach_clients")
      .insert({ coach_profile_id: coachVictim, client_profile_id: ctx.alexId, status: "active", access_level: "full" })
      .select("id").single()
    if (vErr) throw vErr
    made.links.push(vLink.id)
    await newLogin(coachIntruderEmail)
    const coachIntruderJwt = await jwtFor(coachIntruderEmail)

    // No profile at all.
    const freshEmail = mail("fresh")
    const freshLogin = await newLogin(freshEmail)
    const freshJwt = await jwtFor(freshEmail)

    // ── 1. every row ─────────────────────────────────────────────────────────
    console.log(`1. ${rows.length} route calls x (owner, intruder${rows.some((r) => r.role === "coach") ? ", coach intruder" : ""}, new login)`)
    for (const r of rows) {
      const path = r.path(ctx)
      const label = `[${r.group}] ${r.method} ${path.replace(ctx.coachLinkId, ":link").replace(ctx.alexId, ":alex")}`

      if (r.skipOwner) {
        console.log(`  note  ${label} owner call skipped: ${r.skipOwner}`)
      } else {
        const o = await callFull(r.method, path, r.role === "coach" ? coachJwt : alexJwt)
        // "list": 200. "id": handled, meaning sign-in passed: not 401, not 5xx,
        // and a 403 only for a reason other than the email conflict (an access
        // check on an id that does not exist, a beta gate).
        const handled = r.kind === "list"
          ? o.status === 200
          : o.status !== 401 && o.status < 500 && !(o.status === 403 && CONFLICT.test(o.body))
        check(`${label} owner`, handled || !!r.ownerAlsoOk?.(o.status, o.body), { status: o.status, body: o.body.slice(0, 120) })
      }

      const i = await callFull(r.method, path, intruderJwt)
      check(`${label} intruder -> 403 for the email conflict`, i.status === 403 && CONFLICT.test(i.body), { status: i.status, body: i.body.slice(0, 120) })
      check(`${label} intruder left the client profile alone`, await untouched(clientVictim, clientOwner))

      if (r.role === "coach") {
        const ci = await callFull(r.method, path, coachIntruderJwt)
        check(`${label} coach intruder -> 403 for the email conflict`, ci.status === 403 && CONFLICT.test(ci.body), { status: ci.status, body: ci.body.slice(0, 120) })
        check(`${label} coach intruder left the coach profile alone`, await untouched(coachVictim, coachOwner))
      }

      // Never a success, and a client error, not a server error: a login with
      // no profile is "Profile not found" (404) or refused, never a 500.
      const fresh = await call(r.method, path, freshJwt)
      check(`${label} new login -> 4xx`, fresh >= 400 && fresh < 500, fresh)
    }
    const { count: freshProfiles } = await db.from("client_profiles").select("id", { count: "exact", head: true }).eq("user_id", freshLogin)
    check("the new login was never given or made a profile", freshProfiles === 0, freshProfiles)

    // ── 2. claim and reconnect, through the shared lookup ───────────────────
    console.log("2. claim an unowned profile, reconnect after a deleted login (client and coach route)")
    const paths = [
      { label: "client route", method: "GET", path: "/api/me/proof-project", coach: false },
      { label: "coach route", method: "GET", path: "/api/coach/tasks", coach: true },
    ]
    for (const p of paths) {
      const uEmail = mail(`unowned-${p.coach ? "coach" : "client"}`)
      const unowned = await profile({ user_id: null, email: uEmail, ...(p.coach ? { is_coach: true, name: "Matrix Unowned Coach" } : {}) })
      const uLogin = await newLogin(uEmail)
      const s1 = await call(p.method, p.path, await jwtFor(uEmail))
      check(`${p.label}: unowned profile claimed by the first login with its email`, (await ownerOf(unowned)) === uLogin, s1)
      check(`${p.label}: ...and the request is not refused`, s1 !== 403 && s1 < 500, s1)

      // Owned by a login that is then deleted: client_profiles.user_id keeps
      // the dead id (no foreign key), which is the state decision 1b covers.
      const rEmail = mail(`reconnect-${p.coach ? "coach" : "client"}`)
      const deadLogin = await newLogin(rEmail)
      const orphan = await profile({ user_id: deadLogin, email: rEmail, ...(p.coach ? { is_coach: true, name: "Matrix Orphan Coach" } : {}) })
      await db.auth.admin.deleteUser(deadLogin)
      made.users = made.users.filter((u) => u !== deadLogin)
      const newOne = await newLogin(rEmail)
      const s2 = await call(p.method, p.path, await jwtFor(rEmail))
      check(`${p.label}: deleted-login profile reconnected to the new login`, (await ownerOf(orphan)) === newOne, { status: s2, owner: await ownerOf(orphan) })
      check(`${p.label}: ...and the request is not refused`, s2 !== 403 && s2 < 500, s2)
    }
  } finally {
    for (const id of made.links) await db.from("coach_clients").delete().eq("id", id)
    for (const id of made.profiles) {
      await db.from("coach_clients").delete().eq("coach_profile_id", id)
      await db.from("coach_clients").delete().eq("client_profile_id", id)
      await db.from("client_profiles").delete().eq("id", id)
    }
    for (const id of made.users) await db.auth.admin.deleteUser(id).catch(() => {})
    console.log(`cleanup: ${made.links.length} links, ${made.profiles.length} profiles, ${made.users.length} logins deleted`)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
