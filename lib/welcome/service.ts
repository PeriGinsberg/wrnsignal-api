// lib/welcome/service.ts
//
// The welcome email on the server: the coach's four templates, the editor's
// starting point for one client, and the send.
//
// THE SEND, in order:
//   1. check it is this client's welcome task and it has not gone out yet
//   2. with Send: check the email, send it (Postmark, the signal-client layout
//      adds the signature), and log it. If the email fails, nothing changes.
//   3. either way, release the task through the plan's own rules, which shares
//      the Drive workspace with the client, as before (lib/plan/service.ts).
//   With Don't send, History says the task went out without an email.
//
// The email sender and the Drive calls are passed in so the rules run against
// the fake database.

import type { SupabaseClient } from "@supabase/supabase-js"
import { sendToClient, type SendResult } from "../email/send"
import { logProspectEvent } from "../prospects/history"
import { applyTaskAction } from "../plan/service"
import type { DriveApi } from "../sow/workspace"
import { firstNameOf } from "../sow/model"
import {
  WELCOME_BODY_MAX,
  WELCOME_EMAIL_TEMPLATE,
  WELCOME_START_LABEL,
  WELCOME_STARTS,
  WELCOME_SUBJECT_MAX,
  fillFirstName,
  isWelcomeStart,
  normalizeLink,
  renderWelcomeEmail,
  startForPhase,
  welcomeProblem,
  type WelcomeStart,
  type WelcomeTemplate,
} from "./model"

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number }
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status })

export type SendEmail = (args: Parameters<typeof sendToClient>[0]) => Promise<SendResult>

// ── Templates ────────────────────────────────────────────────────────────────

/** The coach's templates, one per starting point they have saved, in the fixed order. */
export async function getWelcomeTemplates(db: SupabaseClient, coachId: string): Promise<WelcomeTemplate[]> {
  const { data, error } = await db.from("coach_welcome_templates").select("start_key, subject, body, scheduling_link").eq("coach_profile_id", coachId)
  if (error) throw new Error(`Failed to read the welcome emails: ${error.message}`)
  const rows = (data ?? []) as WelcomeTemplate[]
  return WELCOME_STARTS.map((k) => rows.find((r) => r.start_key === k)).filter((r): r is WelcomeTemplate => !!r)
}

/** Save one template. Subject and message are required; the scheduling link may be blank. */
export async function saveWelcomeTemplate(db: SupabaseClient, coachId: string, input: unknown): Promise<Result<WelcomeTemplate>> {
  const b = (input ?? {}) as Record<string, unknown>
  if (!isWelcomeStart(b.start_key)) return fail("Unknown welcome email.")
  const subject = typeof b.subject === "string" ? b.subject.trim() : ""
  const body = typeof b.body === "string" ? b.body.replace(/\r\n/g, "\n").trim() : ""
  if (!subject) return fail("The welcome email needs a subject.")
  if (subject.length > WELCOME_SUBJECT_MAX) return fail(`The subject can be at most ${WELCOME_SUBJECT_MAX} characters.`)
  if (!body) return fail("The welcome email needs a message.")
  if (body.length > WELCOME_BODY_MAX) return fail(`The message can be at most ${WELCOME_BODY_MAX} characters.`)
  const link = normalizeLink(b.scheduling_link)
  if ("error" in link) return fail(link.error)
  const row = { start_key: b.start_key, subject, body, scheduling_link: link.value }
  const { data: existing } = await db.from("coach_welcome_templates").select("start_key")
    .eq("coach_profile_id", coachId).eq("start_key", row.start_key).maybeSingle()
  const { error } = existing
    ? await db.from("coach_welcome_templates").update(row).eq("coach_profile_id", coachId).eq("start_key", row.start_key)
    : await db.from("coach_welcome_templates").insert({ coach_profile_id: coachId, ...row })
  if (error) return fail(`Failed to save the welcome email: ${error.message}`, 500)
  return { ok: true, data: row }
}

// ── One client's welcome email ───────────────────────────────────────────────

export type WelcomeDraft = {
  task: { id: string; name: string }
  to: string | null
  parent_email: string | null
  first_name: string
  drive_url: string | null
  /** The template this plan's start matches, or null for the coach to pick. */
  match: WelcomeStart | null
  /** The phase the welcome task sits in, for the editor to name. */
  phase: string | null
  templates: WelcomeTemplate[]
}

type Rel = {
  id: string; coach_profile_id: string; client_profile_id: string | null; name: string | null
  invited_email: string | null; parent_email: string | null; workspace_folder_url: string | null
}

async function clientEmail(db: SupabaseClient, r: Rel): Promise<string | null> {
  if (r.invited_email?.trim()) return r.invited_email.trim()
  if (!r.client_profile_id) return null
  const { data } = await db.from("client_profiles").select("email").eq("id", r.client_profile_id).maybeSingle()
  return (data as { email: string | null } | null)?.email?.trim() || null
}

/** What the editor opens with. Refuses a task that is not this client's welcome task, or has already gone. */
export async function loadWelcomeDraft(db: SupabaseClient, coachClientId: string, taskId: string): Promise<Result<WelcomeDraft>> {
  const { data: t } = await db.from("coach_client_engagement_activities")
    .select("id, name, owner, state, welcome_release, engagement_deliverable_id").eq("id", taskId).maybeSingle()
  const task = t as { id: string; name: string; owner: string; state: string; welcome_release: boolean | null; engagement_deliverable_id: string } | null
  if (!task) return fail("Task not found", 404)
  const { data: d } = await db.from("coach_client_engagement_deliverables").select("engagement_id, phase_id").eq("id", task.engagement_deliverable_id).maybeSingle()
  const deliv = d as { engagement_id: string; phase_id: string | null } | null
  const { data: e } = deliv ? await db.from("coach_client_engagements").select("coach_client_id").eq("id", deliv.engagement_id).maybeSingle() : { data: null }
  if (!e || (e as { coach_client_id: string }).coach_client_id !== coachClientId) return fail("Task not found", 404)
  if (!task.welcome_release) return fail("This isn't the client's welcome task.", 409)
  if (task.state !== "active" && task.state !== "upcoming") return fail("The welcome task has already been released.", 409)

  const { data: c } = await db.from("coach_clients")
    .select("id, coach_profile_id, client_profile_id, name, invited_email, parent_email, workspace_folder_url").eq("id", coachClientId).maybeSingle()
  const rel = c as Rel | null
  if (!rel) return fail("Client not found", 404)

  let phaseKey: string | null = null
  let phaseLabel: string | null = null
  if (deliv?.phase_id) {
    const { data: p } = await db.from("coach_phases").select("phase_key, label").eq("id", deliv.phase_id).maybeSingle()
    phaseKey = (p as { phase_key: string } | null)?.phase_key ?? null
    phaseLabel = (p as { label: string } | null)?.label ?? null
  }
  return {
    ok: true,
    data: {
      task: { id: task.id, name: task.name },
      to: await clientEmail(db, rel),
      parent_email: rel.parent_email?.trim() || null,
      first_name: firstNameOf(rel.name),
      drive_url: rel.workspace_folder_url,
      match: startForPhase(phaseKey),
      phase: phaseLabel,
      templates: await getWelcomeTemplates(db, rel.coach_profile_id),
    },
  }
}

/**
 * Send (or don't), then release the welcome task. With send false, only the
 * release happens and History says no email went.
 */
export async function sendWelcome(
  db: SupabaseClient,
  args: {
    coachClientId: string
    taskId: string
    actor: string
    send: boolean
    start?: unknown
    subject?: unknown
    body?: unknown
    ccParent?: unknown
    mail?: SendEmail
    drive?: DriveApi
  },
): Promise<Result<{ sent: boolean; to: string | null; cc: string | null; redirected: boolean }>> {
  const draft = await loadWelcomeDraft(db, args.coachClientId, args.taskId)
  if (!draft.ok) return draft
  const x = draft.data
  let sent: { to: string; cc: string | null; redirected: boolean } | null = null

  if (args.send) {
    if (!isWelcomeStart(args.start)) return fail("Pick which welcome email this is.")
    const template = x.templates.find((t) => t.start_key === args.start)
    if (!template) return fail(`There is no ${WELCOME_START_LABEL[args.start]} welcome email in Settings yet.`)
    if (!x.to) return fail("This client has no email address. Add one to their record first.")
    const subject = typeof args.subject === "string" ? fillFirstName(args.subject.trim(), x.first_name) : ""
    const body = typeof args.body === "string" ? fillFirstName(args.body.replace(/\r\n/g, "\n").trim(), x.first_name) : ""
    const problem = welcomeProblem({ subject, body, driveUrl: x.drive_url, schedulingLink: template.scheduling_link })
    if (problem) return fail(problem)
    const cc = args.ccParent === true ? x.parent_email : null
    if (args.ccParent === true && !cc) return fail("There is no parent email on this record to copy.")

    const rendered = renderWelcomeEmail(body, { drive: x.drive_url, scheduling: template.scheduling_link })
    const result = await (args.mail ?? sendToClient)({
      to: x.to,
      cc,
      templateAlias: WELCOME_EMAIL_TEMPLATE,
      model: { subject, body_html: rendered.html, body_text: rendered.text },
    })
    if (!result.ok) return fail(`The email did not send, so nothing changed: ${result.error}`, 502)
    sent = { to: x.to, cc, redirected: result.redirected }
    await logProspectEvent(db, {
      coachClientId: args.coachClientId, eventType: "welcome_email_sent", actor: args.actor,
      context: { to: x.to, cc, subject, template: WELCOME_START_LABEL[args.start], task: x.task.name, message_id: result.messageId },
    })
  }

  const released = await applyTaskAction(db, { coachClientId: args.coachClientId, taskId: args.taskId, action: "release", actor: args.actor, drive: args.drive })
  if (!released.ok) {
    return sent
      ? fail(`The welcome email went to ${sent.to}, but the task did not release: ${released.error}. Release it from the Plan.`, released.status)
      : released
  }
  if (!sent) {
    await logProspectEvent(db, {
      coachClientId: args.coachClientId, eventType: "welcome_email_skipped", actor: args.actor, context: { task: x.task.name },
    })
  }
  return { ok: true, data: { sent: !!sent, to: sent?.to ?? null, cc: sent?.cc ?? null, redirected: sent?.redirected ?? false } }
}
