// tests/coach-parity/email-conflict.ts
//
// The email fall-through, end to end with REAL logins against dev.
//
// Builds the exposed state: a profile owned by login O whose stored email is
// another login's (B's) email, and B has no profile of its own. That is what a
// profile looks like after its owner's login email changed without the profile
// following. Then B calls the routes.
//
//   Positioning / Cover Letter  must refuse (403) and leave the profile alone.
//   A network route             is printed, not asserted: it shares
//                               getProfileId's default, which re-points the
//                               profile at B. That is the open hole reported
//                               alongside this test; when it is fixed at the
//                               source, that line will read REFUSED.
//
// Creds from process.env only (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// NEXT_PUBLIC_SUPABASE_ANON_KEY). Dev only. Everything it creates is deleted
// in `finally`.
//
//   npx tsx tests/coach-parity/email-conflict.ts

import { createClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
if (!url.includes(DEV_REF)) throw new Error(`Refusing to run: SUPABASE_URL is not dev (${DEV_REF})`)
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
if (!SERVICE || !ANON) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY")
const BASE = process.env.BASE || "http://localhost:3100"

const db = createClient(url, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const stamp = Date.now()
const OWNER_EMAIL = `email-conflict-owner-${stamp}@example.test`
const INTRUDER_EMAIL = `email-conflict-intruder-${stamp}@example.test`
const PASSWORD = `ec-${stamp}-Aa1!`

let failed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok || detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`)
  if (!ok) failed++
}

async function main() {
  const created: { users: string[]; profile?: string } = { users: [] }
  try {
    const { data: o, error: oErr } = await db.auth.admin.createUser({ email: OWNER_EMAIL, password: PASSWORD, email_confirm: true })
    if (oErr) throw oErr
    created.users.push(o.user.id)
    const { data: b, error: bErr } = await db.auth.admin.createUser({ email: INTRUDER_EMAIL, password: PASSWORD, email_confirm: true })
    if (bErr) throw bErr
    created.users.push(b.user.id)

    // Owned by O, carrying B's email: the exposed state.
    const { data: p, error: pErr } = await db.from("client_profiles")
      .insert({ user_id: o.user.id, email: INTRUDER_EMAIL, profile_text: "Email conflict test profile", updated_at: new Date().toISOString() })
      .select("id").single()
    if (pErr) throw pErr
    created.profile = p.id

    const anon = createClient(url, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email: INTRUDER_EMAIL, password: PASSWORD })
    if (sErr) throw sErr
    const jwt = s.session!.access_token
    const owner = async () => (await db.from("client_profiles").select("user_id").eq("id", p.id).single()).data?.user_id

    console.log("B signs in; B's email matches a profile O owns")
    for (const route of ["/api/positioning", "/api/coverletter"]) {
      const res = await fetch(`${BASE}${route}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ job: "Analyst role. Requirements: Excel, SQL, communication." }),
      })
      check(`${route}: refused with 403`, res.status === 403, res.status)
      check(`${route}: the profile still belongs to O`, (await owner()) === o.user.id)
    }

    const net = await fetch(`${BASE}/api/network/companies`, { headers: { Authorization: `Bearer ${jwt}` } })
    const after = await owner()
    console.log(`\nINFO (not asserted): GET /api/network/companies as B -> ${net.status}; ` +
      (after === b.user.id
        ? "the profile was RE-POINTED at B (network routes share the open hole)"
        : "REFUSED, the profile still belongs to O"))
  } finally {
    if (created.profile) await db.from("client_profiles").delete().eq("id", created.profile)
    for (const id of created.users) await db.auth.admin.deleteUser(id)
    console.log("\ncleanup: test profile and both test logins deleted")
  }
  if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
  console.log("\nall email-conflict checks passed")
}

main().catch((e) => { console.error(e); process.exit(1) })
