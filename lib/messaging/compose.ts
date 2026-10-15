// lib/messaging/compose.ts
//
// A coach's message as an email: what they typed, then their signature, as
// plain text and as HTML. No layout, no header, no logo: it should read like an
// email they wrote in their own inbox.
//
// The text is escaped before it becomes HTML, so nothing typed can change the
// email's markup. Paragraphs split on blank lines, single line breaks are kept,
// and bare http(s) links become links.

export const MESSAGE_SUBJECT_MAX = 200
export const MESSAGE_BODY_MAX = 20000
export const SIGNATURE_MAX = 2000

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
const INK = "#222222"

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// On escaped text, so a URL ends at whitespace or an escaped < or ". Trailing
// sentence punctuation is not part of the link.
const URL_RE = /https?:\/\/[^\s<]+?(?=[.,;:!?)\]]*(?:\s|$|&lt;|&quot;))/g

function linkify(escaped: string): string {
  return escaped.replace(URL_RE, (u) => `<a href="${u}" style="color:#1a56db;">${u}</a>`)
}

const paragraphs = (s: string) => s.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)

export function composeMessage(body: string, signature: string | null): { html: string; text: string } {
  const sig = (signature ?? "").replace(/\r\n/g, "\n").trim()
  const main = body.replace(/\r\n/g, "\n").trim()
  const text = (sig ? `${main}\n\n${sig}` : main) + "\n"
  const html = [...paragraphs(main), ...paragraphs(sig)]
    .map((p) => `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:15px;line-height:1.55;color:${INK};">${linkify(esc(p)).replace(/\n/g, "<br>")}</p>`)
    .join("\n")
  return { html: `<div>\n${html}\n</div>`, text }
}
