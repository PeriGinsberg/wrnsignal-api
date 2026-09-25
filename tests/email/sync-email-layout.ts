// tests/email/sync-email-layout.ts
//
// Pushes the client-facing Postmark LAYOUT and the networking-plan-ready
// template from source.
//
// WHY A LAYOUT AND NOT A SIGNATURE PASTED INTO EACH TEMPLATE. A Postmark layout
// wraps every template that names it, so the WRN header and the signature are
// applied once and inherited. A future client-facing template gets both by
// setting LayoutTemplate, with nothing to re-specify and nothing to forget.
//
// ONE POSTMARK SERVER SERVES DEV, PREVIEW AND PRODUCTION. Running this updates
// production's copy of the layout and the template immediately. That is safe
// while nothing in production sends them, and it is the reason this is a
// script run on purpose rather than something a deploy does.
//
//   POSTMARK_API_KEY=... npx tsx tests/email/sync-email-layout.ts          # push
//   POSTMARK_API_KEY=... npx tsx tests/email/sync-email-layout.ts --test   # push, then send one to peri@
//
// Credentials come from process.env; this file never reads a .env file.

import { signatureHtml, signatureStyles, signatureText, ASSET_BASE } from "../../lib/email/signature"

const TOKEN = process.env.POSTMARK_API_KEY
if (!TOKEN) throw new Error("Set POSTMARK_API_KEY")

const LAYOUT_ALIAS = "signal-client"
const TEMPLATE_ALIAS = "networking-plan-ready"
const TEST_TO = "peri@workforcereadynow.com"

// Body palette, as specified. NOT the signature's navy: see lib/email/signature.ts.
const INK = "#08203F"       // body text
const LABEL = "#009BFF"     // section labels
const RULE = "#FF6B00"      // the header rule and the section numerals
const CALLOUT = "#FFEEDC"   // the "How to start this week" box
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

async function pm(method: string, path: string, body?: any) {
  const res = await fetch("https://api.postmarkapp.com" + path, {
    method,
    headers: { "X-Postmark-Server-Token": TOKEN!, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

// ---------------------------------------------------------------------------
// The layout: logo header, an orange hairline, the template's content, then
// the signature.
// ---------------------------------------------------------------------------
const layoutHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      ${signatureStyles()}
      @media only screen and (max-width: 520px) {
        .wrap { padding: 16px 12px !important; }
        .card { padding: 22px 18px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:#F2FAFD;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F2FAFD;">
      <tr>
        <td class="wrap" align="center" style="padding:28px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="max-width:620px;background-color:#FFFFFF;border-radius:10px;">
            <tr>
              <td class="card" style="padding:28px 32px 0 32px;">
                <img src="${ASSET_BASE}/WRN_Transparent_Logo.png" width="150" alt="Workforce Ready Now"
                     style="display:block;border:0;width:150px;max-width:150px;height:auto;" />
              </td>
            </tr>
            <tr>
              <!-- The orange hairline. Structure, never text. -->
              <td style="padding:14px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr><td style="height:2px;line-height:2px;font-size:0;background-color:${RULE};">&nbsp;</td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="card" style="padding:22px 32px 8px 32px;font-family:${FONT};color:${INK};font-size:16px;line-height:1.6;">
                {{{ @content }}}
              </td>
            </tr>
            <tr>
              <td class="card" style="padding:4px 32px 28px 32px;">
                ${signatureHtml()}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

const layoutText = `{{{ @content }}}

--
${signatureText()}`

// ---------------------------------------------------------------------------
// The template: the copy, unchanged, in the new structure.
// ---------------------------------------------------------------------------
const num = (n: string) =>
  `<span style="color:${RULE};font-weight:700;font-size:20px;line-height:1;">${n}</span>`

const templateHtml = `
<p style="margin:0 0 16px 0;">Hi {{first_name}},</p>

<p style="margin:0 0 24px 0;">Your networking plan is ready, and everything you need to start is now in SIGNAL.</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
  <tr>
    <td align="center" bgcolor="${INK}" style="border-radius:6px;">
      <a href="{{login_url}}"
         style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:6px;">
        Log in to SIGNAL
      </a>
    </td>
  </tr>
</table>

<p style="margin:0 0 14px 0;font-size:11px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:${LABEL};">
  Here's what we built for you
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;">
  <tr>
    <td width="26" valign="top" style="width:26px;padding:0 0 14px 0;">${num("1")}</td>
    <td valign="top" style="padding:0 0 14px 0;">
      <strong>Your target contacts.</strong> Every company and contact we researched for you is loaded on your Networking board in SIGNAL. This is where you'll track each person, log every message you send, and see when your next follow-up is due.
    </td>
  </tr>
  <tr>
    <td width="26" valign="top" style="width:26px;padding:0 0 4px 0;">${num("2")}</td>
    <td valign="top" style="padding:0 0 4px 0;">
      <strong>Your Networking Plan.</strong> Find it in your Coaching Hub under Shared documents. It has your email and LinkedIn messages, when to send each one, and a weekly checklist.
    </td>
  </tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 24px 0;">
  <tr>
    <td bgcolor="${CALLOUT}" style="padding:18px 20px;border-radius:8px;">
      <p style="margin:0 0 10px 0;font-size:11px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:${LABEL};">
        How to start this week
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td width="16" valign="top" style="width:16px;color:${RULE};font-weight:700;padding:0 0 8px 0;">&bull;</td>
            <td valign="top" style="padding:0 0 8px 0;">Open your Networking Plan and read the "Before you send anything" section first.</td></tr>
        <tr><td width="16" valign="top" style="width:16px;color:${RULE};font-weight:700;padding:0 0 8px 0;">&bull;</td>
            <td valign="top" style="padding:0 0 8px 0;">Pick 5 to 8 contacts from your Networking board.</td></tr>
        <tr><td width="16" valign="top" style="width:16px;color:${RULE};font-weight:700;padding:0 0 8px 0;">&bull;</td>
            <td valign="top" style="padding:0 0 8px 0;">Find one real detail about each person or their company, then send your first email and LinkedIn request.</td></tr>
        <tr><td width="16" valign="top" style="width:16px;color:${RULE};font-weight:700;padding:0;">&bull;</td>
            <td valign="top" style="padding:0;">Log each one in SIGNAL as soon as you send it.</td></tr>
      </table>
    </td>
  </tr>
</table>

<p style="margin:0 0 16px 0;">SIGNAL will show you when each follow-up is due, so you never have to track dates yourself.</p>

<p style="margin:0 0 20px 0;">Bring your questions to our next session. I'm looking forward to seeing who you connect with.</p>

<p style="margin:0 0 4px 0;">Best,</p>
`.trim()

const templateText = `Hi {{first_name}},

Your networking plan is ready, and everything you need to start is now in SIGNAL.

Log in to SIGNAL: {{login_url}}

Here's what we built for you:

1. Your target contacts. Every company and contact we researched for you is loaded on your Networking board in SIGNAL. This is where you'll track each person, log every message you send, and see when your next follow-up is due.

2. Your Networking Plan. Find it in your Coaching Hub under Shared documents. It has your email and LinkedIn messages, when to send each one, and a weekly checklist.

How to start this week:

- Open your Networking Plan and read the "Before you send anything" section first.
- Pick 5 to 8 contacts from your Networking board.
- Find one real detail about each person or their company, then send your first email and LinkedIn request.
- Log each one in SIGNAL as soon as you send it.

SIGNAL will show you when each follow-up is due, so you never have to track dates yourself.

Bring your questions to our next session. I'm looking forward to seeing who you connect with.

Best,`

async function main() {
  // ---- layout
  const existingLayout = await pm("GET", `/templates/${LAYOUT_ALIAS}`)
  const layoutBody = {
    Name: "SIGNAL client layout",
    Alias: LAYOUT_ALIAS,
    HtmlBody: layoutHtml,
    TextBody: layoutText,
    TemplateType: "Layout",
  }
  const l = existingLayout.status === 200
    ? await pm("PUT", `/templates/${LAYOUT_ALIAS}`, layoutBody)
    : await pm("POST", "/templates", layoutBody)
  console.log(`layout ${LAYOUT_ALIAS}: ${existingLayout.status === 200 ? "updated" : "created"} -> ${l.status}`)
  if (l.status !== 200) { console.error(JSON.stringify(l.body)); process.exit(1) }

  // ---- template, pointed at the layout
  const t = await pm("PUT", `/templates/${TEMPLATE_ALIAS}`, {
    Subject: "{{subject_prefix}}Your networking plan is ready",
    HtmlBody: templateHtml,
    TextBody: templateText,
    LayoutTemplate: LAYOUT_ALIAS,
  })
  console.log(`template ${TEMPLATE_ALIAS}: updated -> ${t.status}`)
  if (t.status !== 200) { console.error(JSON.stringify(t.body)); process.exit(1) }

  // ---- validate, with the layout applied
  const v = await pm("POST", "/templates/validate", {
    Subject: "{{subject_prefix}}Your networking plan is ready",
    HtmlBody: templateHtml,
    TextBody: templateText,
    LayoutTemplate: LAYOUT_ALIAS,
    TemplateType: "Standard",
    TestRenderModel: { first_name: "Lily", login_url: "https://wrnsignal.workforcereadynow.com/signal/jobfit", subject_prefix: "" },
  })
  for (const part of ["Subject", "HtmlBody", "TextBody"] as const) {
    const p = (v.body as any)?.[part]
    console.log(`  ${part}: valid=${p?.ContentIsValid} errors=${JSON.stringify(p?.ValidationErrors ?? [])}`)
  }
  const html: string = (v.body as any)?.HtmlBody?.RenderedContent ?? ""
  console.log(`  signature present in render: ${html.includes("Founder &amp; CEO") || html.includes("Founder & CEO")}`)
  console.log(`  unresolved placeholders: ${[...html.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]).join(", ") || "none"}`)
  console.log(`  em dashes in render: ${(html.match(/—/g) || []).length}`)

  if (!process.argv.includes("--test")) {
    console.log("\nPushed. Re-run with --test to send one to " + TEST_TO)
    return
  }

  const send = await pm("POST", "/email/withTemplate", {
    From: process.env.POSTMARK_FROM_EMAIL ?? "peri@workforcereadynow.com",
    To: TEST_TO,
    TemplateAlias: TEMPLATE_ALIAS,
    MessageStream: process.env.POSTMARK_STREAM_CLIENT ?? "signal-client",
    TemplateModel: {
      first_name: "Lily",
      login_url: "https://wrnsignal.workforcereadynow.com/signal/jobfit",
      subject_prefix: "[TEST RENDER] ",
    },
  })
  console.log(`\ntest send -> ${send.status} ${JSON.stringify((send.body as any)?.MessageID ?? send.body)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
