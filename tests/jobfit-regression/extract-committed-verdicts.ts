#!/usr/bin/env tsx
// tests/jobfit-regression/extract-committed-verdicts.ts
//
// Generates semantic-verdicts.committed.json — the subset of the frozen
// semantic-relevance cache that the COMMITTED case sources actually consult.
//
// WHY THIS EXISTS: the full freeze (semantic-verdicts.local.json) is gitignored
// because it also covers the local-only prod batch CSV (real candidate PII).
// But the synthetic CSV and the inline retest cases ARE committed, and without
// their verdicts the semantic layer fails open to KEEP on every lookup — ~19 of
// the 41 synthetic cases then drift against baseline.json. CI would either fail
// permanently or have to ignore real HARD diffs. Committing just the verdicts
// reachable from committed inputs fixes that without publishing any PII.
//
// HOW: frozenSemanticOption() wraps the cache in a get-trap Proxy when
// JOBFIT_VERDICT_TRACE=1, so replaying collectLiveSnapshots() records exactly
// the keys those cases look up. We keep the ones that resolve to a real verdict.
//
// The batch CSV is temporarily ignored during the replay (see BATCH_HIDDEN) so
// a dev machine that HAS it does not leak PII-derived verdicts into the
// committed file. Run it from a machine with the local freeze present:
//
//   npx tsx tests/jobfit-regression/extract-committed-verdicts.ts
//
// Re-run whenever the synthetic CSV, the retest cases, or the freeze changes,
// and commit the result alongside baseline.json.

process.env.JOBFIT_VERDICT_TRACE = "1"

import { writeFileSync, existsSync, renameSync } from "node:fs"
import { join } from "node:path"
import { loadFrozenVerdicts, tracedKeys } from "./lib/semantic-cache"
import type { VerdictCache } from "../../app/api/jobfit/semanticRelevance"

const OUT_PATH = join(__dirname, "semantic-verdicts.committed.json")
const BATCH_CSV = join(__dirname, "..", "..", "issues", "040926ProdIssues.csv")
const BATCH_HIDDEN = BATCH_CSV + ".extract-hidden"

async function main() {
  const full = loadFrozenVerdicts()
  if (Object.keys(full).length === 0) {
    console.error(
      "\n✗ No frozen verdicts found. This script must run on a machine that has\n" +
        "  tests/jobfit-regression/semantic-verdicts.local.json (regenerate it with\n" +
        "  freeze-semantic-verdicts.ts — that one DOES call the Anthropic API)."
    )
    process.exit(2)
  }

  // Hide the PII batch CSV for the duration of the replay so only committed
  // sources contribute keys. Restored in `finally`, including on crash.
  const hadBatch = existsSync(BATCH_CSV)
  if (hadBatch) renameSync(BATCH_CSV, BATCH_HIDDEN)
  try {
    console.log("Replaying committed case sources (synthetic CSV + retests)…")
    const { collectLiveSnapshots } = await import("./regression-check")
    const snaps = await collectLiveSnapshots()
    console.log(`  replayed ${Object.keys(snaps).length} case(s)`)
  } finally {
    if (hadBatch) renameSync(BATCH_HIDDEN, BATCH_CSV)
  }

  // tracedKeys() includes misses (a bare `cache[key]` read traps either way);
  // keep only the ones that resolve to a real verdict.
  const hit = tracedKeys().filter((k) => full[k])
  const out: VerdictCache = {}
  for (const k of hit.sort()) out[k] = full[k]

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8")
  console.log(
    `\n✓ Wrote ${hit.length} verdict(s) to semantic-verdicts.committed.json` +
      `  (of ${Object.keys(full).length} in the full freeze; ` +
      `${tracedKeys().length - hit.length} traced key(s) were cache misses)`
  )
  console.log("  Commit it alongside baseline.json.")
}

main().catch((e) => {
  console.error("Fatal error in extract-committed-verdicts:", e)
  process.exit(2)
})
