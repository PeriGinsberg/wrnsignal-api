// lib/phases/service.ts
//
// Client phases on the server. Everything takes the client it is given, so the
// rules run against tests/_lib/fakeSupabase.ts as well as the real database.
// The vocabulary and the rules are in ./model.ts.

import { randomUUID } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { logProspectEvent } from "../prospects/history"
import {
  DEFAULT_PHASES,
  PHASE_LABEL_MAX,
  PHASE_STATUS_LABEL,
  type ClientPhase,
  type Phase,
  type PhaseStatus,
  type SettablePhaseStatus,
} from "./model"

const PHASE_COLUMNS = "id, phase_key, label, sort_order, active, is_custom"

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number }
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status })

const byOrder = (a: Phase, b: Phase) => a.sort_order - b.sort_order

// ── The coach's phases ───────────────────────────────────────────────────────

/**
 * The coach's phases, in order, seeding the five defaults the first time.
 *
 * Seeded for the OWNING coach only (a delegate reads their principal's), and
 * the unique (coach, phase_key) key means two first reads at once cannot
 * double the list: the loser re-reads what the winner wrote.
 */
export async function ensurePhases(db: SupabaseClient, coachId: string): Promise<Phase[]> {
  const read = async () => {
    const { data, error } = await db.from("coach_phases").select(PHASE_COLUMNS).eq("coach_profile_id", coachId)
    if (error) throw new Error(`Failed to read phases: ${error.message}`)
    return ((data ?? []) as Phase[]).sort(byOrder)
  }
  const existing = await read()
  if (existing.length) return existing
  const { error } = await db.from("coach_phases").insert(DEFAULT_PHASES.map((p, i) => ({
    coach_profile_id: coachId, phase_key: p.phase_key, label: p.label, sort_order: i + 1, active: true, is_custom: false,
  })))
  if (error) console.warn("[phases] seeding raced another request:", error.message)
  return read()
}

export type PhaseInput = { id?: string; label: string; active: boolean }

/**
 * Save the coach's phases as listed: order, labels and on/off. An entry
 * without an id is a new phase. Phases left out of the list are kept as they
 * are: phases are never deleted, so History keeps its names.
 */
export async function savePhases(db: SupabaseClient, coachId: string, input: unknown): Promise<Result<Phase[]>> {
  if (!Array.isArray(input)) return fail("phases must be a list")
  const existing = await ensurePhases(db, coachId)
  const ids = new Set(existing.map((p) => p.id))
  const seen = new Set<string>()
  const rows: PhaseInput[] = []
  for (const raw of input) {
    const r = raw as Record<string, unknown>
    const label = typeof r?.label === "string" ? r.label.trim() : ""
    if (!label) return fail("Every phase needs a name.")
    if (label.length > PHASE_LABEL_MAX) return fail(`Phase names can be at most ${PHASE_LABEL_MAX} characters.`)
    if (r.id !== undefined) {
      if (typeof r.id !== "string" || !ids.has(r.id)) return fail("Unknown phase.")
      if (seen.has(r.id)) return fail("A phase is listed twice.")
      seen.add(r.id)
    }
    rows.push({ id: r.id as string | undefined, label, active: r.active !== false })
  }
  if (!rows.some((r) => r.active)) return fail("Keep at least one phase active.")

  const now = new Date().toISOString()
  for (const [i, r] of rows.entries()) {
    const { error } = r.id
      ? await db.from("coach_phases").update({ label: r.label, active: r.active, sort_order: i + 1, updated_at: now })
          .eq("id", r.id).eq("coach_profile_id", coachId)
      : await db.from("coach_phases").insert({
          coach_profile_id: coachId, phase_key: `custom_${randomUUID().slice(0, 8)}`, label: r.label,
          active: r.active, sort_order: i + 1, is_custom: true,
        })
    if (error) return fail(`Failed to save phases: ${error.message}`, 500)
  }
  // Phases left out keep their place after the listed ones.
  const tail = existing.filter((p) => !seen.has(p.id))
  for (const [j, p] of tail.entries()) {
    await db.from("coach_phases").update({ sort_order: rows.length + j + 1 }).eq("id", p.id).eq("coach_profile_id", coachId)
  }
  return { ok: true, data: await ensurePhases(db, coachId) }
}

/** Is this phase one of the coach's? null means "no phase", which is allowed. */
export async function isOwnPhase(db: SupabaseClient, coachIds: string[], phaseId: unknown): Promise<boolean> {
  if (phaseId === null) return true
  if (typeof phaseId !== "string") return false
  const { data } = await db.from("coach_phases").select("id").eq("id", phaseId).in("coach_profile_id", coachIds).maybeSingle()
  return !!data
}

/**
 * A library deliverable got a phase: clients' copies of it that have none take
 * it too, so clients attached before phases existed are not stuck at "Not in
 * plan". A copy that already has a phase keeps it.
 */
export async function fillDeliverablePhase(db: SupabaseClient, milestoneId: string, phaseId: string | null): Promise<void> {
  if (!phaseId) return
  const { error } = await db.from("coach_client_engagement_deliverables")
    .update({ phase_id: phaseId }).eq("source_milestone_id", milestoneId).is("phase_id", null)
  if (error) console.error("[phases] filling client deliverables failed:", error.message)
}

// ── One client's phases ──────────────────────────────────────────────────────

type Board = ClientPhase & { stored: SettablePhaseStatus | null; tasks_started: number; in_plan: boolean }

async function coachOf(db: SupabaseClient, coachClientId: string): Promise<string | null> {
  const { data } = await db.from("coach_clients").select("coach_profile_id").eq("id", coachClientId).maybeSingle()
  return (data as { coach_profile_id: string } | null)?.coach_profile_id ?? null
}

async function board(db: SupabaseClient, coachClientId: string): Promise<Board[] | null> {
  const coachId = await coachOf(db, coachClientId)
  if (!coachId) return null
  const phases = (await ensurePhases(db, coachId)).filter((p) => p.active)

  // Only APPROVED packages put a phase in the plan.
  const { data: engs, error: e1 } = await db.from("coach_client_engagements").select("id")
    .eq("coach_client_id", coachClientId).eq("proposal_status", "approved")
  if (e1) throw new Error(`Failed to read engagements: ${e1.message}`)
  const engIds = ((engs ?? []) as { id: string }[]).map((e) => e.id)

  // A deliverable marked Not needed is out of the plan.
  const delivs: { id: string; phase_id: string | null; not_needed?: boolean }[] = []
  if (engIds.length) {
    const { data, error } = await db.from("coach_client_engagement_deliverables").select("id, phase_id, not_needed").in("engagement_id", engIds)
    if (error) throw new Error(`Failed to read deliverables: ${error.message}`)
    delivs.push(...((data ?? []) as typeof delivs).filter((d) => !d.not_needed))
  }
  const acts: { engagement_deliverable_id: string; state: string }[] = []
  if (delivs.length) {
    const { data, error } = await db.from("coach_client_engagement_activities").select("engagement_deliverable_id, state")
      .in("engagement_deliverable_id", delivs.map((d) => d.id))
    if (error) throw new Error(`Failed to read tasks: ${error.message}`)
    acts.push(...((data ?? []) as typeof acts))
  }
  const { data: rows, error: e2 } = await db.from("client_phase_status").select("phase_id, status, updated_at")
    .eq("coach_client_id", coachClientId)
  if (e2) throw new Error(`Failed to read phase status: ${e2.message}`)
  const stored = new Map(((rows ?? []) as { phase_id: string; status: SettablePhaseStatus; updated_at: string }[])
    .map((r) => [r.phase_id, r]))

  return phases.map((p) => {
    const mine = new Set(delivs.filter((d) => d.phase_id === p.id).map((d) => d.id))
    // Not needed tasks are not counted; Skipped counts as finished.
    const tasks = acts.filter((a) => mine.has(a.engagement_deliverable_id) && a.state !== "not_needed")
    const done = tasks.filter((a) => a.state === "done" || a.state === "skipped").length
    const started = tasks.filter((a) => a.state === "active" || a.state === "waiting_on_client" || a.state === "done").length
    const s = stored.get(p.id) ?? null
    const in_plan = mine.size > 0
    const status: PhaseStatus = !in_plan ? "not_in_plan" : s?.status ?? "not_started"
    return {
      phase_id: p.id,
      label: p.label,
      status,
      tasks_done: done,
      tasks_total: tasks.length,
      ready_to_complete: in_plan && tasks.length > 0 && done === tasks.length && status !== "complete",
      updated_at: s?.updated_at ?? null,
      stored: s?.status ?? null,
      tasks_started: started,
      in_plan,
    }
  })
}

/** The client's phases, in the coach's order, as the stepper shows them. */
export async function getClientPhases(db: SupabaseClient, coachClientId: string): Promise<ClientPhase[] | null> {
  const b = await board(db, coachClientId)
  return b ? b.map((p) => ({
    phase_id: p.phase_id, label: p.label, status: p.status, tasks_done: p.tasks_done,
    tasks_total: p.tasks_total, ready_to_complete: p.ready_to_complete, updated_at: p.updated_at,
  })) : null
}

/**
 * Set a phase's status for a client, and log it in History: who (the coach, or
 * SIGNAL when `actor` is null), the phase, from and to. Setting the status it
 * already has changes nothing and logs nothing.
 */
export async function setPhaseStatus(
  db: SupabaseClient,
  args: { coachClientId: string; phaseId: string; status: SettablePhaseStatus; actor: string | null; reason?: string },
): Promise<Result<{ from: PhaseStatus; to: SettablePhaseStatus; changed: boolean }>> {
  const b = await board(db, args.coachClientId)
  if (!b) return fail("Client not found", 404)
  const phase = b.find((p) => p.phase_id === args.phaseId)
  if (!phase) return fail("Phase not found", 404)
  if (!phase.in_plan) return fail("This phase is not in the client's plan: no approved package has a deliverable in it.", 409)
  if (phase.status === args.status) return { ok: true, data: { from: phase.status, to: args.status, changed: false } }

  const now = new Date().toISOString()
  const row = { status: args.status, updated_by: args.actor, updated_at: now }
  const { error } = phase.stored
    ? await db.from("client_phase_status").update(row).eq("coach_client_id", args.coachClientId).eq("phase_id", args.phaseId)
    : await db.from("client_phase_status").insert({ coach_client_id: args.coachClientId, phase_id: args.phaseId, ...row })
  if (error) return fail(`Failed to save the phase: ${error.message}`, 500)

  await logProspectEvent(db, {
    coachClientId: args.coachClientId,
    eventType: "phase_status_changed",
    actor: args.actor,
    context: {
      phase_id: args.phaseId,
      phase_label: phase.label,
      from: phase.status,
      to: args.status,
      from_label: PHASE_STATUS_LABEL[phase.status],
      to_label: PHASE_STATUS_LABEL[args.status],
      auto: args.actor === null,
      ...(args.reason ? { reason: args.reason } : {}),
    },
  })
  return { ok: true, data: { from: phase.status, to: args.status, changed: true } }
}

/**
 * A task moved to in progress or complete (or a package was approved): any
 * phase in plan whose tasks have started, and whose status nobody has set yet,
 * becomes In progress, by SIGNAL. Once the coach has set a phase's status
 * themselves, SIGNAL leaves it alone. Never fails the action that called it.
 */
export async function autoStartPhases(db: SupabaseClient, coachClientId: string, reason: string): Promise<string[]> {
  try {
    const b = await board(db, coachClientId)
    if (!b) return []
    const started: string[] = []
    for (const p of b) {
      if (!p.in_plan || p.stored !== null || p.tasks_started === 0) continue
      const r = await setPhaseStatus(db, { coachClientId, phaseId: p.phase_id, status: "in_progress", actor: null, reason })
      if (r.ok && r.data.changed) started.push(p.phase_id)
    }
    return started
  } catch (e) {
    console.error("[phases] auto-start failed:", e instanceof Error ? e.message : String(e))
    return []
  }
}
