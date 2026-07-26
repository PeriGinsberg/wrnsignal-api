#!/usr/bin/env tsx
// Thin Python<->engine adapter for the golden-set harness. NOT scoring logic.
//
// stdin : one JSON object { profileText, jobText, userJobTitle?, userCompanyName? }
// stdout: one line  __SIGNAL_JSON__<json>  carrying the raw engine fields that
//         validate.py maps onto the harness shape. A sentinel prefix is used so
//         the engine's own console.log noise on stdout can't corrupt the parse.
//
// Determinism: no `semantic` option is passed, so the gated LLM evidence-
// relevance suppression is OFF — the run is fully deterministic, offline, and
// needs no API key. This matches the golden set's "cold, deterministic" intent.
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { runJobFit } from "../app/api/_lib/jobfitEvaluator"

// Frozen résumé-evidence fixture → deterministic LLM extraction (allowLive:false).
// On a cache miss (or absent fixture) resolveResumeEvidence fails open to regex.
const FIXTURE = join(__dirname, "resume-evidence.frozen.json")
const frozenCache = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : {}

async function main() {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  const inp = JSON.parse(Buffer.concat(chunks).toString("utf8"))

  const r: any = await runJobFit({
    profileText: inp.profileText || "",
    jobText: inp.jobText || "",
    userJobTitle: inp.userJobTitle || undefined,
    userCompanyName: inp.userCompanyName || undefined,
    // no `semantic`, no `profileOverrides` — the engine sees only the cold input.
    applyGateLedger: true, // defect #1 gate ledger (golden harness enables it)
    applyVerbMismatchRisk: true, // defect #2 ownership-verb mismatch risk
    applyRiskDetectors: true, // defect #3 risk under-detection detectors
    resumeExtractor: { cache: frozenCache, allowLive: false }, // frozen LLM extractor
  })

  const payload = {
    decision: r.decision,
    next_step: r.next_step,
    bullets: r.bullets,
    risk_flags: r.risk_flags,
    why_codes: r.why_codes,
    risk_codes: r.risk_codes,
    gate_triggered: r.gate_triggered,
    gate_ledger: r.gate_ledger || [],
  }
  process.stdout.write("\n__SIGNAL_JSON__" + JSON.stringify(payload) + "\n")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
