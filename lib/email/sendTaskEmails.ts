// lib/email/sendTaskEmails.ts
//
// Coach-facing task mail: "you have a task", and the daily overdue digest.
//
// Both ride the signal-internal stream through sendToCoach, which applies no
// layout and therefore no signature. See the standing rule in
// docs/coaching-task-automation-plan.md.

import type { SupabaseClient } from "@supabase/supabase-js"
import { sendToCoach } from "./send"
import { getAppUrl } from "../urls"
import { isOverdue, type Task } from "../tasks/model"

export const TASK_ASSIGNED_TEMPLATE = "task-assigned"
export const OVERDUE_DIGEST_TEMPLATE = "overdue-digest"

/**
 * The dashboard, not the Framer site.
 *
 * getAppUrl, NOT signalLoginUrl. A task link is for a coach going to their own
 * dashboard; APP_BASE_URL is the client-facing marketing host and has no
 * /dashboard route. Sending a coach there is the outage this codebase already
 * had once.
 */
function taskUrl(taskId: string): string {
  return `${getAppUrl()}/dashboard/coach/tasks?task=${encodeURIComponent(taskId)}`
}

function dueText(t: Pick<Task, "due_at" | "due_has_time">): string {
  if (!t.due_at) return "No due date"
  const d = new Date(t.due_at)
  if (Number.isNaN(d.getTime())) return "No due date"
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  if (!t.due_has_time) return day
  return `${day} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
}

/** A one-line reading of the brief, for the coach who has to act on it. */
function briefSummary(brief: any | null): string | null {
  if (!brief) return null
  const bits: string[] = []
  if (brief.primary_roles?.length) bits.push(brief.primary_roles.join(", "))
  if (brief.primary_industries?.length) bits.push(brief.primary_industries.join(", "))
  if (brief.locations?.length) bits.push(brief.locations.join(", "))
  const line = bits.join(" · ")
  return line ? `${brief.name}: ${line}` : String(brief.name)
}

/**
 * Tell the assignee, unless the assignee is the person who did it.
 *
 * SELF-ASSIGNMENT SENDS NOTHING. A coach who adds a task to their own list does
 * not need an email telling them what they just typed, and a system that sends
 * one teaches people to ignore its mail.
 *
 * Never throws. A task that was created is created; failing the write because
 * the notification bounced would be the wrong trade.
 */
export async function sendTaskAssignedEmail(
  db: SupabaseClient,
  taskId: string,
  actorProfileId: string | null,
  opts: { reassignment?: boolean } = {},
): Promise<void> {
  try {
    const { data: task } = await db.from("coach_tasks")
      .select("id, title, description, due_at, due_has_time, source, assignee_profile_id, client_profile_id, brief_id")
      .eq("id", taskId).maybeSingle()
    if (!task) return

    if (task.assignee_profile_id === actorProfileId) return

    const { data: assignee } = await db.from("client_profiles")
      .select("email, name").eq("id", task.assignee_profile_id).maybeSingle()
    if (!assignee?.email) return

    const [{ data: client }, { data: brief }] = await Promise.all([
      task.client_profile_id
        ? db.from("client_profiles").select("name").eq("id", task.client_profile_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      task.brief_id
        ? db.from("networking_campaign_briefs")
            .select("name, primary_roles, primary_industries, locations").eq("id", task.brief_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ])

    const res = await sendToCoach({
      to: assignee.email,
      templateAlias: TASK_ASSIGNED_TEMPLATE,
      model: {
        title: task.title,
        description: task.description ?? "",
        client_name: client?.name ?? "",
        due_text: dueText(task as any),
        // "a rule" rather than "auto": the assignee wants to know whether a
        // person chose this for them.
        source_text: task.source === "auto" ? "a rule" : "a coach",
        brief_summary: briefSummary(brief) ?? "",
        task_url: taskUrl(task.id),
        is_reassignment: !!opts.reassignment,
      },
    })
    if (!res.ok) console.error("[tasks] assignment email failed:", res.error)
  } catch (e: any) {
    console.error("[tasks] assignment email threw:", e?.message ?? e)
  }
}

export type DigestResult = { coachProfileId: string; email: string; count: number; sent: boolean; error?: string }

/**
 * One digest per coach who has overdue work. Coaches with none get nothing.
 *
 * SILENCE IS THE FEATURE. A digest that arrives every morning saying "you have
 * 0 overdue tasks" is trained out of within a week, and then the morning it
 * says 3 is invisible too.
 */
export async function sendOverdueDigests(db: SupabaseClient): Promise<DigestResult[]> {
  const { data: tasks, error } = await db.from("coach_tasks")
    .select("id, title, due_at, due_has_time, status, assignee_profile_id, client_profile_id")
    .eq("status", "open").is("deleted_at", null).not("due_at", "is", null)
  if (error) {
    console.error("[digest] could not read tasks:", error.message)
    return []
  }

  const now = new Date()
  const overdue = (tasks ?? []).filter((t: any) => isOverdue(t, now))
  if (!overdue.length) return []

  const byCoach = new Map<string, any[]>()
  for (const t of overdue) {
    const k = String(t.assignee_profile_id)
    if (!byCoach.has(k)) byCoach.set(k, [])
    byCoach.get(k)!.push(t)
  }

  const clientIds = Array.from(new Set(overdue.map((t: any) => t.client_profile_id).filter(Boolean)))
  const { data: clients } = clientIds.length
    ? await db.from("client_profiles").select("id, name").in("id", clientIds)
    : { data: [] as any[] }
  const clientName = (id: string | null) => (id && clients?.find((c: any) => c.id === id)?.name) || ""

  const { data: coaches } = await db.from("client_profiles")
    .select("id, email, name, active").in("id", Array.from(byCoach.keys()))

  const out: DigestResult[] = []
  for (const [coachId, list] of byCoach) {
    const coach = coaches?.find((c: any) => c.id === coachId)
    if (!coach?.email) {
      out.push({ coachProfileId: coachId, email: "", count: list.length, sent: false, error: "no email" })
      continue
    }
    // An inactive coach still owns the work, but mailing them daily about a
    // list they cannot act on helps nobody. Reported, not sent.
    if (coach.active === false) {
      out.push({ coachProfileId: coachId, email: coach.email, count: list.length, sent: false, error: "coach inactive" })
      continue
    }

    list.sort((a: any, b: any) => String(a.due_at).localeCompare(String(b.due_at)))
    const res = await sendToCoach({
      to: coach.email,
      templateAlias: OVERDUE_DIGEST_TEMPLATE,
      model: {
        overdue_count: list.length,
        plural: list.length === 1 ? "" : "s",
        tasks: list.map((t: any) => ({
          title: t.title,
          client_name: clientName(t.client_profile_id),
          due_text: dueText(t),
        })),
        tasks_url: `${getAppUrl()}/dashboard/coach/tasks?view=overdue`,
      },
    })
    out.push({ coachProfileId: coachId, email: coach.email, count: list.length, sent: res.ok, error: res.ok ? undefined : res.error })
  }
  return out
}

export const TASK_REOPENED_TEMPLATE = "task-reopened"

/**
 * "This came back, and here is why."
 *
 * THE NOTE IS THE PAYLOAD. A reopened task with no reason attached sends the
 * assignee back to a piece of work with no idea what was wrong with it, and
 * the reviewer ends up explaining it in Slack, which is where the record then
 * lives. Request Changes requires a note for this reason, and this is where the
 * note reaches the person who has to act on it.
 *
 * Unlike assignment mail, this DOES send when the actor is the assignee: a rule
 * reopened the task, and the reviewer pressing Request Changes is a different
 * person from the builder in every case the chain has. There is no
 * "you told yourself" case to suppress.
 *
 * Never throws.
 */
export async function sendTaskReopenedEmail(
  db: SupabaseClient,
  taskId: string,
  note: string | null,
): Promise<void> {
  try {
    const { data: task } = await db.from("coach_tasks")
      .select("id, title, assignee_profile_id, client_profile_id, due_at, due_has_time")
      .eq("id", taskId).maybeSingle()
    if (!task) return

    const { data: assignee } = await db.from("client_profiles")
      .select("email, name").eq("id", task.assignee_profile_id).maybeSingle()
    if (!assignee?.email) return

    const { data: client } = task.client_profile_id
      ? await db.from("client_profiles").select("name").eq("id", task.client_profile_id).maybeSingle()
      : { data: null as any }

    const res = await sendToCoach({
      to: assignee.email,
      templateAlias: TASK_REOPENED_TEMPLATE,
      model: {
        title: task.title,
        client_name: client?.name ?? "",
        // Said plainly when it is missing, rather than rendering an empty box.
        note: note?.trim() || "No note was left.",
        due_text: dueText(task as any),
        task_url: taskUrl(task.id),
      },
    })
    if (!res.ok) console.error("[tasks] reopened email failed:", res.error)
  } catch (e: any) {
    console.error("[tasks] reopened email threw:", e?.message ?? e)
  }
}
