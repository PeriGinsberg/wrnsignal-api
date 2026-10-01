// lib/prospects/bookingForm.ts
//
// The public consult booking form (prospect workflow, Phase 2): what it asks,
// how an answer becomes a prospect, and where the person goes next.
//
// A submission is filed under the STUDENT. When a parent fills it in, the
// parent's name, email and phone are kept as the parent contact and History
// says "Form submitted by parent". If the student's email already belongs to
// a prospect or client in the coach's practice, that record is updated
// (blanks filled, nothing a coach entered overwritten) instead of creating a
// second one. Every submission's answers are kept in History as a snapshot.
//
// The page is app/consult; the route is app/api/public/consult-booking.

import type { SupabaseClient } from "@supabase/supabase-js"
import { logProspectEvent } from "./history"
import { advanceIfPresent } from "./stages"
import { prefillConsult, reopenProspect } from "./workflow"
import {
  SERVICES,
  isPickableLeadSource,
  optEmail,
  optEnumList,
  optText,
  takesReferredBy,
  type Parsed,
  type SearchGoal,
  type Service,
} from "./model"

// ── Settings ─────────────────────────────────────────────────────────────────

/** The Initial Consult event the form sends people to. */
export function consultCalendlyUrl(): string {
  return process.env.CONSULT_CALENDLY_URL || "https://calendly.com/peri-workforcereadynow/30min"
}
/** The coach every submission is routed to, by their SIGNAL login email. */
export function intakeCoachEmail(): string {
  return (process.env.INTAKE_COACH_EMAIL || "peri@workforcereadynow.com").trim().toLowerCase()
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

export const SUBMITTERS = ["student", "parent"] as const
export type Submitter = (typeof SUBMITTERS)[number]

export const SITUATIONS = ["internship", "new_grad", "early_career", "seasoned", "other"] as const
export type Situation = (typeof SITUATIONS)[number]
export const SITUATION_LABEL: Record<Situation, string> = {
  internship: "Seeking internship support",
  new_grad: "New graduate (0-1 year)",
  early_career: "Early career (2-5 years)",
  seasoned: "Seasoned professional",
  other: "Other",
}
/** The consult screen's search goal each situation prefills. */
const SITUATION_GOAL: Record<Situation, SearchGoal> = {
  internship: "internship",
  new_grad: "first_job",
  early_career: "early_career_change",
  seasoned: "seasoned_change",
  other: "other",
}

/** Graduation years the form offers: last year to six years out. */
export function gradYearOptions(now = new Date()): number[] {
  const y = now.getFullYear()
  return Array.from({ length: 8 }, (_, i) => y - 1 + i)
}

// ── Parsing ──────────────────────────────────────────────────────────────────

export type BookingInput = {
  submitter: Submitter
  first_name: string
  last_name: string
  phone: string
  email: string
  student_first_name: string | null
  student_last_name: string | null
  student_email: string | null
  student_phone: string | null
  situation: Situation | null
  situation_other: string | null
  services: Service[]
  source_category: string | null
  source_detail: string | null
  referred_by_name: string | null
  referred_by_email: string | null
  anything_else: string | null
  school: string | null
  grad_year: number | null
  major: string | null
}

function req(v: unknown, field: string, label: string, max = 200): Parsed<string> {
  const t = optText(v, field, max)
  if (!t.ok) return t
  if (!t.value) return { ok: false, error: `${label} is required.` }
  return { ok: true, value: t.value }
}

/** Validate a submission. Error messages are written for the person filling it in. */
export function parseBookingForm(body: Record<string, unknown>, now = new Date()): Parsed<BookingInput> {
  const submitter = body.submitter === "parent" ? "parent" : body.submitter === "student" ? "student" : null
  if (!submitter) return { ok: false, error: "Tell us who is filling out this form." }

  const first = req(body.first_name, "first_name", "First name"); if (!first.ok) return first
  const last = req(body.last_name, "last_name", "Last name"); if (!last.ok) return last
  const phone = req(body.phone, "phone", "Phone", 50); if (!phone.ok) return phone
  const email = optEmail(body.email, "email")
  if (!email.ok) return { ok: false, error: "Please enter a valid email address." }
  if (!email.value) return { ok: false, error: "Email is required." }

  let sFirst: string | null = null, sLast: string | null = null, sEmail: string | null = null, sPhone: string | null = null
  if (submitter === "parent") {
    const f = req(body.student_first_name, "student_first_name", "Student's first name"); if (!f.ok) return f
    const l = req(body.student_last_name, "student_last_name", "Student's last name"); if (!l.ok) return l
    const e = optEmail(body.student_email, "student_email")
    if (!e.ok) return { ok: false, error: "Please enter a valid email address for the student." }
    if (!e.value) return { ok: false, error: "Student's email is required." }
    const p = optText(body.student_phone, "student_phone", 50); if (!p.ok) return p
    sFirst = f.value; sLast = l.value; sEmail = e.value; sPhone = p.value ?? null
    if (sEmail === email.value) return { ok: false, error: "Please use the student's own email, not yours, for the student." }
  }

  let situation: Situation | null = null
  if (body.situation !== undefined && body.situation !== null && body.situation !== "") {
    if (!(SITUATIONS as readonly string[]).includes(String(body.situation))) return { ok: false, error: "Please choose your current situation." }
    situation = body.situation as Situation
  }
  const sitOther = optText(body.situation_other, "situation_other", 200); if (!sitOther.ok) return sitOther
  if (situation === "other" && !sitOther.value) return { ok: false, error: "Please tell us your current situation." }

  const services = optEnumList(body.services, "services", SERVICES)
  if (!services.ok) return { ok: false, error: "Please choose services from the list." }

  let source: string | null = null
  if (body.source_category !== undefined && body.source_category !== null && body.source_category !== "") {
    if (!isPickableLeadSource(body.source_category)) return { ok: false, error: "Please choose how you heard about us." }
    source = body.source_category
  }
  const detail = optText(body.source_detail, "source_detail", 500); if (!detail.ok) return detail
  if (source === "other" && !detail.value) return { ok: false, error: "Please tell us how you heard about us." }
  let refName: string | null = null, refEmail: string | null = null
  if (takesReferredBy(source)) {
    const n = optText(body.referred_by_name, "referred_by_name", 200); if (!n.ok) return n
    const e = optEmail(body.referred_by_email, "referred_by_email")
    if (!e.ok) return { ok: false, error: "Please enter a valid email for the person who referred you." }
    refName = n.value ?? null; refEmail = e.value ?? null
  }

  const anything = optText(body.anything_else, "anything_else", 5000); if (!anything.ok) return anything
  const school = optText(body.school, "school", 200); if (!school.ok) return school
  const major = optText(body.major, "major", 200); if (!major.ok) return major
  let gradYear: number | null = null
  if (body.grad_year !== undefined && body.grad_year !== null && body.grad_year !== "") {
    const y = Number(body.grad_year)
    if (!Number.isInteger(y) || y < now.getFullYear() - 60 || y > now.getFullYear() + 10) {
      return { ok: false, error: "Please choose a graduation year." }
    }
    gradYear = y
  }

  return {
    ok: true,
    value: {
      submitter,
      first_name: first.value, last_name: last.value, phone: phone.value, email: email.value,
      student_first_name: sFirst, student_last_name: sLast, student_email: sEmail, student_phone: sPhone,
      situation, situation_other: situation === "other" ? sitOther.value ?? null : null,
      services: services.value ?? [],
      source_category: source,
      source_detail: source === "other" ? detail.value ?? null : null,
      referred_by_name: refName, referred_by_email: refEmail,
      anything_else: anything.value ?? null,
      school: school.value ?? null, grad_year: gradYear, major: major.value ?? null,
    },
  }
}

// ── The prospect it becomes ──────────────────────────────────────────────────

/** Who the record is about: the student, whoever filled it in. */
export function studentOf(i: BookingInput): { name: string; email: string; phone: string | null } {
  if (i.submitter === "parent") {
    return { name: `${i.student_first_name} ${i.student_last_name}`, email: i.student_email!, phone: i.student_phone }
  }
  return { name: `${i.first_name} ${i.last_name}`, email: i.email, phone: i.phone }
}

/**
 * A graduation year as the record's graduation date: May of that year, the
 * usual spring commencement, so the field sorts and displays. The exact year
 * the person chose is in the History snapshot; a coach can correct the month.
 */
export function gradYearToDate(y: number | null): string | null {
  return y ? `${y}-05-01` : null
}

/** The record fields a submission supplies. */
export function prospectFields(i: BookingInput): Record<string, string | null> {
  const s = studentOf(i)
  return {
    name: s.name,
    invited_email: s.email,
    phone: s.phone,
    parent_name: i.submitter === "parent" ? `${i.first_name} ${i.last_name}` : null,
    parent_email: i.submitter === "parent" ? i.email : null,
    parent_phone: i.submitter === "parent" ? i.phone : null,
    source_category: i.source_category,
    source_detail: i.source_detail,
    referred_by_name: i.referred_by_name,
    referred_by_email: i.referred_by_email,
    university: i.school,
    field_of_study: i.major,
    grad_date: gradYearToDate(i.grad_year),
  }
}

/** The answers exactly as given, for History. */
export function answersSnapshot(i: BookingInput): Record<string, unknown> {
  return { ...i, situation_label: i.situation ? SITUATION_LABEL[i.situation] : null }
}

/** Where the person goes next: the Initial Consult, with name and email prefilled. */
export function calendlyRedirect(i: BookingInput, base = consultCalendlyUrl()): string {
  const u = new URL(base)
  // The person who filled in the form books the call, so it is their name.
  u.searchParams.set("name", `${i.first_name} ${i.last_name}`)
  u.searchParams.set("email", i.email)
  return u.toString()
}

export type SubmitResult =
  | { ok: true; coach_client_id: string; created: boolean; reopened: boolean; redirect: string }
  | { ok: false; error: string; status: number }

/**
 * File a submission. The coach is looked up by email; the student's email
 * decides create vs update within that coach's practice.
 */
export async function submitBookingForm(
  db: SupabaseClient,
  input: BookingInput,
  opts: { coachEmail?: string } = {},
): Promise<SubmitResult> {
  const coachEmail = opts.coachEmail ?? intakeCoachEmail()
  const { data: coach, error: coachErr } = await db.from("client_profiles")
    .select("id, is_coach").eq("email", coachEmail).maybeSingle()
  if (coachErr) return { ok: false, error: coachErr.message, status: 500 }
  if (!coach || !coach.is_coach) {
    console.error("[booking-form] intake coach not found:", coachEmail)
    return { ok: false, error: "Booking is not available right now. Please email us instead.", status: 500 }
  }
  const coachId = coach.id as string
  const student = studentOf(input)
  const fields = prospectFields(input)

  const { data: existingRows, error: findErr } = await db.from("coach_clients")
    .select(["id", "lifecycle_status", "prospect_status", ...Object.keys(fields)].join(", "))
    .eq("coach_profile_id", coachId).eq("invited_email", student.email).eq("status", "active").limit(1)
  if (findErr) return { ok: false, error: findErr.message, status: 500 }
  const existing = ((existingRows ?? []) as unknown as Record<string, unknown>[])[0]

  let id: string
  let created = false
  let reopened = false
  if (existing) {
    id = existing.id as string
    // Fill blanks only: the form never overwrites what a coach entered.
    const fill: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) {
      if (v === null) continue
      const cur = existing[k]
      if (cur === null || cur === undefined || cur === "") fill[k] = v
    }
    // Referred-by only means something with a referral source.
    if (!takesReferredBy((fill.source_category ?? existing.source_category) as string | null)) {
      delete fill.referred_by_name
      delete fill.referred_by_email
    }
    if (Object.keys(fill).length) {
      const { error } = await db.from("coach_clients").update(fill).eq("id", id)
      if (error) return { ok: false, error: error.message, status: 500 }
    }
    // Someone who was marked lost and books again is back.
    if (existing.prospect_status === "lost" && existing.lifecycle_status === "Prospect") {
      const r = await reopenProspect(db, { coachClientId: id, actor: null })
      reopened = r.ok
    }
  } else {
    const { data: row, error } = await db.from("coach_clients").insert({
      coach_profile_id: coachId,
      created_by: null,
      client_profile_id: null,
      status: "active",
      access_level: "full",
      lifecycle_status: "Prospect",
      prospect_status: "active",
      ...fields,
    }).select("id").single()
    if (error || !row) return { ok: false, error: error?.message ?? "Could not create the prospect", status: 500 }
    id = row.id as string
    created = true
    await logProspectEvent(db, {
      coachClientId: id, eventType: "prospect_created", actor: null,
      context: { name: student.name, source_category: input.source_category, via: "booking_form" },
    })
    await advanceIfPresent(db, { coachClientId: id, actingIds: [coachId], stageKey: "lead_identified", actor: null })
  }

  // What they told us prefills the consult (never over what is there).
  const pre = await prefillConsult(db, id, {
    search_goal: input.situation ? SITUATION_GOAL[input.situation] : null,
    search_goal_other: input.situation === "other" ? input.situation_other : null,
    services: input.services,
    why_now: input.anything_else ? `From the booking form: ${input.anything_else}` : null,
  })
  if (pre.error) console.error("[booking-form] consult prefill failed:", pre.error)

  await logProspectEvent(db, {
    coachClientId: id,
    eventType: "booking_form_submitted",
    actor: null,
    context: {
      submitted_by: input.submitter,
      submitter_name: `${input.first_name} ${input.last_name}`,
      matched_existing: !created,
      reopened,
      answers: answersSnapshot(input),
    },
  })

  return { ok: true, coach_client_id: id, created, reopened, redirect: calendlyRedirect(input) }
}
