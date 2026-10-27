// lib/supporters.ts
//
// Supporters: the invite token, the two emails, and the column lists every
// supporter route reads through.
//
// THE COLUMN LISTS ARE THE WALL. Supporter routes never select("*") and never
// embed: a new column on signal_applications or client_profiles stays invisible
// to supporters until someone adds it here on purpose.
// tests/supporters/no-coach-tables.test.ts fails if a supporter route names a
// coach-only table.

import { createHash, randomBytes } from "node:crypto"
import { sendToClient, type SendResult } from "./email/send"

export const MAX_SUPPORTERS = 2
export const INVITE_DAYS = 7

/** Tracker columns a supporter sees. No notes, no coach columns. */
export const SUPPORTER_APPLICATION_COLUMNS =
  "id, company_name, job_title, location, job_url, date_posted, application_status, applied_date, " +
  "signal_decision, signal_score, signal_run_at, jobfit_run_id, added_by_role, added_by_supporter_id, created_at, updated_at"

/** Interviews: stage and date only. */
export const SUPPORTER_INTERVIEW_COLUMNS = "id, application_id, interview_stage, interview_date"

/** Profile and resume, view only. */
export const SUPPORTER_PROFILE_COLUMNS =
  "id, name, job_type, target_roles, target_locations, preferred_locations, timeline, resume_text"

/** What the client sees about each of their supporters. Never the token hash. */
export const SUPPORTER_PUBLIC_COLUMNS =
  "id, email, display_name, status, invite_expires_at, invite_sent_at, accepted_at, revoked_at, created_at"

export const SUGGESTION_COLUMNS =
  "id, supporter_id, company_name, job_title, job_url, location, note, status, application_id, decided_at, created_at, updated_at"

/** A fresh invite token and the hash that is stored. The token is only ever emailed. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url")
  return { token, hash: hashInviteToken(token) }
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function normEmail(e: unknown): string {
  return String(e ?? "").trim().toLowerCase()
}

export function firstName(name: unknown, fallback: string): string {
  return String(name ?? "").trim().split(/\s+/)[0] || fallback
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const P = `font-size:14px;color:#555;line-height:1.7;margin:0 0 20px;`
const BUTTON = `display:inline-block;background:#3D1A4A;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 40px;border-radius:8px;letter-spacing:0.02em;`

export async function sendSupporterInvite(args: {
  to: string
  supporterName: string
  clientName: string
  acceptUrl: string
  actor: string
}): Promise<SendResult> {
  const who = escapeHtml(args.clientName)
  const subject = `${args.clientName} invited you to follow their job search on SIGNAL`
  const html = `<div style="font-size:18px;color:#2A0F35;margin-bottom:16px;">Hi ${escapeHtml(args.supporterName)},</div>

<p style="${P}">
  ${who} added you as a supporter on SIGNAL. You will be able to see their job tracker, the jobs SIGNAL has scored for them, and their resume, and you can suggest jobs for them to look at.
</p>

<div style="text-align:center;margin-bottom:24px;">
  <a href="${args.acceptUrl}" style="${BUTTON}">Accept the invite</a>
</div>

<p style="font-size:12px;color:#999;line-height:1.6;margin:0 0 8px;">
  If the button does not work, copy and paste this link into your browser:
</p>
<p style="font-size:12px;color:#3D1A4A;word-break:break-all;line-height:1.5;margin:0 0 24px;">
  ${args.acceptUrl}
</p>

<p style="font-size:12px;color:#999;line-height:1.6;margin:0;">
  The link works for ${INVITE_DAYS} days. ${who} can remove you as a supporter at any time. If you did not expect this, you can safely ignore it.
</p>`
  const text = `Hi ${args.supporterName},

${args.clientName} added you as a supporter on SIGNAL. You will be able to see their job tracker, the jobs SIGNAL has scored for them, and their resume, and you can suggest jobs for them to look at.

Accept the invite:
${args.acceptUrl}

The link works for ${INVITE_DAYS} days. ${args.clientName} can remove you as a supporter at any time. If you did not expect this, you can safely ignore it.`
  return sendToClient({
    to: args.to,
    content: { subject, html, text },
    log: { type: "supporter_invite", coachClientId: null, actor: args.actor },
  })
}

/** To the CLIENT, when a supporter adds a job. Links to the tracker, where it waits. */
export async function sendSuggestionNotice(args: {
  to: string
  clientFirstName: string
  supporterName: string
  jobTitle: string
  companyName: string
  trackerUrl: string
}): Promise<SendResult> {
  const job = `${args.jobTitle} at ${args.companyName}`
  const subject = `${args.supporterName} suggested a job: ${job}`
  const html = `<div style="font-size:18px;color:#2A0F35;margin-bottom:16px;">Hi ${escapeHtml(args.clientFirstName)},</div>

<p style="${P}">
  ${escapeHtml(args.supporterName)} suggested a job for you: <strong style="color:#2A0F35;">${escapeHtml(job)}</strong>.
</p>

<p style="${P}">
  It is waiting at the top of your Job Tracker. Add it to your tracker, or pass on it.
</p>

<div style="text-align:center;margin-bottom:24px;">
  <a href="${args.trackerUrl}" style="${BUTTON}">Open my Job Tracker</a>
</div>`
  const text = `Hi ${args.clientFirstName},

${args.supporterName} suggested a job for you: ${job}.

It is waiting at the top of your Job Tracker. Add it to your tracker, or pass on it:
${args.trackerUrl}`
  return sendToClient({
    to: args.to,
    content: { subject, html, text },
    log: { type: "supporter_suggestion", coachClientId: null, actor: null },
  })
}
