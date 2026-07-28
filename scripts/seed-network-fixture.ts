#!/usr/bin/env tsx
// Network Tracker fixture seeder — throwaway dev data to exercise the tracker
// (worklist + spreadsheet + the dashboard's future metrics). NOT a product
// surface: Phase 6's CSV import is the real ingestion path.
//
// Every next_due_at it writes comes from computeNextDue() — the same engine the
// API routes call. Nothing here hand-rolls interval math (brief §3 guardrail 1).
// The first_*_at milestone columns ARE written directly (a fixture stands in for
// history the routes would have accrued), so the dashboard's reply/chat rates
// have something to compute.
//
// SAFETY: dev project ref only, and --confirm required to write.
//
// USAGE (SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL both accepted for the URL):
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//     npx tsx scripts/seed-network-fixture.ts --email=you@example.com --confirm
//   (omit --confirm for a dry run; --clean removes the fixture instead)
//
// IDEMPOTENCY: re-runnable. --clean (and the pre-seed wipe) delete every contact
// tagged source='fixture' plus the fixture companies by name — nothing else.

import { createClient } from "@supabase/supabase-js"
import { computeNextDue, type ContactStage } from "../lib/network-tracker/reminder-engine"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const PROD_REF = "ejhnokcnahauvrcbcmic"

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const URL_SOURCE = process.env.SUPABASE_URL ? "SUPABASE_URL" : process.env.NEXT_PUBLIC_SUPABASE_URL ? "NEXT_PUBLIC_SUPABASE_URL" : "(none)"
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const EMAIL = (process.argv.find((a) => a.startsWith("--email="))?.slice("--email=".length) || "").trim().toLowerCase()
const CONFIRMED = process.argv.includes("--confirm")
const CLEAN_ONLY = process.argv.includes("--clean")

function abort(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

console.log("\nSIGNAL — network tracker fixture")
console.log(`Target:  ${SUPABASE_URL || "(not set)"}  [from ${URL_SOURCE}]`)
console.log(`Client:  ${EMAIL || "(not set)"}`)
console.log(`Mode:    ${CLEAN_ONLY ? "CLEAN" : "SEED"} ${CONFIRMED ? "(APPLY)" : "(DRY-RUN — pass --confirm to write)"}\n`)

if (!SUPABASE_URL) abort("No Supabase URL in the environment. Export SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL (dev project) before running.")
if (SUPABASE_URL.includes(PROD_REF)) abort(`REFUSED: SUPABASE_URL is the PROD ref (${PROD_REF}). This script is dev-only.`)
if (!SUPABASE_URL.includes(DEV_REF)) abort(`REFUSED: SUPABASE_URL must contain the dev ref (${DEV_REF}).`)
if (!SERVICE_KEY) abort("SUPABASE_SERVICE_ROLE_KEY is required.")
if (!EMAIL) abort("--email=<client email> is required (the board owner).")

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const DAY = 86400000
const ago = (days: number) => new Date(Date.now() - days * DAY)

// ── companies (5) ──
const COMPANIES: { name: string; tier: string; status: string }[] = [
  { name: "Northwind Freight", tier: "dream", status: "actively_working" },
  { name: "Globex", tier: "strong", status: "actively_working" },
  { name: "Initech", tier: "backup", status: "researching" },
  { name: "Umbrella Health", tier: "dream", status: "actively_working" },
  { name: "Vertex Labs", tier: "strong", status: "paused" },
]
const COMPANY_NAMES = COMPANIES.map((c) => c.name)

type Act = { type: string; at: Date; note?: string }
type Seed = {
  fn: string; ln: string; title: string
  company: string | null           // null = standalone
  rel: string | null               // null = "needs attention"
  seg: string | null
  pri: string | null
  stage: ContactStage
  created: Date
  lastAction: Date | null
  dormantSince?: Date
  ft?: Date; fr?: Date; fc?: Date   // first_touch / first_replied / first_chat
  outcomeType?: string
  actions: Act[]
}

// ── contacts (17: 14 company-attached + 3 standalone) ──
// Relationships weighted toward cold + affinity, like a real pull. Statuses are
// produced by the engine from stage + lastAction, not hand-written.
const CONTACTS: Seed[] = [
  // ── identified — nothing due, no first_touch ──
  { fn: "Aisha", ln: "Khan", title: "Product Lead", company: "Umbrella Health", rel: "cold", seg: "Cold PM outreach", pri: "B", stage: "identified", created: ago(3), lastAction: null, actions: [] },
  { fn: "Marcus", ln: "Lee", title: "Eng Manager", company: "Globex", rel: "affinity", seg: "Alumni network", pri: "A", stage: "identified", created: ago(5), lastAction: null, actions: [] }, // A + identified -> needs attention
  { fn: "Rosa", ln: "Diaz", title: "Design Director", company: "Initech", rel: "personal", seg: "Warm intros", pri: "A", stage: "identified", created: ago(8), lastAction: null, actions: [] }, // A + identified -> needs attention
  { fn: "Nina", ln: "Alvarez", title: "Data Scientist", company: null, rel: "cold", seg: "Cold PM outreach", pri: "C", stage: "identified", created: ago(2), lastAction: null, actions: [] }, // standalone
  { fn: "Owen", ln: "Park", title: "Founder", company: null, rel: null, seg: "Warm intros", pri: "B", stage: "identified", created: ago(6), lastAction: null, actions: [] }, // standalone, NO relationship -> needs attention

  // ── sequence_active — different touch counts, varied overdue / due today / later ──
  { fn: "Ben", ln: "Cho", title: "VP Product", company: "Northwind Freight", rel: "cold", seg: "Cold PM outreach", pri: "A", stage: "sequence_active", created: ago(20), lastAction: ago(19), ft: ago(19),
    actions: [{ type: "touch_1", at: ago(19) }] }, // touch_2 due -> ~12d overdue
  { fn: "Carla", ln: "Mendes", title: "Head of Ops", company: "Globex", rel: "affinity", seg: "Alumni network", pri: "B", stage: "sequence_active", created: ago(14), lastAction: ago(10), ft: ago(15),
    actions: [{ type: "touch_1", at: ago(15) }, { type: "touch_2", at: ago(10) }] }, // touch_3 due -> ~5d overdue
  { fn: "Deepak", ln: "Rao", title: "Analytics Lead", company: "Initech", rel: "cold", seg: "Cold PM outreach", pri: "C", stage: "sequence_active", created: ago(11), lastAction: ago(9), ft: ago(9),
    actions: [{ type: "touch_1", at: ago(9) }, { type: "note_logged", at: ago(8), note: "left a voicemail" }] }, // touch_2 due -> ~2d overdue
  { fn: "Elena", ln: "Fischer", title: "PM", company: null, rel: "affinity", seg: "Warm intros", pri: "B", stage: "sequence_active", created: ago(9), lastAction: ago(7), ft: ago(7),
    actions: [{ type: "touch_1", at: ago(7) }] }, // touch_2 due today (standalone)
  { fn: "Frank", ln: "Owusu", title: "Recruiter", company: "Umbrella Health", rel: "recruiter", seg: "Cold PM outreach", pri: "A", stage: "sequence_active", created: ago(8), lastAction: ago(2), ft: ago(6),
    actions: [{ type: "touch_1", at: ago(6) }, { type: "touch_2", at: ago(2) }] }, // touch_3 due in ~3d

  // ── replied — first_touch + first_replied stamped ──
  { fn: "Grace", ln: "Lin", title: "Director, PMM", company: "Northwind Freight", rel: "referred", seg: "Alumni network", pri: "A", stage: "replied", created: ago(16), lastAction: ago(3), ft: ago(14), fr: ago(3),
    actions: [{ type: "touch_1", at: ago(14) }, { type: "touch_2", at: ago(8) }, { type: "note_logged", at: ago(3), note: "replied on LinkedIn — keen to chat" }] }, // reply due -> ~2d overdue
  { fn: "Henry", ln: "Sato", title: "Group PM", company: "Globex", rel: "affinity", seg: "Warm intros", pri: "B", stage: "replied", created: ago(10), lastAction: ago(1), ft: ago(9), fr: ago(1),
    actions: [{ type: "touch_1", at: ago(9) }, { type: "touch_2", at: ago(4) }] }, // reply due today

  // ── talking / later stages ──
  { fn: "Ivy", ln: "Chen", title: "SVP People", company: "Umbrella Health", rel: "referred", seg: "Alumni network", pri: "A", stage: "chat_done", created: ago(20), lastAction: ago(0), ft: ago(18), fr: ago(10), fc: ago(5),
    actions: [{ type: "touch_1", at: ago(18) }, { type: "touch_2", at: ago(14) }, { type: "chat_scheduled", at: ago(6) }, { type: "chat_done", at: ago(0) }] }, // thank_you due in ~1d
  { fn: "Jack", ln: "Wu", title: "Advisor", company: "Vertex Labs", rel: "personal", seg: "Warm intros", pri: "C", stage: "nurture", created: ago(60), lastAction: ago(5), ft: ago(55), fr: ago(40), fc: ago(35),
    actions: [{ type: "touch_1", at: ago(55) }, { type: "chat_done", at: ago(35) }, { type: "note_logged", at: ago(5), note: "sent the Q3 planning article" }] }, // nurture_recurring far out
  { fn: "Kira", ln: "Nolan", title: "Hiring Manager", company: "Northwind Freight", rel: "referred", seg: "Alumni network", pri: "A", stage: "outcome", outcomeType: "referral", created: ago(45), lastAction: ago(10), ft: ago(40), fr: ago(30), fc: ago(25),
    actions: [{ type: "touch_1", at: ago(40) }, { type: "chat_done", at: ago(25) }] }, // outcome -> nothing due

  // ── dormant, both kinds ──
  { fn: "Liam", ln: "Byrne", title: "Ops Manager", company: "Globex", rel: "cold", seg: "Cold PM outreach", pri: "C", stage: "dormant_no_answer", created: ago(40), lastAction: ago(20), dormantSince: ago(20), ft: ago(35),
    actions: [{ type: "touch_1", at: ago(35) }, { type: "touch_2", at: ago(28) }, { type: "touch_3", at: ago(20) }] }, // resurface_no_answer in ~15d
  { fn: "Mia", ln: "Torres", title: "Partnerships", company: "Initech", rel: "affinity", seg: "Alumni network", pri: "B", stage: "dormant_declined", created: ago(30), lastAction: ago(15), dormantSince: ago(15), ft: ago(28), fr: ago(20),
    actions: [{ type: "touch_1", at: ago(28) }, { type: "touch_2", at: ago(23) }, { type: "note_logged", at: ago(15), note: "said not now — try again in Q3" }] }, // resurface_declined far out
]

async function main() {
  const { data: profile, error: pErr } = await db
    .from("client_profiles").select("id, email").eq("email", EMAIL).maybeSingle()
  if (pErr) abort(`Profile lookup failed: ${pErr.message}`)
  if (!profile) abort(`No client_profiles row with email ${EMAIL}.`)
  const owner = profile.id as string
  console.log(`Board owner: ${owner}`)

  if (!CONFIRMED) {
    console.log(`\nWould ${CLEAN_ONLY ? "delete the fixture" : `recreate ${COMPANIES.length} companies + ${CONTACTS.length} contacts`}.`)
    console.log("Dry run — nothing written. Re-run with --confirm.\n")
    return
  }

  // ── wipe prior fixture rows (idempotent) ──
  // Contacts tagged source='fixture' (company-attached AND standalone); their
  // actions cascade. Then the fixture companies by name.
  const delC = await db.from("network_contacts").delete().eq("client_profile_id", owner).eq("source", "fixture")
  if (delC.error) abort(`Contact wipe failed: ${delC.error.message}`)
  const delCo = await db.from("network_companies").delete().eq("client_profile_id", owner).in("name", COMPANY_NAMES)
  if (delCo.error) abort(`Company wipe failed: ${delCo.error.message}`)
  console.log("Removed previous fixture rows.")

  if (CLEAN_ONLY) {
    console.log("Clean complete.\n")
    return
  }

  // ── companies ──
  const companyId = new Map<string, string>()
  for (const co of COMPANIES) {
    const { data, error } = await db.from("network_companies")
      .insert({ client_profile_id: owner, name: co.name, tier: co.tier, status: co.status })
      .select("id").single()
    if (error) abort(`Company insert failed (${co.name}): ${error.message}`)
    companyId.set(co.name, data.id)
  }

  // ── contacts ──
  let overdue = 0, dueToday = 0, later = 0, none = 0
  const startOfToday = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()

  for (const c of CONTACTS) {
    const { data: contact, error: insErr } = await db.from("network_contacts").insert({
      client_profile_id: owner,
      company_id: c.company ? companyId.get(c.company)! : null,
      first_name: c.fn, last_name: c.ln, title: c.title,
      relationship: c.rel, segment: c.seg, priority: c.pri,
      source: "fixture",
      stage: c.stage,
      outcome_type: c.outcomeType ?? null,
      created_at: c.created.toISOString(),
      last_action_at: c.lastAction ? c.lastAction.toISOString() : null,
      dormant_since: c.dormantSince ? c.dormantSince.toISOString() : null,
      first_touch_at: c.ft ? c.ft.toISOString() : null,
      first_replied_at: c.fr ? c.fr.toISOString() : null,
      first_chat_at: c.fc ? c.fc.toISOString() : null,
    }).select("id").single()
    if (insErr) abort(`Contact insert failed (${c.fn} ${c.ln}): ${insErr.message}`)

    if (c.actions.length) {
      const { error: aErr } = await db.from("network_actions").insert(
        c.actions.map((a) => ({
          contact_id: contact.id, type: a.type, action_date: a.at.toISOString(),
          note: a.note ?? null, author_role: "client", author_id: owner,
        })),
      )
      if (aErr) abort(`Action insert failed (${c.fn}): ${aErr.message}`)
    }

    // The engine decides the due date — same call the API routes make.
    const due = computeNextDue({
      stage: c.stage, createdAt: c.created, lastActionAt: c.lastAction,
      reminderOverride: null, dormantSince: c.dormantSince ?? null, pokeEnabled: false,
      actions: c.actions.map((a) => ({ type: a.type })),
    })
    const { error: uErr } = await db.from("network_contacts").update({
      next_due_at: due.nextDueAt ? due.nextDueAt.toISOString() : null,
      next_due_reason: due.nextDueReason,
      ...(due.stage ? { stage: due.stage } : {}),
      ...(due.dormantSince ? { dormant_since: due.dormantSince.toISOString() } : {}),
    }).eq("id", contact.id)
    if (uErr) abort(`Due update failed (${c.fn}): ${uErr.message}`)

    // tally the status mix for the summary
    if (!due.nextDueAt) none++
    else {
      const d = new Date(new Date(due.nextDueAt).getFullYear(), new Date(due.nextDueAt).getMonth(), new Date(due.nextDueAt).getDate()).getTime()
      if (d < startOfToday) overdue++
      else if (d === startOfToday) dueToday++
      else later++
    }
    console.log(`  ${(c.fn + " " + c.ln).padEnd(16)} ${String(due.stage ?? c.stage).padEnd(18)} ${due.nextDueReason ?? "—"}`)
  }

  console.log(`\nStatus mix: ${overdue} overdue · ${dueToday} due today · ${later} due later · ${none} nothing due`)
  console.log(`Seeded ${COMPANIES.length} companies + ${CONTACTS.length} contacts. Open /dashboard/network/contacts as ${EMAIL}.\n`)
}

main().catch((e) => abort(e?.message || String(e)))
