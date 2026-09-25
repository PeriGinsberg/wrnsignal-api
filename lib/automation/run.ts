// lib/automation/run.ts
//
// The rules engine. Reads unprocessed rows from coach_automation_events,
// matches them against coach_automation_rules, and applies the action.
//
// NOTHING ABOUT THE NETWORKING CHAIN IS IN THIS FILE. The chain is rows: four
// templates and seven rules, seeded by tests/automation/seed-networking-chain.ts.
// That is the whole point of moving this out of GoHighLevel rather than
// reimplementing it in TypeScript, and the test of whether it worked is that a
// second chain needs no code.
//
// THE RUNNER IS SEPARATE FROM THE EMITTER ON PURPOSE. A rule that throws must
// not take down the request that emitted the event: the first event in the
// chain fires inside a client's profile submission. Events are appended there
// and applied here, so a failure leaves a row with an error and no
// processed_at, which is visible and replayable.

import type { SupabaseClient } from "@supabase/supabase-js"
import { createTask, setTaskStatus, type ServiceResult } from "../tasks/service"
import type { Task } from "../tasks/model"

export type RuleAction = "create_task" | "complete_task" | "reopen_task"

export type AutomationRule = {
  id: string
  event_key: string
  action: RuleAction
  template_id: string | null
  target_template_key: string | null
  condition: Record<string, unknown>
  active: boolean
  sort_order: number
}

export type AutomationEvent = {
  id: string
  event_key: string
  payload: Record<string, any>
  client_profile_id: string | null
  occurred_at: string
}

export type Outcome = "created" | "completed" | "reopened" | "no_match" | "no_rule" | "error"

export type RunResult = { eventId: string; outcome: Outcome; detail?: string }

/**
 * Does every key in `condition` appear in the payload with the same value?
 *
 * Deliberately shallow and exact. A rule condition is `{"template_key": "...",
 * "decision": "approve"}` and nothing more; giving it operators would invite a
 * query language nobody asked for, and the moment a condition needs one, a
 * rule is doing something that belongs in code.
 *
 * An empty condition matches every event with that key.
 */
export function conditionMatches(condition: Record<string, unknown>, payload: Record<string, any>): boolean {
  for (const [k, v] of Object.entries(condition ?? {})) {
    if (payload?.[k] !== v) return false
  }
  return true
}

/**
 * The task a complete_task or reopen_task rule acts on, if there is one.
 *
 * THE TWO LOOK FOR OPPOSITE STATES, which is the thing to get right.
 * complete_task needs a task that is still open; reopen_task needs one that is
 * already closed, because "send it back" only means anything once it has been
 * handed in. Looking for an open task in both cases meant Request Changes
 * silently did nothing: task one had just been completed, so there was no open
 * one to find, and the rule recorded a no_match.
 */
async function findTargetTask(
  db: SupabaseClient,
  templateKey: string,
  ev: AutomationEvent,
  wanted: "open" | "done",
): Promise<Task | null> {
  const { data: tmpl } = await db
    .from("coach_task_templates").select("id").eq("key", templateKey).maybeSingle()
  if (!tmpl) return null

  // Scoped by the chain when the event carries one, so two clients running the
  // same campaign cannot complete each other's tasks. A chain_id is present on
  // every task the engine creates, so in practice this is always the path
  // taken; the client fallback exists for an event emitted from outside a chain.
  let q = db.from("coach_tasks").select("*")
    .eq("template_id", tmpl.id).eq("status", wanted).is("deleted_at", null)

  if (ev.payload?.chain_id) q = q.eq("chain_id", ev.payload.chain_id)
  else if (ev.payload?.brief_id) q = q.eq("brief_id", ev.payload.brief_id)
  else if (ev.client_profile_id) q = q.eq("client_profile_id", ev.client_profile_id)
  else return null

  const { data } = await q.order("created_at", { ascending: wanted === "open" }).limit(1)
  return (data?.[0] as unknown as Task) ?? null
}

/**
 * Apply one rule to one event.
 *
 * NO MATCHING OPEN TASK IS A NORMAL OUTCOME, NOT AN ERROR. At cutover there
 * are clients already part-way through networking: their plan exists, or has
 * been shared, and no task was ever created for them. When
 * networking_plan.shared fires for one of those, the rule looks for an open
 * share task, finds none, and stops. It must not create the task in order to
 * complete it, and it must not raise.
 */
async function applyRule(
  db: SupabaseClient,
  rule: AutomationRule,
  ev: AutomationEvent,
): Promise<{ outcome: Outcome; detail?: string }> {
  if (rule.action === "create_task") {
    if (!rule.template_id) return { outcome: "error", detail: "create_task rule has no template" }

    const { data: tmpl } = await db
      .from("coach_task_templates").select("*").eq("id", rule.template_id).maybeSingle()
    if (!tmpl) return { outcome: "error", detail: "template not found" }
    if (tmpl.active === false) return { outcome: "no_match", detail: "template inactive" }

    // The due offset lives on the template and defaults to +1 day. It is a
    // default, not a rule: the task's due_at is editable the moment it exists.
    const due = new Date()
    due.setDate(due.getDate() + (Number(tmpl.due_offset_days) || 0))
    due.setHours(12, 0, 0, 0)

    const created = await createTask(db, {
      title: String(tmpl.title),
      description: tmpl.description ?? null,
      client_profile_id: ev.client_profile_id,
      coach_client_id: ev.payload?.coach_client_id ?? null,
      assignee_profile_id: String(tmpl.default_assignee_profile_id),
      due_at: due.toISOString(),
      due_has_time: false,
      source: "auto",
      template_id: tmpl.id,
      // The chain carries forward from the event, or starts here. Every task in
      // one run of the chain shares it, which is how the engine finds the right
      // open task later without guessing by client.
      chain_id: ev.payload?.chain_id ?? ev.id,
      brief_id: ev.payload?.brief_id ?? null,
    }, null)

    if (!created.ok) return { outcome: "error", detail: created.error }
    return { outcome: "created", detail: created.data.id }
  }

  if (!rule.target_template_key) {
    return { outcome: "error", detail: `${rule.action} rule names no target` }
  }
  const target = await findTargetTask(
    db, rule.target_template_key, ev, rule.action === "reopen_task" ? "done" : "open",
  )
  if (!target) {
    const state = rule.action === "reopen_task" ? "completed" : "open"
    return { outcome: "no_match", detail: `no ${state} ${rule.target_template_key}` }
  }

  if (rule.action === "complete_task") {
    const r = await setTaskStatus(db, target.id, "done", null, { note: "Completed automatically" })
    return r.ok ? { outcome: "completed", detail: target.id } : { outcome: "error", detail: r.error }
  }

  // reopen_task. The note is the whole point: Request Changes reopens task one
  // and the reason has to travel with it.
  const r: ServiceResult<Task> = await setTaskStatus(db, target.id, "open", null, {
    note: ev.payload?.note ? String(ev.payload.note) : "Reopened automatically",
  })
  return r.ok ? { outcome: "reopened", detail: target.id } : { outcome: "error", detail: r.error }
}

/**
 * Process one event. Marks it processed whatever happens, including when
 * nothing matched, because an unprocessed row means work outstanding and must
 * never be the record of a deliberate no-op.
 */
export async function runEvent(db: SupabaseClient, ev: AutomationEvent): Promise<RunResult> {
  const { data: rules } = await db
    .from("coach_automation_rules").select("*")
    .eq("event_key", ev.event_key).eq("active", true)
    .order("sort_order", { ascending: true })

  const matching = (rules ?? []).filter((r: any) => conditionMatches(r.condition ?? {}, ev.payload ?? {}))

  if (!matching.length) {
    await db.from("coach_automation_events")
      .update({ processed_at: new Date().toISOString(), outcome: "no_rule" }).eq("id", ev.id)
    return { eventId: ev.id, outcome: "no_rule" }
  }

  const outcomes: string[] = []
  let worst: Outcome = "no_match"
  for (const rule of matching as AutomationRule[]) {
    try {
      const r = await applyRule(db, rule, ev)
      outcomes.push(`${rule.action}:${r.outcome}${r.detail ? `(${r.detail})` : ""}`)
      if (r.outcome === "error") worst = "error"
      else if (worst !== "error") worst = r.outcome
    } catch (e: any) {
      outcomes.push(`${rule.action}:threw(${e?.message ?? e})`)
      worst = "error"
    }
  }

  const summary = outcomes.join("; ")
  await db.from("coach_automation_events").update({
    processed_at: new Date().toISOString(),
    outcome: worst,
    // An errored event keeps its text so it can be read and replayed rather
    // than only counted.
    error: worst === "error" ? summary : null,
  }).eq("id", ev.id)

  return { eventId: ev.id, outcome: worst, detail: summary }
}

/**
 * Drain the queue.
 *
 * Oldest first, because the chain depends on order: completing task one has to
 * be processed before the event that its completion produced.
 */
export async function runPending(db: SupabaseClient, limit = 50): Promise<RunResult[]> {
  const { data, error } = await db
    .from("coach_automation_events").select("*")
    .is("processed_at", null)
    .order("occurred_at", { ascending: true })
    .limit(limit)

  if (error) {
    console.error("[automation] could not read the queue:", error.message)
    return []
  }

  const out: RunResult[] = []
  for (const ev of (data ?? []) as unknown as AutomationEvent[]) {
    out.push(await runEvent(db, ev))
  }
  return out
}

/**
 * Drain the queue completely, including what processing it produces.
 *
 * ONE PASS ONLY ADVANCES THE CHAIN ONE STEP. Completing a task emits
 * task.completed, and that event did not exist when the pass fetched its
 * batch. So "plan generated" completed the build task and stopped, and the
 * share task it should have created appeared only on the next run. Every
 * caller wants the cascade, so the loop belongs here rather than in each of
 * them.
 *
 * CAPPED, because a rule that re-emits its own trigger would otherwise spin
 * forever. Ten passes is far more than the Networking chain needs (its
 * longest cascade is two) and hitting the cap is a bug worth shouting about
 * rather than absorbing.
 */
export async function drain(
  db: SupabaseClient,
  opts: { maxPasses?: number; batch?: number } = {},
): Promise<RunResult[]> {
  const maxPasses = opts.maxPasses ?? 10
  const all: RunResult[] = []
  for (let pass = 1; pass <= maxPasses; pass++) {
    const results = await runPending(db, opts.batch ?? 50)
    all.push(...results)
    if (!results.length) return all
    if (pass === maxPasses) {
      console.error(
        `[automation] drain hit ${maxPasses} passes with work still queued. ` +
        "A rule is probably re-emitting its own trigger.",
      )
    }
  }
  return all
}
