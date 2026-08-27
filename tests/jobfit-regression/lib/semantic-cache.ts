// Shared loader for the frozen semantic-relevance verdict cache.
//
// TWO layers, unioned:
//
//   semantic-verdicts.committed.json  — TRACKED. The subset of verdicts reached
//     by the COMMITTED case sources (fixtures/synthetic-cases-4102026.csv + the
//     inline retest-*.ts cases). Safe to commit: every input it derives from is
//     already in the repo. This is what makes CI deterministic — without it the
//     semantic layer fails open to KEEP on every lookup and ~19 synthetic cases
//     drift against baseline.json. Regenerate with:
//       npx tsx tests/jobfit-regression/extract-committed-verdicts.ts
//
//   semantic-verdicts.local.json      — LOCAL-ONLY / gitignored. The full 130-
//     verdict cache, including verdicts derived from the local-only prod batch
//     CSV (real candidate PII). Present on a dev machine, absent in CI.
//
// Local wins on key collision (it is the freshest freeze). Both absent => {},
// so a fresh checkout fails open (no suppression) rather than erroring.

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { VerdictCache } from "../../../app/api/jobfit/semanticRelevance"

const COMMITTED_PATH = join(process.cwd(), "tests/jobfit-regression/semantic-verdicts.committed.json")
const LOCAL_PATH = join(process.cwd(), "tests/jobfit-regression/semantic-verdicts.local.json")

function readCache(path: string): VerdictCache {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8")) as VerdictCache
  } catch {
    return {}
  }
}

export function verdictSourceStatus(): { committed: number; local: number } {
  return {
    committed: Object.keys(readCache(COMMITTED_PATH)).length,
    local: Object.keys(readCache(LOCAL_PATH)).length,
  }
}

export function loadFrozenVerdicts(): VerdictCache {
  return { ...readCache(COMMITTED_PATH), ...readCache(LOCAL_PATH) }
}

// ── Key tracing (opt-in, for extract-committed-verdicts.ts only) ──────────────
// getVerdict does a bare `cache[key]` read, so a get-trap Proxy records exactly
// the keys a run actually consults. Off unless JOBFIT_VERDICT_TRACE=1, so the
// normal test path hands runJobFit a plain object.
const TRACED_KEYS = new Set<string>()

export function tracedKeys(): string[] {
  return [...TRACED_KEYS].sort()
}

function traceProxy(cache: VerdictCache): VerdictCache {
  return new Proxy(cache, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && /^[0-9a-f]{64}$/.test(prop)) TRACED_KEYS.add(prop)
      return Reflect.get(target, prop, receiver)
    },
  })
}

// The semantic option for runJobFit in test suites: frozen cache, no live calls
// → deterministic, CI never hits the API.
export function frozenSemanticOption() {
  const cache = loadFrozenVerdicts()
  return {
    cache: process.env.JOBFIT_VERDICT_TRACE === "1" ? traceProxy(cache) : cache,
    allowLive: false as const,
  }
}
