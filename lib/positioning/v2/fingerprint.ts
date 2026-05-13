// lib/positioning/v2/fingerprint.ts
//
// Deterministic fingerprint computation for positioning_runs_v2 cache
// identity. Pure function — no I/O, no clock, no randomness.
//
// FRD: docs/Features/positioning-phase1-frd.md (section 4.7 cache invalidation)
// Types: lib/positioning/v2/types.ts (FingerprintInputs, FingerprintResult)
// Spec ref: Stage 1a F5 decision (recorded in FingerprintInputs JSDoc)
//
// What the fingerprint covers (cache invalidation triggers):
//   - profileId         change → new fingerprint (different user)
//   - personaId         change → new fingerprint (different resume version)
//   - JD content        change → new fingerprint (different job)
//   - targeting state   change → new fingerprint (lane / sublane / status flags)
//   - careerStage       change → new fingerprint (user circumstances drifted)
//
// What the fingerprint does NOT cover:
//   - jobfit_run_id — the cache lookup uses (profile_id, persona_id,
//     jobfit_run_id) as the primary key BEFORE comparing fingerprint. A new
//     JobFit run produces a different jobfit_run_id, so it cannot hit the
//     fingerprint check at all. Fingerprint only differentiates within the
//     same jobfit_run_id (where targeting / careerStage might have shifted).
//   - jobfit verdict / score / risks — these are inputs to case determination
//     but not to identity. A re-run of JobFit IS the cache-invalidation signal,
//     mediated through the new jobfit_run_id (above).
//
// Normalization rules:
//   - JD components (title, company, description) are independently
//     trim()+toLowerCase()'d before joining. Internal whitespace and
//     punctuation are preserved — collapsing them could mask legitimate
//     content changes.
//   - Canonical JSON: keys sorted alphabetically at every level,
//     no insignificant whitespace, then lowercased before hashing.
//   - Null targeting is encoded as { _absent: true, career_stage } —
//     distinguishable from any real targeting row (primary_lane is NOT NULL
//     in schema, so a real row always has primary_lane; "_absent" sentinel
//     key cannot collide with column names).

import { createHash } from "node:crypto"
import type {
  FingerprintInputs,
  FingerprintResult,
  FingerprintTargetingState,
} from "./types"
import type { CareerStage } from "@/lib/laneTaxonomy"

// ============================================================================
// Internal: canonical JSON
// ============================================================================

/**
 * Serialize a JSON-compatible value with deterministic output:
 *   - Object keys sorted alphabetically at every level
 *   - No insignificant whitespace
 *   - Strings JSON-quoted (handles escaping)
 *
 * Not exported — internal to the fingerprint computation. Equivalent
 * output to RFC 8785 (JCS) for the subset of values we care about
 * (objects, strings, booleans, nulls; no numbers needing canonical
 * representation for our use case).
 */
function canonicalJSON(value: unknown): string {
  if (value === null || value === undefined) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]"
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k]))
        .join(",") +
      "}"
    )
  }
  // Unsupported (function, symbol, bigint) — treat as null for safety.
  return "null"
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

// ============================================================================
// Component hashes
// ============================================================================

/**
 * Hash the job-description triple. Each component is independently
 * trimmed and lowercased; internal whitespace is preserved.
 */
function computeJdHash(
  jobTitle: string,
  jobCompany: string,
  jobDescription: string,
): string {
  const normalized = [jobTitle, jobCompany, jobDescription]
    .map((s) => (typeof s === "string" ? s : "").trim().toLowerCase())
    .join("|")
  return sha256Hex(normalized)
}

/**
 * Build the targeting payload for hashing. Null targeting produces a
 * sentinel shape that's distinguishable from any real targeting row
 * (primary_lane is NOT NULL at the schema level; "_absent" key cannot
 * collide with column names).
 *
 * careerStage is always included — it's part of cache identity regardless
 * of whether candidate_targeting has a row, because resolveCareerStage
 * has a derive-from-profile fallback path that's independent of the
 * candidate_targeting row's existence.
 */
function buildTargetingPayload(
  targeting: FingerprintTargetingState | null,
  careerStage: CareerStage,
): Record<string, unknown> {
  if (targeting === null) {
    return { _absent: true, career_stage: careerStage }
  }
  return {
    primary_lane: targeting.primary_lane,
    primary_sublane: targeting.primary_sublane,
    career_stage: careerStage,
    status_premed: targeting.status_premed,
    status_prelaw: targeting.status_prelaw,
    status_pregrad: targeting.status_pregrad,
  }
}

function computeTargetingStateHash(
  targeting: FingerprintTargetingState | null,
  careerStage: CareerStage,
): string {
  const payload = buildTargetingPayload(targeting, careerStage)
  return sha256Hex(canonicalJSON(payload).toLowerCase())
}

// ============================================================================
// Outer fingerprint
// ============================================================================

const SHORT_LEN = 8

function shortHex(s: string): string {
  return s.toLowerCase().slice(0, SHORT_LEN)
}

/**
 * Compute the deterministic fingerprint for a positioning_runs_v2 row.
 *
 * Returns:
 *   - hash: sha256 hex (64 chars) — stored in fingerprint_hash column
 *   - code: human-readable identifier — stored in fingerprint_code column,
 *           used for log grepping and debugging
 *
 * Determinism guarantees:
 *   - Input key order does NOT affect output (canonical JSON sorts keys)
 *   - Case and leading/trailing whitespace in JD fields normalized
 *   - Same inputs ALWAYS produce identical hash and code
 *
 * Cross-references Foundation DD-23 indirectly: this function trusts its
 * inputs to be well-formed (TypeScript types enforce shape). Upstream
 * callers (route.ts) are responsible for validating that profileId,
 * personaId, and JD fields are non-empty before calling.
 */
export function computeFingerprint(
  inputs: FingerprintInputs,
): FingerprintResult {
  const jdHash = computeJdHash(
    inputs.jobTitle,
    inputs.jobCompany,
    inputs.jobDescription,
  )
  const targetingStateHash = computeTargetingStateHash(
    inputs.targeting,
    inputs.careerStage,
  )

  const seed = {
    profileId: inputs.profileId,
    personaId: inputs.personaId,
    jdHash,
    targetingStateHash,
  }
  const hash = sha256Hex(canonicalJSON(seed).toLowerCase())

  const code =
    `p:${shortHex(inputs.profileId)}` +
    `|pn:${shortHex(inputs.personaId)}` +
    `|jd:${shortHex(jdHash)}` +
    `|t:${shortHex(targetingStateHash)}`

  return { hash, code }
}
