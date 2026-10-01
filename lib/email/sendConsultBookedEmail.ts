// lib/email/sendConsultBookedEmail.ts
//
// "A new consult has been booked", to the coach, when Calendly tells SIGNAL a
// mapped consult was booked. Carries the date and time, who booked, and what
// they told us on the booking form (or that they booked straight from the
// Calendly link, with whatever they answered there).
//
// Coach-facing, so the internal stream and no signature, and redirected to
// NON_PROD_REDIRECT with an "[env -> address]" prefix outside production, the
// same rule as sendToCoach. Plain HTML rather than a Postmark template, so it
// needs no template to be created before it works.
//
// Postmark is imported lazily: lib/postmark.ts throws at load without a key,
// and the webhook must not fail to load because of that.

import { NON_PROD_REDIRECT, environmentLabel, isProduction } from "./send"
import { getAppUrl } from "../urls"
import { LEAD_SOURCE_LABEL, SERVICE_LABEL, type Service } from "../prospects/model"

export type ConsultBookedEmail = {
  studentName: string
  bookerEmail: string
  bookerName: string | null
  timeLabel: string
  coachClientId: string
  /** True when the booking created the prospect (no form, no record before). */
  createdFromBooking: boolean
  /** The latest booking-form answers on this prospect, if any. */
  form: Record<string, unknown> | null
  /** Anything they answered on the Calendly booking page. */
  calendlyAnswers: { question: string; answer: string }[]
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

/** The form's answers as label/value pairs, in the order the form asks them. */
export function formSummary(f: Record<string, unknown>): [string, string][] {
  const rows: [string, string | null][] = []
  const name = (a: unknown, b: unknown) => [str(a), str(b)].filter(Boolean).join(" ") || null
  const parent = f.submitter === "parent"
  rows.push(["Filled in by", parent ? "Parent or guardian" : "The student or job seeker"])
  rows.push([parent ? "Parent" : "Name", name(f.first_name, f.last_name)])
  rows.push([parent ? "Parent email" : "Email", str(f.email)])
  rows.push([parent ? "Parent phone" : "Phone", str(f.phone)])
  if (parent) {
    rows.push(["Student", name(f.student_first_name, f.student_last_name)])
    rows.push(["Student email", str(f.student_email)])
    rows.push(["Student phone", str(f.student_phone)])
  }
  const situation = str(f.situation_label)
  rows.push(["Current situation", f.situation === "other" && str(f.situation_other) ? `Other: ${str(f.situation_other)}` : situation])
  const services = Array.isArray(f.services) ? (f.services as Service[]).map((s) => SERVICE_LABEL[s] ?? s) : []
  rows.push(["Help wanted with", services.length ? services.join(", ") : null])
  const src = str(f.source_category)
  const srcLabel = src ? (LEAD_SOURCE_LABEL as Record<string, string>)[src] ?? src : null
  rows.push(["Heard about us", src === "other" && str(f.source_detail) ? `Other: ${str(f.source_detail)}` : srcLabel])
  const ref = [str(f.referred_by_name), str(f.referred_by_email)].filter(Boolean).join(", ")
  rows.push(["Referred by", ref || null])
  rows.push(["School", str(f.school)])
  rows.push(["Graduation year", f.grad_year != null ? String(f.grad_year) : null])
  rows.push(["Major", str(f.major)])
  rows.push(["Anything else", str(f.anything_else)])
  return rows.filter((r): r is [string, string] => !!r[1])
}

export function consultBookedSubject(e: ConsultBookedEmail): string {
  return `New consult booked: ${e.studentName}, ${e.timeLabel}`
}

export function consultBookedBody(e: ConsultBookedEmail): { text: string; html: string } {
  const link = `${getAppUrl()}/dashboard/coach/prospects/${encodeURIComponent(e.coachClientId)}`
  const top: [string, string][] = [
    ["When", e.timeLabel],
    ["Prospect", e.studentName],
    ["Booked by", e.bookerName ? `${e.bookerName} (${e.bookerEmail})` : e.bookerEmail],
  ]
  const form = e.form ? formSummary(e.form) : []
  const note = e.form
    ? "From the booking form:"
    : e.createdFromBooking
      ? "They booked straight from your Calendly link, without the booking form. SIGNAL created the prospect from the booking."
      : "No booking form on file for this prospect."

  const textRows = (rows: [string, string][]) => rows.map(([k, v]) => `${k}: ${v}`).join("\n")
  const text = [
    "A new consult has been booked.",
    "",
    textRows(top),
    "",
    note,
    ...(form.length ? [textRows(form)] : []),
    ...(e.calendlyAnswers.length ? ["", "On Calendly:", textRows(e.calendlyAnswers.map((a) => [a.question, a.answer]))] : []),
    "",
    `Open in SIGNAL: ${link}`,
  ].join("\n")

  const table = (rows: [string, string][]) =>
    `<table style="border-collapse:collapse;width:100%;font-size:14px;line-height:1.5;">${rows.map(([k, v]) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#5B6B80;vertical-align:top;white-space:nowrap;">${esc(k)}</td>` +
      `<td style="padding:6px 0;color:#13294A;">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table>`
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#13294A;max-width:600px;">
<p style="font-size:18px;font-weight:bold;margin:0 0 12px;">A new consult has been booked.</p>
${table(top)}
<p style="margin:20px 0 8px;font-weight:bold;">${esc(note)}</p>
${form.length ? table(form) : ""}
${e.calendlyAnswers.length ? `<p style="margin:20px 0 8px;font-weight:bold;">On Calendly:</p>${table(e.calendlyAnswers.map((a) => [a.question, a.answer]))}` : ""}
<p style="margin:24px 0 0;"><a href="${esc(link)}" style="background:#08203F;color:#FEB06A;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">Open in SIGNAL</a></p>
</div>`
  return { text, html }
}

export async function sendConsultBookedEmail(to: string, e: ConsultBookedEmail): Promise<{ ok: boolean; error?: string }> {
  const intended = to.trim()
  if (!intended) return { ok: false, error: "No coach email" }
  const production = isProduction()
  const prefix = production ? "" : `[${environmentLabel()} -> ${intended}] `
  const { text, html } = consultBookedBody(e)
  try {
    const { getPostmarkClient, FROM_EMAIL, INTERNAL_STREAM } = await import("../postmark")
    await getPostmarkClient().sendEmail({
      From: FROM_EMAIL,
      To: production ? intended : NON_PROD_REDIRECT,
      Subject: prefix + consultBookedSubject(e),
      TextBody: text,
      HtmlBody: html,
      MessageStream: INTERNAL_STREAM,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
