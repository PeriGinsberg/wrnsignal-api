// lib/automation/timers.ts
//
// Time-based rules: "when A happens, wait N days, then fire B, unless C
// happens first".
//
// A 'schedule' rule does not act; it leaves a timer. The timer fires its event
// into the ordinary queue, so whatever B should do (create a task, today) is an
// ordinary rule on B. That keeps the waiting in one place and the doing in
// another: the booking follow-up and the SOW day-3 and day-7 follow-ups are
// all one schedule rule plus one create_task rule, and none of them is code.
//
// Timers are scoped to one relationship (coach_client_id), or failing that one
// client, so a booking for one prospect never cancels another's follow-up.

import type { SupabaseClient } from "@supabase/supabase-js"
import { emitTaskEvent } from "../tasks/service"

const DAY_MS = 24 * 60 * 60 * 1000

export type ScheduleRule = {
  id: string
  delay_days: number | null
  fires_event_key: string | null
  cancel_on_event_keys?: string[] | null
}

export type TimerSource = {
  id: string
  event_key: string
  payload: Record<string, unknown>
  client_profile_id: string | null
  occurred_at: string
}

export type Timer = {
  id: string
  fires_event_key: string
  fire_at: string
  cancel_on_event_keys: string[]
  payload: Record<string, unknown>
  client_profile_id: string | null
  coach_client_id: string | null
  fired_at: string | null
  cancelled_at: string | null
}

/**
 * Leave the timer a schedule rule asks for. Counted from when the event
 * happened, not from when the queue got to it, so a late drain does not
 * stretch the wait.
 */
export async function scheduleTimer(
  db: SupabaseClient,
  rule: ScheduleRule,
  ev: TimerSource,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (rule.delay_days == null || rule.delay_days < 0 || !rule.fires_event_key) {
    return { ok: false, error: "schedule rule needs delay_days and fires_event_key" }
  }
  const coachClientId = typeof ev.payload?.coach_client_id === "string" ? ev.payload.coach_client_id : null
  if (!coachClientId && !ev.client_profile_id) {
    return { ok: false, error: "schedule needs an event about a client or prospect" }
  }
  const from = ev.occurred_at ? new Date(ev.occurred_at).getTime() : Date.now()
  const fireAt = new Date(from + rule.delay_days * DAY_MS).toISOString()
  const { data, error } = await db.from("coach_automation_timers").insert({
    rule_id: rule.id,
    source_event_id: ev.id,
    fires_event_key: rule.fires_event_key,
    fire_at: fireAt,
    cancel_on_event_keys: rule.cancel_on_event_keys ?? [],
    payload: ev.payload ?? {},
    client_profile_id: ev.client_profile_id,
    coach_client_id: coachClientId,
  }).select("id").single()
  if (error || !data) return { ok: false, error: error?.message ?? "timer insert failed" }
  return { ok: true, id: String(data.id) }
}

/**
 * Cancel the waiting timers this event is a "unless C happens first" for.
 * Runs for every event, before its rules, whether or not it has any rules of
 * its own: consult.booked exists mainly to do this.
 */
export async function cancelTimersFor(db: SupabaseClient, ev: TimerSource, now = new Date()): Promise<number> {
  const coachClientId = typeof ev.payload?.coach_client_id === "string" ? ev.payload.coach_client_id : null
  if (!coachClientId && !ev.client_profile_id) return 0
  let q = db.from("coach_automation_timers").select("id, cancel_on_event_keys")
    .is("fired_at", null).is("cancelled_at", null)
  q = coachClientId ? q.eq("coach_client_id", coachClientId) : q.eq("client_profile_id", ev.client_profile_id)
  const { data, error } = await q
  if (error) {
    console.error("[automation] reading timers to cancel failed:", error.message)
    return 0
  }
  const ids = ((data ?? []) as { id: string; cancel_on_event_keys: string[] | null }[])
    .filter((t) => (t.cancel_on_event_keys ?? []).includes(ev.event_key))
    .map((t) => t.id)
  if (!ids.length) return 0
  const { error: upErr } = await db.from("coach_automation_timers")
    .update({ cancelled_at: now.toISOString(), cancelled_by_event_key: ev.event_key })
    .in("id", ids).is("fired_at", null)
  if (upErr) {
    console.error("[automation] cancelling timers failed:", upErr.message)
    return 0
  }
  return ids.length
}

/**
 * Fire every timer that has come due. Each is taken with one conditional
 * update, so two runners reaching the same timer fire it once.
 */
export async function fireDueTimers(db: SupabaseClient, now = new Date()): Promise<number> {
  const { data, error } = await db.from("coach_automation_timers").select("*")
    .is("fired_at", null).is("cancelled_at", null)
    .lte("fire_at", now.toISOString())
    .order("fire_at", { ascending: true })
    .limit(100)
  if (error) {
    console.error("[automation] reading due timers failed:", error.message)
    return 0
  }
  let fired = 0
  for (const t of (data ?? []) as Timer[]) {
    const { data: took, error: takeErr } = await db.from("coach_automation_timers")
      .update({ fired_at: now.toISOString() })
      .eq("id", t.id).is("fired_at", null).is("cancelled_at", null)
      .select("id")
    if (takeErr || (took ?? []).length !== 1) continue
    await emitTaskEvent(db, t.fires_event_key, {
      ...(t.payload ?? {}),
      coach_client_id: t.coach_client_id,
      timer_id: t.id,
    }, t.client_profile_id)
    fired++
  }
  return fired
}
