// tests/email/check-plan-ready-template.ts
//
// Read-only. Fetches the live Postmark networking-plan-ready template and
// checks every sentence against source (sync-email-layout.ts) is whole, so a
// cut-off line in Postmark shows up here. Changes nothing.
//
//   POSTMARK_API_KEY=... npx tsx tests/email/check-plan-ready-template.ts
//
// Credentials come from process.env; this file never reads a .env file.

const TOKEN = process.env.POSTMARK_API_KEY
if (!TOKEN) throw new Error("Set POSTMARK_API_KEY")

const MUST_HAVE = [
  "Find it in your Coaching Hub under Shared documents. It has your email and LinkedIn messages, when to send each one, and a weekly checklist.",
  "SIGNAL will show you when each follow-up is due, so you never have to track dates yourself.",
  "Bring your questions to our next session. I'm looking forward to seeing who you connect with.",
]
const BROKEN = ["Shared docu LinkedIn", "never have to t<", "never have to t\n"]

async function main() {
  const res = await fetch("https://api.postmarkapp.com/templates/networking-plan-ready", {
    headers: { "X-Postmark-Server-Token": TOKEN!, Accept: "application/json" },
  })
  const t: any = await res.json()
  if (res.status !== 200) { console.error(res.status, JSON.stringify(t)); process.exit(1) }

  console.log(`Subject: ${t.Subject}`)
  console.log(`Layout:  ${t.LayoutTemplate ?? "(none)"}\n`)
  // Collapse whitespace so line wrapping in the HTML doesn't count as a cut.
  const flat = (s: string | null) => (s ?? "").replace(/\s+/g, " ")
  let bad = 0
  for (const part of ["HtmlBody", "TextBody"] as const) {
    const body = flat(t[part])
    for (const s of MUST_HAVE) {
      const has = body.includes(s)
      if (!has) bad++
      console.log(`  ${has ? "ok  " : "MISSING"} ${part}: ${s.slice(0, 60)}...`)
    }
    for (const b of BROKEN) {
      if ((t[part] ?? "").includes(b)) { bad++; console.log(`  CUT-OFF ${part}: found "${b.trim()}"`) }
    }
  }
  console.log(bad ? `\n${bad} problem(s). Fix: POSTMARK_API_KEY=... npx tsx tests/email/sync-email-layout.ts` : "\nTemplate is whole.")
  if (bad) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
