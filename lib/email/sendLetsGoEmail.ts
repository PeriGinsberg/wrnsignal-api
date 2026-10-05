// lib/email/sendLetsGoEmail.ts
//
// "[name] said Let's Go": the coach's email when a client accepts their SOW
// (lib/sow/accept.ts). What they accepted, the Drive workspace (or why it
// could not be made), the welcome task, and a warning when the package changed
// after the SOW was sent. Internal stream, no signature, redirected outside
// production like every SIGNAL email. Inline HTML, like the consult-booked
// email.
//
// Postmark is imported lazily: lib/postmark.ts throws at load without a key,
// and this module is reached from code the tests load.

import { NON_PROD_REDIRECT, environmentLabel, isProduction } from "./send"

export type LetsGoEmail = {
  clientName: string
  acceptedName: string
  packageName: string
  total: string | null
  terms: string[]
  workspaceUrl: string | null
  workspaceError: string | null
  welcomeTask: string | null
  changedAfterSend: boolean
  link: string
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export function letsGoSubject(e: LetsGoEmail): string {
  return `${e.clientName} said Let's Go to ${e.packageName}`
}

export function letsGoBody(e: LetsGoEmail): { text: string; html: string } {
  const lines: string[] = [
    `${e.clientName} accepted their Statement of Work for ${e.packageName}, signing as "${e.acceptedName}".`,
  ]
  if (e.changedAfterSend) {
    lines.push("Heads up: you changed the package after this SOW was sent and did not re-send it. They accepted the copy they were sent, so check that the plan in SIGNAL matches.")
  }
  if (e.total) lines.push(`Price: ${e.total}\n${e.terms.map((t) => `- ${t}`).join("\n")}`)
  lines.push(e.workspaceUrl
    ? `Their Google Drive workspace is ready: ${e.workspaceUrl}`
    : `SIGNAL could not make their Google Drive workspace (${e.workspaceError ?? "unknown error"}). There is a task to create it.`)
  lines.push(e.welcomeTask
    ? `Next: "Send welcome email (releases: ${e.welcomeTask})" is on your To-Do list. Releasing it shares the Drive workspace with them.`
    : "Next: send their welcome email. This package has no client task to release with it.")
  lines.push(`"Send invoice to ${e.clientName}" is on your To-Do list too.`)
  const text = `${lines.join("\n\n")}\n\nOpen in SIGNAL: ${e.link}\n`
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#13294A;max-width:600px;font-size:14px;line-height:1.55;">
<p style="font-size:18px;font-weight:bold;margin:0 0 12px;">${esc(letsGoSubject(e))}</p>
${lines.map((l) => `<p style="margin:0 0 12px;${l.startsWith("Heads up") ? "background:#FFF1E0;border-left:3px solid #FEB06A;padding:8px 10px;" : ""}">${esc(l).replace(/\n/g, "<br>")}</p>`).join("\n")}
<p style="margin:20px 0 0;"><a href="${esc(e.link)}" style="background:#08203F;color:#FEB06A;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">Open in SIGNAL</a></p>
</div>`
  return { text, html }
}

export async function sendLetsGoEmail(to: string, e: LetsGoEmail): Promise<{ ok: boolean; error?: string }> {
  const intended = to.trim()
  if (!intended) return { ok: false, error: "No coach email" }
  const production = isProduction()
  const prefix = production ? "" : `[${environmentLabel()} -> ${intended}] `
  const { text, html } = letsGoBody(e)
  try {
    const { getPostmarkClient, FROM_EMAIL, INTERNAL_STREAM } = await import("../postmark")
    await getPostmarkClient().sendEmail({
      From: FROM_EMAIL,
      To: production ? intended : NON_PROD_REDIRECT,
      Subject: prefix + letsGoSubject(e),
      TextBody: text,
      HtmlBody: html,
      MessageStream: INTERNAL_STREAM,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
