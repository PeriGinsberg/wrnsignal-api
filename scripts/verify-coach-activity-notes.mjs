// scripts/verify-coach-activity-notes.mjs
//
// Smoke for coach activity-note CRUD:
//   GET/POST  /api/coach/coach-clients/[id]/engagements/[eid]/activities/[aid]/notes
//   PUT/DELETE .../notes/[noteId]
// Asserts create defaults (private + not-action-required), body edit, both toggles,
// validation 400s, soft-delete (gone from GET, row persists), the NESTED-RESOURCE
// guard (a note reached via a DIFFERENT activity the coach owns → 404), and
// cross-coach isolation (Coach B can't CRUD Coach A's activity notes).
//
// Seeds throwaway client_profiles (email+profile_text only) + coach_clients via the
// service role so the notes' NOT NULL client_profile_id FK + UNIQUE(coach,client)
// never collide with real fixtures. Builds catalog packages through the real API.
//
// Required env:
//   BASE_URL  default https://wrnsignal-api-staging.vercel.app
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (dev)
//   COACH_A_EMAIL / COACH_A_PASSWORD ; COACH_B_EMAIL / COACH_B_PASSWORD
//
// Run (plain node):
//   NODE_OPTIONS=--use-system-ca BASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   SUPABASE_SERVICE_ROLE_KEY=... COACH_A_EMAIL=... COACH_A_PASSWORD=... \
//   COACH_B_EMAIL=... COACH_B_PASSWORD=... node scripts/verify-coach-activity-notes.mjs

import { createClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const PROD_REF = "ejhnokcnahauvrcbcmic"
const BASE_URL = (process.env.BASE_URL || "https://wrnsignal-api-staging.vercel.app").replace(/\/$/, "")
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const A = { email: process.env.COACH_A_EMAIL, password: process.env.COACH_A_PASSWORD }
const B = { email: process.env.COACH_B_EMAIL, password: process.env.COACH_B_PASSWORD }

function need(label, v) { if (!v) { console.error(`MISSING env: ${label}`); process.exit(2) } return v }
need("SUPABASE_URL", SUPABASE_URL); need("SUPABASE_ANON_KEY", SUPABASE_ANON_KEY)
need("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
need("COACH_A_EMAIL", A.email); need("COACH_A_PASSWORD", A.password)
need("COACH_B_EMAIL", B.email); need("COACH_B_PASSWORD", B.password)
if (SUPABASE_URL.includes(PROD_REF)) { console.error(`REFUSED: SUPABASE_URL is PROD (${PROD_REF}). Dev only.`); process.exit(2) }
if (!SUPABASE_URL.includes(DEV_REF)) { console.error(`REFUSED: SUPABASE_URL must be dev (${DEV_REF}).`); process.exit(2) }

let failures = 0
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++ }
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const REL_MARKER = "__verify_notes_rel__"
const CLIENT_MARKER = "__verify_notes_client__"

async function signIn(who, creds) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password })
  if (error || !data?.session?.access_token) { console.error(`Sign-in failed for ${who}: ${error?.message || "no session"}`); process.exit(2) }
  return data.session.access_token
}
async function profileIdFor(email) {
  const { data } = await admin.from("client_profiles").select("id").eq("email", email.trim().toLowerCase()).maybeSingle()
  if (!data?.id) { console.error(`No client_profiles.id for ${email}`); process.exit(2) }
  return data.id
}
async function seedClientProfile(tag, stamp) {
  const email = `__verify_notes_${stamp}_${tag}@example.com`
  const { data, error } = await admin.from("client_profiles").insert({ email, profile_text: CLIENT_MARKER }).select("id").single()
  if (error || !data?.id) { console.error(`Seed client_profiles failed: ${error?.message}`); process.exit(2) }
  return data.id
}
async function seedCoachClient(coachProfileId, clientProfileId) {
  const { data, error } = await admin.from("coach_clients").insert({
    coach_profile_id: coachProfileId, client_profile_id: clientProfileId,
    status: "active", access_level: "full", lifecycle_status: "Active", name: REL_MARKER,
  }).select("id").single()
  if (error || !data?.id) { console.error(`Seed coach_clients failed: ${error?.message}`); process.exit(2) }
  return data.id
}
async function api(method, token, path, body) {
  const res = await fetch(`${BASE_URL}/api/coach${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

console.log(`Target: ${BASE_URL}`)
console.log(`Supabase: ${SUPABASE_URL.match(/https:\/\/([^.]+)/)?.[1] ?? SUPABASE_URL}\n`)

const tokenA = await signIn("Coach A", A)
const tokenB = await signIn("Coach B", B)
const profileA = await profileIdFor(A.email)
const profileB = await profileIdFor(B.email)
const stamp = Date.now()
const cleanup = { milestones: [], packages: [], coachClients: [], clientProfiles: [] }

const clientA = await seedClientProfile("a", stamp); cleanup.clientProfiles.push(clientA)
const clientB = await seedClientProfile("b", stamp); cleanup.clientProfiles.push(clientB)
const ccA = await seedCoachClient(profileA, clientA); cleanup.coachClients.push(ccA)
const ccB = await seedCoachClient(profileB, clientB); cleanup.coachClients.push(ccB)

async function makeMilestoneWithActivity(token, mName, actName) {
  const m = await api("POST", token, "/milestones", { name: mName, fee: 100 })
  if (m.status !== 201 || !m.json?.milestone?.id) { console.error(`milestone create failed (${m.status})`); process.exit(2) }
  const mid = m.json.milestone.id; cleanup.milestones.push(mid)
  const a = await api("POST", token, `/milestones/${mid}/activities`, { name: actName, owner: "client" })
  if (a.status !== 201) { console.error(`activity create failed (${a.status})`); process.exit(2) }
  return mid
}
async function makePackage(token, name, deliverableIds) {
  const p = await api("POST", token, "/packages", { name, deliverable_ids: deliverableIds })
  if (p.status !== 201 || !p.json?.package?.id) { console.error(`package create failed (${p.status})`); process.exit(2) }
  cleanup.packages.push(p.json.package.id)
  return p.json.package.id
}

// ── Coach A: two deliverables (each with one activity) → package → attach ──
const M1 = await makeMilestoneWithActivity(tokenA, `${REL_MARKER}_as_M1_${stamp}`, "Kickoff")
const M2 = await makeMilestoneWithActivity(tokenA, `${REL_MARKER}_as_M2_${stamp}`, "Review")
const pkgA = `${REL_MARKER}_as_P_${stamp}`
const PA = await makePackage(tokenA, pkgA, [M1, M2])
const attA = await api("POST", tokenA, `/coach-clients/${ccA}/engagements`, { package_id: PA })
ok(attA.status === 201 && attA.json?.engagement?.id, `attach A package → 201 (got ${attA.status})`)
const E = attA.json?.engagement?.id
const delivsA = attA.json?.engagement?.deliverables || []
const A_act = delivsA[0]?.activities?.[0]?.id
const A_act2 = delivsA[1]?.activities?.[0]?.id
ok(!!A_act && !!A_act2, `A engagement has two activities (A_act=${!!A_act}, A_act2=${!!A_act2})`)

// ── Coach B: own engagement + activity ──
const MB = await makeMilestoneWithActivity(tokenB, `${REL_MARKER}_as_MB_${stamp}`, "BTask")
const PB = await makePackage(tokenB, `${REL_MARKER}_as_PB_${stamp}`, [MB])
const attB = await api("POST", tokenB, `/coach-clients/${ccB}/engagements`, { package_id: PB })
ok(attB.status === 201 && attB.json?.engagement?.id, `attach B package → 201 (got ${attB.status})`)
const EB = attB.json?.engagement?.id
const B_act = attB.json?.engagement?.deliverables?.[0]?.activities?.[0]?.id

const notes = (cc, e, act) => `/coach-clients/${cc}/engagements/${e}/activities/${act}/notes`
const aNotes = notes(ccA, E, A_act)
const aNotes2 = notes(ccA, E, A_act2)

// ── CREATE + defaults ──
let r = await api("POST", tokenA, aNotes, { body: "first note" })
ok(r.status === 201 && r.json?.note?.id, `POST note → 201 (got ${r.status})`)
const N = r.json?.note?.id
ok(r.json?.note?.visible_to_client === false, "new note defaults visible_to_client = false (private)")
ok(r.json?.note?.action_required === false, "new note defaults action_required = false")

let g = await api("GET", tokenA, aNotes)
ok(g.status === 200 && (g.json?.notes || []).length === 1 && g.json.notes[0].id === N, "GET lists the active note")

// ── EDIT body ──
r = await api("PUT", tokenA, `${aNotes}/${N}`, { body: "edited body" })
ok(r.status === 200, `PUT body → 200 (got ${r.status})`)
g = await api("GET", tokenA, aNotes)
ok(g.json?.notes?.[0]?.body === "edited body", "GET reflects edited body")

// ── TOGGLE visible_to_client ──
r = await api("PUT", tokenA, `${aNotes}/${N}`, { visible_to_client: true })
ok(r.status === 200 && r.json?.note?.visible_to_client === true, "PUT visible_to_client=true → reflected")
// ── TOGGLE action_required ──
r = await api("PUT", tokenA, `${aNotes}/${N}`, { action_required: true })
ok(r.status === 200 && r.json?.note?.action_required === true, "PUT action_required=true → reflected")

// ── VALIDATION ──
ok((await api("PUT", tokenA, `${aNotes}/${N}`, {})).status === 400, "PUT {} (no fields) → 400")
ok((await api("POST", tokenA, aNotes, { body: "" })).status === 400, "POST empty body → 400")
ok((await api("POST", tokenA, aNotes, { body: "x".repeat(5001) })).status === 400, "POST body > 5000 → 400")
ok((await api("PUT", tokenA, `${aNotes}/${N}`, { visible_to_client: "yes" })).status === 400, "PUT non-boolean visible_to_client → 400")

// ── SOFT DELETE ──
ok((await api("DELETE", tokenA, `${aNotes}/${N}`)).status === 200, "DELETE note → 200")
g = await api("GET", tokenA, aNotes)
ok((g.json?.notes || []).every((n) => n.id !== N), "deleted note gone from GET")
const delRow = (await admin.from("coach_client_activity_notes").select("id, deleted_at").eq("id", N).maybeSingle()).data
ok(!!delRow && delRow.deleted_at !== null, "row persists with deleted_at set (soft, not hard, delete)")
ok((await api("DELETE", tokenA, `${aNotes}/${N}`)).status === 404, "re-DELETE already-deleted note → 404")

// ── NESTED-RESOURCE GUARD ──
r = await api("POST", tokenA, aNotes, { body: "guard note" })
const N2 = r.json?.note?.id
ok(r.status === 201 && !!N2, `setup: second note on A_act (got ${r.status})`)
ok((await api("PUT", tokenA, `${aNotes2}/${N2}`, { body: "hack" })).status === 404, "PUT A_act's note via A_act2 path → 404")
ok((await api("DELETE", tokenA, `${aNotes2}/${N2}`)).status === 404, "DELETE A_act's note via A_act2 path → 404")
g = await api("GET", tokenA, aNotes)
ok(g.json?.notes?.find((n) => n.id === N2)?.body === "guard note", "N2 unchanged after wrong-activity attempts")
ok(((await api("GET", tokenA, aNotes2)).json?.notes || []).every((n) => n.id !== N2), "GET A_act2 does not list N2")

// ── CROSS-COACH ISOLATION ──
ok((await api("GET", tokenB, aNotes)).status === 404, "Coach B GET A's notes → 404")
ok((await api("POST", tokenB, aNotes, { body: "x" })).status === 404, "Coach B POST to A's activity → 404")
// DEEP: B pairs A's activity under B's own engagement/relationship.
ok((await api("POST", tokenB, notes(ccB, EB, A_act), { body: "x" })).status === 404, "DEEP: B POST to A_act under B's engagement → 404")
ok((await api("PUT", tokenB, `${notes(ccB, EB, B_act)}/${N2}`, { body: "x" })).status === 404, "B PUT A's note via B's own path → 404")
ok((await api("DELETE", tokenB, `${notes(ccB, EB, B_act)}/${N2}`)).status === 404, "B DELETE A's note via B's own path → 404")
ok((await api("GET", tokenA, aNotes)).json?.notes?.find((n) => n.id === N2)?.body === "guard note", "A's note intact after B's blocked attacks")

// ── AUTH ──
const noAuth = await fetch(`${BASE_URL}/api/coach${aNotes}`)
ok(noAuth.status === 401, `GET with no bearer → 401 (got ${noAuth.status})`)

// ── Cleanup ──
for (const id of cleanup.coachClients) await admin.from("coach_clients").delete().eq("id", id) // cascades engagements/activities/notes
for (const id of cleanup.packages) await admin.from("coach_packages").delete().eq("id", id)
for (const id of cleanup.milestones) await admin.from("coach_milestones").delete().eq("id", id)
for (const id of cleanup.clientProfiles) await admin.from("client_profiles").delete().eq("id", id)
// Scoped absence checks.
const leakNotes = (await admin.from("coach_client_activity_notes").select("id").in("id", [N, N2])).data || []
const leakRels = (await admin.from("coach_clients").select("id").eq("name", REL_MARKER)).data || []
ok(leakNotes.length === 0, `cleanup: no throwaway notes remain (found ${leakNotes.length})`)
ok(leakRels.length === 0, `cleanup: no throwaway relationships remain (found ${leakRels.length})`)
console.log("Cleanup: removed throwaway coach_clients (engagements/activities/notes cascaded), packages, milestones, client_profiles")

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
