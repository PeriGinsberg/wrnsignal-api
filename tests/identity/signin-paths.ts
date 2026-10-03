// tests/identity/signin-paths.ts
//
// Every normal way into SIGNAL, with REAL logins against dev, through routes
// that resolve the caller with lib/collab/identity.ts (resolveCaller /
// lib/collab/scope.ts), after getProfileId stopped re-pointing a profile that
// another login owns.
//
//   A. a brand-new user signing up
//   B. a coach-invited client signing in for the first time
//      (B1 the real create-client route; B2 a profile made with no login yet)
//   C. an existing client signing in
//   D. an existing coach signing in
//   E. the conflict: a login whose email is on a profile ANOTHER login owns,
//      refused on a network route and on a non-network route
//
// Routes used, all on the shared lookup:
//   GET /api/network/companies                                   (network)
//   GET /api/me/workbooks                                        (client, non-network)
//   GET /api/coach/clients/:c/applications/:a/detail             (coach, non-network)
// plus GET /api/profile, which is how a brand-new user's profile is created.
//
// Section F prints, without asserting, what two routes that still carry
// PRIVATE copies of the lookup do with the conflict, so the report can show it.
//
// Creds from process.env only (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// NEXT_PUBLIC_SUPABASE_ANON_KEY). Dev only. Uses the dev fixture coach and
// alex+test (password dev-test-1234). Everything it creates is deleted in
// `finally`.
//
//   npx tsx tests/identity/signin-paths.ts

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

const db = createClient(url, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const stamp = Date.now()
const PASSWORD = `sp-${stamp}-Aa1!`
const mail = (tag: string) => `signin-${tag}-${stamp}@example.test`

let failed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok || detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`)
  if (!ok) failed++
}

const made = { users: [] as string[], profiles: [] as string[] }

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
async function get(path: string, jwt: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${jwt}` } })
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any }
}
async function ownerOf(profileId: string) {
  return (await db.from("client_profiles").select("user_id").eq("id", profileId).single()).data?.user_id ?? null
}

async function main() {
  try {
    // ── A ─────────────────────────────────────────────────────────────────
    console.log("A. a brand-new user signing up")
    {
      const email = mail("new")
      const login = await newLogin(email)          // what Supabase sign-up creates
      const jwt = await jwtFor(email)
      const before = await get("/api/me/workbooks", jwt)
      check("before any profile exists: 404 'Profile not found' (unchanged)", before.status === 404, before)
      const prof = await get("/api/profile", jwt)
      const { data: p } = await db.from("client_profiles").select("id, user_id").eq("user_id", login).maybeSingle()
      if (p) made.profiles.push(p.id)
      check("GET /api/profile creates their profile, owned by their login", prof.status === 200 && p?.user_id === login, { status: prof.status })
      check("then a client route works: /api/me/workbooks 200", (await get("/api/me/workbooks", jwt)).status === 200)
      check("and a network route works: /api/network/companies 200", (await get("/api/network/companies", jwt)).status === 200)
    }

    // ── B ─────────────────────────────────────────────────────────────────
    console.log("\nB1. a coach-invited client signing in for the first time (real create-client)")
    {
      const coachJwt = await jwtFor(COACH_EMAIL, FIXTURE_PASSWORD)
      const email = mail("invited")
      const res = await fetch(`${BASE}/api/coach/create-client`, {
        method: "POST",
        headers: { Authorization: `Bearer ${coachJwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: "Signin", lastName: "Invited", email, jobType: "Full-time", targetRoles: "Analyst", targetLocations: "Remote", timeframe: "3 months" }),
      })
      const { data: p } = await db.from("client_profiles").select("id, user_id").eq("email", email).maybeSingle()
      if (p) made.profiles.push(p.id)
      if (p?.user_id) made.users.push(p.user_id)
      check("coach creates the client: 200, profile owned by the new login", res.ok && !!p?.user_id, { status: res.status })
      // The magic link signs them in as THAT login; a password stands in for it.
      await db.auth.admin.updateUserById(p!.user_id!, { password: PASSWORD })
      const jwt = await jwtFor(email)
      check("first sign-in, client route: /api/me/workbooks 200", (await get("/api/me/workbooks", jwt)).status === 200)
      check("first sign-in, network route: /api/network/companies 200", (await get("/api/network/companies", jwt)).status === 200)
      check("...and the profile still belongs to that login", (await ownerOf(p!.id)) === p!.user_id)
    }

    console.log("\nB2. a profile made with no login yet, claimed at first sign-in")
    {
      const email = mail("unowned")
      const { data: p, error } = await db.from("client_profiles")
        .insert({ user_id: null, email, profile_text: "unowned test profile", updated_at: new Date().toISOString() })
        .select("id").single()
      if (error) throw error
      made.profiles.push(p.id)
      const login = await newLogin(email)
      const jwt = await jwtFor(email)
      check("first sign-in, network route: 200", (await get("/api/network/companies", jwt)).status === 200)
      check("...and the unowned profile is now theirs", (await ownerOf(p.id)) === login)
      check("then a client route: /api/me/workbooks 200", (await get("/api/me/workbooks", jwt)).status === 200)
    }

    // ── C, D ──────────────────────────────────────────────────────────────
    console.log("\nC. an existing client signing in")
    const { data: alex } = await db.from("client_profiles").select("id, user_id").eq("email", CLIENT_EMAIL).single()
    {
      const jwt = await jwtFor(CLIENT_EMAIL, FIXTURE_PASSWORD)
      check("client route: /api/me/workbooks 200", (await get("/api/me/workbooks", jwt)).status === 200)
      check("network route: /api/network/companies 200", (await get("/api/network/companies", jwt)).status === 200)
      const prof = await get("/api/profile", jwt)
      check("their own profile: /api/profile returns it", prof.status === 200 && prof.json.profile?.id === alex!.id, { status: prof.status })
    }

    console.log("\nD. an existing coach signing in")
    {
      const jwt = await jwtFor(COACH_EMAIL, FIXTURE_PASSWORD)
      const { data: app } = await db.from("signal_applications").select("id").eq("profile_id", alex!.id).limit(1).single()
      const det = await get(`/api/coach/clients/${alex!.id}/applications/${app!.id}/detail`, jwt)
      check("coach route: a client's job detail 200", det.status === 200, det.status)
      check("network route, acting for the client: 200", (await get(`/api/network/companies?client_profile_id=${alex!.id}`, jwt)).status === 200)
      check("own network board: 200", (await get("/api/network/companies", jwt)).status === 200)
    }

    // ── E ─────────────────────────────────────────────────────────────────
    console.log("\nE. the conflict: a login whose email is on a profile ANOTHER login owns")
    const ownerLogin = await newLogin(mail("owner"))
    const intruderEmail = mail("intruder")
    const intruder = await newLogin(intruderEmail)
    const { data: victim, error: vErr } = await db.from("client_profiles")
      .insert({ user_id: ownerLogin, email: intruderEmail, profile_text: "conflict test profile", updated_at: new Date().toISOString() })
      .select("id").single()
    if (vErr) throw vErr
    made.profiles.push(victim.id)
    const intruderJwt = await jwtFor(intruderEmail)
    {
      const net = await get("/api/network/companies", intruderJwt)
      check("network route /api/network/companies: 403", net.status === 403, net.status)
      check("...and the profile still belongs to its owner", (await ownerOf(victim.id)) === ownerLogin)
      const me = await get("/api/me/workbooks", intruderJwt)
      check("non-network route /api/me/workbooks: 403", me.status === 403, me.status)
      check("...and the profile still belongs to its owner", (await ownerOf(victim.id)) === ownerLogin)
      const pos = await fetch(`${BASE}/api/positioning`, {
        method: "POST", headers: { Authorization: `Bearer ${intruderJwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ job: "Analyst. Requirements: Excel." }),
      })
      check("Positioning: 403", pos.status === 403, pos.status)
    }

    // ── F ─────────────────────────────────────────────────────────────────
    console.log("\nF. INFO, not asserted: routes that still carry a PRIVATE copy of the lookup")
    for (const path of ["/api/me/documents", "/api/runs"]) {
      const r = await get(path, intruderJwt)
      const owner = await ownerOf(victim.id)
      console.log(`  ${path} as the intruder -> ${r.status}; profile owner is now ${owner === ownerLogin ? "STILL the owner" : owner === intruder ? "THE INTRUDER (re-pointed)" : owner}`)
      if (owner !== ownerLogin) await db.from("client_profiles").update({ user_id: ownerLogin }).eq("id", victim.id)
    }
  } finally {
    for (const id of made.profiles) {
      await db.from("coach_clients").delete().eq("client_profile_id", id)
      await db.from("client_profiles").delete().eq("id", id)
    }
    for (const id of made.users) await db.auth.admin.deleteUser(id).catch(() => {})
    console.log(`\ncleanup: ${made.profiles.length} test profiles and ${made.users.length} test logins deleted`)
  }
  if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
  console.log("\nall sign-in path checks passed")
}

main().catch((e) => { console.error(e); process.exit(1) })
