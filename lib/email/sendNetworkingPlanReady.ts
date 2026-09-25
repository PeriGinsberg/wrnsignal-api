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

import { sendToClient, NON_PROD_REDIRECT } from "./send"
import { signalLoginUrl } from "../urls"

export const NETWORKING_PLAN_TEMPLATE = "networking-plan-ready"
export { NON_PROD_REDIRECT }

export type PlanEmailResult =
  | { ok: true; to: string; redirected: boolean; messageId: string }
  | { ok: false; error: string }

/**
 * Send the client their "plan is ready" email.
 *
 * The production guard, the stream and the subject prefix all live in
 * sendToClient now, so every client-facing email gets them rather than each
 * sender re-deciding. What is left here is the one thing specific to this
 * email: it must not go at all without a login URL.
 */
export async function sendNetworkingPlanReady(args: {
  to: string
  firstName: string
}): Promise<PlanEmailResult> {
  let loginUrl: string
  try {
    loginUrl = signalLoginUrl()
  } catch (e: any) {
    // Deliberately not sent. See the note on signalLoginUrl: an email that
    // has left cannot be corrected, and the fallback would be the API host.
    return { ok: false, error: String(e?.message ?? e) }
  }

  return sendToClient({
    to: args.to,
    templateAlias: NETWORKING_PLAN_TEMPLATE,
    model: { first_name: args.firstName || "there", login_url: loginUrl },
  })
}
