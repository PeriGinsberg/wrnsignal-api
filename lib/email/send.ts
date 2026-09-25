// lib/email/send.ts
//
// The one way SIGNAL sends a templated email.
//
// STANDING RULE: EVERY CLIENT-FACING EMAIL CARRIES THE SIGNATURE.
//
// It is not pasted into templates and it is not added here at send time. The
// Postmark layout `signal-client` holds the WRN header, the orange rule and
// the signature, and a template that names that layout inherits all three. So
// "the default" is enforced where a template is defined, and sendToClient
// below refuses to send a template that has not opted in, rather than sending
// a bare one and leaving somebody to notice later.
//
// Adding a client-facing template is therefore two steps, and the second is
// checked for you:
//   1. create the template with LayoutTemplate: "signal-client"
//   2. send it with sendToClient()
//
// See tests/email/sync-email-layout.ts, which is what pushes the layout.

import { getPostmarkClient, CLIENT_STREAM, INTERNAL_STREAM, FROM_EMAIL } from "../postmark"

export const CLIENT_LAYOUT_ALIAS = "signal-client"

/** Where client mail goes when this is not production. */
export const NON_PROD_REDIRECT = "peri@workforcereadynow.com"

export type SendResult =
  | { ok: true; to: string; redirected: boolean; messageId: string }
  | { ok: false; error: string }

/**
 * Is this the real production deployment?
 *
 * VERCEL_ENV is 'production' only for the production deployment itself, not a
 * preview built from the same commit. Anything else, a local machine included,
 * counts as not production.
 *
 * THE DEFAULT IS THE SAFE ONE. An unset variable means "not production", so a
 * misconfigured environment redirects mail inward rather than posting it to a
 * client. Backwards would send real clients test email.
 */
export function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production"
}

/**
 * Send a client-facing template.
 *
 * Outside production the mail is redirected to NON_PROD_REDIRECT with the
 * intended recipient in the subject, so a preview deployment can be exercised
 * end to end without a client receiving anything. The body is untouched,
 * including its links, because the point of the test is to see what the client
 * would have seen.
 *
 * `subject_prefix` is always supplied, empty in production. Templates carry
 * "{{subject_prefix}}Real subject" so the prefix needs no conditional; an
 * omitted merge field would render Postmark's placeholder text instead.
 */
export async function sendToClient(args: {
  to: string
  templateAlias: string
  model: Record<string, unknown>
  from?: string
}): Promise<SendResult> {
  const intended = String(args.to || "").trim()
  if (!intended) return { ok: false, error: "No email address for this client." }

  const production = isProduction()
  const to = production ? intended : NON_PROD_REDIRECT
  const subjectPrefix = production ? "" : `[${process.env.VERCEL_ENV ?? "local"} -> ${intended}] `

  try {
    const res = await getPostmarkClient().sendEmailWithTemplate({
      From: args.from ?? FROM_EMAIL,
      To: to,
      TemplateAlias: args.templateAlias,
      MessageStream: CLIENT_STREAM,
      TemplateModel: { ...args.model, subject_prefix: subjectPrefix },
    })
    return { ok: true, to, redirected: !production, messageId: res.MessageID }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

/**
 * Send a coach-facing template: task assignment, the reopen, the digest.
 *
 * NO SIGNATURE. Signing a task notification as the founder would be odd. It
 * rides the internal stream so a bounce on a client address cannot affect its
 * deliverability, and vice versa.
 *
 * REDIRECTED OUTSIDE PRODUCTION, exactly like client mail, and for a sharper
 * reason than politeness. The coaches a dev database assigns work to are the
 * REAL ones: dev carries a copy of production's profiles, so a smoke test that
 * creates three tasks sends three genuine "you have a new task" emails to
 * people who do not have those tasks. Mail about work that does not exist is
 * worse than mail nobody reads, because it gets acted on.
 */
export async function sendToCoach(args: {
  to: string
  templateAlias: string
  model: Record<string, unknown>
}): Promise<SendResult> {
  const intended = String(args.to || "").trim()
  if (!intended) return { ok: false, error: "No email address for this coach." }

  const production = isProduction()
  const to = production ? intended : NON_PROD_REDIRECT
  const subjectPrefix = production ? "" : `[${process.env.VERCEL_ENV ?? "local"} -> ${intended}] `

  try {
    const res = await getPostmarkClient().sendEmailWithTemplate({
      From: FROM_EMAIL,
      To: to,
      TemplateAlias: args.templateAlias,
      MessageStream: INTERNAL_STREAM,
      TemplateModel: { ...args.model, subject_prefix: subjectPrefix },
    })
    return { ok: true, to, redirected: !production, messageId: res.MessageID }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}
