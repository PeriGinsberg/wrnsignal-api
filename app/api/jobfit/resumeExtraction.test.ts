#!/usr/bin/env tsx
// Anti-hallucination floor test (LLM résumé extractor, step 1). Adversarial:
// fabricated facts with bad spans MUST be dropped; real spans (even reformatted)
// MUST survive. Run: npx tsx app/api/jobfit/resumeExtraction.test.ts

import {
  spanPresent, spanContainsValue, normalizeForGrounding, verifyGrounding,
  type RawResumeExtraction,
} from "./resumeExtraction"

let pass = 0, fail = 0
const ok = (name: string, cond: boolean) => { cond ? pass++ : fail++; console.log(`${cond ? "✓" : "✗"} ${name}`) }

const RESUME = [
  "**Senior Data Engineer — Acme (2020–Present)**",
  "- Built dbt models and owned the warehouse",
  "- Partnered with the analytics team on reporting",
  "### SKILLS",
  "Snowflake, Python, dbt",
  "### EDUCATION",
  "Self-taught. No degree.",
].join("\n")
const RN = normalizeForGrounding(RESUME)

// ── primitives ────────────────────────────────────────────────────────────────
console.log("span primitives")
ok("verbatim span present", spanPresent("Built dbt models and owned the warehouse", RN))
ok("case-insensitive present", spanPresent("BUILT DBT MODELS", RN))
ok("en-dash → hyphen normalized present", spanPresent("2020-Present", RN)) // résumé has en-dash
ok("markdown-bold stripped present", spanPresent("Senior Data Engineer", RN))
ok("FABRICATED span absent → not present", !spanPresent("Built pytorch models in production", RN))
ok("empty span → not present", !spanPresent("", RN))
ok("value in span", spanContainsValue("Built dbt models", "dbt"))
ok("value NOT in span (hallucinated tool grounded on unrelated real span)", !spanContainsValue("Built dbt models", "pytorch"))

// ── verifier on a mixed fabricated extraction ────────────────────────────────
const raw: RawResumeExtraction = {
  roles: [
    { // GOOD role, one good bullet + one bullet carrying a hallucinated tool
      title: "Senior Data Engineer", company: "Acme", startYear: 2020, endYear: null, domains: ["b2b_saas"],
      grounding_span: "Senior Data Engineer — Acme (2020–Present)",
      bullets: [
        { text: "Built dbt models and owned the warehouse", leadingVerb: "built", verbClass: "ownership", objectPhrase: "dbt models and the warehouse", objectHeadNoun: "warehouse", scope: "function",
          tools: ["dbt", "pytorch"], metrics: [], grounding_span: "Built dbt models and owned the warehouse" }, // pytorch is hallucinated → must drop
        { text: "Fabricated bullet never written", leadingVerb: "led", verbClass: "ownership", objectPhrase: "x", objectHeadNoun: "x", scope: "function",
          tools: [], metrics: [], grounding_span: "Led a 40-person org and owned an 8-figure budget" }, // span not in résumé → drop bullet
      ],
    },
    { // FABRICATED role — span not in résumé → whole role dropped
      title: "VP Engineering", company: "Ghost Corp", startYear: 2015, endYear: 2020, domains: ["b2b_saas"],
      grounding_span: "VP Engineering — Ghost Corp (2015–2020)", bullets: [],
    },
  ],
  skills: [
    { name: "snowflake", location: "skills-only", grounding_span: "Snowflake, Python, dbt" }, // good
    { name: "tensorflow", location: "skills-only", grounding_span: "Snowflake, Python, dbt" }, // span real but doesn't name tensorflow → drop
  ],
  credentials: {
    degree: { value: true, grounding_span: "BS Computer Science, MIT" }, // hallucinated degree, span not in résumé → drop → unknown
    clearancesHeld: [{ id: "ts_sci", grounding_span: "Active TS/SCI clearance" }], // span not in résumé → drop
    licensesHeld: [],
  },
  managementBullets: [{ grounding_span: "Managed a team of 12 engineers", peopleNoun: "team" }], // not in résumé → drop
}

const { verified, dropped } = verifyGrounding(raw, RESUME)
console.log("\nverifier — dropped:")
for (const d of dropped) console.log("   ✗ " + d)

console.log("\nverifier assertions")
ok("fabricated role (Ghost Corp) dropped", verified.roles.length === 1)
ok("fabricated bullet dropped, good bullet kept", verified.roles[0].bullets.length === 1)
ok("hallucinated tool 'pytorch' stripped from good bullet", JSON.stringify(verified.roles[0].bullets[0].tools) === JSON.stringify(["dbt"]))
ok("real skill 'snowflake' kept", verified.skills.some((s) => s.name === "snowflake"))
ok("hallucinated skill 'tensorflow' dropped (span doesn't name it)", !verified.skills.some((s) => s.name === "tensorflow"))
ok("hallucinated degree=true dropped → undefined (fires safe)", verified.credentials.degree === undefined)
ok("hallucinated clearance dropped", verified.credentials.clearancesHeld.length === 0)
ok("hallucinated management bullet dropped", verified.managementBullets.length === 0)
ok("nothing ungrounded survived (dropped count >= 6)", dropped.length >= 6)

console.log(`\n${pass}/${pass + fail} floor assertions passed`)
process.exit(fail > 0 ? 1 : 0)
