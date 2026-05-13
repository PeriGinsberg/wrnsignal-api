// Read-only inventory of currently-firing Sprint 2 heuristic rules
// against Peri's prod coach data. Replicates the logic in
// app/api/coach/home/route.ts (the canonical implementation) so the
// counts here reflect what the live Engagement Signals surfaces show.
//
// SAFETY: read-only. No INSERT/UPDATE/DELETE.

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PROD_REF = "ejhnokcnahauvrcbcmic"
const COACH_EMAIL = (process.env.COACH_EMAIL || "peri@workforcereadynow.com").trim().toLowerCase()

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}
if (!SUPABASE_URL.includes(PROD_REF)) {
  console.error(`This count is intended for PROD (${PROD_REF}). Got URL not matching prod.`)
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const MS_DAY = 24 * 60 * 60 * 1000
const daysAgo = (d) => new Date(Date.now() - d * MS_DAY).toISOString()
const daysBetween = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / MS_DAY)

const lines = []
function out(s) { console.log(s); lines.push(s) }

out(`# Engagement Signals — current firing count`)
out(`# Target: ${SUPABASE_URL}`)
out(`# Coach email: ${COACH_EMAIL}`)
out("")

// ── 1. Find the coach + active clients ───────────────────────────────
const { data: coach, error: coachErr } = await sb
  .from("client_profiles")
  .select("id, name, email, is_coach")
  .eq("email", COACH_EMAIL)
  .maybeSingle()
if (coachErr || !coach) {
  console.error("Coach not found:", coachErr?.message)
  process.exit(1)
}
if (!coach.is_coach) {
  console.error(`Profile ${COACH_EMAIL} is_coach=false. Aborting.`)
  process.exit(1)
}
const coachProfileId = coach.id

const { data: relRows } = await sb
  .from("coach_clients")
  .select("id, client_profile_id, accepted_at, last_viewed_at, status")
  .eq("coach_profile_id", coachProfileId)
  .eq("status", "active")
const relationships = relRows || []
const clientProfileIds = relationships.map((r) => r.client_profile_id).filter(Boolean)

out(`Active clients: ${relationships.length}`)
out("")

// Build last_viewed_at lookup per client (needed for R3-R5)
const lastViewedByClient = new Map()
for (const r of relationships) {
  lastViewedByClient.set(r.client_profile_id, r.last_viewed_at)
}

// Profile lookup for client names
const profileById = new Map()
if (clientProfileIds.length > 0) {
  const { data: profs } = await sb
    .from("client_profiles")
    .select("id, name, email, user_id")
    .in("id", clientProfileIds)
  for (const p of profs || []) profileById.set(p.id, p)
}

// ── R1: client hasn't logged in 7+ days ──────────────────────────────
const r1Items = []
for (const cpid of clientProfileIds) {
  const profile = profileById.get(cpid)
  if (!profile?.user_id) continue
  try {
    const { data: u } = await sb.auth.admin.getUserById(profile.user_id)
    const last = u?.user?.last_sign_in_at
    if (!last) continue  // skip if never signed in (per route logic)
    const days = daysBetween(last)
    if (days >= 7) {
      r1Items.push({ client: profile.name || profile.email, days })
    }
  } catch {}
}

// ── R2: coach rec pending client review 3+ days ──────────────────────
let r2Items = []
if (clientProfileIds.length > 0) {
  const { data: stale } = await sb
    .from("coach_job_recommendations")
    .select("id, client_profile_id, company_name, created_at")
    .eq("coach_profile_id", coachProfileId)
    .in("client_profile_id", clientProfileIds)
    .is("client_responded_at", null)
    .lt("created_at", daysAgo(3))
  for (const r of stale || []) {
    const profile = profileById.get(r.client_profile_id)
    r2Items.push({ client: profile?.name || profile?.email, company: r.company_name, days: daysBetween(r.created_at) })
  }
}

// ── R3 / R4 / R5: status_history-driven ──────────────────────────────
// Latest transition per (client, to_status, application_id), where the
// app's CURRENT status still matches that to_status, days >= threshold,
// and coach hasn't viewed since the change.
const statusThresholds = { interviewing: 2, rejected: 3, offer: 1 }
const r3Items = []
const r4Items = []
const r5Items = []

if (clientProfileIds.length > 0) {
  const { data: histRows } = await sb
    .from("signal_applications_status_history")
    .select("id, application_id, to_status, changed_at, signal_applications!inner(profile_id, company_name, job_title)")
    .in("to_status", ["interviewing", "rejected", "offer"])
    .in("signal_applications.profile_id", clientProfileIds)
    .order("changed_at", { ascending: false })

  // Latest per (client, to_status, application_id)
  const latest = new Map()
  for (const r of histRows || []) {
    const cpid = r.signal_applications?.profile_id
    if (!cpid) continue
    const key = `${cpid}:${r.to_status}:${r.application_id}`
    if (!latest.has(key)) {
      latest.set(key, {
        application_id: r.application_id,
        to_status: r.to_status,
        changed_at: r.changed_at,
        client_profile_id: cpid,
        company_name: r.signal_applications?.company_name ?? "",
      })
    }
  }

  // Verify current status still matches
  const candidateAppIds = Array.from(latest.values()).map((h) => h.application_id)
  const currentByApp = new Map()
  if (candidateAppIds.length > 0) {
    const { data: currentApps } = await sb
      .from("signal_applications")
      .select("id, application_status")
      .in("id", candidateAppIds)
    for (const a of currentApps || []) currentByApp.set(a.id, a.application_status)
  }

  for (const h of latest.values()) {
    if (currentByApp.get(h.application_id) !== h.to_status) continue
    const days = daysBetween(h.changed_at)
    const threshold = statusThresholds[h.to_status]
    if (days < threshold) continue
    const lastViewed = lastViewedByClient.get(h.client_profile_id)
    if (lastViewed && lastViewed > h.changed_at) continue  // viewed since
    const profile = profileById.get(h.client_profile_id)
    const item = { client: profile?.name || profile?.email, company: h.company_name, days }
    if (h.to_status === "interviewing") r3Items.push(item)
    if (h.to_status === "rejected") r4Items.push(item)
    if (h.to_status === "offer") r5Items.push(item)
  }
}

// ── R6: poor-fit app added 5+ days ago, no coach rec for that company+title ──
const r6Items = []
if (clientProfileIds.length > 0) {
  const { data: poorFit } = await sb
    .from("signal_applications")
    .select("id, profile_id, company_name, job_title, signal_score, created_at, application_status")
    .in("profile_id", clientProfileIds)
    .not("signal_score", "is", null)
    .lt("signal_score", 60)
    .lt("created_at", daysAgo(5))
    .not("application_status", "in", "(rejected,withdrawn)")

  const { data: coachRecs } = await sb
    .from("coach_job_recommendations")
    .select("client_profile_id, company_name, job_title")
    .eq("coach_profile_id", coachProfileId)
    .in("client_profile_id", clientProfileIds)
  const recKey = (cpid, co, ti) => `${cpid}|${(co || "").toLowerCase().trim()}|${(ti || "").toLowerCase().trim()}`
  const recSet = new Set((coachRecs || []).map((r) => recKey(r.client_profile_id, r.company_name, r.job_title)))

  for (const a of poorFit || []) {
    if (recSet.has(recKey(a.profile_id, a.company_name, a.job_title))) continue
    const profile = profileById.get(a.profile_id)
    r6Items.push({
      client: profile?.name || profile?.email,
      company: a.company_name,
      score: a.signal_score,
      days: daysBetween(a.created_at),
    })
  }
}

// ── Report ───────────────────────────────────────────────────────────
function summary(label, kind, threshold, items) {
  out(`## ${label}`)
  out(`Kind: ${kind} | threshold: ${threshold}`)
  out(`Firings: ${items.length}`)
  for (const it of items.slice(0, 30)) {
    const tail = Object.entries(it)
      .filter(([k]) => k !== "client")
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")
    out(`  - ${it.client}  (${tail})`)
  }
  if (items.length > 30) out(`  · +${items.length - 30} more not shown`)
  out("")
}

summary("R1 — no_login (7+ days since last sign-in)",                "no_login",            "days >= 7",   r1Items)
summary("R2 — rec_pending_review (coach rec waiting 3+ days)",       "rec_pending_review",  "days >= 3",   r2Items)
summary("R3 — moved_interviewing (interviewing 2+ days, unviewed)",  "moved_interviewing",  "days >= 2",   r3Items)
summary("R4 — moved_rejected (rejected 3+ days, unviewed)",          "moved_rejected",      "days >= 3",   r4Items)
summary("R5 — offer_no_followup (offer 1+ day, unviewed)",           "offer_no_followup",   "days >= 1",   r5Items)
summary("R6 — poor_fit_no_rec (signal_score<60, 5+ days, no rec)",   "poor_fit_no_rec",     "days >= 5 AND signal_score < 60", r6Items)

const total = r1Items.length + r2Items.length + r3Items.length + r4Items.length + r5Items.length + r6Items.length
out(`# TOTAL FIRINGS: ${total}`)
