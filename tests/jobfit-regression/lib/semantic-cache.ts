// Shared loader for the frozen semantic-relevance verdict cache. Local-only
// (see tests/jobfit-regression/.gitignore). Returns {} if absent so a fresh
// checkout fails open (no suppression) rather than erroring.

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { VerdictCache } from "../../../app/api/jobfit/semanticRelevance"

const CACHE_PATH = join(process.cwd(), "tests/jobfit-regression/semantic-verdicts.local.json")

export function loadFrozenVerdicts(): VerdictCache {
  if (!existsSync(CACHE_PATH)) return {}
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as VerdictCache
  } catch {
    return {}
  }
}

// The semantic option for runJobFit in test suites: frozen cache, no live calls
// → deterministic, CI never hits the API.
export function frozenSemanticOption() {
  return { cache: loadFrozenVerdicts(), allowLive: false as const }
}
