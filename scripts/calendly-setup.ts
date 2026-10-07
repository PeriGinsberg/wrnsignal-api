#!/usr/bin/env tsx
// Connect a coach's Calendly to SIGNAL.
//
// 1. Reads the Calendly account the personal access token belongs to, and
//    lists its event types.
// 2. Saves the mapping "this event type means Consult booked, for this coach"
//    (calendly_event_type_actions) in the database SUPABASE_URL points at.
// 3. With --register=<url>, registers Calendly's webhook to that URL, signed
//    with CALENDLY_WEBHOOK_SIGNING_KEY. Production only: dev and staging test
//    with tests/calendly/simulate.ts, so real bookings never reach them.
//
// Nothing is written without --yes; without it, this prints what it would do.
// Credentials come from the environment; this file never reads a .env file and
// never prints a token or key.
//
// USAGE (dev: map the event type to the dev coach, no webhook):
//   node --use-system-ca --env-file=.env.local --env-file=.env.development.local \
//     node_modules/tsx/dist/cli.mjs scripts/calendly-setup.ts \
//     --coach=peri+democoach@workforcereadynow.com --yes
//
// USAGE (prod: map to Peri, and register the webhook):
//   ... scripts/calendly-setup.ts --coach=peri@workforcereadynow.com \
//     --register=https://wrnsignal-api.vercel.app/api/webhooks/calendly --yes
//   with the prod SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.
//
// Options:
//   --url=<scheduling link>  the event type to map (default: CONSULT_CALENDLY_URL,
//                            else https://calendly.com/peri-workforcereadynow/30min)
//   --list                   list the event types and stop
//   --sessions               map the coaching-session event types instead: each
//                            one to the library deliverable it books (Resume
//                            Workshop, Mock Interview...), or to "one-off" for
//                            the WRN Working Session. Prints every pairing,
//                            and the event types it could not pair; saves with
//                            --yes. Never touches the consult mapping.

import { createClient } from "@supabase/supabase-js"
import { consultCalendlyUrl } from "../lib/prospects/bookingForm"

const API = "https://api.calendly.com"
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const flag = (name: string) => process.argv.includes(`--${name}`)
const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase()

type EventType = { uri: string; name: string; scheduling_url: string; active: boolean }
type Page<T> = { collection: T[]; pagination?: { next_page?: string | null } }
type Subscription = { callback_url: string; state: string }

function need(name: string): string {
  const v = process.env[name]
  if (!v) { console.error(`${name} is not set.`); process.exit(1) }
  return v
}

async function calendly<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${need("CALENDLY_ACCESS_TOKEN")}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Calendly ${init.method ?? "GET"} ${path}: ${res.status} ${body?.message ?? ""} ${JSON.stringify(body?.details ?? "")}`)
  return body as T
}

// Which library deliverable each Calendly session books, found by name. Keys
// are matched as substrings of the event type's name with case, spaces and
// punctuation removed; the first entry that matches wins. null = the session
// is in no plan, so it always makes a one-off prep task.
const SESSIONS: { keys: string[]; deliverable: string | null }[] = [
  { keys: ["signaldnaassessment"], deliverable: "Your SIGNAL DNA Assessment" },
  { keys: ["decode"], deliverable: "Your SIGNAL DNA Decode and Career Path Session" },
  { keys: ["resumeworkshop"], deliverable: "Resume Workshop" },
  { keys: ["resumereview", "finalize"], deliverable: "Resume" },
  { keys: ["jobsearchstrategy", "strategynetworking"], deliverable: "SIGNAL Setup and Job Search Strategy" },
  { keys: ["reviewnetworkingplan", "networkingplanreview"], deliverable: "Networking Campaign" },
  { keys: ["preinterviewprep", "preinterview"], deliverable: "Pre-Interview Prep" },
  { keys: ["mockinterview"], deliverable: "Mock Interview" },
  { keys: ["interviewsession"], deliverable: "Interview Sessions 1 to 3" },
  { keys: ["offboarding"], deliverable: "Offboarding" },
  { keys: ["workingsession"], deliverable: null },
]
const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "")

async function mapSessions(types: EventType[], write: boolean) {
  const coachEmail = arg("coach")
  if (!coachEmail) { console.error("Pass --coach=<the coach's SIGNAL email>."); process.exit(1) }
  const db = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } })
  console.log(`\nDatabase: ${new URL(need("SUPABASE_URL")).hostname.split(".")[0]}`)
  const { data: coach, error: coachErr } = await db.from("client_profiles")
    .select("id, email, is_coach").ilike("email", coachEmail.trim()).eq("is_coach", true).maybeSingle()
  if (coachErr) throw new Error(coachErr.message)
  if (!coach) { console.error(`No coach with the email ${coachEmail} in this database.`); process.exit(1) }
  const { data: lib } = await db.from("coach_milestones").select("id, name").eq("coach_profile_id", coach.id).eq("active", true)
  const library = (lib ?? []) as { id: string; name: string }[]
  const { data: mapped } = await db.from("calendly_event_type_actions").select("id, event_type_uri, action")
  const existing = new Map(((mapped ?? []) as { id: string; event_type_uri: string; action: string }[]).map((m) => [m.event_type_uri, m]))

  console.log(`\nSession mapping for ${coach.email}:`)
  const rows: Record<string, unknown>[] = []
  const unpaired: string[] = []
  for (const t of types.filter((x) => x.active)) {
    const was = existing.get(t.uri)
    if (was?.action === "consult_booked") { console.log(`  skip  "${t.name}": it is the consult`); continue }
    const entry = SESSIONS.find((e) => e.keys.some((k) => key(t.name).includes(k)))
    if (!entry) { unpaired.push(t.name); continue }
    const m = entry.deliverable ? library.find((l) => l.name.trim().toLowerCase() === entry.deliverable!.toLowerCase()) : null
    if (entry.deliverable && !m) {
      console.log(`  MISSING  "${t.name}" -> library deliverable "${entry.deliverable}" not found; not saved`)
      continue
    }
    console.log(`  ${was ? "update" : "add   "}  "${t.name}" -> ${m ? `"${m.name}"` : "one-off prep task (no plan deliverable)"}`)
    rows.push({
      coach_profile_id: coach.id, event_type_uri: t.uri, event_type_name: t.name, scheduling_url: t.scheduling_url,
      action: "session_booked", milestone_id: m?.id ?? null, active: true, _id: was?.id ?? null,
    })
  }
  if (unpaired.length) console.log(`\nNot paired (bookings of these stay ignored):\n${unpaired.map((n) => `  "${n}"`).join("\n")}`)
  if (!write) { console.log("\nDry run. Add --yes to save."); return }
  for (const { _id, ...row } of rows) {
    const { error } = _id
      ? await db.from("calendly_event_type_actions").update(row).eq("id", _id as string)
      : await db.from("calendly_event_type_actions").insert(row)
    if (error) throw new Error(`${row.event_type_name}: ${error.message}`)
  }
  console.log(`\nSaved ${rows.length} session mapping(s).`)
}

async function main() {
  const write = flag("yes")
  const me = (await calendly<{ resource: { uri: string; name: string; email: string; current_organization: string } }>("/users/me")).resource
  console.log(`Calendly account: ${me.name} <${me.email}>`)

  const types: EventType[] = []
  let next: string | null = `/event_types?user=${encodeURIComponent(me.uri)}&count=100`
  while (next) {
    const page: Page<EventType> = await calendly<Page<EventType>>(next)
    types.push(...page.collection)
    next = page.pagination?.next_page ?? null
  }
  console.log("\nEvent types:")
  for (const t of types) console.log(`  ${t.active ? " " : "x"} ${t.name}  ${t.scheduling_url}`)
  if (flag("list")) return
  if (flag("sessions")) return mapSessions(types, write)

  const want = arg("url") || consultCalendlyUrl()
  const type = types.find((t) => norm(t.scheduling_url) === norm(want))
  if (!type) { console.error(`\nNo event type has the link ${want}. Use --list to see them.`); process.exit(1) }
  console.log(`\nInitial Consult: "${type.name}" (${type.scheduling_url})`)

  const coachEmail = arg("coach")
  if (!coachEmail) { console.error("Pass --coach=<the coach's SIGNAL email>."); process.exit(1) }
  const db = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } })
  console.log(`Database: ${new URL(need("SUPABASE_URL")).hostname.split(".")[0]}`)
  const { data: coach, error: coachErr } = await db.from("client_profiles")
    .select("id, email, is_coach").ilike("email", coachEmail.trim()).eq("is_coach", true).maybeSingle()
  if (coachErr) throw new Error(coachErr.message)
  if (!coach) { console.error(`No coach with the email ${coachEmail} in this database.`); process.exit(1) }

  const row = {
    coach_profile_id: coach.id, event_type_uri: type.uri, event_type_name: type.name,
    scheduling_url: type.scheduling_url, action: "consult_booked", active: true,
  }
  const { data: existing } = await db.from("calendly_event_type_actions").select("id").eq("event_type_uri", type.uri).maybeSingle()
  console.log(`${existing ? "Update" : "Add"} mapping: "${type.name}" means Consult booked, for ${coach.email}`)
  if (write) {
    const { error } = existing
      ? await db.from("calendly_event_type_actions").update(row).eq("id", existing.id)
      : await db.from("calendly_event_type_actions").insert(row)
    if (error) throw new Error(error.message)
    console.log("  saved")
  }

  const register = arg("register")
  if (!register) {
    console.log(write ? "\nDone. No webhook registered (pass --register=<url> in production)." : "\nDry run. Add --yes to save.")
    return
  }
  const key = need("CALENDLY_WEBHOOK_SIGNING_KEY")
  const org = me.current_organization
  const subs = await calendly<Page<Subscription>>(`/webhook_subscriptions?organization=${encodeURIComponent(org)}&user=${encodeURIComponent(me.uri)}&scope=user&count=100`)
  const same = subs.collection.find((s) => norm(s.callback_url) === norm(register))
  if (same) {
    console.log(`\nWebhook already registered to ${register} (${same.state}). To change its signing key, delete it in Calendly and run this again.`)
    return
  }
  console.log(`\nRegister webhook: invitee.created + invitee.canceled -> ${register}`)
  if (!write) { console.log("Dry run. Add --yes to register."); return }
  await calendly("/webhook_subscriptions", {
    method: "POST",
    body: JSON.stringify({ url: register, events: ["invitee.created", "invitee.canceled"], organization: org, user: me.uri, scope: "user", signing_key: key }),
  })
  console.log("  registered")
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
