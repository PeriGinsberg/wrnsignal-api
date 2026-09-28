// tests/email/sync-practice-templates.ts
//
// Pushes the two client-facing practice-round templates:
//
//   practice-round-ready    "Your coach sent you a practice round"
//   practice-feedback-ready "Your coach left feedback"
//
// BOTH USE THE signal-client LAYOUT, which carries the header, the rule and the
// founder's signature. That is the standing rule for anything a client reads, so
// the bodies here are the inner content only: no <html>, no shell, no signature.
// A {{{@content}}} slot in the layout is where this lands.
//
// EVERY SUBJECT STARTS WITH {{subject_prefix}}. It is empty in production and
// carries "[preview -> whoever] " everywhere else, because sendToClient
// redirects outside production. Without it a staging run is indistinguishable
// from the real thing in an inbox.
//
//   POSTMARK_API_KEY=... npx tsx tests/email/sync-practice-templates.ts
//
// Idempotent: creates a template the first time, edits it after. One Postmark
// server serves every environment, so this updates production's copy
// immediately, which is why it is a script run on purpose and not part of a
// deploy.

const TOKEN = process.env.POSTMARK_API_KEY
if (!TOKEN) throw new Error("Set POSTMARK_API_KEY")

const INK = "#08203F"
const MUTED = "#4A6478"
const RULE = "#FF6B00"
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

async function pm(method: string, path: string, body?: any) {
  const res = await fetch("https://api.postmarkapp.com" + path, {
    method,
    headers: { "X-Postmark-Server-Token": TOKEN!, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

const p = (inner: string) =>
  `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};">${inner}</p>`

/**
 * A solid navy button. The brand rule is that a primary action is solid navy
 * with white ink; orange draws rules and never a fill. Table-wrapped because
 * Outlook does not give a styled <a> a background.
 */
const button = (label: string) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px 0;">
  <tr><td align="center" bgcolor="${INK}" style="border-radius:8px;">
    <a href="{{practice_url}}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${label}</a>
  </td></tr>
</table>`

const rule = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;"><tr><td style="height:3px;line-height:3px;font-size:0;background-color:${RULE};">&nbsp;</td></tr></table>`

const small = (inner: string) =>
  `<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">${inner}</p>`

const TEMPLATES = [
  {
    Alias: "practice-round-ready",
    Name: "Practice round ready",
    Subject: "{{subject_prefix}}{{coach_name}} sent you a practice round",
    HtmlBody: [
      rule,
      p("Hi {{first_name}},"),
      p(
        "{{coach_name}} has put together a practice round for you: <strong>{{question_count}} {{question_word}}</strong>, " +
          "{{seconds}} seconds each. You record your answers on video, one question at a time.",
      ),
      p("There is no penalty for a second take. Record it again until it sounds like you."),
      button("Start the practice round"),
      small("The link opens SIGNAL. You will need to allow camera and microphone access."),
    ].join("\n"),
    TextBody:
      "Hi {{first_name}},\n\n" +
      "{{coach_name}} has put together a practice round for you: {{question_count}} {{question_word}}, {{seconds}} seconds each. " +
      "You record your answers on video, one question at a time.\n\n" +
      "There is no penalty for a second take. Record it again until it sounds like you.\n\n" +
      "Start the practice round: {{practice_url}}\n\n" +
      "The link opens SIGNAL. You will need to allow camera and microphone access.\n",
  },
  {
    Alias: "practice-feedback-ready",
    Name: "Practice feedback ready",
    Subject: "{{subject_prefix}}{{coach_name}} left feedback on your practice round",
    // THE FEEDBACK ITSELF IS NOT IN THIS EMAIL, on purpose. It is written per
    // question and belongs under the answer it is about; flattened into a mail
    // it loses the thing that makes it usable. This is a nudge with a link.
    HtmlBody: [
      rule,
      p("Hi {{first_name}},"),
      p(
        "{{coach_name}} has watched your practice round, <strong>{{round_title}}</strong>, and written feedback on each answer.",
      ),
      p("Your recordings are there too, so you can watch each answer back with the notes beside it."),
      button("Read the feedback"),
      small("Everything is in your Coaching Hub, under Practice rounds."),
    ].join("\n"),
    TextBody:
      "Hi {{first_name}},\n\n" +
      "{{coach_name}} has watched your practice round, {{round_title}}, and written feedback on each answer.\n\n" +
      "Your recordings are there too, so you can watch each answer back with the notes beside it.\n\n" +
      "Read the feedback: {{practice_url}}\n\n" +
      "Everything is in your Coaching Hub, under Practice rounds.\n",
  },
]

async function main() {
  const layouts = await pm("GET", "/templates?Count=100&Offset=0&TemplateType=Layout")
  const layout = (layouts.body?.Templates ?? []).find((t: any) => t.Alias === "signal-client")
  if (!layout) throw new Error("No signal-client layout on this server")

  for (const t of TEMPLATES) {
    const existing = await pm("GET", `/templates/${t.Alias}`)
    const payload = { ...t, LayoutTemplate: "signal-client", TemplateType: "Standard" }
    const res =
      existing.status === 200
        ? await pm("PUT", `/templates/${t.Alias}`, payload)
        : await pm("POST", "/templates", payload)
    const verb = existing.status === 200 ? "updated" : "created"
    if (res.status >= 300) {
      console.error(`FAIL ${t.Alias}: ${res.status} ${JSON.stringify(res.body)}`)
      process.exitCode = 1
    } else {
      console.log(`${verb.padEnd(7)} ${t.Alias}  (id ${res.body?.TemplateId})`)
    }
  }
}

void main()
