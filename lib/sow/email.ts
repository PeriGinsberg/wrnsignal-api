// lib/sow/email.ts
//
// The email that sends a client their SOW. The coach edits the subject and the
// body before it goes; [SOW link] in the body becomes the button to their
// private link. The signature is not here: the Postmark layout signal-client
// adds it (lib/email/send.ts), and the editor shows it read-only.
//
// The coach's text is escaped before it becomes HTML, so nothing typed into the
// editor can change the email's markup.

import { fillOpening } from "./model"

export const SOW_EMAIL_TEMPLATE = "sow-ready"
export const SOW_LINK_TOKEN = "[SOW link]"
export const SOW_EMAIL_SUBJECT_MAX = 200
export const SOW_EMAIL_BODY_MAX = 6000

export const DEFAULT_SOW_EMAIL_SUBJECT = "Your plan with Workforce Ready Now"

export const DEFAULT_SOW_EMAIL_BODY = [
  "Hi [First Name],",
  "Thank you for taking the time to talk with me. Based on our conversation, I recommend the [package name] for your engagement. See the details here:",
  SOW_LINK_TOKEN,
  "It lays out exactly what we'll build together, how we'll work, and the investment. When everything looks right, click Let's Go at the bottom of the page and we'll get started.",
  "As soon as you accept, I'll set up your personal Google Drive workspace and send your welcome email with your first step. Your invoice will follow separately.",
  "If you have questions, call, text, or email me anytime at (561) 843-6269.",
  "I'm looking forward to working with you.",
].join("\n\n")

/** The default body for this client: [First Name] and [package name] filled; [SOW link] stays for the send. */
export function defaultSowEmailBody(clientName: string | null, packageName: string): string {
  return fillOpening(DEFAULT_SOW_EMAIL_BODY, clientName)!.replace(/\[\s*package\s+name\s*\]/gi, packageName)
}

const LINK_RE = /\[\s*sow\s+link\s*\]/i
const LINK_RE_ALL = /\[\s*sow\s+link\s*\]/gi

export function hasSowLink(body: string): boolean {
  return LINK_RE.test(body)
}

const INK = "#08203F"
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** A solid navy button, table-wrapped for Outlook (the practice-round emails' button). */
function button(url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px 0;">
  <tr><td align="center" bgcolor="${INK}" style="border-radius:8px;">
    <a href="${esc(url)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;">View your Statement of Work</a>
  </td></tr>
</table>`
}

/**
 * The coach's text as the email's HTML and plain-text bodies. Paragraphs are
 * split on blank lines; a paragraph that is only [SOW link] becomes the
 * button, and [SOW link] inside a sentence becomes a plain link.
 */
export function renderSowEmail(body: string, url: string): { html: string; text: string } {
  const paras = body.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const html = paras.map((p) => {
    if (LINK_RE.test(p) && p.replace(LINK_RE_ALL, "").trim() === "") return button(url)
    const inner = esc(p)
      .replace(LINK_RE_ALL, `<a href="${esc(url)}" style="color:${INK};font-weight:bold;">View your Statement of Work</a>`)
      .replace(/\n/g, "<br>")
    return `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};">${inner}</p>`
  }).join("\n")
  const text = paras.map((p) => p.replace(LINK_RE_ALL, url)).join("\n\n") + "\n"
  return { html, text }
}
