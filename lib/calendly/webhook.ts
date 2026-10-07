// lib/calendly/webhook.ts
//
// What a Calendly booking or cancellation does in SIGNAL.
//
// WHICH BOOKINGS COUNT is data, not code: calendly_event_type_actions maps a
// Calendly event type, for one coach, to an action. Today there is one action,
// consult_booked (Peri's Initial Consult). Another meeting type is a new row,
// plus a new entry in ACTIONS below if it should do something different.
//
// EVERY DELIVERY IS HANDLED ONCE. Calendly retries until it gets a 2xx, so each
// (event, invitee) is written to calendly_webhook_deliveries before it is acted
// on, and a second arrival is answered "duplicate". A delivery that fails is
// removed again and answered 500, so Calendly's retry gets a clean second try.
//
// A RESCHEDULE ARRIVES AS TWO DELIVERIES: the old booking is cancelled (with
// rescheduled: true) and a new one is created (with old_invitee pointing back).
// The cancel half does nothing; the new half moves the consult and its prep
// task, which keeps a reschedule from reading as a cancellation.

import { createHmac, timingSafeEqual } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { logProspectEvent } from "../prospects/history"
import { advanceIfPresent } from "../prospects/stages"
import { bookConsult, cancelConsult, reopenProspect } from "../prospects/workflow"
import { sendConsultBookedEmail, type ConsultBookedEmail } from "../email/sendConsultBookedEmail"
import { bookSessionTasks, cancelSessionTasks, moveSessionPrep } from "../plan/service"
import { planLink } from "../plan/todo"
import { createTask, setTaskStatus, updateTask } from "../tasks/service"
import { dayToDueAt } from "../prospects/workflow"

export const SIGNATURE_HEADER = "calendly-webhook-signature"
/** How old a signed delivery may be. Calendly's own guidance is a few minutes. */
export const SIGNATURE_TOLERANCE_SEC = 5 * 60

/** The coach's calendar day for a booking. Peri works in Eastern time. */
export function coachTimezone(): string {
  return process.env.COACH_TIMEZONE || "America/New_York"
}

/**
 * When a session's Prepare task is due: the day before the session, or today
 * when the session is today or tomorrow (or somehow already past).
 */
export function prepDueDay(sessionDay: string, today: string): string {
  const d = new Date(`${sessionDay}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  const before = d.toISOString().slice(0, 10)
  return before < today ? today : before
}

// ── Signatures ───────────────────────────────────────────────────────────────

/** The header Calendly sends: t=<unix seconds>,v1=<hex HMAC of "t.body">. */
export function signCalendly(rawBody: string, key: string, unixSeconds: number): string {
  const v1 = createHmac("sha256", key).update(`${unixSeconds}.${rawBody}`).digest("hex")
  return `t=${unixSeconds},v1=${v1}`
}

export function verifyCalendlySignature(
  rawBody: string,
  header: string | null,
  key: string,
  nowMs = Date.now(),
): boolean {
  if (!header || !key) return false
  const parts = Object.fromEntries(header.split(",").map((kv) => {
    const i = kv.indexOf("=")
    return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()]
  }))
  const t = Number(parts.t)
  if (!Number.isFinite(t) || !parts.v1) return false
  if (Math.abs(nowMs / 1000 - t) > SIGNATURE_TOLERANCE_SEC) return false
  const expected = createHmac("sha256", key).update(`${t}.${rawBody}`).digest("hex")
  const a = Buffer.from(expected, "hex")
  const b = Buffer.from(String(parts.v1), "hex")
  return a.length === b.length && timingSafeEqual(a, b)
}

// ── Dates ────────────────────────────────────────────────────────────────────

/** YYYY-MM-DD of an instant, in a timezone. */
export function dayInZone(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso))
}

/** "Thu, Oct 9, 2:00 PM EDT", for History. */
export function timeLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(iso))
}

// ── The payload ──────────────────────────────────────────────────────────────

export type CalendlyWebhook = {
  event: "invitee.created" | "invitee.canceled" | string
  payload: {
    uri: string
    email: string
    name?: string | null
    first_name?: string | null
    last_name?: string | null
    text_reminder_number?: string | null
    rescheduled?: boolean
    old_invitee?: string | null
    new_invitee?: string | null
    cancellation?: { canceled_by?: string | null; reason?: string | null; canceler_type?: string | null } | null
    questions_and_answers?: { question?: string | null; answer?: string | null }[] | null
    scheduled_event: {
      uri: string
      name?: string | null
      start_time: string
      event_type: string
    }
  }
}

export type CalendlyAction = "consult_booked" | "session_booked"

export type HandleResult = {
  status: number
  outcome: string
  coach_client_id?: string | null
  detail?: string
}

export type NotifyCoach = (to: string, e: ConsultBookedEmail) => Promise<{ ok: boolean; error?: string }>
type Mapping = { coach_profile_id: string; action: string; event_type_name: string | null; milestone_id: string | null }
type Ctx = { db: SupabaseClient; coachId: string; body: CalendlyWebhook; tz: string; now: Date; notify: NotifyCoach; mapping: Mapping }
type Touched = { book_task_id?: string | null; prep_task_id?: string | null; todo_task_id?: string | null }
type Step = { outcome: string; coach_client_id?: string | null; detail?: string; touched?: Touched }

/** What each mapped action does on a booking and on a cancellation. */
const ACTIONS: Record<CalendlyAction, { created: (c: Ctx) => Promise<Step>; canceled: (c: Ctx) => Promise<Step> }> = {
  consult_booked: { created: consultBooked, canceled: consultCanceled },
  session_booked: { created: sessionBooked, canceled: sessionCanceled },
}

// ── Finding the prospect ─────────────────────────────────────────────────────

type RecordRow = { id: string; name: string | null; lifecycle_status: string; prospect_status: string | null; invited_at: string | null }

/**
 * The record in this coach's practice for the person who booked: the student's
 * own email first, then a parent's (a parent who filled in the form books the
 * call under their own address). An open prospect beats a client, then newest.
 */
export async function findRecordByEmail(db: SupabaseClient, coachId: string, email: string): Promise<RecordRow | null> {
  const e = email.trim().toLowerCase()
  if (!e) return null
  for (const col of ["invited_email", "parent_email"] as const) {
    const { data, error } = await db.from("coach_clients")
      .select(`id, name, lifecycle_status, prospect_status, invited_at, ${col}`)
      .eq("coach_profile_id", coachId).eq("status", "active").ilike(col, e)
    if (error) throw new Error(`Failed to look up ${col}: ${error.message}`)
    const rows = ((data ?? []) as unknown as (RecordRow & Record<string, string | null>)[])
      .filter((r) => (r[col] ?? "").toLowerCase() === e)
      .sort((a, b) =>
        Number(b.lifecycle_status === "Prospect") - Number(a.lifecycle_status === "Prospect")
        || ((a.invited_at ?? "") < (b.invited_at ?? "") ? 1 : -1))
    if (rows[0]) return rows[0]
  }
  return null
}

/** The record an earlier booking by this invitee landed on. */
async function recordForInvitee(db: SupabaseClient, inviteeUri: string | null | undefined): Promise<string | null> {
  if (!inviteeUri) return null
  const { data } = await db.from("calendly_webhook_deliveries").select("coach_client_id")
    .eq("event", "invitee.created").eq("invitee_uri", inviteeUri).limit(1)
  return ((data ?? [])[0] as { coach_client_id: string | null } | undefined)?.coach_client_id ?? null
}

async function loadRecord(db: SupabaseClient, id: string): Promise<RecordRow | null> {
  const { data } = await db.from("coach_clients")
    .select("id, name, lifecycle_status, prospect_status, invited_at").eq("id", id).maybeSingle()
  return (data as RecordRow | null) ?? null
}

function bookerName(p: CalendlyWebhook["payload"]): string {
  return (p.name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email).slice(0, 200)
}

/** No record for this person yet: they booked straight from the Calendly link. */
async function createFromBooking(c: Ctx): Promise<RecordRow> {
  const p = c.body.payload
  const name = bookerName(p)
  const { data, error } = await c.db.from("coach_clients").insert({
    coach_profile_id: c.coachId,
    created_by: null,
    client_profile_id: null,
    status: "active",
    access_level: "full",
    lifecycle_status: "Prospect",
    prospect_status: "active",
    name,
    invited_email: p.email.trim().toLowerCase(),
    phone: p.text_reminder_number?.trim() || null,
    source_category: "other",
    source_detail: "Booked directly on Calendly",
  }).select("id, name, lifecycle_status, prospect_status, invited_at").single()
  if (error || !data) throw new Error(`Could not create the prospect: ${error?.message ?? "no row"}`)
  const row = data as RecordRow
  await logProspectEvent(c.db, {
    coachClientId: row.id, eventType: "prospect_created", actor: null,
    context: { name, source_category: "other", source_detail: "Booked directly on Calendly", via: "calendly" },
  })
  await advanceIfPresent(c.db, { coachClientId: row.id, actingIds: [c.coachId], stageKey: "lead_identified", actor: null })
  return row
}

// ── consult_booked ───────────────────────────────────────────────────────────

async function consultBooked(c: Ctx): Promise<Step> {
  const p = c.body.payload
  const start = p.scheduled_event.start_time
  const isReschedule = !!p.old_invitee

  // A reschedule belongs to the record the original booking landed on, even
  // if the person used a different email the second time.
  const priorId = isReschedule ? await recordForInvitee(c.db, p.old_invitee) : null
  let record = priorId ? await loadRecord(c.db, priorId) : null
  let created = false
  if (!record) record = await findRecordByEmail(c.db, c.coachId, p.email)
  if (!record) { record = await createFromBooking(c); created = true }

  if (record.lifecycle_status !== "Prospect") {
    return { outcome: "not_a_prospect", coach_client_id: record.id, detail: `record is ${record.lifecycle_status}` }
  }
  if (record.prospect_status === "lost") {
    const r = await reopenProspect(c.db, { coachClientId: record.id, actor: null })
    if (!r.ok) return { outcome: "error", coach_client_id: record.id, detail: r.error }
  }

  const r = await bookConsult(c.db, {
    coachClientId: record.id,
    actingIds: [c.coachId],
    day: dayInZone(start, c.tz),
    actor: null,
    assignee: c.coachId,
    history: {
      via: "calendly",
      time_label: timeLabel(start, c.tz),
      booked_by: p.email,
      ...(isReschedule ? { rescheduled: true } : {}),
    },
  })
  if (!r.ok) return { outcome: "error", coach_client_id: record.id, detail: r.error }

  // A new booking emails the coach; a reschedule does not.
  const emailNote = isReschedule ? null : await emailCoach(c, record, created)
  return {
    outcome: isReschedule ? "rescheduled" : created ? "booked_new_prospect" : "booked",
    coach_client_id: record.id,
    ...(emailNote ? { detail: emailNote } : {}),
  }
}

/**
 * "A new consult has been booked", with the time and what they told us. Never
 * fails the booking: the consult is recorded whether or not the email goes,
 * and a failure is noted on the delivery row.
 */
async function emailCoach(c: Ctx, record: RecordRow, created: boolean): Promise<string | null> {
  try {
    const p = c.body.payload
    const { data: coach } = await c.db.from("client_profiles").select("email").eq("id", c.coachId).maybeSingle()
    const to = (coach as { email: string | null } | null)?.email
    if (!to) return "email not sent: coach has no email"
    const { data: forms } = await c.db.from("coach_client_events").select("context, created_at")
      .eq("coach_client_id", record.id).eq("event_type", "booking_form_submitted")
      .order("created_at", { ascending: false }).limit(1)
    const answers = ((forms ?? [])[0] as { context?: { answers?: Record<string, unknown> } } | undefined)?.context?.answers ?? null
    const r = await c.notify(to, {
      studentName: record.name?.trim() || bookerName(p),
      bookerEmail: p.email,
      bookerName: bookerName(p),
      timeLabel: timeLabel(p.scheduled_event.start_time, c.tz),
      coachClientId: record.id,
      createdFromBooking: created,
      form: answers,
      calendlyAnswers: (p.questions_and_answers ?? [])
        .filter((qa) => qa?.question?.trim() && qa?.answer?.trim())
        .map((qa) => ({ question: String(qa.question).trim(), answer: String(qa.answer).trim() })),
    })
    return r.ok ? null : `email not sent: ${r.error}`
  } catch (e) {
    return `email not sent: ${e instanceof Error ? e.message : String(e)}`
  }
}

async function consultCanceled(c: Ctx): Promise<Step> {
  const p = c.body.payload
  // The first half of a reschedule. The new booking's delivery moves the
  // consult; acting here would cancel it in between.
  if (p.rescheduled) return { outcome: "reschedule_cancel_half", coach_client_id: await recordForInvitee(c.db, p.uri) }

  const id = (await recordForInvitee(c.db, p.uri)) ?? (await findRecordByEmail(c.db, c.coachId, p.email))?.id ?? null
  if (!id) return { outcome: "no_record", detail: "no prospect matched this cancellation" }
  const r = await cancelConsult(c.db, {
    coachClientId: id,
    today: dayInZone(c.now.toISOString(), c.tz),
    actor: null,
    history: {
      via: "calendly",
      time_label: timeLabel(p.scheduled_event.start_time, c.tz),
      reason: p.cancellation?.reason?.trim() || null,
      canceled_by: p.cancellation?.canceler_type === "host" ? "host" : "invitee",
    },
  })
  if (!r.ok) return { outcome: "error", coach_client_id: id, detail: r.error }
  return { outcome: "cancelled", coach_client_id: id }
}

// ── session_booked ───────────────────────────────────────────────────────────
//
// A client booked a coaching session. With a plan match: the Book task is
// Done and the Prepare task Active, due the day before (see prepDueDay). With
// none (WRN Working Session, a session not in their plan, a package not yet
// approved, every set already booked, or no client with this email): a one-off
// "Prepare for [session] with [name]" on the coach's To-Do, same due date.
// Either way the delivery row remembers what was touched, so a reschedule or a
// cancellation acts on exactly that.

type ClientRow = { id: string; name: string | null; client_profile_id: string | null }

/**
 * The coach's client for this email: invited email, parent email, or the email
 * the client signs in with. A client beats a prospect, then the newest.
 */
async function findClientByEmail(db: SupabaseClient, coachId: string, email: string): Promise<ClientRow | null> {
  const e = email.trim().toLowerCase()
  if (!e) return null
  const cols = "id, name, client_profile_id, lifecycle_status, invited_at"
  type Row = ClientRow & { lifecycle_status: string; invited_at: string | null }
  const rows: Row[] = []
  for (const col of ["invited_email", "parent_email"] as const) {
    const { data, error } = await db.from("coach_clients").select(`${cols}, ${col}`)
      .eq("coach_profile_id", coachId).eq("status", "active").ilike(col, e)
    if (error) throw new Error(`Failed to look up ${col}: ${error.message}`)
    rows.push(...((data ?? []) as unknown as (Row & Record<string, string | null>)[]).filter((r) => (r[col] ?? "").toLowerCase() === e))
  }
  const { data: profs } = await db.from("client_profiles").select("id, email").ilike("email", e)
  const profIds = ((profs ?? []) as { id: string; email: string | null }[]).filter((p) => (p.email ?? "").toLowerCase() === e).map((p) => p.id)
  if (profIds.length) {
    const { data } = await db.from("coach_clients").select(cols)
      .eq("coach_profile_id", coachId).eq("status", "active").in("client_profile_id", profIds)
    rows.push(...((data ?? []) as unknown as Row[]))
  }
  rows.sort((a, b) =>
    Number(a.lifecycle_status === "Prospect") - Number(b.lifecycle_status === "Prospect")
    || ((a.invited_at ?? "") < (b.invited_at ?? "") ? 1 : -1))
  const r = rows[0]
  return r ? { id: r.id, name: r.name, client_profile_id: r.client_profile_id } : null
}

/** What an earlier booking by this invitee touched. */
async function bookingFor(db: SupabaseClient, inviteeUri: string | null | undefined) {
  if (!inviteeUri) return null
  const { data } = await db.from("calendly_webhook_deliveries")
    .select("coach_client_id, book_task_id, prep_task_id, todo_task_id")
    .eq("event", "invitee.created").eq("invitee_uri", inviteeUri).limit(1)
  return ((data ?? [])[0] as { coach_client_id: string | null; book_task_id: string | null; prep_task_id: string | null; todo_task_id: string | null } | undefined) ?? null
}

/** Prepare tasks this client's live bookings already hold, so a second booking takes the next set. */
async function heldPrepIds(db: SupabaseClient, coachClientId: string): Promise<string[]> {
  const { data: booked } = await db.from("calendly_webhook_deliveries").select("invitee_uri, prep_task_id")
    .eq("event", "invitee.created").eq("coach_client_id", coachClientId)
  const { data: cancelled } = await db.from("calendly_webhook_deliveries").select("invitee_uri")
    .eq("event", "invitee.canceled").eq("coach_client_id", coachClientId).eq("outcome", "session_cancelled")
  const gone = new Set(((cancelled ?? []) as { invitee_uri: string }[]).map((r) => r.invitee_uri))
  return ((booked ?? []) as { invitee_uri: string; prep_task_id: string | null }[])
    .filter((r) => r.prep_task_id && !gone.has(r.invitee_uri)).map((r) => r.prep_task_id as string)
}

const sessionName = (c: Ctx) =>
  c.mapping.event_type_name?.trim() || c.body.payload.scheduled_event.name?.trim() || "session"

async function sessionBooked(c: Ctx): Promise<Step> {
  const p = c.body.payload
  const start = p.scheduled_event.start_time
  const prepDue = prepDueDay(dayInZone(start, c.tz), dayInZone(c.now.toISOString(), c.tz))
  const session = sessionName(c)
  const base = { via: "calendly", session, time_label: timeLabel(start, c.tz), prep_due: prepDue }

  // A reschedule moves what the original booking touched, nothing else.
  const prior = p.old_invitee ? await bookingFor(c.db, p.old_invitee) : null
  if (prior && (prior.prep_task_id || prior.todo_task_id)) {
    const ccId = prior.coach_client_id
    let prep: string | null = null
    if (prior.prep_task_id && ccId) prep = await moveSessionPrep(c.db, { coachClientId: ccId, prepTaskId: prior.prep_task_id, prepDue })
    if (prior.todo_task_id) {
      const r = await updateTask(c.db, prior.todo_task_id, { due_at: dayToDueAt(prepDue), due_has_time: false }, null)
      if (!r.ok) return { outcome: "error", coach_client_id: ccId, detail: r.error }
    }
    if (ccId) await logProspectEvent(c.db, { coachClientId: ccId, eventType: "session_booked", actor: null, context: { ...base, rescheduled: true, prep_task: prep } })
    return {
      outcome: "session_rescheduled", coach_client_id: ccId,
      touched: { book_task_id: prior.book_task_id, prep_task_id: prior.prep_task_id, todo_task_id: prior.todo_task_id },
    }
  }

  const client = await findClientByEmail(c.db, c.coachId, p.email)
  if (client && c.mapping.milestone_id) {
    const pair = await bookSessionTasks(c.db, {
      coachClientId: client.id, milestoneId: c.mapping.milestone_id, prepDue, coachId: c.coachId,
      heldPrepIds: await heldPrepIds(c.db, client.id), reason: `${session} booked on Calendly`,
    })
    if (pair) {
      await logProspectEvent(c.db, { coachClientId: client.id, eventType: "session_booked", actor: null, context: {
        ...base, matched: true, deliverable: pair.deliverable, book_task: pair.book?.name ?? null, prep_task: pair.prep.name,
      } })
      return { outcome: "session_booked", coach_client_id: client.id, touched: { book_task_id: pair.book?.id ?? null, prep_task_id: pair.prep.id } }
    }
  }

  // No match: a one-off prep task on the coach's To-Do.
  const who = client?.name?.trim() || bookerName(p)
  const title = `Prepare for ${session} with ${who}`
  const r = await createTask(c.db, {
    title,
    coach_client_id: client?.id ?? null,
    client_profile_id: client?.client_profile_id ?? null,
    assignee_profile_id: c.coachId,
    due_at: dayToDueAt(prepDue),
    due_has_time: false,
    source: "auto",
    link: client ? planLink({ coach_client_id: client.id, client_profile_id: client.client_profile_id }) : "/dashboard/coach/tasks",
  }, null)
  if (!r.ok) return { outcome: "error", coach_client_id: client?.id ?? null, detail: r.error }
  const why = !client ? "no client with this email"
    : !c.mapping.milestone_id ? "a session that is not part of any plan"
    : "no open booking task for this session in the plan"
  if (client) await logProspectEvent(c.db, { coachClientId: client.id, eventType: "session_booked", actor: null, context: { ...base, matched: false, todo_title: title, why } })
  return { outcome: "session_booked_one_off", coach_client_id: client?.id ?? null, detail: why, touched: { todo_task_id: r.data.id } }
}

async function sessionCanceled(c: Ctx): Promise<Step> {
  const p = c.body.payload
  // The first half of a reschedule: the new booking's delivery moves things.
  if (p.rescheduled) return { outcome: "reschedule_cancel_half", coach_client_id: (await bookingFor(c.db, p.uri))?.coach_client_id ?? null }

  const prior = await bookingFor(c.db, p.uri)
  if (!prior || !(prior.prep_task_id || prior.todo_task_id)) return { outcome: "no_record", detail: "no booking SIGNAL acted on matches this cancellation" }
  const ccId = prior.coach_client_id
  const session = sessionName(c)
  const context: Record<string, unknown> = {
    via: "calendly", session, time_label: timeLabel(p.scheduled_event.start_time, c.tz),
    reason: p.cancellation?.reason?.trim() || null,
    canceled_by: p.cancellation?.canceler_type === "host" ? "host" : "invitee",
  }
  if (prior.prep_task_id && ccId) {
    const r = await cancelSessionTasks(c.db, { coachClientId: ccId, bookTaskId: prior.book_task_id, prepTaskId: prior.prep_task_id, reason: `${session} cancelled on Calendly` })
    Object.assign(context, { already_ran: r.ran, book_task: r.book, prep_task: r.prep, prep_kept_done: r.prep_kept_done })
  }
  if (prior.todo_task_id) {
    const r = await setTaskStatus(c.db, prior.todo_task_id, "cancelled", null)
    if (!r.ok && r.status !== 404) return { outcome: "error", coach_client_id: ccId, detail: r.error }
    context.todo_cancelled = true
  }
  if (ccId) await logProspectEvent(c.db, { coachClientId: ccId, eventType: "session_cancelled", actor: null, context })
  return { outcome: "session_cancelled", coach_client_id: ccId }
}

// ── The entry point ──────────────────────────────────────────────────────────

export async function handleCalendlyWebhook(
  db: SupabaseClient,
  body: CalendlyWebhook,
  opts: { now?: Date; timezone?: string; notify?: NotifyCoach } = {},
): Promise<HandleResult> {
  const now = opts.now ?? new Date()
  const tz = opts.timezone ?? coachTimezone()
  const kind = body?.event === "invitee.created" ? "created" : body?.event === "invitee.canceled" ? "canceled" : null
  const p = body?.payload
  if (!kind || !p?.uri || !p?.email || !p?.scheduled_event?.event_type || !p.scheduled_event.start_time) {
    return { status: 200, outcome: "ignored", detail: "not a booking or cancellation SIGNAL reads" }
  }

  const { data: mapping, error: mapErr } = await db.from("calendly_event_type_actions")
    .select("coach_profile_id, action, event_type_name, milestone_id").eq("event_type_uri", p.scheduled_event.event_type).eq("active", true)
    .maybeSingle()
  if (mapErr) return { status: 500, outcome: "error", detail: mapErr.message }
  const handler = mapping ? ACTIONS[mapping.action as CalendlyAction] : undefined
  if (!mapping || !handler) return { status: 200, outcome: "ignored_event_type" }

  const { data: seen } = await db.from("calendly_webhook_deliveries").select("id")
    .eq("event", body.event).eq("invitee_uri", p.uri).limit(1)
  if ((seen ?? []).length) return { status: 200, outcome: "duplicate" }

  const { data: delivery, error: insErr } = await db.from("calendly_webhook_deliveries").insert({
    event: body.event,
    invitee_uri: p.uri,
    scheduled_event_uri: p.scheduled_event.uri,
    event_type_uri: p.scheduled_event.event_type,
    invitee_email: p.email.trim().toLowerCase(),
    outcome: "processing",
    payload: body,
  }).select("id").single()
  // A second arrival racing the first loses on the unique key.
  if (insErr || !delivery) return { status: 200, outcome: "duplicate", detail: insErr?.message }

  const ctx: Ctx = { db, coachId: String(mapping.coach_profile_id), body, tz, now, notify: opts.notify ?? sendConsultBookedEmail, mapping: mapping as Mapping }
  try {
    const step = await handler[kind](ctx)
    if (step.outcome === "error") throw new Error(step.detail ?? "failed")
    await db.from("calendly_webhook_deliveries").update({
      outcome: step.outcome, detail: step.detail ?? null, coach_client_id: step.coach_client_id ?? null,
      ...(step.touched ?? {}),
    }).eq("id", delivery.id)
    return { status: 200, ...step }
  } catch (e) {
    // Forget the delivery so Calendly's retry is handled afresh.
    await db.from("calendly_webhook_deliveries").delete().eq("id", delivery.id)
    return { status: 500, outcome: "error", detail: e instanceof Error ? e.message : String(e) }
  }
}
