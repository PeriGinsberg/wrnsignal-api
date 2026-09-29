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
import { createTask, emitTaskEvent, setTaskStatus, type ServiceResult } from "../tasks/service"
import { fallbackLink, resolveLinkTemplate } from "@/lib/tasks/links"
import { sendTaskReopenedEmail } from "../email/sendTaskEmails"
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
  /**
   * How complete_task and reopen_task find their target.
   *
   * "chain" walks chain_id, then brief_id, then the client, and stops at the
   * first one the event can supply. Strict on purpose: an old campaign's share
   * task must not be ticked by a new campaign's share.
   *
   * "client" matches on the client alone, for a task that exists BEFORE any
   * campaign and therefore carries neither id.
   */
  match_scope?: "chain" | "client"
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
  scope: "chain" | "client" = "chain",
): Promise<Task | null> {
  const { data: tmpl } = await db
    .from("coach_task_templates").select("id, title").eq("key", templateKey).maybeSingle()
  if (!tmpl) return null

  /** The scoping, applied the same way to the template and the title pass. */
  const scoped = (q: any) => {
    // "client" ignores the chain and the brief on purpose. See match_scope.
    if (scope === "client") {
      return ev.client_profile_id ? q.eq("client_profile_id", ev.client_profile_id) : null
    }
    // Scoped by the chain when the event carries one, so two clients running
    // the same campaign cannot complete each other's tasks. A chain_id is
    // present on every task the engine creates, so in practice this is always
    // the path taken; the client fallback is for an event from outside a chain.
    if (ev.payload?.chain_id) return q.eq("chain_id", ev.payload.chain_id)
    if (ev.payload?.brief_id) return q.eq("brief_id", ev.payload.brief_id)
    if (ev.client_profile_id) return q.eq("client_profile_id", ev.client_profile_id)
    return null
  }

  const base = () => db.from("coach_tasks").select("*")
    .eq("status", wanted).is("deleted_at", null)

  const byTemplate = scoped(base().eq("template_id", tmpl.id))
  if (byTemplate) {
    const { data } = await byTemplate.order("created_at", { ascending: wanted === "open" }).limit(1)
    if (data?.[0]) return data[0] as unknown as Task
  }

  // THE TITLE FALLBACK, for tasks that predate the template.
  //
  // "Define Networking Campaign" was a task coaches typed by hand long before
  // it was a template, so the rows already on prod have a null template_id and
  // nothing but their title to recognise them by. Restricted to template-less
  // tasks: a task the engine created has a template_id, and matching those by
  // title as well would give two ways to find the same row.
  const byTitle = scoped(base().is("template_id", null).eq("title", tmpl.title))
  if (!byTitle) return null
  const { data } = await byTitle.order("created_at", { ascending: wanted === "open" }).limit(1)
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

    // WHOSE TASK IS THIS?
    //
    // A template names one default assignee, which is right for "Erin builds
    // every campaign" and wrong for a task belonging to whoever coaches this
    // particular client. assign_to_lead_coach resolves it per task, from the
    // relationship the event carries.
    //
    // FALLS BACK RATHER THAN FAILING. A relationship with no coach, or a coach
    // row that is not assignable, should not swallow the task: the default is
    // still a real coach who can act on it and reassign it, which is a far
    // better outcome than the chain stopping.
    let assignee = String(tmpl.default_assignee_profile_id)
    if (tmpl.assign_to_lead_coach === true) {
      const coachClientId = ev.payload?.coach_client_id ?? null
      const { data: rel } = coachClientId
        ? await db.from("coach_clients").select("coach_profile_id").eq("id", coachClientId).maybeSingle()
        : ev.client_profile_id
          ? await db.from("coach_clients").select("coach_profile_id")
              .eq("client_profile_id", ev.client_profile_id).eq("status", "active").limit(1).maybeSingle()
          : { data: null as any }
      if (rel?.coach_profile_id) assignee = String(rel.coach_profile_id)
      else console.warn(`[automation] ${tmpl.key}: no lead coach found, using the template default`)
    }

    // The due offset lives on the template and is usually +1 day. It is a
    // default, not a rule: the task's due_at is editable the moment it exists.
    //
    // NULL MEANS NO DUE DATE, and is not the same as 0. A template with no
    // natural deadline ("Define Networking Campaign") must not be handed one,
    // because a task that goes overdue on its own trains the overdue digest to
    // be ignored. `Number(null) || 0` read that as today, which is the bug this
    // spells out rather than relies on.
    let dueAt: string | null = null
    if (tmpl.due_offset_days !== null && tmpl.due_offset_days !== undefined) {
      const due = new Date()
      due.setDate(due.getDate() + (Number(tmpl.due_offset_days) || 0))
      due.setHours(12, 0, 0, 0)
      dueAt = due.toISOString()
    }

    // WHERE THIS TASK IS DONE.
    //
    // From the template's own pattern, so a sixth networking step stays an
    // INSERT. The fallback is the client record: a rule that stopped firing
    // because somebody added a template without a link_template would be an
    // automation silently going dark, which is worse than a Go button that
    // lands one click short. If neither resolves, createTask refuses the task
    // and the event is recorded with an error, which is visible and replayable.
    const link =
      resolveLinkTemplate(tmpl.link_template as string | null, {
        clientId: ev.client_profile_id,
        briefId: ev.payload?.brief_id ?? null,
      }) ?? fallbackLink(ev.client_profile_id)

    const created = await createTask(db, {
      title: String(tmpl.title),
      link,
      description: tmpl.description ?? null,
      client_profile_id: ev.client_profile_id,
      coach_client_id: ev.payload?.coach_client_id ?? null,
      assignee_profile_id: assignee,
      due_at: dueAt,
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
    rule.match_scope ?? "chain",
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
  const note = ev.payload?.note ? String(ev.payload.note) : null
  const r: ServiceResult<Task> = await setTaskStatus(db, target.id, "open", null, {
    note: note ?? "Reopened automatically",
  })
  if (!r.ok) return { outcome: "error", detail: r.error }

  // AND THE PERSON WHO HAS TO ACT ON IT IS TOLD. A task that quietly comes
  // back sits in a list the builder has already stopped looking at, and the
  // reviewer ends up chasing it by hand. Awaited, because a floating promise
  // on a serverless function is dropped when the request ends.
  await sendTaskReopenedEmail(db, target.id, note)
  return { outcome: "reopened", detail: target.id }
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

/**
 * Emit an event and immediately work the queue.
 *
 * THE CHAIN SHOULD MOVE WHILE THE COACH IS STILL LOOKING AT THE SCREEN. A
 * coach who ticks "Create Networking Campaign" and does not see the review task
 * appear has no way to tell a working system from a broken one, and the cron
 * that would eventually produce it runs every half hour.
 *
 * The drain is wrapped, because it must never fail the write that emitted. The
 * event row is already appended by that point, so a failure here means the
 * cron picks it up later, which is exactly the fallback the cron is for.
 */
export async function emitAndRun(
  db: SupabaseClient,
  eventKey: string,
  payload: Record<string, unknown>,
  clientProfileId: string | null,
): Promise<RunResult[]> {
  await emitTaskEvent(db, eventKey, payload, clientProfileId)
  try {
    return await drain(db)
  } catch (e: any) {
    console.error(`[automation] drain after ${eventKey} failed:`, e?.message ?? e)
    return []
  }
}
