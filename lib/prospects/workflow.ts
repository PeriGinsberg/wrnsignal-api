// lib/prospects/workflow.ts
//
// The prospect workflow's actions (Phase 1): losing and reopening a prospect,
// booking the consult, saving the consult as the record, and the consult's
// three outcomes. Routes check who may act; what each action MEANS is here,
// once, and tested in tests/prospects/workflow.test.ts.
//
// Every action that creates work creates a TASK (lib/tasks/service.ts), with a
// link to where the work is done, and every action leaves a History line
// (./history.ts). The chain each outcome runs is listed in CONSULT_OUTCOME_CHAIN
// so the confirm dialog can show exactly what will happen before it does.

import type { SupabaseClient } from "@supabase/supabase-js"
import { createTask, setTaskStatus, updateTask, TASK_COLUMNS } from "../tasks/service"
import { prospectLink } from "../tasks/links"
import { logProspectEvent } from "./history"
import { advanceIfPresent } from "./stages"
import {
  LOST_REASON_LABEL,
  MATERIAL_STATES,
  SEARCH_GOALS,
  SERVICES,
  isLostReason,
  optDay,
  optEmail,
  optEnum,
  optEnumList,
  optText,
  parseLeadSource,
  parseParent,
  type ConsultOutcome,
  type LostReason,
  type Parsed,
} from "./model"

export type WorkflowResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number }
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status })

type ProspectRow = {
  id: string
  name: string | null
  lifecycle_status: string
  prospect_status: string | null
  lost_reason: string | null
  lost_reason_detail: string | null
  lost_notes: string | null
  lost_at: string | null
  client_profile_id: string | null
  coach_profile_id: string
}

async function loadProspect(db: SupabaseClient, coachClientId: string): Promise<ProspectRow | null> {
  const { data, error } = await db.from("coach_clients")
    .select("id, name, lifecycle_status, prospect_status, lost_reason, lost_reason_detail, lost_notes, lost_at, client_profile_id, coach_profile_id")
    .eq("id", coachClientId).maybeSingle()
  if (error) throw new Error(`Failed to read prospect: ${error.message}`)
  return (data as ProspectRow | null) ?? null
}

const displayName = (p: { name: string | null }) => p.name?.trim() || "this prospect"

/** A date-only due date: noon UTC of that day, so no timezone moves it. */
export function dayToDueAt(day: string): string {
  return `${day}T12:00:00.000Z`
}
/** Tomorrow (UTC calendar day), date-only. */
export function tomorrowDay(now = new Date()): string {
  const d = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

function isOpenProspect(p: ProspectRow): boolean {
  return p.lifecycle_status === "Prospect" && p.prospect_status !== "won"
}

// ── Lost and reopened ────────────────────────────────────────────────────────

/** Read the lost fields off a request body. Other needs its specify text. */
export function parseLostInput(body: Record<string, unknown>): Parsed<{ reason: LostReason; detail: string | null; notes: string | null }> {
  if (!isLostReason(body.lost_reason)) {
    return { ok: false, error: "Choose why the prospect was lost." }
  }
  const detail = optText(body.lost_reason_detail, "lost_reason_detail", 500)
  if (!detail.ok) return detail
  const notes = optText(body.lost_notes, "lost_notes", 5000)
  if (!notes.ok) return notes
  if (body.lost_reason === "other" && !detail.value) return { ok: false, error: "Say what the other reason was." }
  return {
    ok: true,
    value: { reason: body.lost_reason, detail: body.lost_reason === "other" ? detail.value ?? null : null, notes: notes.value ?? null },
  }
}

export async function markProspectLost(
  db: SupabaseClient,
  args: { coachClientId: string; reason: LostReason; detail: string | null; notes: string | null; actor: string | null; via?: "status" | "consult" },
): Promise<WorkflowResult<{ lost_at: string }>> {
  const p = await loadProspect(db, args.coachClientId)
  if (!p) return fail("Prospect not found", 404)
  if (!isOpenProspect(p)) return fail("Only an open prospect can be marked lost.", 409)
  if (p.prospect_status === "lost") return fail("This prospect is already marked lost.", 409)
  const lostAt = new Date().toISOString()
  const { error } = await db.from("coach_clients").update({
    prospect_status: "lost",
    lost_reason: args.reason,
    lost_reason_detail: args.reason === "other" ? args.detail : null,
    lost_notes: args.notes,
    lost_at: lostAt,
  }).eq("id", args.coachClientId)
  if (error) return fail(`Failed to mark lost: ${error.message}`, 500)
  await logProspectEvent(db, {
    coachClientId: args.coachClientId,
    eventType: "prospect_lost",
    actor: args.actor,
    context: {
      reason: args.reason,
      reason_label: LOST_REASON_LABEL[args.reason],
      detail: args.reason === "other" ? args.detail : null,
      notes: args.notes,
      via: args.via ?? "status",
    },
  })
  return { ok: true, data: { lost_at: lostAt } }
}

/** Back to active. The record's lost fields are cleared; History keeps them. */
export async function reopenProspect(
  db: SupabaseClient,
  args: { coachClientId: string; actor: string | null },
): Promise<WorkflowResult<true>> {
  const p = await loadProspect(db, args.coachClientId)
  if (!p) return fail("Prospect not found", 404)
  if (p.prospect_status !== "lost") return fail("Only a lost prospect can be reopened.", 409)
  const { error } = await db.from("coach_clients").update({
    prospect_status: "active",
    lost_reason: null,
    lost_reason_detail: null,
    lost_notes: null,
    lost_at: null,
  }).eq("id", args.coachClientId)
  if (error) return fail(`Failed to reopen: ${error.message}`, 500)
  await logProspectEvent(db, {
    coachClientId: args.coachClientId,
    eventType: "prospect_reopened",
    actor: args.actor,
    context: {
      previous_reason: p.lost_reason,
      previous_reason_label: p.lost_reason && isLostReason(p.lost_reason) ? LOST_REASON_LABEL[p.lost_reason] : null,
      previous_detail: p.lost_reason_detail,
      previous_notes: p.lost_notes,
      lost_at: p.lost_at,
    },
  })
  return { ok: true, data: true }
}

// ── The consult record ───────────────────────────────────────────────────────

export const CONSULT_COLUMNS =
  "coach_client_id, scheduled_for, why_now, search_goal, search_goal_other, services, timeline_deadlines, " +
  "timeline_start, timeline_season, tried_so_far, material_resume, material_linkedin, material_cover_letter, " +
  "recommendation, next_steps, outcome, outcome_at, minutes_logged, created_at, updated_at"

export type ConsultRow = {
  coach_client_id: string
  scheduled_for: string | null
  why_now: string | null
  search_goal: string | null
  search_goal_other: string | null
  services: string[]
  timeline_deadlines: string | null
  timeline_start: string | null
  timeline_season: string | null
  tried_so_far: string | null
  material_resume: string | null
  material_linkedin: string | null
  material_cover_letter: string | null
  recommendation: string | null
  next_steps: string | null
  outcome: ConsultOutcome | null
  outcome_at: string | null
  minutes_logged: number | null
}

/** What a prospect with no consult row yet reads as. */
export function emptyConsult(coachClientId: string): ConsultRow {
  return {
    coach_client_id: coachClientId,
    scheduled_for: null, why_now: null, search_goal: null, search_goal_other: null, services: [],
    timeline_deadlines: null, timeline_start: null, timeline_season: null, tried_so_far: null,
    material_resume: null, material_linkedin: null, material_cover_letter: null,
    recommendation: null, next_steps: null, outcome: null, outcome_at: null, minutes_logged: null,
  }
}

export async function getConsult(db: SupabaseClient, coachClientId: string): Promise<ConsultRow> {
  const { data, error } = await db.from("prospect_consults").select(CONSULT_COLUMNS)
    .eq("coach_client_id", coachClientId).maybeSingle()
  if (error) throw new Error(`Failed to read consult: ${error.message}`)
  return (data as unknown as ConsultRow) ?? emptyConsult(coachClientId)
}

/** Insert the row or update it. There is at most one per prospect. */
async function writeConsult(db: SupabaseClient, coachClientId: string, patch: Partial<ConsultRow>): Promise<string | null> {
  const { data: existing, error: readErr } = await db.from("prospect_consults")
    .select("coach_client_id").eq("coach_client_id", coachClientId).maybeSingle()
  if (readErr) return readErr.message
  const { error } = existing
    ? await db.from("prospect_consults").update({ ...patch, updated_at: new Date().toISOString() }).eq("coach_client_id", coachClientId)
    : await db.from("prospect_consults").insert({ ...emptyConsult(coachClientId), ...patch })
  return error ? error.message : null
}

/**
 * Fill consult fields that are still empty, and nothing else. Used by the
 * public booking form: what the prospect said prefills the consult, but never
 * overwrites what a coach already wrote. Returns the keys it filled.
 */
export async function prefillConsult(
  db: SupabaseClient,
  coachClientId: string,
  patch: Partial<ConsultRow>,
): Promise<{ filled: string[]; error: string | null }> {
  const current = await getConsult(db, coachClientId) as unknown as Record<string, unknown>
  const fill: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || (Array.isArray(v) && !v.length)) continue
    const cur = current[k]
    const empty = cur === null || cur === undefined || cur === "" || (Array.isArray(cur) && !cur.length)
    if (empty) fill[k] = v
  }
  if (!Object.keys(fill).length) return { filled: [], error: null }
  const error = await writeConsult(db, coachClientId, fill as Partial<ConsultRow>)
  return { filled: Object.keys(fill), error }
}

/** The prospect fields the consult screen's top section may edit. */
export const CONSULT_PROSPECT_FIELDS = [
  "name", "invited_email", "phone",
  "parent_name", "parent_email", "parent_phone",
  "source_category", "source_detail", "referred_by_name", "referred_by_email",
  "current_title", "current_company", "university", "field_of_study", "grad_date",
  "target_roles", "target_industries", "target_locations",
] as const

/** The consult's own fields, filled in during the call. */
export const CONSULT_FIELDS = [
  "why_now", "search_goal", "search_goal_other", "services",
  "timeline_deadlines", "timeline_start", "timeline_season", "tried_so_far",
  "material_resume", "material_linkedin", "material_cover_letter",
  "recommendation", "next_steps",
] as const

/** Validate a consult save. Only keys present in the body are returned. */
export function parseConsultSave(
  body: Record<string, unknown>,
  current: Record<string, unknown>,
): Parsed<{ prospect: Record<string, unknown>; consult: Record<string, unknown> }> {
  const prospect: Record<string, unknown> = {}
  const consult: Record<string, unknown> = {}
  const p = (body.prospect && typeof body.prospect === "object" ? body.prospect : {}) as Record<string, unknown>
  const c = (body.consult && typeof body.consult === "object" ? body.consult : {}) as Record<string, unknown>

  if ("name" in p) {
    const n = optText(p.name, "name", 200)
    if (!n.ok) return n
    if (!n.value) return { ok: false, error: "name cannot be empty" }
    prospect.name = n.value
  }
  const email = optEmail(p.invited_email, "invited_email")
  if (!email.ok) return email
  if (email.value !== undefined) prospect.invited_email = email.value
  const texts: [string, number][] = [
    ["phone", 50], ["current_title", 200], ["current_company", 200], ["university", 200],
    ["field_of_study", 200], ["target_roles", 1000], ["target_industries", 1000], ["target_locations", 1000],
  ]
  for (const [k, max] of texts) {
    const t = optText(p[k], k, max)
    if (!t.ok) return t
    if (t.value !== undefined) prospect[k] = t.value
  }
  const grad = optDay(p.grad_date, "grad_date")
  if (!grad.ok) return grad
  if (grad.value !== undefined) prospect.grad_date = grad.value
  const parent = parseParent(p)
  if (!parent.ok) return parent
  Object.assign(prospect, parent.value)
  const lead = parseLeadSource(p, {
    source_category: (current.source_category as string | null) ?? null,
    referred_by_name: (current.referred_by_name as string | null) ?? null,
    referred_by_email: (current.referred_by_email as string | null) ?? null,
  }, { required: true })
  if (!lead.ok) return lead
  Object.assign(prospect, lead.value)

  const longTexts: [string, number][] = [
    ["why_now", 5000], ["search_goal_other", 200], ["timeline_deadlines", 500], ["timeline_start", 500],
    ["timeline_season", 500], ["tried_so_far", 5000], ["recommendation", 5000], ["next_steps", 5000],
  ]
  for (const [k, max] of longTexts) {
    const t = optText(c[k], k, max)
    if (!t.ok) return t
    if (t.value !== undefined) consult[k] = t.value
  }
  const goal = optEnum(c.search_goal, "search_goal", SEARCH_GOALS)
  if (!goal.ok) return goal
  if (goal.value !== undefined) consult.search_goal = goal.value
  if (consult.search_goal !== undefined && consult.search_goal !== "other") consult.search_goal_other = null
  const services = optEnumList(c.services, "services", SERVICES)
  if (!services.ok) return services
  if (services.value !== undefined) consult.services = services.value
  for (const k of ["material_resume", "material_linkedin", "material_cover_letter"]) {
    const m = optEnum(c[k], k, MATERIAL_STATES)
    if (!m.ok) return m
    if (m.value !== undefined) consult[k] = m.value
  }
  return { ok: true, value: { prospect, consult } }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Save the consult. It becomes the record: prospect fields are written to the
 * prospect, consult fields to the consult. The values it replaced go to
 * History, so whatever the booking (or an earlier save) said is kept.
 * A save that changes nothing writes nothing.
 */
export async function saveConsult(
  db: SupabaseClient,
  args: { coachClientId: string; body: Record<string, unknown>; actor: string | null },
): Promise<WorkflowResult<{ changed: string[] }>> {
  const { data: current, error: readErr } = await db.from("coach_clients")
    .select(CONSULT_PROSPECT_FIELDS.join(", ")).eq("id", args.coachClientId).maybeSingle()
  if (readErr) return fail(readErr.message, 500)
  if (!current) return fail("Prospect not found", 404)
  const cur = current as unknown as Record<string, unknown>
  const parsed = parseConsultSave(args.body, cur)
  if (!parsed.ok) return fail(parsed.error)
  const consultBefore = await getConsult(db, args.coachClientId) as unknown as Record<string, unknown>

  const prospectChanges: Record<string, unknown> = {}
  const previousProspect: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parsed.value.prospect)) {
    if (same(cur[k], v)) continue
    prospectChanges[k] = v
    previousProspect[k] = cur[k] ?? null
  }
  const consultChanges: Record<string, unknown> = {}
  const previousConsult: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parsed.value.consult)) {
    if (same(consultBefore[k], v)) continue
    consultChanges[k] = v
    previousConsult[k] = consultBefore[k] ?? null
  }
  const changed = [...Object.keys(prospectChanges), ...Object.keys(consultChanges)]
  if (!changed.length) return { ok: true, data: { changed } }

  if (Object.keys(prospectChanges).length) {
    const { error } = await db.from("coach_clients").update(prospectChanges).eq("id", args.coachClientId)
    if (error) return fail(`Failed to save the record: ${error.message}`, 500)
  }
  if (Object.keys(consultChanges).length) {
    const err = await writeConsult(db, args.coachClientId, consultChanges as Partial<ConsultRow>)
    if (err) return fail(`Failed to save the consult: ${err}`, 500)
  }
  await logProspectEvent(db, {
    coachClientId: args.coachClientId,
    eventType: "consult_saved",
    actor: args.actor,
    context: { changed, previous: { prospect: previousProspect, consult: previousConsult } },
  })
  return { ok: true, data: { changed } }
}

// ── Consult booked ───────────────────────────────────────────────────────────

export const PREP_TASK_PREFIX = "Prep for consult with "

/**
 * The consult is booked for `day`. Records the date, reaches Consult Scheduled
 * (if the coach's pipeline has it), and sets up "Prep for consult with
 * [name]" due that day, linked to the consult screen. Booking again (a
 * reschedule) moves the open prep task rather than adding a second one, and
 * clears an earlier outcome such as a no-show: this is a new call.
 */
export async function bookConsult(
  db: SupabaseClient,
  args: { coachClientId: string; actingIds: string[]; day: string; actor: string },
): Promise<WorkflowResult<{ task_id: string; rescheduled: boolean }>> {
  const day = optDay(args.day, "date")
  if (!day.ok || !day.value) return fail(day.ok ? "Choose the date of the call." : day.error)
  const p = await loadProspect(db, args.coachClientId)
  if (!p) return fail("Prospect not found", 404)
  if (!isOpenProspect(p) || p.prospect_status === "lost") return fail("Reopen the prospect before booking a consult.", 409)

  const err = await writeConsult(db, args.coachClientId, { scheduled_for: day.value, outcome: null, outcome_at: null, minutes_logged: null })
  if (err) return fail(`Failed to record the booking: ${err}`, 500)
  await advanceIfPresent(db, { coachClientId: args.coachClientId, actingIds: args.actingIds, stageKey: "consult_scheduled", actor: args.actor })

  const { data: open, error: findErr } = await db.from("coach_tasks").select(TASK_COLUMNS)
    .eq("coach_client_id", args.coachClientId).eq("status", "open").is("deleted_at", null)
    .ilike("title", `${PREP_TASK_PREFIX}%`).limit(1)
  if (findErr) return fail(findErr.message, 500)
  const existing = (open ?? [])[0] as unknown as { id: string } | undefined

  let taskId: string
  if (existing) {
    const r = await updateTask(db, existing.id, { due_at: dayToDueAt(day.value), due_has_time: false }, args.actor)
    if (!r.ok) return fail(r.error, r.status)
    taskId = r.data.id
  } else {
    const r = await createTask(db, {
      title: `${PREP_TASK_PREFIX}${displayName(p)}`,
      coach_client_id: args.coachClientId,
      client_profile_id: p.client_profile_id,
      assignee_profile_id: args.actor,
      due_at: dayToDueAt(day.value),
      due_has_time: false,
      source: "auto",
      link: prospectLink(args.coachClientId, "consult"),
    }, args.actor)
    if (!r.ok) return fail(r.error, r.status)
    taskId = r.data.id
  }

  await logProspectEvent(db, {
    coachClientId: args.coachClientId,
    eventType: "consult_booked",
    actor: args.actor,
    context: { date: day.value, rescheduled: !!existing },
  })
  return { ok: true, data: { task_id: taskId, rescheduled: !!existing } }
}

// ── Outcomes ─────────────────────────────────────────────────────────────────

/**
 * What each outcome does, in order, as the confirm dialog shows it. The
 * server does exactly this; tests/prospects/workflow.test.ts checks each step.
 */
export const CONSULT_OUTCOME_CHAIN: Record<ConsultOutcome, string[]> = {
  completed: [
    "Records the consult as complete, with the time logged if you entered it.",
    "Closes the \"Prep for consult with [name]\" task.",
    "Attaches the package you picked to this prospect as a draft engagement (Custom starts empty).",
    "Moves the prospect to Consult Completed.",
    "Creates the task \"Draft SOW for [name]\", due tomorrow.",
    "Adds the outcome to History.",
  ],
  no_show: [
    "Records the consult as a no-show.",
    "Closes the \"Prep for consult with [name]\" task.",
    "Creates the task \"Follow up with [name] after missed consult\", due tomorrow.",
    "Adds the no-show to History.",
  ],
  not_a_fit: [
    "Marks the prospect Lost, with the reason \"Not a fit\" and your notes.",
    "Records the consult's outcome.",
    "Closes the \"Prep for consult with [name]\" task.",
    "Adds it to History. You can reopen the prospect later.",
  ],
}

/**
 * The call has happened (or been missed), so its prep is over. Every outcome
 * closes the open prep task, through setTaskStatus so the tick is logged like
 * one a coach made. Never fails the outcome: a prep task already closed or
 * deleted by hand is simply not found.
 */
async function closePrepTask(db: SupabaseClient, coachClientId: string, actor: string): Promise<void> {
  const { data, error } = await db.from("coach_tasks").select("id")
    .eq("coach_client_id", coachClientId).eq("status", "open").is("deleted_at", null)
    .ilike("title", `${PREP_TASK_PREFIX}%`)
  if (error) { console.error("[prospects/workflow] finding the prep task failed:", error.message); return }
  for (const t of (data ?? []) as { id: string }[]) {
    const r = await setTaskStatus(db, t.id, "done", actor)
    if (!r.ok) console.error("[prospects/workflow] closing the prep task failed:", r.error)
  }
}

export const DRAFT_SOW_PREFIX = "Draft SOW for "
export const NO_SHOW_PREFIX = "Follow up with "

export type OutcomeInput =
  | { outcome: "completed"; minutes: number | null; packageChoice: { packageId: string } | { custom: true } }
  | { outcome: "no_show" }
  | { outcome: "not_a_fit"; notes: string | null }

/** Read an outcome request body. */
export function parseOutcomeInput(body: Record<string, unknown>): Parsed<OutcomeInput> {
  if (body.outcome === "no_show") return { ok: true, value: { outcome: "no_show" } }
  if (body.outcome === "not_a_fit") {
    const notes = optText(body.notes, "notes", 5000)
    if (!notes.ok) return notes
    return { ok: true, value: { outcome: "not_a_fit", notes: notes.value ?? null } }
  }
  if (body.outcome !== "completed") return { ok: false, error: "outcome must be completed, no_show or not_a_fit" }
  let minutes: number | null = null
  if (body.minutes !== undefined && body.minutes !== null && body.minutes !== "") {
    const n = Number(body.minutes)
    if (!Number.isInteger(n) || n < 0 || n > 1440) return { ok: false, error: "Time logged must be whole minutes, 0 to 1440." }
    minutes = n
  }
  if (body.package_id === "custom") return { ok: true, value: { outcome: "completed", minutes, packageChoice: { custom: true } } }
  if (typeof body.package_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.package_id)) {
    return { ok: false, error: "Pick a package, or Custom." }
  }
  return { ok: true, value: { outcome: "completed", minutes, packageChoice: { packageId: body.package_id } } }
}

/** Attach the chosen package as a draft engagement. Custom starts empty. */
async function attachPackage(
  db: SupabaseClient,
  p: ProspectRow,
  choice: { packageId: string } | { custom: true },
  actor: string,
): Promise<WorkflowResult<{ engagement_id: string; name: string }>> {
  if ("custom" in choice) {
    const { data, error } = await db.from("coach_client_engagements")
      .insert({ coach_client_id: p.id, name: "Custom" }).select("id").single()
    if (error || !data) return fail(`Failed to start the Custom engagement: ${error?.message ?? "no row"}`, 500)
    await logProspectEvent(db, { coachClientId: p.id, eventType: "engagement_attached", actor, context: { name: "Custom", engagement_id: data.id } })
    return { ok: true, data: { engagement_id: data.id as string, name: "Custom" } }
  }
  const { data: pkg, error: pkgErr } = await db.from("coach_packages")
    .select("id, name").eq("id", choice.packageId).eq("coach_profile_id", p.coach_profile_id).maybeSingle()
  if (pkgErr) return fail(pkgErr.message, 500)
  if (!pkg) return fail("That package was not found in this practice's services.", 404)
  // The RPC checks the package and the relationship belong to the same coach:
  // the relationship's own coach, so a delegate acting for them can use it.
  const { data: engagementId, error } = await db.rpc("attach_package_to_engagement", {
    p_coach_client_id: p.id,
    p_package_id: choice.packageId,
    p_coach_profile_id: p.coach_profile_id,
  })
  if (error || !engagementId) return fail(`Failed to attach the package: ${error?.message ?? "no engagement"}`, 500)
  await logProspectEvent(db, { coachClientId: p.id, eventType: "engagement_attached", actor, context: { name: pkg.name, engagement_id: engagementId } })
  return { ok: true, data: { engagement_id: engagementId as string, name: pkg.name as string } }
}

/**
 * Record the consult's outcome and run its chain (CONSULT_OUTCOME_CHAIN).
 * One outcome per booked call: recording a second is refused until the
 * consult is booked again.
 */
export async function recordConsultOutcome(
  db: SupabaseClient,
  args: { coachClientId: string; actingIds: string[]; actor: string; input: OutcomeInput },
): Promise<WorkflowResult<{ outcome: ConsultOutcome; task_id?: string; engagement_id?: string }>> {
  const p = await loadProspect(db, args.coachClientId)
  if (!p) return fail("Prospect not found", 404)
  if (!isOpenProspect(p) || p.prospect_status === "lost") return fail("Reopen the prospect before recording a consult outcome.", 409)
  const consult = await getConsult(db, args.coachClientId)
  if (consult.outcome) return fail("This consult already has an outcome. Book the next consult to record another.", 409)
  const now = new Date().toISOString()
  const { input } = args

  if (input.outcome === "not_a_fit") {
    const lost = await markProspectLost(db, {
      coachClientId: p.id, reason: "not_a_fit", detail: null, notes: input.notes, actor: args.actor, via: "consult",
    })
    if (!lost.ok) return lost
    const err = await writeConsult(db, p.id, { outcome: "not_a_fit", outcome_at: now })
    if (err) return fail(`Marked lost, but the consult outcome was not saved: ${err}`, 500)
    await closePrepTask(db, p.id, args.actor)
    return { ok: true, data: { outcome: "not_a_fit" } }
  }

  if (input.outcome === "no_show") {
    const err = await writeConsult(db, p.id, { outcome: "no_show", outcome_at: now })
    if (err) return fail(`Failed to record the no-show: ${err}`, 500)
    await closePrepTask(db, p.id, args.actor)
    const task = await createTask(db, {
      title: `${NO_SHOW_PREFIX}${displayName(p)} after missed consult`,
      coach_client_id: p.id,
      client_profile_id: p.client_profile_id,
      assignee_profile_id: args.actor,
      due_at: dayToDueAt(tomorrowDay()),
      due_has_time: false,
      source: "auto",
      link: prospectLink(p.id),
    }, args.actor)
    if (!task.ok) return fail(`No-show recorded, but the follow-up task was not created: ${task.error}`, task.status)
    await logProspectEvent(db, {
      coachClientId: p.id, eventType: "consult_no_show", actor: args.actor, context: { scheduled_for: consult.scheduled_for },
    })
    return { ok: true, data: { outcome: "no_show", task_id: task.data.id } }
  }

  // Consult complete.
  const engagement = await attachPackage(db, p, input.packageChoice, args.actor)
  if (!engagement.ok) return engagement
  const err = await writeConsult(db, p.id, { outcome: "completed", outcome_at: now, minutes_logged: input.minutes })
  if (err) return fail(`Package attached, but the consult outcome was not saved: ${err}`, 500)
  await closePrepTask(db, p.id, args.actor)
  await advanceIfPresent(db, { coachClientId: p.id, actingIds: args.actingIds, stageKey: "consult_completed", actor: args.actor })
  const task = await createTask(db, {
    title: `${DRAFT_SOW_PREFIX}${displayName(p)}`,
    description: `Package: ${engagement.data.name}`,
    coach_client_id: p.id,
    client_profile_id: p.client_profile_id,
    assignee_profile_id: args.actor,
    due_at: dayToDueAt(tomorrowDay()),
    due_has_time: false,
    source: "auto",
    link: prospectLink(p.id),
  }, args.actor)
  if (!task.ok) return fail(`Consult recorded, but the Draft SOW task was not created: ${task.error}`, task.status)
  await logProspectEvent(db, {
    coachClientId: p.id,
    eventType: "consult_completed",
    actor: args.actor,
    context: { minutes: input.minutes, package_name: engagement.data.name, engagement_id: engagement.data.engagement_id },
  })
  return { ok: true, data: { outcome: "completed", task_id: task.data.id, engagement_id: engagement.data.engagement_id } }
}
