#!/usr/bin/env tsx
// Freeze the golden résumés' LLM extraction into a committed fixture, so the
// harness replays identical evidence (allowLive:false) — the determinism
// mechanism (mirror of the semantic freeze). Run LIVE once with the key:
//   ANTHROPIC_API_KEY=... NODE_OPTIONS=--use-system-ca \
//     npx tsx "Regression Testing July 2026/freeze-resume-evidence.ts"

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { resolveResumeEvidence, type ResumeExtractCache } from "../app/api/jobfit/llmResumeExtractor"

const DIR = join(__dirname, "cases")
const FIXTURE = join(__dirname, "resume-evidence.frozen.json")

// Replicate score_resume._split_input so the cache key matches what the bridge
// sends (profileText = "Resume:\n" + body).
function profileTextOf(n: string): string {
  const md = readFileSync(join(DIR, `case-${n}.input.md`), "utf8")
  const resumePart = md.split(/^\s*##\s*JOB\s+POSTING\s*$/im)[0]
  const m = resumePart.match(/^\s*##\s*RESUME\s*$/im)
  let body = m ? resumePart.slice((m.index || 0) + m[0].length) : resumePart
  body = body.replace(/\n-{3,}\s*$/, "\n").trim()
  return "Resume:\n" + body
}

;(async () => {
  const cache: ResumeExtractCache = {}
  for (const n of ["01", "02", "03", "04", "05", "06", "07", "08", "09"]) {
    const r = await resolveResumeEvidence(profileTextOf(n), { llm: { cache, allowLive: true } })
    console.log(`case ${n}: source=${r.source}`)
    if (r.source !== "llm") console.log(`  ⚠ case ${n} did NOT use the LLM (check key / API)`)
  }
  writeFileSync(FIXTURE, JSON.stringify(cache, null, 2) + "\n", "utf8")
  console.log(`\nWrote ${Object.keys(cache).length} entries to ${FIXTURE}`)
})().catch((e) => {
  console.error("freeze failed:", e?.message || String(e))
  process.exit(1)
})
