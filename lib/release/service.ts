// lib/release/service.ts
//
// The Release-step email on the server: the coach's templates, the draft for
// one client step, and the send.
//
// WHOSE TEMPLATES. The client's main coach's (coach_clients.coach_profile_id),
// like the welcome email: the step was copied from that coach's library, and
// its source_activity_id points at the library step the template hangs on. A
// step with no source (added by hand, or attached before the 2026-10-04
// library import) has no email.
//
// THE SEND, in order:
//   1. check it is a client step on this client's plan, Active or Upcoming,
//      not the welcome task (that has its own email), and it has a template
//   2. refuse while a [bracket] is left (lib/release/model.ts)
//   3. send it as the signed-in coach's message (lib/messaging/sendCoachMessage.ts):
//      their From, their signature, saved to Communications. If it fails,
//      nothing changes.
//   4. release the step through the plan's own rules (lib/plan/service.ts)
//
// The provider is passed in so the rules run against the fake database.

import type { SupabaseClient } from "@supabase/supabase-js"
import { logProspectEvent } from "../prospects/history"
import { applyTaskAction } from "../plan/service"
import { sendCoachMessage } from "../messaging/sendCoachMessage"
import type { MessageProvider } from "../messaging/types"
import { firstNameOf } from "../sow/model"
import {
  RELEASE_BODY_MAX,
  RELEASE_SUBJECT_MAX,
  fillReleaseFields,
  normalizeReleaseLink,
  releaseProblem,
  type ReleaseTemplate,
} from "./model"

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number }
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status })

const TEMPLATE_COLUMNS = "activity_id, subject, body, scheduling_link"

// ── Templates ────────────────────────────────────────────────────────────────

/** A client step in the coach's library, with its email if it has one. */
export type ReleaseStep = {
  activity_id: string
  deliverable: string
  name: string
  template: ReleaseTemplate | null
}

/** Every client step in the coach's library, in library order, each with its email or null. */
export async function getReleaseSteps(db: SupabaseClient, coachId: string): Promise<ReleaseStep[]> {
  const { data: ms, error: e1 } = await db.from("coach_milestones").select("id, name, sort_order, active")
    .eq("coach_profile_id", coachId)
  if (e1) throw new Error(`Failed to read the library: ${e1.message}`)
  const milestones = ((ms ?? []) as { id: string; name: string; sort_order: number; active: boolean }[])
    .filter((m) => m.active !== false).sort((a, b) => a.sort_order - b.sort_order)
  if (!milestones.length) return []
  const { data: acts, error: e2 } = await db.from("coach_milestone_activities").select("id, milestone_id, name, owner, sort_order")
    .in("milestone_id", milestones.map((m) => m.id))
  if (e2) throw new Error(`Failed to read the library steps: ${e2.message}`)
  const { data: ts, error: e3 } = await db.from("coach_release_templates").select(TEMPLATE_COLUMNS).eq("coach_profile_id", coachId)
  if (e3) throw new Error(`Failed to read the release emails: ${e3.message}`)
  const templates = new Map(((ts ?? []) as ReleaseTemplate[]).map((t) => [t.activity_id, t]))
  const steps = ((acts ?? []) as { id: string; milestone_id: string; name: string; owner: string; sort_order: number }[])
    .filter((a) => a.owner === "client")
  const out: ReleaseStep[] = []
  for (const m of milestones) {
    for (const a of steps.filter((s) => s.milestone_id === m.id).sort((x, y) => x.sort_order - y.sort_order)) {
      out.push({ activity_id: a.id, deliverable: m.name, name: a.name, template: templates.get(a.id) ?? null })
    }
  }
  return out
}

/** Is this library step one of the coach's client steps? */
async function ownsClientStep(db: SupabaseClient, coachId: string, activityId: string): Promise<boolean> {
  const { data: a } = await db.from("coach_milestone_activities").select("id, milestone_id, owner").eq("id", activityId).maybeSingle()
  const act = a as { milestone_id: string; owner: string } | null
  if (!act || act.owner !== "client") return false
  const { data: m } = await db.from("coach_milestones").select("coach_profile_id").eq("id", act.milestone_id).maybeSingle()
  return (m as { coach_profile_id: string } | null)?.coach_profile_id === coachId
}

/** Save one step's email. Subject and message are required; the scheduling link may be blank. */
export async function saveReleaseTemplate(db: SupabaseClient, coachId: string, input: unknown): Promise<Result<ReleaseTemplate>> {
  const b = (input ?? {}) as Record<string, unknown>
  const activityId = typeof b.activity_id === "string" ? b.activity_id : ""
  if (!activityId || !(await ownsClientStep(db, coachId, activityId))) return fail("That step isn't one of your client steps.", 404)
  const subject = typeof b.subject === "string" ? b.subject.replace(/[\r\n]+/g, " ").trim() : ""
  const body = typeof b.body === "string" ? b.body.replace(/\r\n/g, "\n").trim() : ""
  if (!subject) return fail("The email needs a subject.")
  if (subject.length > RELEASE_SUBJECT_MAX) return fail(`The subject can be at most ${RELEASE_SUBJECT_MAX} characters.`)
  if (!body) return fail("The email needs a message.")
  if (body.length > RELEASE_BODY_MAX) return fail(`The message can be at most ${RELEASE_BODY_MAX} characters.`)
  const link = normalizeReleaseLink(b.scheduling_link)
  if ("error" in link) return fail(link.error)
  const row = { activity_id: activityId, subject, body, scheduling_link: link.value }
  const { data: existing } = await db.from("coach_release_templates").select("activity_id").eq("activity_id", activityId).maybeSingle()
  const { error } = existing
    ? await db.from("coach_release_templates").update(row).eq("activity_id", activityId)
    : await db.from("coach_release_templates").insert({ coach_profile_id: coachId, ...row })
  if (error) return fail(`Failed to save the email: ${error.message}`, 500)
  return { ok: true, data: row }
}

/** Remove one step's email: the step goes back to a plain Release. */
export async function deleteReleaseTemplate(db: SupabaseClient, coachId: string, activityId: unknown): Promise<Result<null>> {
  if (typeof activityId !== "string" || !activityId || !(await ownsClientStep(db, coachId, activityId))) {
    return fail("That step isn't one of your client steps.", 404)
  }
  const { error } = await db.from("coach_release_templates").delete().eq("activity_id", activityId).eq("coach_profile_id", coachId)
  if (error) return fail(`Failed to remove the email: ${error.message}`, 500)
  return { ok: true, data: null }
}

// ── One client ───────────────────────────────────────────────────────────────

/** The client's main coach. */
async function mainCoachId(db: SupabaseClient, coachClientId: string): Promise<string | null> {
  const { data } = await db.from("coach_clients").select("coach_profile_id").eq("id", coachClientId).maybeSingle()
  return (data as { coach_profile_id: string } | null)?.coach_profile_id ?? null
}

/** Which of these plan tasks have an email: client tasks whose library step has a template. */
export async function tasksWithReleaseEmail(db: SupabaseClient, coachClientId: string, taskIds: string[]): Promise<Set<string>> {
  if (!taskIds.length) return new Set()
  const coachId = await mainCoachId(db, coachClientId)
  if (!coachId) return new Set()
  const { data: rows } = await db.from("coach_client_engagement_activities").select("id, owner, source_activity_id").in("id", taskIds)
  const linked = ((rows ?? []) as { id: string; owner: string; source_activity_id: string | null }[])
    .filter((r) => r.owner === "client" && r.source_activity_id)
  if (!linked.length) return new Set()
  const { data: ts } = await db.from("coach_release_templates").select("activity_id")
    .eq("coach_profile_id", coachId).in("activity_id", [...new Set(linked.map((r) => r.source_activity_id!))])
  const has = new Set(((ts ?? []) as { activity_id: string }[]).map((t) => t.activity_id))
  return new Set(linked.filter((r) => has.has(r.source_activity_id!)).map((r) => r.id))
}

export type ReleaseDraft = {
  task: { id: string; name: string }
  subject: string
  body: string
  scheduling_link: string | null
}

type TaskRow = {
  id: string; name: string; owner: string; state: string; welcome_release: boolean | null
  engagement_deliverable_id: string; source_activity_id: string | null
}

/** What the Message panel opens with: the step's template, with the fields SIGNAL can fill filled. */
export async function loadReleaseDraft(db: SupabaseClient, coachClientId: string, taskId: string): Promise<Result<ReleaseDraft>> {
  const { data: t } = await db.from("coach_client_engagement_activities")
    .select("id, name, owner, state, welcome_release, engagement_deliverable_id, source_activity_id").eq("id", taskId).maybeSingle()
  const task = t as TaskRow | null
  if (!task) return fail("Task not found", 404)
  const { data: d } = await db.from("coach_client_engagement_deliverables").select("engagement_id").eq("id", task.engagement_deliverable_id).maybeSingle()
  const { data: e } = d ? await db.from("coach_client_engagements").select("coach_client_id").eq("id", (d as { engagement_id: string }).engagement_id).maybeSingle() : { data: null }
  if (!e || (e as { coach_client_id: string }).coach_client_id !== coachClientId) return fail("Task not found", 404)
  if (task.owner !== "client") return fail("Only a client step has a release email.", 409)
  if (task.welcome_release) return fail("This is the welcome task. Release it to send the welcome email.", 409)
  if (task.state !== "active" && task.state !== "upcoming") return fail("This step has already been released.", 409)

  const { data: c } = await db.from("coach_clients").select("coach_profile_id, name, client_profile_id, workspace_folder_url")
    .eq("id", coachClientId).maybeSingle()
  const rel = c as { coach_profile_id: string; name: string | null; client_profile_id: string | null; workspace_folder_url: string | null } | null
  if (!rel) return fail("Client not found", 404)
  if (!task.source_activity_id) return fail("This step has no email in Settings.", 404)
  const { data: tpl } = await db.from("coach_release_templates").select(TEMPLATE_COLUMNS)
    .eq("activity_id", task.source_activity_id).eq("coach_profile_id", rel.coach_profile_id).maybeSingle()
  const template = tpl as ReleaseTemplate | null
  if (!template) return fail("This step has no email in Settings.", 404)

  let name = rel.name?.trim() || null
  if (!name && rel.client_profile_id) {
    const { data: p } = await db.from("client_profiles").select("name").eq("id", rel.client_profile_id).maybeSingle()
    name = (p as { name: string | null } | null)?.name?.trim() || null
  }
  const fields = { firstName: firstNameOf(name), drive: rel.workspace_folder_url?.trim() || null, scheduling: template.scheduling_link }
  return {
    ok: true,
    data: {
      task: { id: task.id, name: task.name },
      subject: fillReleaseFields(template.subject, fields),
      body: fillReleaseFields(template.body, fields),
      scheduling_link: template.scheduling_link,
    },
  }
}

/** Send the coach's edited draft, then release the step. */
export async function sendReleaseEmail(
  db: SupabaseClient,
  args: {
    coachClientId: string
    taskId: string
    /** The signed-in coach: the email goes from them. */
    actor: string
    subject?: unknown
    body?: unknown
    ccParent?: unknown
    /** Typed CC addresses (lib/email/cc.ts). */
    cc?: unknown
    provider?: MessageProvider
  },
): Promise<Result<{ to: string; redirected: boolean }>> {
  const draft = await loadReleaseDraft(db, args.coachClientId, args.taskId)
  if (!draft.ok) return draft
  const subject = typeof args.subject === "string" ? args.subject.replace(/[\r\n]+/g, " ").trim() : ""
  const body = typeof args.body === "string" ? args.body.replace(/\r\n/g, "\n").trim() : ""
  const problem = releaseProblem(subject, body)
  if (problem) return fail(problem)

  const sent = await sendCoachMessage(db, {
    coachClientId: args.coachClientId,
    actor: args.actor,
    input: { channel: "email", subject, body, cc_parent: args.ccParent === true, cc: args.cc },
    provider: args.provider,
  })
  if (!sent.ok) return fail(`${sent.error} Nothing changed: the step is still waiting to be released.`, sent.status)

  await logProspectEvent(db, {
    coachClientId: args.coachClientId, eventType: "release_email_sent", actor: args.actor,
    context: { to: sent.data.to, subject, task: draft.data.task.name, message_id: sent.data.message_id },
  })
  const released = await applyTaskAction(db, { coachClientId: args.coachClientId, taskId: args.taskId, action: "release", actor: args.actor })
  if (!released.ok) {
    return fail(`The email went to ${sent.data.to}, but the step did not release: ${released.error}. Release it from the Plan.`, released.status)
  }
  return { ok: true, data: { to: sent.data.to, redirected: sent.data.redirected } }
}
