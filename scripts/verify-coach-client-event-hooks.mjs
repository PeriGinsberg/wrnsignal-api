// scripts/verify-coach-client-event-hooks.mjs
//
// Integration smoke for the 9 client-event-log hooks: trigger each event through
// the REAL API and assert the right event row appears (type / actor / context),
// that every action STILL SUCCEEDS (best-effort logging never breaks it), and
// that a convert logs converted_to_client with NO stray stage_changed for the
// terminal stage (the double-log guard).
//
// SCOPE: covers the 8 email-free event types live —
//   prospect_created, stage_changed, converted_to_client, engagement_attached,
//   proposal_sent, proposal_approved, proposal_declined, engagement_detached.
// The two invite_sent hooks (POST /invite and .../send-invite) send REAL emails
// (Supabase OTP / Postmark) and create real auth accounts, so they're excluded
// from the automated smoke — covered by diff review + the helper's proven
// best-effort behavior (verify-coach-client-events.mjs). Run them manually if
// needed.
//
// Required env:
//   BASE_URL                   default https://wrnsignal-api-staging.vercel.app
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (dev project)
//   COACH_A_EMAIL / COACH_A_PASSWORD
//
// Run (plain node — this one does NOT import the TS helper):
//   NODE_OPTIONS=--use-system-ca BASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   SUPABASE_SERVICE_ROLE_KEY=... COACH_A_EMAIL=... COACH_A_PASSWORD=... \
//   node scripts/verify-coach-client-event-hooks.mjs

import { createClient } from "@supabase/supabase-js"

const BASE_URL = (process.env.BASE_URL || "https://wrnsignal-api-staging.vercel.app").replace(/\/$/, "")
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const A = { email: process.env.COACH_A_EMAIL, password: process.env.COACH_A_PASSWORD }

function need(label, v) { if (!v) { console.error(`MISSING env: ${label}`); process.exit(2) } return v }
need("SUPABASE_URL", SUPABASE_URL); need("SUPABASE_ANON_KEY", SUPABASE_ANON_KEY)
need("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
need("COACH_A_EMAIL", A.email); need("COACH_A_PASSWORD", A.password)

let failures = 0
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++ }
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

async function signIn(creds) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password })
  if (error || !data?.session?.access_token) { console.error(`Sign-in failed: ${error?.message || "no session"}`); process.exit(2) }
  return data.session.access_token
}
async function profileIdFor(email) {
  const { data } = await admin.from("client_profiles").select("id").eq("email", email.trim().toLowerCase()).maybeSingle()
  if (!data?.id) { console.error(`No client_profiles.id for ${email}`); process.exit(2) }
  return data.id
}
async function api(method, token, path, body) {
  const res = await fetch(`${BASE_URL}/api/coach${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}
async function eventsFor(token, cc) {
  const r = await api("GET", token, `/coach-clients/${cc}/events`)
  return r.json?.events || []
}

console.log(`Target: ${BASE_URL}`)
console.log(`Supabase: ${SUPABASE_URL.match(/https:\/\/([^.]+)/)?.[1] ?? SUPABASE_URL}\n`)

const tokenA = await signIn(A)
const profileA = await profileIdFor(A.email)
const stamp = Date.now()
const cleanup = { milestones: [], packages: [] }
let cc1 = null

// ── prospect_created ──
const created = await api("POST", tokenA, "/prospects", { name: `__verify_throwaway___hooks_${stamp}`, source_category: "referral" })
ok(created.status === 201 && created.json?.prospect?.id, `POST /prospects → 201 (got ${created.status})`)
cc1 = created.json?.prospect?.id
{
  const evs = await eventsFor(tokenA, cc1)
  const e = evs.find((x) => x.event_type === "prospect_created")
  ok(!!e, "prospect_created logged")
  ok(e?.actor_profile_id === profileA, "prospect_created actor = coach")
  ok(e?.context?.name?.includes("__verify_throwaway__") && e?.context?.source_category === "referral", "prospect_created context { name, source_category }")
}

// ── stage_changed (non-terminal) ──
const pipe = await api("GET", tokenA, "/pipeline")
const stages = pipe.json?.stages || []
const nonTerminal = stages.find((s) => !s.is_terminal && s.active)
const terminal = stages.find((s) => s.is_terminal)
ok(!!nonTerminal && !!terminal, `pipeline has a non-terminal + terminal stage (n=${stages.length})`)
const stageRes = await api("PATCH", tokenA, `/prospects/${cc1}/stage`, { stage_key: nonTerminal.stage_key })
ok(stageRes.status === 200, `PATCH stage (non-terminal) → 200 (got ${stageRes.status})`)
{
  const evs = await eventsFor(tokenA, cc1)
  const e = evs.find((x) => x.event_type === "stage_changed")
  ok(!!e && e.context?.stage_key === nonTerminal.stage_key, `stage_changed logged with context.stage_key=${nonTerminal.stage_key}`)
}

// ── converted_to_client (terminal) + DOUBLE-LOG GUARD ──
const convertRes = await api("PATCH", tokenA, `/prospects/${cc1}/stage`, { stage_key: terminal.stage_key })
ok(convertRes.status === 200 && convertRes.json?.converted === true, `PATCH stage (terminal) → converted (got ${convertRes.status})`)
{
  const evs = await eventsFor(tokenA, cc1)
  ok(evs.filter((x) => x.event_type === "converted_to_client").length === 1, "converted_to_client logged exactly once")
  ok(!evs.some((x) => x.event_type === "stage_changed" && x.context?.stage_key === terminal.stage_key),
     "DOUBLE-LOG GUARD: no stage_changed for the terminal stage")
}

// ── engagement_attached (needs a package) ──
const mk = await api("POST", tokenA, "/milestones", { name: `__verify_throwaway___hooks_M_${stamp}`, fee: 100 })
const M = mk.json?.milestone?.id; if (M) cleanup.milestones.push(M)
const pk = await api("POST", tokenA, "/packages", { name: `__verify_throwaway___hooks_P_${stamp}`, deliverable_ids: [M] })
const P = pk.json?.package?.id; if (P) cleanup.packages.push(P)
ok(!!M && !!P, "setup: milestone + package created")
const attach = await api("POST", tokenA, `/coach-clients/${cc1}/engagements`, { package_id: P })
ok(attach.status === 201 && attach.json?.engagement?.id, `POST engagement (attach) → 201 (got ${attach.status})`)
const eng = attach.json?.engagement?.id
{
  const evs = await eventsFor(tokenA, cc1)
  const e = evs.find((x) => x.event_type === "engagement_attached")
  ok(!!e && e.context?.engagement_id === eng, "engagement_attached logged with context.engagement_id")
  ok(typeof e?.context?.name === "string", "engagement_attached context.name present")
}

// ── proposal_sent / approved / declined + draft SKIP ──
for (const [status, type] of [["sent", "proposal_sent"], ["approved", "proposal_approved"], ["declined", "proposal_declined"]]) {
  const r = await api("PATCH", tokenA, `/coach-clients/${cc1}/engagements/${eng}`, { proposal_status: status })
  ok(r.status === 200, `PATCH proposal_status=${status} → 200 (got ${r.status})`)
  const evs = await eventsFor(tokenA, cc1)
  ok(evs.some((x) => x.event_type === type), `${type} logged`)
}
{
  const before = (await eventsFor(tokenA, cc1)).length
  const draft = await api("PATCH", tokenA, `/coach-clients/${cc1}/engagements/${eng}`, { proposal_status: "draft" })
  ok(draft.status === 200, `PATCH proposal_status=draft → 200 (got ${draft.status})`)
  const after = (await eventsFor(tokenA, cc1)).length
  ok(after === before, "draft transition logs NO event (skip-draft holds)")
}

// ── engagement_detached ──
const detach = await api("DELETE", tokenA, `/coach-clients/${cc1}/engagements/${eng}`)
ok(detach.status === 200 && detach.json?.deleted === eng, `DELETE engagement (detach) → 200 (got ${detach.status})`)
{
  const evs = await eventsFor(tokenA, cc1)
  const e = evs.find((x) => x.event_type === "engagement_detached")
  ok(!!e && e.context?.engagement_id === eng && typeof e.context?.name === "string", "engagement_detached logged with context { name, engagement_id }")
}

// ── Cleanup (deleting the coach_client cascades events/engagements/stage_progress) ──
if (cc1) await admin.from("coach_clients").delete().eq("id", cc1)
for (const id of cleanup.packages) await admin.from("coach_packages").delete().eq("id", id)
for (const id of cleanup.milestones) await admin.from("coach_milestones").delete().eq("id", id)
console.log("\nCleanup: removed throwaway prospect (events/engagements cascaded), package, milestone via service role")

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
