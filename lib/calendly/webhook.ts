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

export const SIGNATURE_HEADER = "calendly-webhook-signature"
/** How old a signed delivery may be. Calendly's own guidance is a few minutes. */
export const SIGNATURE_TOLERANCE_SEC = 5 * 60

/** The coach's calendar day for a booking. Peri works in Eastern time. */
export function coachTimezone(): string {
  return process.env.COACH_TIMEZONE || "America/New_York"
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

export type CalendlyAction = "consult_booked"

export type HandleResult = {
  status: number
  outcome: string
  coach_client_id?: string | null
  detail?: string
}

export type NotifyCoach = (to: string, e: ConsultBookedEmail) => Promise<{ ok: boolean; error?: string }>
type Ctx = { db: SupabaseClient; coachId: string; body: CalendlyWebhook; tz: string; now: Date; notify: NotifyCoach }
type Step = { outcome: string; coach_client_id?: string | null; detail?: string }

/** What each mapped action does on a booking and on a cancellation. */
const ACTIONS: Record<CalendlyAction, { created: (c: Ctx) => Promise<Step>; canceled: (c: Ctx) => Promise<Step> }> = {
  consult_booked: { created: consultBooked, canceled: consultCanceled },
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
    .select("coach_profile_id, action").eq("event_type_uri", p.scheduled_event.event_type).eq("active", true)
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

  const ctx: Ctx = { db, coachId: String(mapping.coach_profile_id), body, tz, now, notify: opts.notify ?? sendConsultBookedEmail }
  try {
    const step = await handler[kind](ctx)
    if (step.outcome === "error") throw new Error(step.detail ?? "failed")
    await db.from("calendly_webhook_deliveries").update({
      outcome: step.outcome, detail: step.detail ?? null, coach_client_id: step.coach_client_id ?? null,
    }).eq("id", delivery.id)
    return { status: 200, ...step }
  } catch (e) {
    // Forget the delivery so Calendly's retry is handled afresh.
    await db.from("calendly_webhook_deliveries").delete().eq("id", delivery.id)
    return { status: 500, outcome: "error", detail: e instanceof Error ? e.message : String(e) }
  }
}
