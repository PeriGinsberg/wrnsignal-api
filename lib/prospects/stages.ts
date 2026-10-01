// lib/prospects/stages.ts
//
// Moving a prospect through the coach's pipeline, forward and back, on the
// server. The stage route uses these, and so do the consult actions ("Consult
// booked" reaches Consult Scheduled; "Consult complete" reaches Consult
// Completed), which run without a page to click the stages one by one.
//
// THE MODEL, unchanged from the stage route: prospect_stage_progress holds one
// row per stage reached; coach_clients.current_stage_key is the furthest
// reached non-terminal stage. Going forward marks every skipped stage too
// ("the path fills"). Going back un-reaches every stage after the target, so
// the furthest-reached rule and the current stage agree again.
//
// The terminal Convert stage is not handled here: converting runs the
// conversion flow in the stage route.

import type { SupabaseClient } from "@supabase/supabase-js"
import { logProspectEvent } from "./history"

export type StageDef = { stage_key: string; label: string; sort_order: number; is_terminal: boolean; active: boolean }
export type StageResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number }

/** The coach's pipeline. `actingIds` are the coaches the caller may act as (delegation). */
export async function loadPipeline(db: SupabaseClient, actingIds: string[]): Promise<StageDef[]> {
  const { data, error } = await db.from("coach_pipeline_stages")
    .select("stage_key, label, sort_order, is_terminal, active")
    .in("coach_profile_id", actingIds)
  if (error) throw new Error(`Failed to read pipeline: ${error.message}`)
  return ((data ?? []) as StageDef[]).sort((a, b) => a.sort_order - b.sort_order)
}

async function loadProgress(db: SupabaseClient, coachClientId: string): Promise<Map<string, string | null>> {
  const { data, error } = await db.from("prospect_stage_progress")
    .select("stage_key, reached_at").eq("coach_client_id", coachClientId)
  if (error) throw new Error(`Failed to read progress: ${error.message}`)
  return new Map(((data ?? []) as { stage_key: string; reached_at: string | null }[]).map((p) => [p.stage_key, p.reached_at]))
}

function furthestReached(pipeline: StageDef[], reached: Set<string>): StageDef | null {
  let best: StageDef | null = null
  for (const s of pipeline) {
    if (s.is_terminal || !s.active || !reached.has(s.stage_key)) continue
    if (!best || s.sort_order > best.sort_order) best = s
  }
  return best
}

/**
 * Advance to a stage, marking every active non-terminal stage before it that
 * is not yet reached. One History line per stage newly reached, as the page's
 * click-by-click path wrote. Returns the stage keys newly reached.
 */
export async function advanceProspectTo(
  db: SupabaseClient,
  args: { coachClientId: string; actingIds: string[]; stageKey: string; actor: string | null },
): Promise<StageResult<{ reached: string[]; current_stage_key: string | null }>> {
  const pipeline = await loadPipeline(db, args.actingIds)
  const target = pipeline.find((s) => s.stage_key === args.stageKey)
  if (!target) return { ok: false, error: `stage_key not in your pipeline: ${args.stageKey}`, status: 400 }
  if (!target.active) return { ok: false, error: `stage_key is not an active stage: ${args.stageKey}`, status: 400 }
  if (target.is_terminal) return { ok: false, error: "Converting is not a stage move.", status: 400 }

  const progress = await loadProgress(db, args.coachClientId)
  const toMark = pipeline.filter((s) =>
    s.active && !s.is_terminal && s.sort_order <= target.sort_order && !progress.has(s.stage_key))
  const now = new Date().toISOString()
  for (const s of toMark) {
    const { error } = await db.from("prospect_stage_progress")
      .insert({ coach_client_id: args.coachClientId, stage_key: s.stage_key, reached_at: now })
    if (error) return { ok: false, error: `Failed to record stage: ${error.message}`, status: 500 }
    progress.set(s.stage_key, now)
  }

  const current = furthestReached(pipeline, new Set(progress.keys()))?.stage_key ?? args.stageKey
  const { error: updErr } = await db.from("coach_clients")
    .update({ current_stage_key: current }).eq("id", args.coachClientId)
  if (updErr) return { ok: false, error: `Failed to update current stage: ${updErr.message}`, status: 500 }

  for (const s of toMark) {
    await logProspectEvent(db, {
      coachClientId: args.coachClientId,
      eventType: "stage_changed",
      actor: args.actor,
      context: { stage_key: s.stage_key, stage_label: s.label },
    })
  }
  return { ok: true, data: { reached: toMark.map((s) => s.stage_key), current_stage_key: current } }
}

/**
 * Advance only if the coach's pipeline has this stage, active. A coach may
 * have renamed, removed or turned off "Consult Scheduled"; the consult action
 * still does its real work (the task, the record) and simply moves no stage.
 * Never moves a prospect backwards: a stage already passed is left alone.
 */
export async function advanceIfPresent(
  db: SupabaseClient,
  args: { coachClientId: string; actingIds: string[]; stageKey: string; actor: string | null },
): Promise<string[]> {
  const pipeline = await loadPipeline(db, args.actingIds)
  const target = pipeline.find((s) => s.stage_key === args.stageKey)
  if (!target || !target.active || target.is_terminal) return []
  const r = await advanceProspectTo(db, args)
  if (!r.ok) {
    console.error("[prospects/stages] advance skipped:", r.error)
    return []
  }
  return r.data.reached
}

/**
 * Move a prospect back to an earlier stage it has reached. Every stage after
 * it is un-reached (its progress row removed), so the stage band and the
 * current stage agree. Logged as one History line naming both stages.
 *
 * Refused for a converted prospect: its record lives on as a client, and
 * un-converting is not a stage move.
 */
export async function moveProspectBack(
  db: SupabaseClient,
  args: { coachClientId: string; actingIds: string[]; stageKey: string; actor: string | null },
): Promise<StageResult<{ unreached: string[]; current_stage_key: string }>> {
  const { data: rel, error: relErr } = await db.from("coach_clients")
    .select("lifecycle_status, prospect_status, current_stage_key").eq("id", args.coachClientId).maybeSingle()
  if (relErr) return { ok: false, error: relErr.message, status: 500 }
  if (!rel) return { ok: false, error: "Prospect not found", status: 404 }
  if (rel.lifecycle_status !== "Prospect" || rel.prospect_status === "won") {
    return { ok: false, error: "A converted prospect cannot be moved back a stage.", status: 409 }
  }

  const pipeline = await loadPipeline(db, args.actingIds)
  const target = pipeline.find((s) => s.stage_key === args.stageKey)
  if (!target || target.is_terminal) return { ok: false, error: `stage_key not in your pipeline: ${args.stageKey}`, status: 400 }
  const progress = await loadProgress(db, args.coachClientId)
  if (!progress.has(target.stage_key)) {
    return { ok: false, error: "That stage has not been reached, so there is nothing to move back to.", status: 400 }
  }

  const later = pipeline.filter((s) => !s.is_terminal && s.sort_order > target.sort_order && progress.has(s.stage_key))
  if (!later.length) return { ok: false, error: "The prospect is already at that stage.", status: 400 }

  const from = furthestReached(pipeline, new Set(progress.keys()))
  const { error: delErr } = await db.from("prospect_stage_progress")
    .delete().eq("coach_client_id", args.coachClientId).in("stage_key", later.map((s) => s.stage_key))
  if (delErr) return { ok: false, error: `Failed to move back: ${delErr.message}`, status: 500 }

  const { error: updErr } = await db.from("coach_clients")
    .update({ current_stage_key: target.stage_key }).eq("id", args.coachClientId)
  if (updErr) return { ok: false, error: `Failed to update current stage: ${updErr.message}`, status: 500 }

  await logProspectEvent(db, {
    coachClientId: args.coachClientId,
    eventType: "stage_moved_back",
    actor: args.actor,
    context: {
      stage_key: target.stage_key,
      stage_label: target.label,
      from_stage_key: from?.stage_key ?? null,
      from_stage_label: from?.label ?? null,
      unreached: later.map((s) => s.stage_key),
    },
  })
  return { ok: true, data: { unreached: later.map((s) => s.stage_key), current_stage_key: target.stage_key } }
}
