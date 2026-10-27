#!/usr/bin/env tsx
// The email log: private links never saved readable, and who gets the coach's
// blind copy.
// Run: npx tsx tests/email/client-email-log.test.ts

import { makeFakeDb } from "../_lib/fakeSupabase"
import { renderSowEmail } from "../../lib/sow/email"
import { coachBccFor, redactPrivateLinks, redactRow, PRIVATE_SOW_LINK, PRIVATE_SIGN_IN_LINK, PRIVATE_SUPPORTER_LINK } from "../../lib/email/clientEmailLog"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

async function main() {
  console.log("redaction")
  const sow = "https://wrnsignal-api.vercel.app/sow/fhx4bHhhtIMqLf593OzgKjA3vPU4S0xfIkiwRCh-pTI"
  const r = renderSowEmail("Hi Alexandra,\n\nSee it here:\n\n[SOW link]\n\nOr: [SOW link] inline.", sow)
  const html = redactPrivateLinks(r.html, { html: true })
  const text = redactPrivateLinks(r.text)
  ok("SOW token gone from HTML", !html.includes("fhx4bHhh"))
  ok("SOW token gone from text", !text.includes("fhx4bHhh"))
  ok("text shows the label", text.includes(PRIVATE_SOW_LINK))
  ok("HTML button href is #", html.includes('href="#"') && !html.includes(`href="${PRIVATE_SOW_LINK}"`))

  const magic = "https://zydrqckpwidipwbhrfgd.supabase.co/auth/v1/verify?token=abc123&type=magiclink&redirect_to=https://x.app/dashboard"
  const inviteHtml = `<a href="${magic.replace(/&/g, "&amp;")}">Open</a><p>${magic.replace(/&/g, "&amp;")}</p>`
  const ih = redactPrivateLinks(inviteHtml, { html: true })
  ok("magic link gone from HTML (with &amp;)", !ih.includes("token=abc123") && !ih.includes("magiclink"), ih)
  ok("pasted magic link shows the label", ih.includes(`<p>${PRIVATE_SIGN_IN_LINK}</p>`), ih)
  const it = redactPrivateLinks(`Sign in:\n${magic}\n\nThanks`)
  ok("magic link gone from text, rest kept", it === `Sign in:\n${PRIVATE_SIGN_IN_LINK}\n\nThanks`, it)

  const sup = "https://wrnsignal-api.vercel.app/dashboard/supporter/accept?token=Zq3-abc_123"
  const sh = redactPrivateLinks(`<a href="${sup}">Accept</a><p>${sup}</p>`, { html: true })
  ok("supporter invite token gone from HTML", !sh.includes("Zq3-abc_123") && sh.includes(`<p>${PRIVATE_SUPPORTER_LINK}</p>`), sh)
  ok("supporter invite token gone from text", redactPrivateLinks(`Accept:
${sup}`) === `Accept:
${PRIVATE_SUPPORTER_LINK}`)

  const plain = "https://wrnsignal-api.vercel.app/dashboard/practice/round-1 and https://workforcereadynow.com/consult-request"
  ok("ordinary links untouched", redactPrivateLinks(plain) === plain)

  const row = redactRow({
    coach_client_id: "cc", email_type: "sow", from_email: "f", to_email: "t", cc_email: null, bcc_emails: [],
    delivered_to: "t", redirected: false, subject: "s", text_body: r.text, html_body: r.html, triggered_by: null, postmark_message_id: "m",
  })
  ok("redactRow covers both bodies", !String(row.text_body).includes("fhx4") && !String(row.html_body).includes("fhx4"))

  console.log("blind copy")
  const db = makeFakeDb({
    coach_clients: [{ id: "cc-1", coach_profile_id: "peri" }],
    client_profiles: [
      { id: "peri", email: "peri@wrn.com" },
      { id: "erin", email: "erin+coach@wrn.com" },
      { id: "nomail", email: null },
    ],
  }).client as any
  const bcc = (actor: string | null, exclude: string[] = ["client@x.com"]) =>
    coachBccFor(db, { coachClientId: "cc-1", actor, exclude })

  ok("coach sends: just the coach", JSON.stringify(await bcc("peri")) === JSON.stringify(["peri@wrn.com"]))
  ok("delegate sends: delegate and the client's coach",
    JSON.stringify(await bcc("erin")) === JSON.stringify(["erin+coach@wrn.com", "peri@wrn.com"]))
  ok("automatic send: the client's coach", JSON.stringify(await bcc(null)) === JSON.stringify(["peri@wrn.com"]))
  ok("nobody already on To/CC", JSON.stringify(await bcc("erin", ["PERI@wrn.com"])) === JSON.stringify(["erin+coach@wrn.com"]))
  ok("a coach with no email is skipped", JSON.stringify(await bcc("nomail")) === JSON.stringify(["peri@wrn.com"]))
  ok("no relationship, no actor: nobody",
    (await coachBccFor(db, { coachClientId: null, actor: null, exclude: [] })).length === 0)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}
void main()
