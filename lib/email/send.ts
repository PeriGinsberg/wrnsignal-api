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

import type { SupabaseClient } from "@supabase/supabase-js"
import { getPostmarkClient, CLIENT_STREAM, INTERNAL_STREAM, FROM_EMAIL } from "../postmark"
import { getSupabaseAdmin } from "../collab/identity"
import { coachBccFor, logClientEmail, type ClientEmailType } from "./clientEmailLog"
import { splitCc } from "./cc"

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
/**
 * The host whose deployments are allowed to email real clients.
 *
 * Overridable by env so a rename does not need a code change, but it has a
 * default so the common case needs no configuration at all.
 */
const LIVE_EMAIL_HOST = (process.env.SIGNAL_LIVE_EMAIL_HOST ?? "wrnsignal-api.vercel.app").trim()

/**
 * What to call this environment in a redirected subject line.
 *
 * NOT VERCEL_ENV, which reads "production" on staging and made every
 * redirected staging email announce itself as "[production -> ...]". The
 * project's own host is the thing that actually differs, so the label is its
 * first segment: "wrnsignal-api-staging" becomes "staging".
 */
export function environmentLabel(): string {
  const host = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim()
  if (!host) return process.env.VERCEL_ENV ?? "local"
  const name = host.split(".")[0]
  return name.replace(/^wrnsignal-api-?/, "") || name
}

export function isProduction(): boolean {
  // VERCEL_ENV IS NOT ENOUGH, and this is the correction. It reads
  // "production" for the production deployment of ANY project, including
  // wrnsignal-api-staging, so staging was mailing real client addresses with
  // no redirect and no [staging -> ] prefix. Confirmed on 2026-09-28: a
  // practice round sent from staging went straight to the client.
  //
  // That matters because the staging project points at the DEV database, and
  // dev carries a copy of production's client profiles. The redirect that
  // exists to stop a preview mailing a client did not cover the one
  // environment most likely to be exercised against real-looking data.
  if (process.env.VERCEL_ENV !== "production") return false

  // WHICH project this deployment belongs to. Vercel sets this to the
  // project's own production alias, so staging reports
  // wrnsignal-api-staging.vercel.app and production reports
  // wrnsignal-api.vercel.app.
  const host = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim()

  // UNKNOWN MEANS NOT PRODUCTION. If the variable is ever absent we redirect
  // inward rather than outward: the failure is then "Peri receives mail meant
  // for clients", which is loud and recoverable in minutes, instead of
  // "clients receive mail from a test environment", which is neither.
  if (!host) {
    console.warn(
      "[email] VERCEL_PROJECT_PRODUCTION_URL is not set on a production deployment. " +
      "Treating this as NOT production, so client mail is being redirected. " +
      "Check /api/version.",
    )
    return false
  }

  return host === LIVE_EMAIL_HOST
}

/** What the email log needs to know about a send. See lib/email/clientEmailLog.ts. */
export type ClientEmailContext = {
  type: ClientEmailType
  /** The coach_clients row the email belongs to; its coach gets a blind copy. */
  coachClientId: string | null
  /** Who clicked to send it. Null when SIGNAL sent it on its own. */
  actor: string | null
  /** Defaults to the service-role client. */
  db?: SupabaseClient
}

/**
 * A content-only "template" for an email SIGNAL writes itself (the invite), so
 * it is rendered into the same layout as the stored templates.
 */
const INLINE_TEMPLATE = {
  Subject: "{{subject_prefix}}{{{subject}}}",
  HtmlBody: "{{{body_html}}}",
  TextBody: "{{{body_text}}}",
  LayoutTemplate: CLIENT_LAYOUT_ALIAS,
}

/**
 * The email exactly as it will go out: Postmark renders the template, the
 * layout and the signature, and that rendered copy is what is sent AND what is
 * saved, so the log cannot differ from the inbox. (Checked against a real SOW
 * on 2026-10-12: subject, text and HTML byte-identical to Postmark's record of
 * the templated send.)
 *
 * This is also where the signature rule is enforced: a stored template that
 * does not use the signal-client layout is refused rather than sent bare.
 */
async function renderClientEmail(args: {
  templateAlias?: string
  model?: Record<string, unknown>
  content?: { subject: string; html: string; text: string }
  subjectPrefix: string
}): Promise<{ ok: true; subject: string; html: string; text: string } | { ok: false; error: string }> {
  const pm = getPostmarkClient()
  let tpl: { Subject: string; HtmlBody: string | null; TextBody: string | null; LayoutTemplate: string | null }
  let model: Record<string, unknown>
  if (args.templateAlias) {
    tpl = await pm.getTemplate(args.templateAlias)
    if (tpl.LayoutTemplate !== CLIENT_LAYOUT_ALIAS) {
      return { ok: false, error: `The ${args.templateAlias} template does not use the ${CLIENT_LAYOUT_ALIAS} layout, so it would go out without the signature.` }
    }
    model = args.model ?? {}
  } else if (args.content) {
    tpl = INLINE_TEMPLATE
    model = { subject: args.content.subject, body_html: args.content.html, body_text: args.content.text }
  } else {
    return { ok: false, error: "Nothing to send." }
  }
  const v = await pm.validateTemplate({
    Subject: tpl.Subject,
    HtmlBody: tpl.HtmlBody ?? undefined,
    TextBody: tpl.TextBody ?? undefined,
    LayoutTemplate: tpl.LayoutTemplate ?? undefined,
    TemplateType: "Standard" as any,
    InlineCssForHtmlTestRender: true,
    TestRenderModel: { ...model, subject_prefix: args.subjectPrefix },
  })
  if (!v.AllContentIsValid) {
    return { ok: false, error: `The email did not render: ${JSON.stringify([v.Subject, v.HtmlBody, v.TextBody].map((p) => p?.ValidationErrors ?? []))}` }
  }
  return { ok: true, subject: v.Subject.RenderedContent, html: v.HtmlBody?.RenderedContent ?? "", text: v.TextBody?.RenderedContent ?? "" }
}

/**
 * Send a client-facing email: a stored template (templateAlias + model) or
 * one SIGNAL wrote (content), either way inside the signal-client layout.
 *
 * Three things happen to every one, which is why every client email comes
 * through here:
 *   1. the coach gets a blind copy (coachBccFor: whoever clicked, plus the
 *      client's coach when that is someone else; the client's coach alone for
 *      an automatic send)
 *   2. it is saved to the email log, private links removed
 *   3. outside production it is redirected to NON_PROD_REDIRECT with the
 *      intended To, CC and BCC in the subject, and none of them is mailed.
 *      The body is untouched, including its links, because the point of the
 *      test is to see what the client would have seen.
 *
 * `subject_prefix` is always supplied, empty in production. Templates carry
 * "{{subject_prefix}}Real subject" so the prefix needs no conditional; an
 * omitted merge field would render Postmark's placeholder text instead.
 */
export async function sendToClient(args: {
  to: string
  templateAlias?: string
  model?: Record<string, unknown>
  content?: { subject: string; html: string; text: string }
  from?: string
  /**
   * A copy, e.g. a prospect's parent: one address or several, comma-separated
   * (resolveCc in ./cc.ts). Outside production it is not sent: the
   * redirect covers it, and the subject names it instead, so a test shows who
   * would have been copied without mailing them.
   */
  cc?: string | null
  log: ClientEmailContext
}): Promise<SendResult> {
  const intended = String(args.to || "").trim()
  if (!intended) return { ok: false, error: "No email address for this client." }
  const cc = String(args.cc ?? "").trim()
  const from = args.from ?? FROM_EMAIL

  // The blind copy. A failure to work it out never stops the email; it goes
  // without the copy and says so in the server log.
  let db: SupabaseClient | null = null
  let bcc: string[] = []
  try {
    db = args.log.db ?? getSupabaseAdmin()
    bcc = await coachBccFor(db, { coachClientId: args.log.coachClientId, actor: args.log.actor, exclude: [intended, ...splitCc(cc)] })
  } catch (e: any) {
    console.warn("[email] coach BCC lookup failed, sending without it:", e?.message ?? String(e))
  }

  const production = isProduction()
  const to = production ? intended : NON_PROD_REDIRECT
  const copies = [cc ? `cc ${cc}` : "", bcc.length ? `bcc ${bcc.join(", ")}` : ""].filter(Boolean).join(", ")
  const subjectPrefix = production ? "" : `[${environmentLabel()} -> ${intended}${copies ? `, ${copies}` : ""}] `

  let messageId: string
  let rendered: { subject: string; html: string; text: string }
  try {
    const r = await renderClientEmail({ templateAlias: args.templateAlias, model: args.model, content: args.content, subjectPrefix })
    if (!r.ok) return r
    rendered = r
    const res = await getPostmarkClient().sendEmail({
      From: from,
      To: to,
      ...(production && cc ? { Cc: cc } : {}),
      ...(production && bcc.length ? { Bcc: bcc.join(", ") } : {}),
      Subject: r.subject,
      HtmlBody: r.html,
      TextBody: r.text,
      Tag: args.log.type,
      MessageStream: CLIENT_STREAM,
    })
    messageId = res.MessageID
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }

  if (db) {
    await logClientEmail(db, {
      coach_client_id: args.log.coachClientId,
      email_type: args.log.type,
      from_email: from,
      to_email: intended,
      cc_email: cc || null,
      bcc_emails: bcc,
      delivered_to: to,
      redirected: !production,
      subject: rendered.subject,
      text_body: rendered.text,
      html_body: rendered.html,
      triggered_by: args.log.actor,
      postmark_message_id: messageId,
    })
  }
  return { ok: true, to, redirected: !production, messageId }
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
  const subjectPrefix = production ? "" : `[${environmentLabel()} -> ${intended}] `

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
