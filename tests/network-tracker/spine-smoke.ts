// tests/network-tracker/spine-smoke.ts
// End-to-end smoke of the Network Tracker spine against the DEV database.
// Mints a throwaway dev auth user + client_profile, signs in for a REAL Bearer
// token, then calls the ACTUAL route handlers (through resolveCaller) and asserts.
// Cleans up everything at the end.
//
// Credentials come from the ENVIRONMENT ONLY — this file never reads .env*.
// Export these in your shell first:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Run: npx tsx tests/network-tracker/spine-smoke.ts

import { createClient } from "@supabase/supabase-js"
import fs from "node:fs"

// Accept either name for the URL, but the route handlers' getSupabaseAdmin()
// reads SUPABASE_URL specifically — so normalize it back into process.env below.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""

if (!SUPABASE_URL) throw new Error("ABORT: export SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in your shell")
if (!SERVICE_KEY) throw new Error("ABORT: export SUPABASE_SERVICE_ROLE_KEY in your shell")
if (/ejhnokcnahauvrcbcmic/.test(SUPABASE_URL)) throw new Error("ABORT: that is the PROD project")
if (!/zydrqckpwidipwbhrfgd/.test(SUPABASE_URL)) throw new Error("ABORT: not the dev project")

// The handlers read these at call time, so make sure both are present under the
// exact names getSupabaseAdmin() expects.
process.env.SUPABASE_URL = SUPABASE_URL
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY

let pass = 0
const fails: string[] = []
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ✔", name + (extra !== undefined ? `  (${extra})` : "")) }
  else { fails.push(name); console.log("  ✘", name, extra !== undefined ? ":: " + JSON.stringify(extra) : "") }
}
const mkReq = (path: string, token: string, init: any = {}) =>
  new Request(`http://localhost${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
  }) as any
const P = (o: any) => ({ params: Promise.resolve(o) })
const DAY = 86400000
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString()
const inDays = (v: string) => Math.round((new Date(v).getTime() - Date.now()) / DAY)

// tsx may hand back the module namespace or a CJS-interop wrapper; take either.
async function handler(path: string, name: "GET" | "POST") {
  const m: any = await import(path)
  const fn = m?.[name] ?? m?.default?.[name]
  if (typeof fn !== "function") throw new Error(`could not load ${name} from ${path}`)
  return fn as (req: any, ctx?: any) => Promise<Response>
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const stamp = Date.now()
const email = `nt-smoke-${stamp}@example.com`
const password = `Smoke!${stamp}aB`
let userId = ""
let ownerId = ""

async function main() {
  // ---- provision throwaway user + client_profile, sign in ----
  const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (cu.error) throw cu.error
  userId = cu.data.user!.id
  const cp = await admin.from("client_profiles")
    .insert({ user_id: userId, email, profile_text: "", name: "NT Smoke" }).select("id").single()
  if (cp.error) throw cp.error
  ownerId = cp.data.id
  // The service-role key is a valid apikey for the token endpoint, so no anon key needed.
  const si = await admin.auth.signInWithPassword({ email, password })
  if (si.error) throw si.error
  const token = si.data.session!.access_token
  console.log(`provisioned owner ${ownerId}\n`)

  // ---- seed a company + contact (sequence_active, no due yet) ----
  const co = await admin.from("network_companies")
    .insert({ client_profile_id: ownerId, name: "Acme Corp", tier: "dream" }).select("id").single()
  if (co.error) throw co.error
  const companyId = co.data.id
  const ct = await admin.from("network_contacts").insert({
    client_profile_id: ownerId, company_id: companyId, first_name: "Test", last_name: "Person", stage: "sequence_active",
  }).select("id").single()
  if (ct.error) throw ct.error
  const contactId = ct.data.id

  // ---- import the ACTUAL handlers ----
  const worklist = await handler("@/app/api/network/worklist/route", "GET")
  const companiesGET = await handler("@/app/api/network/companies/route", "GET")
  const contactGET = await handler("@/app/api/network/contacts/[contactId]/route", "GET")
  const logAction = await handler("@/app/api/network/contacts/[contactId]/actions/route", "POST")
  const changeStage = await handler("@/app/api/network/contacts/[contactId]/stage/route", "POST")
  const setReminder = await handler("@/app/api/network/contacts/[contactId]/reminder/route", "POST")
  const patchContact = await handler("@/app/api/network/contacts/[contactId]/route", "PATCH")
  const createContact = await handler("@/app/api/network/contacts/route", "POST")
  const listContacts = await handler("@/app/api/network/contacts/route", "GET")
  const importPreview = await handler("@/app/api/network/import/preview/route", "POST")
  const importCommit = await handler("@/app/api/network/import/commit/route", "POST")
  const deleteContact = await handler("@/app/api/network/contacts/[contactId]/route", "DELETE")
  const batchDelete = await handler("@/app/api/network/contacts/delete/route", "POST")

  console.log("── ROUTE 1  GET /api/network/worklist ──")
  let r = await worklist(mkReq("/api/network/worklist", token))
  let j = await r.json()
  check("worklist starts empty (null next_due_at is not due)", r.status === 200 && j.ok && j.contacts.length === 0, r.status)

  console.log("\n── ROUTE 2  POST .../actions ──")
  r = await logAction(mkReq(`/api/network/contacts/${contactId}/actions`, token, {
    method: "POST", body: JSON.stringify({ type: "touch_2", action_date: "2026-07-01T00:00:00.000Z" }),
  }), P({ contactId }))
  j = await r.json()
  check("logAction -> 201, ladder advances to touch_3", r.status === 201 && j.contact.next_due_reason === "touch_3", r.status)
  check("next_due_at = action_date +5d", j.contact.next_due_at === "2026-07-06T00:00:00+00:00", j.contact.next_due_at)

  console.log("\n── ROUTE 3  POST .../stage ──")
  r = await changeStage(mkReq(`/api/network/contacts/${contactId}/stage`, token, {
    method: "POST", body: JSON.stringify({ stage: "replied" }),
  }), P({ contactId }))
  j = await r.json()
  check("changeStage -> replied, reason 'reply'", r.status === 200 && j.contact.stage === "replied" && j.contact.next_due_reason === "reply", r.status)

  console.log("\n── ROUTE 4  POST .../reminder ──")
  r = await setReminder(mkReq(`/api/network/contacts/${contactId}/reminder`, token, {
    method: "POST", body: JSON.stringify({ reminder_override: "2020-01-01T00:00:00.000Z" }),
  }), P({ contactId }))
  j = await r.json()
  check("reminder override -> reason 'manual'", r.status === 200 && j.contact.next_due_reason === "manual", r.status)
  check("next_due_at = the override date", j.contact.next_due_at === "2020-01-01T00:00:00+00:00", j.contact.next_due_at)

  console.log("\n── ROUTE 1 again  worklist reflects the override ──")
  r = await worklist(mkReq("/api/network/worklist", token))
  j = await r.json()
  check("overdue contact now on the worklist", j.ok && j.contacts.some((c: any) => c.id === contactId), `${j.contacts?.length} row(s)`)

  console.log("\n── ROUTE 5  GET /api/network/companies ──")
  r = await companiesGET(mkReq("/api/network/companies", token))
  j = await r.json()
  const acme = (j.companies || []).find((c: any) => c.id === companyId)
  check("company board -> Acme, contact_count 1", r.status === 200 && acme && acme.contact_count === 1, `count ${acme?.contact_count}`)

  console.log("\n── ROUTE 6  GET /api/network/contacts/[contactId] ──")
  r = await contactGET(mkReq(`/api/network/contacts/${contactId}`, token), P({ contactId }))
  j = await r.json()
  check("contact read -> contact + its action log", r.status === 200 && j.contact.id === contactId && j.actions.length === 1, `${j.actions?.length} action(s)`)

  console.log("\n── the gate ──")
  r = await worklist(mkReq("/api/network/worklist?client_profile_id=3cbd3d45-e10b-4c88-9022-c8d6d415ba7c", token))
  check("foreign board -> 403", r.status === 403, r.status)
  r = await logAction(mkReq("/api/network/contacts/x/actions", token, {
    method: "POST", body: JSON.stringify({ type: "note_logged" }),
  }), P({ contactId: "11111111-1111-4111-8111-111111111111" }))
  check("unknown contact -> 404", r.status === 404, r.status)
  r = await logAction(mkReq(`/api/network/contacts/${contactId}/actions`, token, {
    method: "POST", body: JSON.stringify({ type: "definitely_not_valid" }),
  }), P({ contactId }))
  check("invalid action type -> 400", r.status === 400, r.status)

  // ══════════════════════════════════════════════════════════════════
  // PATH A — snooze, then act. The override is a one-shot deferral.
  // Before the fix this contact was pinned to reason 'manual' with a past
  // date forever: permanently overdue, impossible to work off the worklist.
  // ══════════════════════════════════════════════════════════════════
  console.log("\n══ PATH A  snooze → log an action → override cleared ══")
  {
    // The contact is still carrying the 2020 override from ROUTE 4, and is
    // in stage 'replied' (cadence: reply @ +1d).
    r = await contactGET(mkReq(`/api/network/contacts/${contactId}`, token), P({ contactId }))
    j = await r.json()
    check("precondition: override is set and reason is 'manual'",
      Boolean(j.contact.reminder_override) && j.contact.next_due_reason === "manual", j.contact.next_due_reason)

    r = await logAction(mkReq(`/api/network/contacts/${contactId}/actions`, token, {
      method: "POST", body: JSON.stringify({ type: "note_logged", action_date: new Date().toISOString() }),
    }), P({ contactId }))
    j = await r.json()
    check("action logged -> 201", r.status === 201, r.status)
    check("reminder_override CLEARED", j.contact.reminder_override === null, `override = ${j.contact.reminder_override}`)
    check("reason back on the stage cadence ('reply', not 'manual')", j.contact.next_due_reason === "reply", j.contact.next_due_reason)
    check("next due ≈ +1d (replied/reply interval)", inDays(j.contact.next_due_at) === 1, `+${inDays(j.contact.next_due_at)}d`)

    r = await worklist(mkReq("/api/network/worklist", token))
    j = await r.json()
    check("no longer overdue -> off the worklist", !j.contacts.some((c: any) => c.id === contactId), `${j.contacts.length} row(s) due`)
  }

  // ══════════════════════════════════════════════════════════════════
  // PATH B — re-engagement. Before the fix, moving a dormant contact back
  // to sequence_active re-counted the OLD cycle's touches and flipped it
  // straight back to dormant: a contact could never be worked twice.
  // ══════════════════════════════════════════════════════════════════
  console.log("\n══ PATH B  touch 3 exhausted → dormant_no_answer → re-engage → ladder restarts ══")
  {
    const c2 = await admin.from("network_contacts").insert({
      client_profile_id: ownerId, company_id: companyId,
      first_name: "Sam", last_name: "Ortiz", stage: "sequence_active", last_action_at: ago(12),
    }).select("id").single()
    if (c2.error) throw c2.error
    const samId = c2.data.id
    // One follow-up touch already on the record; the next (touch_3) exhausts the ladder.
    const seed = await admin.from("network_actions").insert([
      { contact_id: samId, type: "touch_1", action_date: ago(20), author_role: "client", author_id: ownerId },
      { contact_id: samId, type: "touch_2", action_date: ago(12), author_role: "client", author_id: ownerId },
    ])
    if (seed.error) throw seed.error

    r = await logAction(mkReq(`/api/network/contacts/${samId}/actions`, token, {
      method: "POST", body: JSON.stringify({ type: "touch_3", action_date: new Date().toISOString() }),
    }), P({ contactId: samId }))
    j = await r.json()
    check("touch_3 logged -> engine flips stage to dormant_no_answer", j.contact.stage === "dormant_no_answer", j.contact.stage)
    check("reason 'resurface_no_answer'", j.contact.next_due_reason === "resurface_no_answer", j.contact.next_due_reason)
    check("resurfaces in ≈35d", inDays(j.contact.next_due_at) === 35, `+${inDays(j.contact.next_due_at)}d`)
    check("dormant_since stamped", Boolean(j.contact.dormant_since), j.contact.dormant_since)

    // The user decides to work this person again.
    r = await changeStage(mkReq(`/api/network/contacts/${samId}/stage`, token, {
      method: "POST", body: JSON.stringify({ stage: "sequence_active" }),
    }), P({ contactId: samId }))
    j = await r.json()
    check("re-engage -> 200, stage sequence_active", r.status === 200 && j.contact.stage === "sequence_active", j.contact.stage)
    check("cycle_started_at STAMPED", Boolean(j.contact.cycle_started_at), j.contact.cycle_started_at)
    check("did NOT flip straight back to dormant", !j.contact.stage.startsWith("dormant"), j.contact.stage)
    check("ladder restarts at touch_2 (old cycle's touches not counted)", j.contact.next_due_reason === "touch_2", j.contact.next_due_reason)
    check("next due ≈ +7d (touch_2 interval)", inDays(j.contact.next_due_at) === 7, `+${inDays(j.contact.next_due_at)}d`)

    // History is scoped out of the count, not destroyed.
    r = await contactGET(mkReq(`/api/network/contacts/${samId}`, token), P({ contactId: samId }))
    j = await r.json()
    check("old cycle's actions preserved in the log", j.actions.length === 3, `${j.actions.length} actions retained`)
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 4 — the contact record's write paths: notes PATCH, clear-reminder,
  // and the stepper's branch / outcome sub-attributes.
  // ══════════════════════════════════════════════════════════════════
  console.log("\n══ PHASE 4  contact-record writes ══")
  {
    // notes PATCH — save, then clear (empty string -> NULL).
    r = await patchContact(mkReq(`/api/network/contacts/${contactId}`, token, {
      method: "PATCH", body: JSON.stringify({ notes: "Met at the alumni mixer." }),
    }), P({ contactId }))
    j = await r.json()
    check("PATCH notes -> 200, persisted", r.status === 200 && j.contact.notes === "Met at the alumni mixer.", j.contact?.notes)
    r = await patchContact(mkReq(`/api/network/contacts/${contactId}`, token, {
      method: "PATCH", body: JSON.stringify({ notes: "   " }),
    }), P({ contactId }))
    j = await r.json()
    check("PATCH blank notes -> NULL", r.status === 200 && j.contact.notes === null, j.contact?.notes)
    r = await patchContact(mkReq(`/api/network/contacts/${contactId}`, token, {
      method: "PATCH", body: JSON.stringify({}),
    }), P({ contactId }))
    check("PATCH with no notes key -> 400", r.status === 400, r.status)

    // clear-reminder — set a snooze via the stepper's route, then clear it (the
    // "Clear reminder" control POSTs reminder_override: null).
    r = await setReminder(mkReq(`/api/network/contacts/${contactId}/reminder`, token, {
      method: "POST", body: JSON.stringify({ reminder_override: "2030-01-01T00:00:00.000Z" }),
    }), P({ contactId }))
    j = await r.json()
    check("precondition: snoozed to a future date", j.contact.next_due_reason === "manual", j.contact?.next_due_reason)
    r = await setReminder(mkReq(`/api/network/contacts/${contactId}/reminder`, token, {
      method: "POST", body: JSON.stringify({ reminder_override: null }),
    }), P({ contactId }))
    j = await r.json()
    check("clear reminder -> override NULL", r.status === 200 && j.contact.reminder_override === null, j.contact?.reminder_override)
    check("clear reminder -> reason folds back to stage cadence (not 'manual')", j.contact.next_due_reason !== "manual", j.contact?.next_due_reason)

    // stepper: the declined case is now its own dormant stage (responded_branch retired).
    r = await changeStage(mkReq(`/api/network/contacts/${contactId}/stage`, token, {
      method: "POST", body: JSON.stringify({ stage: "dormant_declined" }),
    }), P({ contactId }))
    j = await r.json()
    check("stepper: dormant_declined -> resurface_declined", j.contact.stage === "dormant_declined" && j.contact.next_due_reason === "resurface_declined", j.contact?.next_due_reason)
    check("dormant_declined resurfaces in ≈90d", inDays(j.contact.next_due_at) === 90, `+${inDays(j.contact.next_due_at)}d`)
    // outcome_type sub-attribute on the outcome stage.
    r = await changeStage(mkReq(`/api/network/contacts/${contactId}/stage`, token, {
      method: "POST", body: JSON.stringify({ stage: "outcome", outcome_type: "referral" }),
    }), P({ contactId }))
    j = await r.json()
    check("stepper: outcome + referral -> no due (null), leaves worklist", j.contact.outcome_type === "referral" && j.contact.next_due_at === null, `${j.contact?.outcome_type}/${j.contact?.next_due_at}`)

    // PATCH the v3 contact fields (relationship / priority / segment).
    r = await patchContact(mkReq(`/api/network/contacts/${contactId}`, token, {
      method: "PATCH", body: JSON.stringify({ relationship: "referred", priority: "A", segment: "PM alumni" }),
    }), P({ contactId }))
    j = await r.json()
    check("PATCH v3 fields -> persisted", r.status === 200 && j.contact.relationship === "referred" && j.contact.priority === "A" && j.contact.segment === "PM alumni", `${j.contact?.relationship}/${j.contact?.priority}`)
    r = await patchContact(mkReq(`/api/network/contacts/${contactId}`, token, {
      method: "PATCH", body: JSON.stringify({ relationship: "not_a_relationship" }),
    }), P({ contactId }))
    check("PATCH invalid relationship -> 400", r.status === 400, r.status)
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 4.5 — create contact. Optional company (new / existing / none),
  // dedup surfaced as a clean 409, and the identified / no-due invariant.
  // ══════════════════════════════════════════════════════════════════
  console.log("\n══ PHASE 4.5  POST /api/network/contacts ══")
  {
    const dbRow = async (id: string) =>
      (await admin.from("network_contacts").select("stage, next_due_at, next_due_reason, reminder_override").eq("id", id).single()).data

    // 1) create with a NEW company
    r = await createContact(mkReq("/api/network/contacts", token, {
      method: "POST", body: JSON.stringify({ first_name: "Dana", last_name: "Reed", title: "VP Ops", company_name: "Globex" }),
    }))
    j = await r.json()
    check("create w/ new company -> 201", r.status === 201 && j.ok, r.status)
    const danaId = j.contact?.id
    const globexId = j.contact?.company_id
    check("company auto-created + linked", j.contact?.network_companies?.name === "Globex", j.contact?.network_companies?.name)
    let row = await dbRow(danaId)
    check("starts identified", row.stage === "identified", row.stage)
    check("no due date (poke off)", row.next_due_at === null && row.next_due_reason === null, `${row.next_due_at}/${row.next_due_reason}`)
    check("no reminder", row.reminder_override === null, row.reminder_override)

    // 2) standalone contact (no company) is first-class
    r = await createContact(mkReq("/api/network/contacts", token, {
      method: "POST", body: JSON.stringify({ first_name: "Riley", last_name: "Nolan" }),
    }))
    j = await r.json()
    check("standalone create -> 201, company_id null", r.status === 201 && j.contact?.company_id === null, j.contact?.company_id)

    // 3) existing company reused case-insensitively ('globex' == 'Globex'), no 2nd company row
    r = await createContact(mkReq("/api/network/contacts", token, {
      method: "POST", body: JSON.stringify({ first_name: "Sam", last_name: "Ortiz", company_name: "globex" }),
    }))
    j = await r.json()
    check("existing company reused case-insensitively", r.status === 201 && j.contact?.company_id === globexId, `${j.contact?.company_id} vs ${globexId}`)
    const globexCount = (await admin.from("network_companies").select("id").eq("client_profile_id", ownerId).ilike("name", "globex")).data?.length
    check("no duplicate company row created", globexCount === 1, `${globexCount} Globex row(s)`)

    // 4) duplicate at the same company -> clean 409, not a raw PG error
    r = await createContact(mkReq("/api/network/contacts", token, {
      method: "POST", body: JSON.stringify({ first_name: "Dana", last_name: "Reed", company_name: "Globex" }),
    }))
    j = await r.json()
    check("duplicate at same company -> 409", r.status === 409, r.status)
    check("409 message is human, names the contact + company", /already have a contact named Dana Reed at Globex/.test(j.error || ""), j.error)

    // 5) SAME name at a DIFFERENT company is allowed (dedup is company-scoped)
    r = await createContact(mkReq("/api/network/contacts", token, {
      method: "POST", body: JSON.stringify({ first_name: "Dana", last_name: "Reed", company_name: "Initech" }),
    }))
    check("same name at a different company -> 201", r.status === 201, r.status)

    // 6) duplicate standalone -> 409 (partial index fires on NULL company)
    r = await createContact(mkReq("/api/network/contacts", token, {
      method: "POST", body: JSON.stringify({ first_name: "Riley", last_name: "Nolan" }),
    }))
    j = await r.json()
    check("duplicate standalone -> 409", r.status === 409, r.status)
    check("409 message names the standalone contact", /already have a contact named Riley Nolan\./.test(j.error || ""), j.error)

    // 7) body CANNOT set stage / dates / reminders — they are ignored
    r = await createContact(mkReq("/api/network/contacts", token, {
      method: "POST", body: JSON.stringify({
        first_name: "Mallory", last_name: "Quist",
        stage: "outcome", next_due_at: "2020-01-01T00:00:00.000Z", reminder_override: "2020-01-01T00:00:00.000Z",
      }),
    }))
    j = await r.json()
    row = await dbRow(j.contact?.id)
    check("injected stage ignored -> identified", row.stage === "identified", row.stage)
    check("injected due/reminder ignored -> null", row.next_due_at === null && row.reminder_override === null, `${row.next_due_at}/${row.reminder_override}`)

    // 9) v3 fields accepted on create, and validated
    r = await createContact(mkReq("/api/network/contacts", token, {
      method: "POST", body: JSON.stringify({ first_name: "Vera", last_name: "Lin", relationship: "affinity", priority: "B", segment: "NYU" }),
    }))
    j = await r.json()
    check("create accepts relationship/priority", r.status === 201 && j.contact?.relationship === "affinity" && j.contact?.priority === "B", `${j.contact?.relationship}/${j.contact?.priority}`)
    r = await createContact(mkReq("/api/network/contacts", token, {
      method: "POST", body: JSON.stringify({ first_name: "Bad", last_name: "Rel", relationship: "nope" }),
    }))
    check("create invalid relationship -> 400", r.status === 400, r.status)

    // 8) missing name -> 400
    r = await createContact(mkReq("/api/network/contacts", token, {
      method: "POST", body: JSON.stringify({ first_name: "", last_name: "Nameless" }),
    }))
    check("missing first name -> 400", r.status === 400, r.status)
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 5a — GET /api/network/contacts (the roster). Standalone included,
  // no due-gating, sort = no-activity-first then most-recently-active, filters.
  // ══════════════════════════════════════════════════════════════════
  console.log("\n══ PHASE 5a  GET /api/network/contacts (roster) ══")
  {
    // A company for the company-attached planted contact.
    const rc = await admin.from("network_companies")
      .insert({ client_profile_id: ownerId, name: "Roster Co" }).select("id").single()
    if (rc.error) throw rc.error
    const rosterCoId = rc.data.id

    // Plant deterministic rows: three standalone with known activity times, one
    // company-attached. last_action_at drives the sort; stage drives the filter.
    const plant = await admin.from("network_contacts").insert([
      { client_profile_id: ownerId, first_name: "Zed", last_name: "Nullson", stage: "identified", last_action_at: null },
      { client_profile_id: ownerId, first_name: "Amy", last_name: "Freshly", stage: "identified", last_action_at: ago(1) },
      { client_profile_id: ownerId, first_name: "Bob", last_name: "Staleman", stage: "identified", last_action_at: ago(30) },
      { client_profile_id: ownerId, first_name: "Cara", last_name: "Cohen", stage: "sequence_active", last_action_at: ago(5), company_id: rosterCoId },
    ]).select("id, first_name")
    if (plant.error) throw plant.error
    const id = (n: string) => plant.data.find((c) => c.first_name === n)!.id
    const [zed, amy, bob, cara] = [id("Zed"), id("Amy"), id("Bob"), id("Cara")]

    // full roster
    r = await listContacts(mkReq("/api/network/contacts", token))
    j = await r.json()
    check("list -> 200 + ok", r.status === 200 && j.ok, r.status)
    const ids: string[] = (j.contacts ?? []).map((c: any) => c.id)
    check("roster includes standalone + company-attached", [zed, amy, bob, cara].every((x) => ids.includes(x)), `${ids.length} total`)

    // sort: nulls-first globally, then most-recently-active
    check("first row has no activity (nulls-first, not nulls-last)", j.contacts[0]?.last_action_at === null, j.contacts[0]?.last_action_at)
    const pos = (x: string) => ids.indexOf(x)
    check("sort: no-activity (Zed) before recent (Amy)", pos(zed) < pos(amy), `${pos(zed)} < ${pos(amy)}`)
    check("sort: more-recent (Amy) before less-recent (Cara)", pos(amy) < pos(cara), `${pos(amy)} < ${pos(cara)}`)
    check("sort: less-recent (Cara) before oldest (Bob)", pos(cara) < pos(bob), `${pos(cara)} < ${pos(bob)}`)

    // standalone filter
    r = await listContacts(mkReq("/api/network/contacts?standalone=1", token))
    j = await r.json()
    const sIds: string[] = j.contacts.map((c: any) => c.id)
    check("standalone filter: includes standalone, excludes company-attached", sIds.includes(zed) && !sIds.includes(cara), `${sIds.length} standalone`)
    check("standalone rows really have null company_id", j.contacts.every((c: any) => c.company_id === null))

    // company filter
    r = await listContacts(mkReq(`/api/network/contacts?company_id=${rosterCoId}`, token))
    j = await r.json()
    const cIds: string[] = j.contacts.map((c: any) => c.id)
    check("company filter: includes attached, excludes standalone", cIds.includes(cara) && !cIds.includes(zed), `${cIds.length} at Roster Co`)

    // stage filter
    r = await listContacts(mkReq("/api/network/contacts?stage=sequence_active", token))
    j = await r.json()
    const stIds: string[] = j.contacts.map((c: any) => c.id)
    check("stage filter sequence_active: includes Cara, excludes identified Zed", stIds.includes(cara) && !stIds.includes(zed), `${stIds.length} sequence_active`)

    // invalid stage + gate
    r = await listContacts(mkReq("/api/network/contacts?stage=bogus", token))
    check("invalid stage filter -> 400", r.status === 400, r.status)
    r = await listContacts(mkReq("/api/network/contacts?client_profile_id=3cbd3d45-e10b-4c88-9022-c8d6d415ba7c", token))
    check("foreign board -> 403", r.status === 403, r.status)
  }

  // ══════════════════════════════════════════════════════════════════
  // MIGRATION 3 — first_touch_at / first_replied_at / first_chat_at:
  // stamped ONCE on the first time each milestone is reached, never recomputed.
  // ══════════════════════════════════════════════════════════════════
  console.log("\n══ MIGRATION 3  first-reached milestones ══")
  {
    const mk = async (first: string, last: string) =>
      (await admin.from("network_contacts").insert({ client_profile_id: ownerId, first_name: first, last_name: last, stage: "identified" }).select("id").single()).data!.id

    // (a) stage path: sequence_active → replied → chat_scheduled stamp each once
    const aId = await mk("Milestone", "Stage")
    r = await changeStage(mkReq(`/api/network/contacts/${aId}/stage`, token, { method: "POST", body: JSON.stringify({ stage: "sequence_active" }) }), P({ contactId: aId }))
    j = await r.json()
    check("entering sequence_active stamps first_touch_at", Boolean(j.contact.first_touch_at), j.contact.first_touch_at)
    check("first_replied_at still null", j.contact.first_replied_at === null, j.contact.first_replied_at)
    const touchStamp = j.contact.first_touch_at

    r = await changeStage(mkReq(`/api/network/contacts/${aId}/stage`, token, { method: "POST", body: JSON.stringify({ stage: "replied" }) }), P({ contactId: aId }))
    j = await r.json()
    check("entering replied stamps first_replied_at", Boolean(j.contact.first_replied_at), j.contact.first_replied_at)
    check("first_touch_at unchanged (set-once)", j.contact.first_touch_at === touchStamp, `${j.contact.first_touch_at} vs ${touchStamp}`)
    const repliedStamp = j.contact.first_replied_at

    r = await changeStage(mkReq(`/api/network/contacts/${aId}/stage`, token, { method: "POST", body: JSON.stringify({ stage: "chat_scheduled" }) }), P({ contactId: aId }))
    j = await r.json()
    check("entering chat_scheduled stamps first_chat_at", Boolean(j.contact.first_chat_at), j.contact.first_chat_at)

    // (b) never recomputed: move back to replied — first_replied_at stands
    r = await changeStage(mkReq(`/api/network/contacts/${aId}/stage`, token, { method: "POST", body: JSON.stringify({ stage: "replied" }) }), P({ contactId: aId }))
    j = await r.json()
    check("re-entering replied does NOT recompute first_replied_at", j.contact.first_replied_at === repliedStamp, `${j.contact.first_replied_at} vs ${repliedStamp}`)

    // (c) action path: a touch_1 log stamps first_touch_at from its action_date
    const bId = await mk("Milestone", "Touch")
    const backdated = ago(3)
    r = await logAction(mkReq(`/api/network/contacts/${bId}/actions`, token, { method: "POST", body: JSON.stringify({ type: "touch_1", action_date: backdated }) }), P({ contactId: bId }))
    j = await r.json()
    check("touch_1 log stamps first_touch_at from action_date", j.contact.first_touch_at === backdated, `${j.contact.first_touch_at} vs ${backdated}`)
    // a later touch does not move it
    r = await logAction(mkReq(`/api/network/contacts/${bId}/actions`, token, { method: "POST", body: JSON.stringify({ type: "touch_2", action_date: new Date().toISOString() }) }), P({ contactId: bId }))
    j = await r.json()
    check("later touch does NOT recompute first_touch_at", j.contact.first_touch_at === backdated, j.contact.first_touch_at)
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 6 — CSV import: preview (header detection + mapping guess) and commit
  // (name split, dedup, non-person flag, bad-email → system note).
  // ══════════════════════════════════════════════════════════════════
  console.log("\n══ PHASE 6  CSV import ══")
  {
    // Headers on ROW 3 (title + instruction sentence above), a combined Name
    // column, an intra-batch duplicate, a non-person, a no-name row, a bad email.
    const csv = [
      "Boston soft-IP hit list,,,",
      "Please reach out to each of the following contacts before Friday close.,,,",
      "Name,Firm,Title,Email",
      "Dr. Zelda Quimby,ImpCoA,Partner,zelda@impcoa.com",
      "Zelda Quimby,ImpCoA,Partner,dupe@impcoa.com",
      "Marvin O. Rutherford,ImpCoB,Counsel,use firm form / 555-9999",
      "Trademark Committee,ImpCoC,,team@impcoc.com",
      ",ImpCoD,No name,x@y.com",
      "Delphine V. Achterberg,,Advisor,delphine@example.com",
    ].join("\n")
    const mkForm = (fields: Record<string, string>) => {
      const fd = new FormData()
      fd.append("file", new File([csv], "list.csv", { type: "text/csv" }))
      for (const [k, v] of Object.entries(fields)) fd.append(k, v)
      return new Request("http://localhost/api/network/import", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd }) as any
    }

    // preview
    r = await importPreview(mkForm({}))
    j = await r.json()
    check("preview -> 200", r.status === 200 && j.ok, r.status)
    check("header row detected as row 3 (index 2)", j.headerRow === 2, `index ${j.headerRow}`)
    check("headers parsed", JSON.stringify(j.headers) === JSON.stringify(["Name", "Firm", "Title", "Email"]), JSON.stringify(j.headers))
    check("mapping guessed: Name→name, Firm→company, Title→title, Email→email",
      JSON.stringify(j.guessedMapping) === JSON.stringify(["name", "company", "title", "email"]), JSON.stringify(j.guessedMapping))
    check("6 data rows counted", j.totalRows === 6, j.totalRows)

    // commit with the guessed mapping
    r = await importCommit(mkForm({ sheet: "CSV", headerRow: "2", mapping: JSON.stringify(["name", "company", "title", "email"]) }))
    j = await r.json()
    check("commit -> 200", r.status === 200 && j.ok, r.status)
    check("imported 4 (dup + no-name skipped)", j.imported === 4, j.imported)
    check("3 new companies (ImpCoD not created — its row had no name)", j.newCompanies === 3, j.newCompanies)
    check("1 duplicate skipped, named", j.skippedDuplicates.length === 1 && /Zelda Quimby/.test(j.skippedDuplicates[0]), JSON.stringify(j.skippedDuplicates))
    check("1 skipped for no name", j.skippedNoName.length === 1, JSON.stringify(j.skippedNoName))
    check("1 non-person name flagged", j.flagged.nonPersonNames === 1, j.flagged.nonPersonNames)
    check("1 unparseable email flagged", j.flagged.unparseableEmails === 1, j.flagged.unparseableEmails)

    // the bad-email row kept its text as a dated system note (§6/§8)
    const marv = (await admin.from("network_contacts").select("id, email").eq("client_profile_id", ownerId).eq("first_name", "Marvin O.").eq("last_name", "Rutherford").maybeSingle()).data
    check("bad-email contact has null email", marv && marv.email === null, marv?.email)
    const sysNote = (await admin.from("network_actions").select("note, author_role, type").eq("contact_id", marv!.id).eq("author_role", "system")).data
    check("contact-method saved as a system note_logged", (sysNote?.length ?? 0) === 1 && /555-9999/.test(sysNote![0].note), JSON.stringify(sysNote))

    // the split stripped the title and the standalone landed with null company
    const zelda = (await admin.from("network_contacts").select("first_name, last_name, source").eq("client_profile_id", ownerId).eq("last_name", "Quimby").maybeSingle()).data
    check("title stripped on import (Dr. Zelda Quimby -> Zelda)", zelda?.first_name === "Zelda", zelda?.first_name)
    check("imported rows tagged source=import", zelda?.source === "import", zelda?.source)
    const delphine = (await admin.from("network_contacts").select("company_id").eq("client_profile_id", ownerId).eq("last_name", "Achterberg").maybeSingle()).data
    check("blank-company row is standalone", delphine && delphine.company_id === null, delphine?.company_id)

    // Regression: the real client XLSX exceljs couldn't read (git-ignored fixture;
    // skipped when absent). Drives the preview route with the actual file bytes.
    const MALERI = "network-import-fixtures/maleri.xlsx"
    if (fs.existsSync(MALERI)) {
      const fd = new FormData()
      fd.append("file", new File([fs.readFileSync(MALERI)], "maleri.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
      const rq = new Request("http://localhost/api/network/import/preview", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd }) as any
      r = await importPreview(rq)
      j = await r.json()
      check("maleri.xlsx preview -> 200 (read-excel-file parses prefixed-namespace file)", r.status === 200 && j.ok, r.status)
      check("maleri header detected on row 4 (index 3)", j.headerRow === 3, `index ${j.headerRow}`)
      check("maleri 48 data rows", j.totalRows === 48, j.totalRows)
      check("maleri first header is 'Outreach Rank'", j.headers?.[0] === "Outreach Rank", j.headers?.[0])
    } else {
      console.log("   (maleri.xlsx fixture absent — regression check skipped)")
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 7 — delete: single (with cascade), batch, owner-only, cap.
  // ══════════════════════════════════════════════════════════════════
  console.log("\n══ PHASE 7  delete ══")
  {
    // (a) single delete cascades actions AND comments — nothing orphaned.
    r = await createContact(mkReq("/api/network/contacts", token, {
      method: "POST", body: JSON.stringify({ first_name: "Cascade", last_name: "Target" }),
    }))
    j = await r.json()
    const cid = j.contact.id
    await logAction(mkReq(`/api/network/contacts/${cid}/actions`, token, {
      method: "POST", body: JSON.stringify({ type: "note_logged", note: "will vanish" }),
    }), P({ contactId: cid }))
    await admin.from("network_comments").insert({ contact_id: cid, client_profile_id: ownerId, author_role: "client", body: "also vanishes", visibility: "private" })
    const actBefore = (await admin.from("network_actions").select("id").eq("contact_id", cid)).data?.length ?? 0
    const comBefore = (await admin.from("network_comments").select("id").eq("contact_id", cid)).data?.length ?? 0
    check("precondition: contact has an action + a comment", actBefore >= 1 && comBefore >= 1, `${actBefore} act, ${comBefore} com`)

    r = await deleteContact(mkReq(`/api/network/contacts/${cid}`, token, { method: "DELETE" }), P({ contactId: cid }))
    j = await r.json()
    check("single delete -> 200", r.status === 200 && j.ok && j.deleted === 1, r.status)
    const gone = (await admin.from("network_contacts").select("id").eq("id", cid)).data?.length ?? 0
    const actAfter = (await admin.from("network_actions").select("id").eq("contact_id", cid)).data?.length ?? 0
    const comAfter = (await admin.from("network_comments").select("id").eq("contact_id", cid)).data?.length ?? 0
    check("contact + its actions + its comments all gone (not orphaned)", gone === 0 && actAfter === 0 && comAfter === 0, `contact ${gone}, act ${actAfter}, com ${comAfter}`)

    // (b) batch delete
    const mk = async (fn: string) => (await admin.from("network_contacts").insert({ client_profile_id: ownerId, first_name: fn, last_name: "Batch" }).select("id").single()).data!.id
    const b1 = await mk("Bee1"), b2 = await mk("Bee2"), b3 = await mk("Bee3")
    r = await batchDelete(mkReq("/api/network/contacts/delete", token, { method: "POST", body: JSON.stringify({ ids: [b1, b2, b3] }) }))
    j = await r.json()
    check("batch delete -> 200, deleted 3", r.status === 200 && j.deleted === 3, `${r.status}/${j.deleted}`)
    check("all three gone", ((await admin.from("network_contacts").select("id").in("id", [b1, b2, b3])).data?.length ?? -1) === 0)

    // (c) cap
    r = await batchDelete(mkReq("/api/network/contacts/delete", token, { method: "POST", body: JSON.stringify({ ids: Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`) }) }))
    check("batch over cap -> 400", r.status === 400, r.status)
    r = await batchDelete(mkReq("/api/network/contacts/delete", token, { method: "POST", body: JSON.stringify({ ids: [] }) }))
    check("empty batch -> 400", r.status === 400, r.status)

    // (d) owner-only: a foreign board's contact can't be deleted, single or batch.
    const foreignProfile = (await admin.from("client_profiles").insert({ email: `nt-foreign-${stamp}@example.com`, profile_text: "", name: "Foreign" }).select("id").single()).data!.id
    const foreignContact = (await admin.from("network_contacts").insert({ client_profile_id: foreignProfile, first_name: "Not", last_name: "Yours" }).select("id").single()).data!.id
    r = await deleteContact(mkReq(`/api/network/contacts/${foreignContact}`, token, { method: "DELETE" }), P({ contactId: foreignContact }))
    check("single delete of a foreign contact -> 403", r.status === 403, r.status)
    r = await batchDelete(mkReq("/api/network/contacts/delete", token, { method: "POST", body: JSON.stringify({ ids: [foreignContact] }) }))
    j = await r.json()
    check("batch delete scoped to owner: foreign id deletes 0", r.status === 200 && j.deleted === 0, `${r.status}/${j.deleted}`)
    check("foreign contact still exists", ((await admin.from("network_contacts").select("id").eq("id", foreignContact)).data?.length ?? 0) === 1)
    // cleanup the foreign board
    await admin.from("network_contacts").delete().eq("client_profile_id", foreignProfile)
    await admin.from("client_profiles").delete().eq("id", foreignProfile)
  }
}

main()
  .then(() => {
    if (fails.length) { console.error(`\n✘ FAILED — ${pass} passed, ${fails.length} failed`); process.exitCode = 1 }
    else console.log(`\n✔ ALL PASSED (${pass} checks)`)
  })
  .catch((e) => { console.error("\n" + (e?.stack || e?.message || e)); process.exitCode = 1 })
  .finally(async () => {
    if (ownerId) {
      await admin.from("network_contacts").delete().eq("client_profile_id", ownerId)
      await admin.from("network_companies").delete().eq("client_profile_id", ownerId)
      await admin.from("client_profiles").delete().eq("id", ownerId)
    }
    if (userId) await admin.auth.admin.deleteUser(userId)
    console.log("cleaned up")
  })
