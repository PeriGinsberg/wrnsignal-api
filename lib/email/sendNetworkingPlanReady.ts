// lib/email/sendNetworkingPlanReady.ts
//
// "Your networking plan is ready", sent to the client when a coach clicks Share
// with Client, and again when they click Re-send email.
//
// THIS REPLACES THE GOHIGHLEVEL PATH. Until 2026-09-26 this email was sent by a
// GHL workflow triggered by the tag `networking-plan-shared`. SIGNAL wrote the
// tag and could see nothing after that: not whether the mail was sent, not
// where it went, not whether it bounced. It now sends the mail itself, through
// the Postmark template `networking-plan-ready`, and records the result on the
// job row.
//
// The template stores only the subject and the two bodies. From, stream and
// recipient are decided here, per send, because that is where Postmark puts
// them.

import { getPostmarkClient, CLIENT_STREAM, FROM_EMAIL } from "../postmark"
import { signalLoginUrl } from "../urls"

export const NETWORKING_PLAN_TEMPLATE = "networking-plan-ready"

/** Where client mail goes when this is not production. */
export const NON_PROD_REDIRECT = "peri@workforcereadynow.com"

export type PlanEmailResult =
  | { ok: true; to: string; redirected: boolean; messageId: string }
  | { ok: false; error: string }

/**
 * Is this the real production deployment?
 *
 * VERCEL_ENV is set by Vercel to 'production' | 'preview' | 'development', and
 * is 'production' only for the production deployment itself, not for a preview
 * built from the same commit. Anything else, including a local machine where it
 * is undefined, counts as not production.
 *
 * THE DEFAULT IS THE SAFE ONE. An unset variable means "not production", so a
 * misconfigured environment redirects mail internally rather than posting it to
 * a client. Getting this backwards would send real clients test email.
 */
function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production"
}

/**
 * Send the client their "plan is ready" email.
 *
 * Outside production the mail is redirected to NON_PROD_REDIRECT and the
 * intended recipient is put in the subject, so a preview deploy can be
 * exercised end to end without a client ever receiving anything. The body is
 * unchanged, including the login link, because the point of the test is to see
 * what the client would have seen.
 */
export async function sendNetworkingPlanReady(args: {
  to: string
  firstName: string
}): Promise<PlanEmailResult> {
  const intended = String(args.to || "").trim()
  if (!intended) return { ok: false, error: "No email address for this client." }

  let loginUrl: string
  try {
    loginUrl = signalLoginUrl()
  } catch (e: any) {
    // Deliberately not sent. See the note on signalLoginUrl.
    return { ok: false, error: String(e?.message ?? e) }
  }

  const production = isProduction()
  const to = production ? intended : NON_PROD_REDIRECT

  // Trailing space is part of the value: the template is
  // "{{subject_prefix}}Your networking plan is ready" with no space of its own,
  // so that production passes "" and gets the subject exactly as written.
  const subjectPrefix = production
    ? ""
    : `[${process.env.VERCEL_ENV ?? "local"} -> ${intended}] `

  try {
    const res = await getPostmarkClient().sendEmailWithTemplate({
      From: FROM_EMAIL,
      To: to,
      TemplateAlias: NETWORKING_PLAN_TEMPLATE,
      MessageStream: CLIENT_STREAM,
      TemplateModel: {
        first_name: args.firstName || "there",
        login_url: loginUrl,
        subject_prefix: subjectPrefix,
      },
    })
    return { ok: true, to, redirected: !production, messageId: res.MessageID }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}
