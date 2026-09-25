// tests/email/sync-task-templates.ts
//
// Pushes the two coach-facing Postmark templates: task assignment, and the
// daily overdue digest.
//
// EVERY SUBJECT STARTS WITH {{subject_prefix}}. It is empty in production and
// carries "[preview -> whoever] " everywhere else, because sendToCoach
// redirects internal mail outside production the same way client mail is
// redirected. Dev has a copy of production's coach profiles, so without this a
// test run mails real people about work that does not exist.
//
// NO LAYOUT, AND THEREFORE NO SIGNATURE. The signal-client layout carries the
// founder's signature, which belongs on mail to a client and would be odd on
// "you have been given a task". These ride the signal-internal stream and stand
// on their own. That is the standing rule in the plan doc, applied.
//
//   POSTMARK_API_KEY=... npx tsx tests/email/sync-task-templates.ts
//
// One Postmark server serves every environment, so this updates production's
// copy immediately. Safe while nothing sends them, and the reason it is a
// script run on purpose rather than part of a deploy.

const TOKEN = process.env.POSTMARK_API_KEY
if (!TOKEN) throw new Error("Set POSTMARK_API_KEY")

const INK = "#08203F"
const LABEL = "#009BFF"
const RULE = "#FF6B00"
const MUTED = "#4A6478"
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

async function pm(method: string, path: string, body?: any) {
  const res = await fetch("https://api.postmarkapp.com" + path, {
    method,
    headers: { "X-Postmark-Server-Token": TOKEN!, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

function shell(inner: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background-color:#F2FAFD;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F2FAFD;">
    <tr><td align="center" style="padding:28px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#FFFFFF;border-radius:10px;">
        <tr><td style="padding:24px 28px 0 28px;">
          <table role="presentation" width="100%"><tr><td style="height:3px;line-height:3px;font-size:0;background-color:${RULE};">&nbsp;</td></tr></table>
        </td></tr>
        <tr><td style="padding:20px 28px 26px 28px;font-family:${FONT};color:${INK};font-size:15px;line-height:1.6;">
${inner}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

const button = (hrefVar: string, label: string) => `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px 0;">
            <tr><td align="center" bgcolor="${INK}" style="border-radius:6px;">
              <a href="${hrefVar}" style="display:inline-block;padding:12px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:6px;">${label}</a>
            </td></tr>
          </table>`

// ---------------------------------------------------------------------------
// task-assigned
// ---------------------------------------------------------------------------
const assignedHtml = shell(`
          <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:${LABEL};">
            {{#is_reassignment}}Task reassigned to you{{/is_reassignment}}{{^is_reassignment}}New task for you{{/is_reassignment}}
          </p>
          <p style="margin:0 0 14px 0;font-size:19px;font-weight:700;">{{title}}</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;">
            {{#client_name}}<tr><td width="92" style="padding:3px 0;color:${MUTED};">Client</td><td style="padding:3px 0;">{{.}}</td></tr>{{/client_name}}
            <tr><td width="92" style="padding:3px 0;color:${MUTED};">Due</td><td style="padding:3px 0;">{{due_text}}</td></tr>
            <tr><td width="92" style="padding:3px 0;color:${MUTED};">Added by</td><td style="padding:3px 0;">{{source_text}}</td></tr>
          </table>

          {{#description}}<p style="margin:16px 0 0 0;color:${MUTED};">{{.}}</p>{{/description}}

          {{#brief_summary}}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0 0;">
            <tr><td bgcolor="#FFEEDC" style="padding:14px 16px;border-radius:8px;">
              <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:${LABEL};">Campaign brief</p>
              <p style="margin:0;font-size:14px;">{{.}}</p>
            </td></tr>
          </table>
          {{/brief_summary}}
${button("{{task_url}}", "Open in SIGNAL")}`)

const assignedText = `{{#is_reassignment}}Task reassigned to you{{/is_reassignment}}{{^is_reassignment}}New task for you{{/is_reassignment}}

{{title}}

{{#client_name}}Client: {{.}}
{{/client_name}}Due: {{due_text}}
Added by: {{source_text}}
{{#description}}
{{.}}
{{/description}}{{#brief_summary}}
Campaign brief: {{.}}
{{/brief_summary}}
Open in SIGNAL: {{task_url}}`

// ---------------------------------------------------------------------------
// task-reopened  (Request Changes)
//
// THE NOTE IS THE EMAIL. Everything else is context for it, so it gets the
// tinted block and the body copy gets nothing.
// ---------------------------------------------------------------------------
const reopenedHtml = shell(`
          <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:${RULE};">
            Sent back to you
          </p>
          <p style="margin:0 0 14px 0;font-size:19px;font-weight:700;">{{title}}</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">
            <tr><td bgcolor="#FFEEDC" style="padding:14px 16px;border-radius:8px;">
              <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:${LABEL};">What to change</p>
              <p style="margin:0;font-size:15px;line-height:1.55;">{{note}}</p>
            </td></tr>
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;">
            {{#client_name}}<tr><td width="92" style="padding:3px 0;color:${MUTED};">Client</td><td style="padding:3px 0;">{{.}}</td></tr>{{/client_name}}
            <tr><td width="92" style="padding:3px 0;color:${MUTED};">Due</td><td style="padding:3px 0;">{{due_text}}</td></tr>
          </table>
${button("{{task_url}}", "Open in SIGNAL")}`)

const reopenedText = `Sent back to you

{{title}}

What to change:
{{note}}

{{#client_name}}Client: {{.}}
{{/client_name}}Due: {{due_text}}

Open in SIGNAL: {{task_url}}`
// ---------------------------------------------------------------------------
// overdue-digest
// ---------------------------------------------------------------------------
const digestHtml = shell(`
          <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:${LABEL};">Overdue</p>
          <p style="margin:0 0 16px 0;font-size:19px;font-weight:700;">
            You have {{overdue_count}} overdue task{{#plural}}s{{/plural}}
          </p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;">
            {{#tasks}}
            <tr>
              <td width="14" valign="top" style="padding:0 0 10px 0;color:${RULE};font-weight:700;">&bull;</td>
              <td valign="top" style="padding:0 0 10px 0;">
                <strong>{{title}}</strong>{{#client_name}} <span style="color:${MUTED};">&middot; {{.}}</span>{{/client_name}}<br />
                <span style="color:${MUTED};">Due {{due_text}}</span>
              </td>
            </tr>
            {{/tasks}}
          </table>
${button("{{tasks_url}}", "Open your tasks")}`)

const digestText = `You have {{overdue_count}} overdue task{{#plural}}s{{/plural}}.

{{#tasks}}- {{title}}{{#client_name}} ({{.}}){{/client_name}} - due {{due_text}}
{{/tasks}}
Open your tasks: {{tasks_url}}`

async function push(alias: string, name: string, subject: string, html: string, text: string) {
  const existing = await pm("GET", `/templates/${alias}`)
  const body = { Name: name, Alias: alias, Subject: subject, HtmlBody: html, TextBody: text, TemplateType: "Standard" }
  const r = existing.status === 200
    ? await pm("PUT", `/templates/${alias}`, body)
    : await pm("POST", "/templates", body)
  console.log(`${alias}: ${existing.status === 200 ? "updated" : "created"} -> ${r.status}`)
  if (r.status !== 200) { console.error(JSON.stringify(r.body)); process.exit(1) }
}

async function main() {
  // Subject carries the client in brackets, as specified.
  await push("task-assigned", "Task assigned",
    "{{subject_prefix}}New task: {{title}}{{#client_name}} ({{.}}){{/client_name}}",
    assignedHtml, assignedText)

  await push("task-reopened", "Task sent back",
    "{{subject_prefix}}Sent back: {{title}}{{#client_name}} ({{.}}){{/client_name}}",
    reopenedHtml, reopenedText)

  await push("overdue-digest", "Overdue task digest",
    "{{subject_prefix}}You have {{overdue_count}} overdue task{{#plural}}s{{/plural}}",
    digestHtml, digestText)

  // Rendered with the layout deliberately absent, which is what the internal
  // stream sends.
  const v = await pm("POST", "/templates/validate", {
    Subject: "{{subject_prefix}}New task: {{title}}{{#client_name}} ({{.}}){{/client_name}}",
    HtmlBody: assignedHtml, TextBody: assignedText, TemplateType: "Standard",
    TestRenderModel: {
      title: "Create Networking Campaign", client_name: "Lily Stein",
      due_text: "Sep 26", source_text: "a rule", task_url: "https://x/y",
      brief_summary: "Analyst roles, New York", is_reassignment: false, description: "",
      subject_prefix: "[preview -> erin@example.com] ",
    },
  })
  for (const part of ["Subject", "HtmlBody", "TextBody"] as const) {
    const p = (v.body as any)?.[part]
    console.log(`  task-assigned ${part}: valid=${p?.ContentIsValid} errors=${JSON.stringify(p?.ValidationErrors ?? [])}`)
  }
  const rendered: string = (v.body as any)?.HtmlBody?.RenderedContent ?? ""
  console.log(`  signature absent (correct for internal): ${!rendered.includes("Founder")}`)
  console.log(`  subject renders: ${JSON.stringify((v.body as any)?.Subject?.RenderedContent)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
