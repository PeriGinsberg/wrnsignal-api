// lib/email/sendCoachJobEmails.ts
//
// "Your coach added a job to your tracker", sent to the client after a coach
// adds a job through POST /api/coach/recommend-job. One way only: coach to
// client. Nothing here reads a reply.
//
// BATCHED, NOT SENT INLINE. recommend-job queues the job (coach_job_emails,
// migration 20261118) and returns. The cron sends one email per coach and
// client once the oldest queued job for that pair is BATCH_MINUTES old, naming
// every job queued for them by then. A coach adding five jobs in a sitting
// sends one email, not five.
//
// Through sendToClient like every client email, so the staging redirect, the
// coach's blind copy and the Communications log all apply. There is no client
// email opt-out in SIGNAL yet; when one exists it belongs in sendToClient, not
// here.

import type { SupabaseClient } from "@supabase/supabase-js"
import { sendToClient, type SendResult } from "./send"

export const BATCH_MINUTES = 10

export type QueuedJob = {
  id: string
  application_id: string
  client_profile_id: string
  coach_profile_id: string
  coach_client_id: string | null
  created_at: string
}

/**
 * Queue the email for a job a coach just added. Never throws: the job is on
 * the tracker either way, and a missed email must not fail the request.
 */
export async function queueCoachJobEmail(
  db: SupabaseClient,
  job: { applicationId: string; clientProfileId: string; coachProfileId: string; coachClientId: string | null },
): Promise<boolean> {
  const { error } = await db.from("coach_job_emails").insert({
    application_id: job.applicationId,
    client_profile_id: job.clientProfileId,
    coach_profile_id: job.coachProfileId,
    coach_client_id: job.coachClientId,
  })
  if (error) console.error("[coach-job-email] queue failed:", error.message)
  return !error
}

/**
 * Which queued jobs are ready to go, grouped one email per coach and client.
 * A group is ready once its OLDEST job is BATCH_MINUTES old; it then takes
 * every job queued for that pair, the newer ones included.
 */
export function readyBatches(rows: QueuedJob[], now: Date, minutes = BATCH_MINUTES): QueuedJob[][] {
  const groups = new Map<string, QueuedJob[]>()
  for (const r of rows) {
    const key = `${r.client_profile_id}:${r.coach_profile_id}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const cutoff = now.getTime() - minutes * 60_000
  return [...groups.values()]
    .map((g) => [...g].sort((a, b) => a.created_at.localeCompare(b.created_at)))
    .filter((g) => new Date(g[0].created_at).getTime() <= cutoff)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const P = `font-size:14px;color:#555;line-height:1.7;margin:0 0 20px;`
const BUTTON = `display:inline-block;background:#3D1A4A;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 40px;border-radius:8px;letter-spacing:0.02em;`
const LINK = `color:#3D1A4A;font-weight:600;`

export type EmailJob = { title: string; company: string; url: string }

/** The email itself. Pure, so the wording is tested without sending. */
export function coachJobEmailContent(args: {
  clientFirstName: string
  coachName: string
  jobs: EmailJob[]
  trackerUrl: string
}): { subject: string; html: string; text: string } {
  const label = (j: EmailJob) => `${j.title} at ${j.company}`
  const [first, ...rest] = args.jobs
  const one = rest.length === 0
  const subject = one
    ? `${args.coachName} added a job to your tracker: ${label(first)}`
    : `${args.coachName} added ${args.jobs.length} jobs to your tracker: ${label(first)} and ${rest.length} more`

  const hi = `<div style="font-size:18px;color:#2A0F35;margin-bottom:16px;">Hi ${escapeHtml(args.clientFirstName)},</div>`
  const html = one
    ? `${hi}

<p style="${P}">
  ${escapeHtml(args.coachName)} added a job to your Job Tracker: <strong style="color:#2A0F35;">${escapeHtml(label(first))}</strong>.
</p>

<p style="${P}">Open it and review it for yourself. Read each bullet and decide if this job fits your search goals.</p>

<div style="text-align:center;margin-bottom:24px;">
  <a href="${first.url}" style="${BUTTON}">Open the job</a>
</div>`
    : `${hi}

<p style="${P}">
  ${escapeHtml(args.coachName)} added ${args.jobs.length} jobs to your Job Tracker:
</p>

<ul style="${P}padding-left:20px;">
${args.jobs.map((j) => `  <li style="margin-bottom:6px;"><a href="${j.url}" style="${LINK}">${escapeHtml(label(j))}</a></li>`).join("\n")}
</ul>

<p style="${P}">Open each one and review it for yourself. Read each bullet and decide if this job fits your search goals.</p>

<div style="text-align:center;margin-bottom:24px;">
  <a href="${args.trackerUrl}" style="${BUTTON}">Open my Job Tracker</a>
</div>`

  const text = one
    ? `Hi ${args.clientFirstName},

${args.coachName} added a job to your Job Tracker: ${label(first)}.

Open it and review it for yourself. Read each bullet and decide if this job fits your search goals.
${first.url}`
    : `Hi ${args.clientFirstName},

${args.coachName} added ${args.jobs.length} jobs to your Job Tracker:

${args.jobs.map((j) => `- ${label(j)}: ${j.url}`).join("\n")}

Open each one and review it for yourself. Read each bullet and decide if this job fits your search goals.

Your Job Tracker:
${args.trackerUrl}`

  return { subject, html, text }
}

const firstWord = (name: unknown, fallback: string) => String(name ?? "").trim().split(/\s+/)[0] || fallback

export type BatchResult = {
  clientProfileId: string
  coachProfileId: string
  jobs: number
  outcome: "sent" | "failed" | "skipped"
  detail: string | null
}

type Sender = typeof sendToClient

/**
 * Send every batch that is ready. `send` is sendToClient; the smoke test
 * passes its own to read the email without sending it, and `onlyClients` so
 * it never touches a real queued job on the database it runs against.
 */
export async function sendDueCoachJobEmails(
  db: SupabaseClient,
  opts: { appUrl: string; now?: Date; send?: Sender; onlyClients?: string[] },
): Promise<BatchResult[]> {
  const now = opts.now ?? new Date()
  const send = opts.send ?? sendToClient
  let q = db
    .from("coach_job_emails")
    .select("id, application_id, client_profile_id, coach_profile_id, coach_client_id, created_at")
    .is("claimed_at", null)
  if (opts.onlyClients) q = q.in("client_profile_id", opts.onlyClients)
  const { data: queued, error } = await q.order("created_at").limit(1000)
  if (error) throw new Error(`coach_job_emails read failed: ${error.message}`)

  const results: BatchResult[] = []
  for (const batch of readyBatches((queued ?? []) as QueuedJob[], now)) {
    // The lock. Only rows this update actually flips are ours; a run that
    // overlaps gets none of them back and sends nothing.
    const { data: claimed, error: cErr } = await db
      .from("coach_job_emails")
      .update({ claimed_at: new Date().toISOString() })
      .in("id", batch.map((r) => r.id))
      .is("claimed_at", null)
      .select("id, application_id, coach_client_id")
    if (cErr) throw new Error(`coach_job_emails claim failed: ${cErr.message}`)
    const mine = (claimed ?? []) as { id: string; application_id: string; coach_client_id: string | null }[]
    if (!mine.length) continue

    const clientProfileId = batch[0].client_profile_id
    const coachProfileId = batch[0].coach_profile_id
    const finish = async (outcome: BatchResult["outcome"], detail: string | null) => {
      await db
        .from("coach_job_emails")
        .update({ outcome, detail, sent_at: outcome === "sent" ? new Date().toISOString() : null })
        .in("id", mine.map((r) => r.id))
      results.push({ clientProfileId, coachProfileId, jobs: mine.length, outcome, detail })
    }

    const order = new Map(batch.map((r, i) => [r.application_id, i]))
    const [{ data: apps }, { data: people }] = await Promise.all([
      db.from("signal_applications").select("id, company_name, job_title").in("id", mine.map((r) => r.application_id)),
      db.from("client_profiles").select("id, name, email, user_id").in("id", [clientProfileId, coachProfileId]),
    ])
    const client = (people ?? []).find((p: any) => p.id === clientProfileId) as any
    const coach = (people ?? []).find((p: any) => p.id === coachProfileId) as any
    const jobs = ((apps ?? []) as { id: string; company_name: string; job_title: string }[])
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((a) => ({ title: a.job_title, company: a.company_name, url: `${opts.appUrl}/dashboard/tracker/${a.id}` }))

    if (!jobs.length) { await finish("skipped", "The jobs were deleted before the email went."); continue }
    if (!client?.email) { await finish("skipped", "The client has no email address."); continue }
    // The links go to the client's dashboard, which they cannot open without
    // a login. They hear about the jobs when they are invited instead.
    if (!client.user_id) { await finish("skipped", "The client has no SIGNAL login yet."); continue }

    const coachName = String(coach?.name ?? "").trim() || "Your coach"
    const sent: SendResult = await send({
      to: client.email,
      content: coachJobEmailContent({
        clientFirstName: firstWord(client.name, "there"),
        coachName,
        jobs,
        trackerUrl: `${opts.appUrl}/dashboard/tracker`,
      }),
      log: { type: "coach_job", coachClientId: mine[0].coach_client_id, actor: coachProfileId, db },
    })
    await finish(sent.ok ? "sent" : "failed", sent.ok ? null : sent.error)
  }
  return results
}
