// Seed the DEV networking board for peri+demojordan@workforcereadynow.com so
// every band on the redesigned contacts board has something in it, and so the
// Model B stage offer can be triggered in one click.
//
// Run: NODE_OPTIONS=--use-system-ca npx tsx --env-file=.env.development.local tests/seed-jordan-dev-board.ts
//
//   (no flags)             dry run of the seed, reports and exits
//   --apply                seed
//   --teardown             dry run of the teardown, reports what it would undo
//   --teardown --apply     undo the seed
//   --verify               re-check the board against the engine. Read-only.
//
// JORDAN IS A POPULATED ACCOUNT, which makes this different from the Erin seed.
// That one filled a grey wall; this one adds to 33 applications, 34 JobFit runs,
// 4 interviews and 2 existing contacts that must survive untouched. So the
// guards below abort on a board that looks EMPTY as well as on the wrong
// database — a near-empty result here means the connection is not what I think
// it is.
//
// ADDITIVE, WITH FOUR EXCEPTIONS. Everything is an insert except the two
// company renames and the tier/status fills, which are in-place UPDATEs on rows
// that already exist. Every original value is captured below, read off the live
// rows before anything was written, so the teardown restores them verbatim
// rather than guessing.
//
// THE ENGINE COMPUTES EVERY DUE DATE, this file computes none of them. Actions
// are replayed through computeNextDue exactly as the routes do, with the
// BACKDATED instant as the clock. That is what makes the seeded board identical
// to one a real user produced, rather than a plausible-looking set of rows with
// hand-written dates that drift the first time the engine changes. It also
// means the band each contact lands in is a CONSEQUENCE of its history, not an
// assertion — Ellis below goes dormant because the engine flips him, not
// because this file says so.

import { createClient } from "@supabase/supabase-js"
import { computeNextDue, type ContactStage } from "../lib/network-tracker/reminder-engine"
import { stageAfterAction, isPipelineAction } from "../lib/network-tracker/action-semantics"

const PROFILE_ID = "3cbd3d45-e10b-4c88-9022-c8d6d415ba7c"
const EMAIL = "peri+demojordan@workforcereadynow.com"
const DEV_REF = "zydrqckpwidipwbhrfgd"

const APPLY = process.argv.includes("--apply")
const TEARDOWN = process.argv.includes("--teardown")
const VERIFY = process.argv.includes("--verify")

/** Stamped on every contact this run creates. The teardown matches on it and on
 *  nothing else, so it can never reach Norma, Peter, or anything else Jordan
 *  already had. */
const SEED_TAG = "seed-jordan-20260809"

/**
 * READ OFF THE LIVE ROWS before anything was written, so the revert restores
 * exactly what was there. A field that appears in the seed and not here would
 * silently never revert, so both directions list the same fields.
 */
const RENAMES = [
  { from: "Mom Inc.", to: "Loomis Sayles" },
  { from: "Test Company 2", to: "Cambridge Associates" },
] as const

/** The one application whose denormalized company_name would otherwise drift.
 *  network_companies is referenced by UUID everywhere, so the rename breaks no
 *  foreign key — but signal_applications.company_name is a separate TEXT column
 *  and would go on saying "Test Company 2" on the tracker and on both of its
 *  interviews. */
const APP_RENAME = {
  fromCompany: "Test Company 2",
  toCompany: "Cambridge Associates",
  fromTitle: "Test Role 2",
  toTitle: "Client Service Associate",
} as const

/** Tier/status fills. Every one of these is currently NULL/NULL — captured, so
 *  teardown puts the nulls back rather than assuming they were always null. */
const COMPANY_FIELDS = [
  { name: "Beacon Pointe", tier: "strong", status: "researching", wasTier: null, wasStatus: null },
  { name: "Weissman", tier: "backup", status: "paused", wasTier: null, wasStatus: null },
  { name: "Cambridge Associates", tier: "dream", status: "actively_working", wasTier: null, wasStatus: null },
] as const

const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const DAY = 86_400_000
/** Relative to NOW, never a hardcoded date: the bands are computed from the
 *  clock at read time, so a fixed date would put everyone in the wrong band the
 *  day after this was written. */
const ago = (days: number) => new Date(Date.now() - days * DAY)

function die(msg: string): never {
  console.error(`\nABORT: ${msg}`)
  process.exit(1)
}

// ── The seven contacts ─────────────────────────────────────────────────────
//
// `band` is the rank contactOrder.attentionRank should produce, and it is what
// --verify checks. It is a PREDICTION about what the engine will do given this
// history, not an instruction — if the engine disagrees, the verify fails and
// the prediction was wrong.
type Step =
  | { kind: "action"; type: string; days: number; note?: string }
  | { kind: "stage"; stage: ContactStage; days: number }

type Seed = {
  first: string
  last: string
  title: string
  company: string
  relationship: string
  priority: string
  band: number
  why: string
  steps: Step[]
}

const CONTACTS: Seed[] = [
  {
    first: "Alice", last: "Ferro", title: "VP, Client Service", company: "Cambridge Associates",
    relationship: "referred", priority: "A", band: 1, why: "replied 1d ago -> reply due +1d = today",
    steps: [
      { kind: "action", type: "touch_1", days: 21 },
      { kind: "action", type: "note_logged", days: 5, note: "Left a voicemail, said to try email." },
      { kind: "stage", stage: "replied", days: 1 },
    ],
  },
  {
    first: "Marcus", last: "Bell", title: "Director, Private Client", company: "Loomis Sayles",
    relationship: "cold", priority: "B", band: 0, why: "one follow-up 14d ago -> touch_3 due +5d = 9d overdue",
    steps: [
      { kind: "action", type: "touch_1", days: 30 },
      { kind: "action", type: "touch_2", days: 14 },
    ],
  },
  {
    first: "Dana", last: "Whitlock", title: "Head of Talent", company: "Beacon Pointe",
    relationship: "affinity", priority: "B", band: 2, why: "nurture 5d ago -> +42d",
    steps: [
      { kind: "action", type: "touch_1", days: 45 },
      { kind: "stage", stage: "replied", days: 40 },
      { kind: "stage", stage: "chat_scheduled", days: 33 },
      { kind: "stage", stage: "chat_done", days: 30 },
      { kind: "action", type: "thank_you", days: 29 },
      { kind: "stage", stage: "nurture", days: 5 },
    ],
  },
  {
    first: "Owen", last: "Tsai", title: "Portfolio Manager", company: "Weissman",
    relationship: "personal", priority: "A", band: 2, why: "ask_made 4d ago -> ask_followup +14d",
    steps: [
      { kind: "action", type: "touch_1", days: 25 },
      { kind: "stage", stage: "replied", days: 20 },
      { kind: "stage", stage: "chat_done", days: 15 },
      { kind: "action", type: "ask", days: 4 },
      { kind: "stage", stage: "ask_made", days: 4 },
    ],
  },
  {
    first: "Priya", last: "Raghavan", title: "Senior Recruiter", company: "Cambridge Associates",
    relationship: "recruiter", priority: "A", band: 3, why: "chat_scheduled -> engine returns NO due date",
    steps: [
      { kind: "action", type: "touch_1", days: 12 },
      { kind: "stage", stage: "replied", days: 8 },
      { kind: "stage", stage: "chat_scheduled", days: 3 },
    ],
  },
  {
    first: "Ellis", last: "Vaughn", title: "Managing Director", company: "Beacon Pointe",
    relationship: "cold", priority: "C", band: 5,
    why: "THREE touches, no answer -> the ENGINE flips him to dormant_no_answer",
    steps: [
      { kind: "action", type: "touch_1", days: 40 },
      { kind: "action", type: "touch_2", days: 33 },
      { kind: "action", type: "touch_3", days: 26 },
    ],
  },
  {
    // THE MODEL B CONTACT. Stage sits at sequence_active with a live-looking
    // log. Open her and log "Chat done": chat_done is ahead of sequence_active,
    // so the offer fires. Exactly ONE follow-up touch, because a second would
    // trip the engine's flip to dormant and take the stage with it.
    first: "Sofia", last: "Marek", title: "Wealth Advisor", company: "Loomis Sayles",
    relationship: "referred", priority: "A", band: 0,
    why: "MODEL B PRIMER — sequence_active, 1 follow-up 9d ago -> touch_3 due 4d overdue",
    steps: [
      { kind: "action", type: "touch_1", days: 38 },
      { kind: "action", type: "note_logged", days: 25, note: "She replied on LinkedIn, suggested a call." },
      { kind: "action", type: "touch_2", days: 9 },
    ],
  },
]

// ── Replay helpers: the routes, with a backdated clock ─────────────────────

async function applyAction(contactId: string, type: string, at: Date, note: string | null) {
  const { data: c } = await s.from("network_contacts")
    .select("id, stage, created_at, reminder_override, dormant_since, cycle_started_at, first_touch_at")
    .eq("id", contactId).single()
  if (!c) die(`contact ${contactId} vanished mid-run`)

  const { error: insErr } = await s.from("network_actions").insert({
    contact_id: contactId, type, action_date: at.toISOString(), note,
    author_role: "client", author_id: PROFILE_ID,
  })
  if (insErr) die(`action insert failed: ${insErr.message}`)

  if (!isPipelineAction(type)) return   // inert, exactly as the route stops

  const { data: acts } = await s.from("network_actions")
    .select("type, action_date").eq("contact_id", contactId)

  const implied = stageAfterAction((c as any).stage, type)
  const due = computeNextDue({
    stage: (implied ?? (c as any).stage) as ContactStage,
    createdAt: (c as any).created_at,
    lastActionAt: at,
    reminderOverride: (c as any).reminder_override,
    dormantSince: (c as any).dormant_since,
    pokeEnabled: false,
    actions: acts ?? [],
    cycleStartedAt: (c as any).cycle_started_at,
    pipelineActivity: true,
  })

  const patch: Record<string, any> = {
    last_action_at: at.toISOString(),
    next_due_at: due.nextDueAt ? due.nextDueAt.toISOString() : null,
    next_due_reason: due.nextDueReason,
  }
  if (implied) patch.stage = implied
  if (due.stage) patch.stage = due.stage
  if (due.dormantSince) patch.dormant_since = due.dormantSince.toISOString()
  if (due.clearOverride) patch.reminder_override = null
  if (type === "touch_1" && !(c as any).first_touch_at) patch.first_touch_at = at.toISOString()

  const { error } = await s.from("network_contacts").update(patch).eq("id", contactId)
  if (error) die(`contact patch failed: ${error.message}`)
}

async function applyStage(contactId: string, stage: ContactStage, at: Date) {
  const { data: c } = await s.from("network_contacts")
    .select("id, stage, created_at, reminder_override, dormant_since, cycle_started_at, first_replied_at, first_chat_at")
    .eq("id", contactId).single()
  if (!c) die(`contact ${contactId} vanished mid-run`)

  const { data: acts } = await s.from("network_actions")
    .select("type, action_date").eq("contact_id", contactId)

  let dormantSince = (c as any).dormant_since as string | null
  if ((stage === "dormant_no_answer" || stage === "dormant_declined") && !dormantSince) {
    dormantSince = at.toISOString()
  }

  const due = computeNextDue({
    stage, createdAt: (c as any).created_at, lastActionAt: at,
    reminderOverride: (c as any).reminder_override, dormantSince,
    pokeEnabled: false, actions: acts ?? [],
    cycleStartedAt: (c as any).cycle_started_at, pipelineActivity: true,
  })

  const patch: Record<string, any> = {
    stage,
    last_action_at: at.toISOString(),
    next_due_at: due.nextDueAt ? due.nextDueAt.toISOString() : null,
    next_due_reason: due.nextDueReason,
    dormant_since: dormantSince,
  }
  if (due.stage) patch.stage = due.stage
  // The three fields nobody notices are missing until the funnel reads wrong.
  if (stage === "sequence_active" && (c as any).stage !== "sequence_active") patch.cycle_started_at = at.toISOString()
  if (stage === "replied" && !(c as any).first_replied_at) patch.first_replied_at = at.toISOString()
  if ((stage === "chat_scheduled" || stage === "chat_done") && !(c as any).first_chat_at) patch.first_chat_at = at.toISOString()
  if (due.clearOverride) patch.reminder_override = null

  const { error } = await s.from("network_contacts").update(patch).eq("id", contactId)
  if (error) die(`stage patch failed: ${error.message}`)
}

// ── Band arithmetic, mirroring contactOrder.attentionRank ──────────────────
const RESTING = new Set(["dormant_no_answer", "dormant_declined"])
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
function bandOf(row: { stage: string; next_due_at: string | null; next_due_reason: string | null }): number {
  if (RESTING.has(row.stage)) return 5
  if (row.next_due_at) {
    const due = startOfDay(new Date(row.next_due_at))
    const today = startOfDay(new Date())
    if (due < today) return 0
    if (due === today) return 1
    return 2
  }
  if (row.next_due_reason) return 1
  if (row.stage === "identified") return 4
  return 3
}
const BAND_LABELS = ["Overdue", "Due today", "Due later", "Waiting on them", "Not started", "Resting"]

// ── Guards ─────────────────────────────────────────────────────────────────
async function guards() {
  const ref = process.env.SUPABASE_URL?.match(/https?:\/\/([a-z0-9]+)\./i)?.[1]
  if (ref !== DEV_REF) die(`refusing to touch project "${ref}" — this script is DEV (${DEV_REF}) only`)

  const { data: p } = await s.from("client_profiles").select("id, email, name").eq("id", PROFILE_ID).maybeSingle()
  if (!p) die("profile not found")
  if ((p as any).email !== EMAIL) die(`profile ${PROFILE_ID} is ${(p as any).email}, expected ${EMAIL}`)

  // POPULATED-ACCOUNT GUARD. Jordan is not a blank board; a near-empty read
  // means the connection is not what it looks like, and seeding on top of the
  // wrong account is the one mistake this cannot undo cleanly.
  const [{ count: apps }, { count: contacts }] = await Promise.all([
    s.from("signal_applications").select("id", { count: "exact", head: true }).eq("profile_id", PROFILE_ID),
    s.from("network_contacts").select("id", { count: "exact", head: true }).eq("client_profile_id", PROFILE_ID),
  ])
  if ((apps ?? 0) < 30) die(`expected 30+ applications on Jordan, found ${apps} — wrong account or wrong database`)
  if ((contacts ?? 0) < 2) die(`expected Jordan's 2 existing contacts, found ${contacts}`)

  console.log(`Profile  ${(p as any).name} <${(p as any).email}>`)
  console.log(`Existing ${apps} applications, ${contacts} contacts — untouched by this script`)
}

async function companyIdByName(name: string): Promise<string | null> {
  const { data } = await s.from("network_companies")
    .select("id").eq("client_profile_id", PROFILE_ID).ilike("name", name).maybeSingle()
  return (data as any)?.id ?? null
}

// ── Seed ───────────────────────────────────────────────────────────────────
async function seed() {
  const { count: already } = await s.from("network_contacts")
    .select("id", { count: "exact", head: true })
    .eq("client_profile_id", PROFILE_ID).eq("source", SEED_TAG)
  if ((already ?? 0) > 0) die(`${already} contacts already carry ${SEED_TAG} — run --teardown --apply first`)

  // Renames must not collide with the unique index on (client_profile_id, lower(name)).
  for (const r of RENAMES) {
    if (!(await companyIdByName(r.from))) die(`company "${r.from}" not found — already renamed?`)
    if (await companyIdByName(r.to)) die(`"${r.to}" already exists for this profile; the unique index would reject the rename`)
  }

  console.log("\nWOULD RENAME")
  for (const r of RENAMES) console.log(`  ${r.from}  ->  ${r.to}`)
  console.log(`  application "${APP_RENAME.fromCompany} / ${APP_RENAME.fromTitle}"  ->  "${APP_RENAME.toCompany} / ${APP_RENAME.toTitle}"`)
  console.log("\nWOULD SET tier/status")
  for (const c of COMPANY_FIELDS) console.log(`  ${c.name.padEnd(22)} ${c.tier} / ${c.status}`)
  console.log("\nWOULD CREATE")
  for (const c of CONTACTS) {
    console.log(`  ${(c.first + " " + c.last).padEnd(18)} ${c.company.padEnd(22)} band ${c.band} ${BAND_LABELS[c.band].padEnd(16)} ${c.steps.length} actions`)
    console.log(`  ${"".padEnd(18)} ${c.why}`)
  }
  if (!APPLY) { console.log("\nDRY RUN. Re-run with --apply to write."); return }

  for (const r of RENAMES) {
    const { error } = await s.from("network_companies").update({ name: r.to })
      .eq("client_profile_id", PROFILE_ID).ilike("name", r.from)
    if (error) die(`rename ${r.from} failed: ${error.message}`)
  }
  {
    const { error } = await s.from("signal_applications")
      .update({ company_name: APP_RENAME.toCompany, job_title: APP_RENAME.toTitle })
      .eq("profile_id", PROFILE_ID).eq("company_name", APP_RENAME.fromCompany)
    if (error) die(`application rename failed: ${error.message}`)
  }
  for (const c of COMPANY_FIELDS) {
    const { error } = await s.from("network_companies").update({ tier: c.tier, status: c.status })
      .eq("client_profile_id", PROFILE_ID).ilike("name", c.name)
    if (error) die(`tier/status on ${c.name} failed: ${error.message}`)
  }

  for (const c of CONTACTS) {
    const companyId = await companyIdByName(c.company)
    if (!companyId) die(`company "${c.company}" not found for ${c.first} ${c.last}`)

    // Created BEFORE its first action, so created_at never post-dates history.
    const createdAt = ago(Math.max(...c.steps.map((x) => x.days)) + 2)
    const { data: row, error } = await s.from("network_contacts").insert({
      client_profile_id: PROFILE_ID, company_id: companyId,
      first_name: c.first, last_name: c.last, title: c.title,
      relationship: c.relationship, priority: c.priority,
      stage: "identified",              // every contact starts here; history moves it
      source: SEED_TAG,
      created_at: createdAt.toISOString(),
    }).select("id").single()
    if (error) die(`insert ${c.first} ${c.last} failed: ${error.message}`)

    // Chronological, so each replay sees the state the one before it left.
    for (const step of [...c.steps].sort((a, b) => b.days - a.days)) {
      if (step.kind === "action") await applyAction((row as any).id, step.type, ago(step.days), step.note ?? null)
      else await applyStage((row as any).id, step.stage, ago(step.days))
    }
    console.log(`  seeded ${c.first} ${c.last}`)
  }
  console.log("\nSeeded. Run --verify to check the bands.")
}

// ── Verify (read-only) ─────────────────────────────────────────────────────
async function verify() {
  const { data: rows } = await s.from("network_contacts")
    .select("id, first_name, last_name, stage, next_due_at, next_due_reason, source, network_companies(name)")
    .eq("client_profile_id", PROFILE_ID)
  const all = (rows ?? []) as any[]

  console.log("\nEVERY CONTACT ON THE BOARD (seeded and pre-existing):")
  const byBand = new Map<number, string[]>()
  for (const r of all) {
    const b = bandOf(r)
    const tag = r.source === SEED_TAG ? "seed" : "existing"
    byBand.set(b, [...(byBand.get(b) ?? []),
      `${r.first_name} ${r.last_name} (${r.stage}, ${tag}, ${r.network_companies?.name ?? "standalone"})`])
  }
  let missing = 0
  for (let b = 0; b <= 5; b++) {
    const rowsIn = byBand.get(b) ?? []
    if (rowsIn.length === 0) { missing++; console.log(`  ${b} ${BAND_LABELS[b].padEnd(16)} EMPTY  <<<`) }
    else console.log(`  ${b} ${BAND_LABELS[b].padEnd(16)} ${rowsIn.length}  ${rowsIn.join(", ")}`)
  }

  // Predictions vs reality. A mismatch means the engine did something this file
  // did not expect — which is worth failing over, because the whole point of
  // replaying through it is that it, not this file, decides.
  let wrong = 0
  for (const c of CONTACTS) {
    const r = all.find((x) => x.first_name === c.first && x.last_name === c.last && x.source === SEED_TAG)
    if (!r) { console.log(`  MISSING ${c.first} ${c.last}`); wrong++; continue }
    const got = bandOf(r)
    if (got !== c.band) {
      console.log(`  BAND MISMATCH ${c.first} ${c.last}: predicted ${c.band} (${BAND_LABELS[c.band]}), got ${got} (${BAND_LABELS[got]})`)
      wrong++
    }
  }

  const sofia = all.find((x) => x.first_name === "Sofia" && x.source === SEED_TAG)
  const primed = sofia?.stage === "sequence_active"
  console.log(`\nModel B primer: Sofia Marek stage=${sofia?.stage ?? "(missing)"} ${primed ? "OK" : "<<< expected sequence_active"}`)
  console.log("  Open her, log \"Chat done\", and the offer to move her to \"You talked\" should appear.")
  if (!primed) wrong++

  const { data: cos } = await s.from("network_companies")
    .select("name, tier, status").eq("client_profile_id", PROFILE_ID).order("name")
  console.log("\nCOMPANIES:")
  for (const c of (cos ?? []) as any[]) console.log(`  ${c.name.padEnd(24)} ${c.tier ?? "-"} / ${c.status ?? "-"}`)

  console.log(`\n${missing} empty bands, ${wrong} mismatches.`)
  if (missing || wrong) process.exit(1)
}

// ── Teardown ───────────────────────────────────────────────────────────────
async function teardown() {
  const { data: mine } = await s.from("network_contacts")
    .select("id, first_name, last_name").eq("client_profile_id", PROFILE_ID).eq("source", SEED_TAG)
  const rows = (mine ?? []) as any[]

  console.log(`\nTEARDOWN would delete ${rows.length} contacts matched on source='${SEED_TAG}':`)
  for (const r of rows) console.log(`  ${r.first_name} ${r.last_name}`)
  console.log("  their actions go too — network_actions.contact_id is ON DELETE CASCADE")
  console.log("\nand would restore:")
  for (const r of RENAMES) console.log(`  ${r.to}  ->  ${r.from}`)
  console.log(`  application "${APP_RENAME.toCompany} / ${APP_RENAME.toTitle}"  ->  "${APP_RENAME.fromCompany} / ${APP_RENAME.fromTitle}"`)
  for (const c of COMPANY_FIELDS) console.log(`  ${c.name.padEnd(22)} tier/status -> ${c.wasTier ?? "NULL"} / ${c.wasStatus ?? "NULL"}`)
  console.log("\nNorma Moskowitz, Peter Garry, the applications, runs and interviews are NOT touched.")

  if (!APPLY) { console.log("\nDRY RUN. Re-run with --teardown --apply to undo."); return }

  // Fields first, while the companies still answer to their seeded names.
  for (const c of COMPANY_FIELDS) {
    const { error } = await s.from("network_companies").update({ tier: c.wasTier, status: c.wasStatus })
      .eq("client_profile_id", PROFILE_ID).ilike("name", c.name)
    if (error) die(`restore tier/status on ${c.name} failed: ${error.message}`)
  }
  {
    const { error } = await s.from("signal_applications")
      .update({ company_name: APP_RENAME.fromCompany, job_title: APP_RENAME.fromTitle })
      .eq("profile_id", PROFILE_ID).eq("company_name", APP_RENAME.toCompany)
    if (error) die(`restore application failed: ${error.message}`)
  }
  for (const r of RENAMES) {
    const { error } = await s.from("network_companies").update({ name: r.from })
      .eq("client_profile_id", PROFILE_ID).ilike("name", r.to)
    if (error) die(`restore ${r.to} failed: ${error.message}`)
  }
  if (rows.length) {
    const { error } = await s.from("network_contacts").delete()
      .eq("client_profile_id", PROFILE_ID).eq("source", SEED_TAG)
    if (error) die(`delete failed: ${error.message}`)
  }
  console.log("\nTorn down.")
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    die("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not in the environment — pass --env-file=.env.development.local")
  }
  await guards()
  if (VERIFY) return verify()
  if (TEARDOWN) return teardown()
  return seed()
}

void main()
