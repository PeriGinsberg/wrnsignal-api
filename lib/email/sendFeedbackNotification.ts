import { postmarkClient, MESSAGE_STREAM } from "../postmark"

// Beta-feedback notification email (FRD §6.3). Models lib/email/sendClientInvite.ts:
// same Postmark client + message stream, but sends FROM/TO the support inbox
// (not the WRN-branded FROM_EMAIL) so coach feedback lands in the shared
// support@stopapplyingblind.com box. v0.1 uses inline templates (no Postmark
// template ID) for iteration speed during early beta.

export type FeedbackType =
  | "issue_bug"
  | "enhancement"
  | "technical_question"
  | "general_feedback"
  | "other"

export type FeedbackSeverity = "blocker" | "high" | "medium" | "low"

const TYPE_LABELS: Record<FeedbackType, string> = {
  issue_bug: "Issue/Bug",
  enhancement: "Enhancement",
  technical_question: "Technical Question",
  general_feedback: "General Feedback",
  other: "Other",
}

const SEVERITY_LABELS: Record<FeedbackSeverity, string> = {
  blocker: "Blocker",
  high: "High",
  medium: "Medium",
  low: "Low",
}

// Support inbox — distinct from POSTMARK_FROM_EMAIL (the WRN-branded sender
// used by sendClientInvite). stopapplyingblind.com is domain-verified in
// Postmark, so any address on the domain sends without a per-address signature.
const FEEDBACK_FROM_EMAIL =
  process.env.POSTMARK_FEEDBACK_FROM_EMAIL ?? "support@stopapplyingblind.com"

// Deep link to the row in Supabase Studio. Derives the project ref from
// SUPABASE_URL so the link points at whichever environment actually wrote
// the row (dev now, prod after promotion). Falls back to no link if the
// URL can't be parsed.
function studioRowLink(feedbackId: string): string | null {
  const ref = (process.env.SUPABASE_URL || "").match(
    /https?:\/\/([a-z0-9]+)\.supabase\.co/i,
  )?.[1]
  if (!ref) return null
  // Studio has no per-row URL; link to the filtered table editor and carry
  // the id in the surrounding text so the recipient can find the exact row.
  return `https://supabase.com/dashboard/project/${ref}/editor?schema=public&table=beta_feedback`
}

interface SendFeedbackNotificationParams {
  feedbackId: string
  coachName: string
  coachEmail: string
  type: FeedbackType
  severity: FeedbackSeverity | null
  body: string
  replyOk: boolean
  pageUrl: string | null
  userAgent: string | null
  activeClientCount: number
  createdAt: string // ISO8601
}

export async function sendFeedbackNotification({
  feedbackId,
  coachName,
  coachEmail,
  type,
  severity,
  body,
  replyOk,
  pageUrl,
  userAgent,
  activeClientCount,
  createdAt,
}: SendFeedbackNotificationParams): Promise<void> {
  const typeLabel = TYPE_LABELS[type]
  const severityLabel = severity ? SEVERITY_LABELS[severity] : "—"
  const replyOkLabel = replyOk ? "Yes" : "No"
  const rowLink = studioRowLink(feedbackId)

  const subject = `[SIGNAL Feedback] [${typeLabel}] from ${coachName}`

  const textBody = `${coachName} submitted feedback:

TYPE: ${typeLabel}
SEVERITY: ${severityLabel}
REPLY OK: ${replyOkLabel}

MESSAGE:
${body}

CONTEXT:
- Page: ${pageUrl || "—"}
- Timestamp: ${createdAt}
- Browser: ${userAgent || "—"}
- Coach's active clients: ${activeClientCount}
- Coach's email: ${coachEmail}

ROW: ${feedbackId}${rowLink ? `
View in Supabase: ${rowLink}` : ""}
Reply to coach: ${coachEmail}`

  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")

  const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <div style="max-width:600px;margin:24px auto;padding:0 20px;">
    <div style="font-size:16px;font-weight:600;margin-bottom:16px;">
      ${esc(coachName)} submitted feedback
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
      <tr><td style="padding:4px 0;color:#666;width:140px;">Type</td><td style="padding:4px 0;font-weight:600;">${esc(typeLabel)}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Severity</td><td style="padding:4px 0;">${esc(severityLabel)}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Reply OK</td><td style="padding:4px 0;">${replyOkLabel}</td></tr>
    </table>
    <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Message</div>
    <div style="background:#fff;border:1px solid #e3e6ea;border-radius:8px;padding:14px;font-size:14px;line-height:1.6;white-space:pre-wrap;margin-bottom:20px;">${esc(body)}</div>
    <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Context</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
      <tr><td style="padding:4px 0;color:#666;width:160px;">Page</td><td style="padding:4px 0;">${pageUrl ? esc(pageUrl) : "—"}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Timestamp</td><td style="padding:4px 0;">${esc(createdAt)}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Browser</td><td style="padding:4px 0;">${userAgent ? esc(userAgent) : "—"}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Coach's active clients</td><td style="padding:4px 0;">${activeClientCount}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Coach's email</td><td style="padding:4px 0;"><a href="mailto:${esc(coachEmail)}" style="color:#1a5fb4;">${esc(coachEmail)}</a></td></tr>
    </table>
    <div style="font-size:13px;color:#666;border-top:1px solid #e3e6ea;padding-top:14px;">
      Row: ${esc(feedbackId)}${rowLink ? ` &middot; <a href="${rowLink}" style="color:#1a5fb4;">View in Supabase</a>` : ""}
      <br/>
      <a href="mailto:${esc(coachEmail)}" style="color:#1a5fb4;">Reply to coach</a>
    </div>
  </div>
</body>
</html>`

  await postmarkClient.sendEmail({
    From: FEEDBACK_FROM_EMAIL,
    To: FEEDBACK_FROM_EMAIL,
    // Reply-To set to the coach only when they opted in. When reply_ok is
    // false we omit Reply-To entirely so replies thread back to From, which
    // is the support inbox (FRD §5.5 / open question #3 — "omit" path).
    ...(replyOk ? { ReplyTo: coachEmail } : {}),
    Subject: subject,
    TextBody: textBody,
    HtmlBody: htmlBody,
    MessageStream: MESSAGE_STREAM,
    Tag: "beta-feedback",
  })
}
