// tests/email/sync-sow-template.ts
//
// Pushes the client-facing SOW email template:
//
//   sow-ready   the coach's own subject and body, edited before each send
//
// The subject and body are the coach's text (lib/sow/email.ts renders and
// escapes it), so the template is only a frame: {{{body_html}}} is unescaped
// on purpose, and is safe because renderSowEmail escaped the coach's words.
// USES THE signal-client LAYOUT, which carries the header, the rule and the
// founder's signature, like every client-facing email.
//
// THE SUBJECT STARTS WITH {{subject_prefix}}: empty in production, and
// "[preview -> whoever] " everywhere else, where sendToClient redirects.
//
//   POSTMARK_API_KEY=... npx tsx tests/email/sync-sow-template.ts
//
// Idempotent: creates the template the first time, edits it after. One Postmark
// server serves every environment, so this updates production's copy at once;
// nothing sends it until the SOW send code ships.

const TOKEN = process.env.POSTMARK_API_KEY
if (!TOKEN) throw new Error("Set POSTMARK_API_KEY")

async function pm(method: string, path: string, body?: any) {
  const res = await fetch("https://api.postmarkapp.com" + path, {
    method,
    headers: { "X-Postmark-Server-Token": TOKEN!, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

const TEMPLATE = {
  Alias: "sow-ready",
  Name: "SOW ready",
  Subject: "{{subject_prefix}}{{subject}}",
  HtmlBody: "{{{body_html}}}",
  TextBody: "{{body_text}}",
}

async function main() {
  const layouts = await pm("GET", "/templates?Count=100&Offset=0&TemplateType=Layout")
  const layout = (layouts.body?.Templates ?? []).find((t: any) => t.Alias === "signal-client")
  if (!layout) throw new Error("No signal-client layout on this server")
  const existing = await pm("GET", `/templates/${TEMPLATE.Alias}`)
  const payload = { ...TEMPLATE, LayoutTemplate: "signal-client", TemplateType: "Standard" }
  const res = existing.status === 200
    ? await pm("PUT", `/templates/${TEMPLATE.Alias}`, payload)
    : await pm("POST", "/templates", payload)
  const verb = existing.status === 200 ? "updated" : "created"
  if (res.status >= 300) {
    console.error(`FAIL ${TEMPLATE.Alias}: ${res.status} ${JSON.stringify(res.body)}`)
    process.exitCode = 1
  } else {
    console.log(`${verb.padEnd(7)} ${TEMPLATE.Alias}  (id ${res.body?.TemplateId})`)
  }
}
void main()
