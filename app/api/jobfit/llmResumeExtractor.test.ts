#!/usr/bin/env tsx
// LLM résumé extractor (step 2) — denylist vetoes + fail-open identity to regex.
// (Live LLM-vs-regex diff on the 8 résumés is step 3's freeze.) Run:
//   npx tsx app/api/jobfit/llmResumeExtractor.test.ts

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { applyDenylists, resolveResumeEvidence } from "./llmResumeExtractor"
import { extractProfileEvidence } from "./profileEvidence"
import { extractVerbEvidence } from "./verbEvidence"
import type { RawResumeExtraction } from "./resumeExtraction"

const DIR = join(__dirname, "..", "..", "..", "Regression Testing July 2026", "cases")
const resumeOf = (n: string) =>
  readFileSync(join(DIR, `case-${n}.input.md`), "utf8").split(/##\s*JOB\s+POSTING/i)[0].split(/##\s*RESUME/i)[1] || ""

let pass = 0, fail = 0
const ok = (name: string, cond: boolean) => { cond ? pass++ : fail++; console.log(`${cond ? "✓" : "✗"} ${name}`) }

// ── denylists: LLM proposes ownership/function, deterministic override wins ───
const raw: RawResumeExtraction = {
  roles: [{
    title: "Analyst", company: "X", startYear: 2020, endYear: null, domains: ["b2b_saas"], grounding_span: "Analyst",
    bullets: [
      // LLM (wrongly) labels a contribution verb as ownership → must become contribution
      { text: "Partnered with the agency to build the measurement function", leadingVerb: "partnered", verbClass: "ownership", objectPhrase: "the measurement function", objectHeadNoun: "function", scope: "function", tools: [], metrics: [], grounding_span: "Partnered" },
      // LLM (wrongly) labels a task object as function scope → must become task
      { text: "Built recurring reporting", leadingVerb: "built", verbClass: "ownership", objectPhrase: "recurring reporting", objectHeadNoun: "reporting", scope: "function", tools: [], metrics: [], grounding_span: "Built" },
      // legit ownership on a function object — untouched
      { text: "Built the data warehouse", leadingVerb: "built", verbClass: "ownership", objectPhrase: "the data warehouse", objectHeadNoun: "warehouse", scope: "function", tools: [], metrics: [], grounding_span: "Built" },
    ],
  }],
  skills: [], credentials: { clearancesHeld: [], licensesHeld: [] }, managementBullets: [],
}
const { raw: deny, overrides } = applyDenylists(raw)
const b = deny.roles[0].bullets
console.log("denylist overrides:", JSON.stringify(overrides, null, 0))
ok("'partnered' ownership → contribution (denylist)", b[0].verbClass === "contribution")
ok("'built reporting' function → task (denylist)", b[1].scope === "task")
ok("legit 'built the data warehouse' stays ownership+function", b[2].verbClass === "ownership" && b[2].scope === "function")

// ── fail-open: LLM disabled/miss → regex path, byte-identical to today ────────
async function main() {
  for (const n of ["01", "07", "08"]) {
    const resume = resumeOf(n)
    // allowLive:false + empty cache → cache miss, live disabled → regex fallback
    const r = await resolveResumeEvidence(resume, { llm: { cache: {}, allowLive: false } })
    ok(`${n}: fail-open source=regex`, r.source === "regex")
    ok(`${n}: fail-open ProfileEvidence == regex`, JSON.stringify(r.profileEvidence) === JSON.stringify(extractProfileEvidence(resume)))
    ok(`${n}: fail-open VerbBullet[] == regex`, JSON.stringify(r.verbBullets) === JSON.stringify(extractVerbEvidence(resume)))
  }
  // no llm opts at all → regex
  const none = await resolveResumeEvidence(resumeOf("07"))
  ok("no-llm-opts → source=regex", none.source === "regex")

  console.log(`\n${pass}/${pass + fail} step-2 assertions passed`)
  process.exit(fail > 0 ? 1 : 0)
}
main()
