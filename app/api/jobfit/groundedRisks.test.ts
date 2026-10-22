#!/usr/bin/env tsx
// Risk bullets come only from the engine's risk codes, one per code. Prod run
// 378022a7 (FOX internship) had one code, "could not read clear requirements",
// and the writer returned two risks of its own: no media experience, and no
// SQL or cloud tools "FOX's BI team likely uses". The posting asks for neither.
// Run: npx tsx app/api/jobfit/groundedRisks.test.ts
//
// Synthetic text only; the model call is mocked.

import { generateBulletsV5, groundRiskBullets, writerRisks } from "./bulletGeneratorV5"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const bullet = (risk_id: string | undefined, gap: string) => ({
  risk_id, keyword: "A GAP", gap, adjacent_evidence: "", severity: "medium",
})

console.log("groundRiskBullets")
{
  const kept = groundRiskBullets([
    bullet("R1", "The posting lists Figma as required and your profile shows none."),
    bullet("R1", "A second take on the same code."),
    bullet("R9", "A risk the engine never raised."),
    bullet(undefined, "No media or broadcasting experience."),
    bullet("R2", "You lack SQL that the BI team likely uses."),
    { risk_id: "R2", keyword: "", gap: "missing keyword", adjacent_evidence: "", severity: "low" },
  ], ["R1", "R2"])
  ok("keeps one bullet for R1", kept.length === 1 && kept[0].gap.startsWith("The posting lists Figma"), JSON.stringify(kept))
  ok("the kept bullet has no risk_id field", !("risk_id" in (kept[0] as any)))
}

console.log("\nquoted risks")
{
  const jd = `Requirements:
- Strong sports betting knowledge and/or work background
- Experience with a content management system
- Familiarity with Sprout Social or Asana is a plus, but not required
- Availability for evening and weekend shifts`
  const q = (quote: string, gap: string) => ({ jd_quote: quote, keyword: "A GAP", gap, adjacent_evidence: "", severity: "medium" })
  const kept = groundRiskBullets([
    q("Strong sports betting knowledge", "The role asks for sports betting knowledge you do not show."),
    q("Familiarity with Sprout Social or Asana", "The role requires Sprout Social."),
    q("Experience with SQL and cloud platforms", "You lack SQL."),
    q("Experience with a content management system", "The role asks for CMS experience you do not show."),
    q("Availability for evening and weekend shifts", "A third quoted risk."),
  ], [], jd)
  ok("a verbatim required line is kept", kept.some((b) => /sports betting/.test(b.gap)), JSON.stringify(kept))
  ok("a line marked 'a plus, but not required' is dropped", !kept.some((b) => /Sprout/.test(b.gap)))
  ok("a quote not in the posting is dropped", !kept.some((b) => /SQL/.test(b.gap)))
  ok("no more than two quoted risks", kept.length === 2, String(kept.length))
}
{
  const jd = `Responsibilities:
- Track earned media and build coverage reports
Successful students have:
- Knowledge of current programming and talent
Requirements:
- Currently enrolled in a bachelor's program`
  const q = (quote: string) => ({ jd_quote: quote, keyword: "A GAP", gap: "A gap.", adjacent_evidence: "", severity: "medium" })
  const kept = groundRiskBullets([q("Track earned media and build coverage reports"), q("Knowledge of current programming and talent")], [], jd)
  ok("a duty or a 'successful students have' line is not quotable", kept.length === 0, JSON.stringify(kept))
}

console.log("\nlocation and citizenship are heads-ups")
{
  const jd = `This internship is based in Mountain View, CA.
Requirements:
- Must be a U.S. citizen
- Experience with Excel`
  const q = (quote: string, gap: string, severity = "high") => ({ jd_quote: quote, keyword: "A GAP", gap, adjacent_evidence: "", severity })
  const kept = groundRiskBullets([
    q("Mountain View, CA", "This internship is in Mountain View, CA, and you target Miami, so plan for relocation."),
    q("Must be a U.S. citizen", "The posting requires U.S. citizenship; confirm you meet it."),
  ], [], jd)
  ok("a location heads-up quoting the posting is kept", kept.length >= 1 && /Mountain View/.test(kept[0].gap), JSON.stringify(kept))
  ok("it is always low severity", kept[0]?.severity === "low")
  ok("one location / citizenship heads-up per run", kept.length === 1, String(kept.length))
  const sales = groundRiskBullets([{ risk_id: "R1", keyword: "A GAP", gap: "Your background is B2B sponsorship sales, not consumer research.", adjacent_evidence: "", severity: "medium" }], ["R1"], jd)
  ok("'sponsorship sales' is not a work-authorization point", sales[0]?.severity === "medium", JSON.stringify(sales))
}

console.log("\nwriterRisks")
{
  const out: any = {
    risk_codes: [
      { code: "RISK_LIMITED_MATCH_EVIDENCE", job_fact: "SIGNAL could not read clear requirements from this posting." },
      { code: "RISK_MISSING_TOOLS", job_fact: "Posting lists figma as required." },
    ],
  }
  const w = writerRisks(out)
  ok("limited-match is not sent to the writer", w.length === 1 && w[0].code === "RISK_MISSING_TOOLS", JSON.stringify(w))
  ok("risks are numbered from R1", w[0].risk_id === "R1")
}
{
  const out: any = {
    risk_codes: [
      { code: "RISK_MISSING_TOOLS", job_fact: "Posting lists salesforce as required." },
      { code: "RISK_FAMILY_MISMATCH", job_fact: "This role is in the Sales field." },
      { code: "RISK_MISSING_PROOF", job_fact: "salesforce tool usage" },
      { code: "RISK_MISSING_PROOF", job_fact: "figma tool usage" },
    ],
  }
  const w = writerRisks(out).map((r) => String(r.job_fact))
  ok("a missing tool raised twice reaches the writer once", w.length === 3 && !w.includes("salesforce tool usage") && w.includes("figma tool usage"), JSON.stringify(w))
}

console.log("\ngenerateBulletsV5 with a mocked model")
async function run(riskCodes: any[], modelRiskBullets: any[]) {
  const reply = {
    why_bullets: [{ keyword: "DATA WORK", lead: "You built 12 dashboards.", connection: "The role builds reports.", action: "Lead with one dashboard." }],
    risk_bullets: modelRiskBullets,
    cover_letter_strategy: { open_with: "x", lead_signal: "x", address_gap: null, tone: "x" },
    positioning_strategy: { lead_section: "x", reframe: "x" },
    networking_strategy: { target_contacts: "x", outreach_angle: "x" },
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(reply) }], usage: {} }), { status: 200 })) as any
  try {
    return await generateBulletsV5({ decision: "Review", score: 60, why_codes: [], risk_codes: riskCodes, job_text: "Requirements:\n- Knowledge of current events" } as any)
  } finally {
    globalThis.fetch = realFetch
  }
}

async function main() {
  {
    const v5 = await run(
      [{ code: "RISK_LIMITED_MATCH_EVIDENCE", job_fact: "SIGNAL could not read clear requirements from this posting." }],
      [bullet("R1", "You have no media experience."), bullet("R2", "You lack SQL.")],
    )
    ok("only limited-match: no risk bullets at all", v5.risk_structured.length === 0 && v5.risk.length === 0, JSON.stringify(v5.risk))
  }
  {
    const v5 = await run(
      [{ code: "RISK_MISSING_TOOLS", job_fact: "Posting lists figma as required." }],
      [bullet("R1", "The posting lists Figma as required and you show none."), bullet(undefined, "No NYC creator network.")],
    )
    ok("one code: one bullet, the invented one dropped", v5.risk_structured.length === 1 && /Figma/.test(v5.risk[0]), JSON.stringify(v5.risk))
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}
main()
