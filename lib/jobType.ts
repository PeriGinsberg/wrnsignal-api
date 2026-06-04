// lib/jobType.ts
//
// Canonical job_type vocabulary, shared by every job_type surface (coach
// prospect form, coach Profile & Personas form, D2C dashboard/profile, intake,
// and the API routes). Defined once here so the vocabulary can't drift again
// (it previously diverged into 'Full Time Role' / 'Full Time' / 'Full-time').
// Spec: docs/job-type-overhaul-spec.md §10 step 2.
//
// Plain constants module — no "use client", no server-only imports — so it is
// safe to import from both client components and server routes.
//
// SCOPE: this step DEFINES the constant only. Rewiring each form/route to
// import it, and the validator/normalizer helper, are later per-surface steps.

export const JOB_TYPE_OPTIONS = [
  "Full-time",
  "Part-time",
  "Internship",
  "Contract",
  "Any",
] as const

export type JobType = (typeof JOB_TYPE_OPTIONS)[number]

/**
 * Normalize + validate an incoming job_type value against the canonical
 * vocabulary. Pure. Replaces both the dropped DB CHECK and the old single-value
 * optEnum (job_type overhaul §10 step 3). Multi-aware (comma-joined or array).
 *
 * - Accepts: a single canonical string, a comma-joined string, an array of
 *   either, or null/undefined/empty.
 * - Splits on commas, trims members, drops empties.
 * - Partitions members into valid (∈ JOB_TYPE_OPTIONS, exact match) and invalid.
 * - 'Any' mutual-exclusion: if 'Any' is among the valid members, the result is
 *   exactly 'Any' (all other selections discarded).
 * - De-dupes and emits in canonical JOB_TYPE_OPTIONS order (not input order).
 *
 * Returns { value, invalid }:
 *   - value:   clean canonical comma-joined string, or null when there are no
 *              valid members (empty/null input, or every member invalid).
 *   - invalid: the raw members that were not in the canonical set. Write routes
 *              should 400 when this is non-empty (matches the old optEnum);
 *              lenient/migration callers can ignore it and use `value`.
 */
/**
 * Lenient pre-coercion of legacy/dirty job_type values to canonical, run BEFORE
 * the strict normalizeJobType (job_type overhaul §10 step 6). Pure.
 *
 * Why this exists: prod client_profiles.job_type was never normalized (the
 * Step-1 migration was dev-only), so ~45 rows still hold 9 legacy variants
 * ('Full Time Role', 'Full Time', 'full time', 'internship', 'All', etc.). On a
 * full-form resave the strict normalizeJobType would 400 those values and lock
 * the user out of saving. This maps the known legacy spellings to canonical so
 * they coerce instead of erroring.
 *
 * - Case/space/hyphen-insensitive: members are compared on a compact key
 *   (lowercased, spaces+hyphens removed), so any spelling of "full time" maps.
 * - Multi-aware: coerces each comma-split member independently.
 * - Known non-job-type values mis-filed into job_type ('Recent graduate',
 *   'Current student') are DROPPED.
 * - UNRECOGNIZED members pass through unchanged so the downstream strict
 *   normalizeJobType still rejects genuine garbage (preserves the 400 guard for
 *   real API misuse — that's the whole reason for two layers).
 *
 * Compose as: normalizeJobType(canonicalizeLegacyJobType(input))
 *
 * Returns a comma-joined string of coerced/passed members, or null when nothing
 * remains.
 */
export function canonicalizeLegacyJobType(
  input: string | string[] | null | undefined,
): string | null {
  // compact-key → canonical (null = drop a known non-job-type value).
  const LEGACY_MAP: Record<string, string | null> = {
    fulltime: "Full-time",
    fulltimerole: "Full-time",
    parttime: "Part-time",
    internship: "Internship",
    contract: "Contract",
    any: "Any",
    all: "Any",
    recentgraduate: null,
    currentstudent: null,
  }

  const rawMembers: string[] =
    input == null
      ? []
      : (Array.isArray(input) ? input : [input])
          .flatMap((x) => String(x).split(","))
          .map((s) => s.trim())
          .filter((s) => s.length > 0)

  const out: string[] = []
  for (const m of rawMembers) {
    const key = m.toLowerCase().replace(/[\s-]/g, "")
    if (key in LEGACY_MAP) {
      const mapped = LEGACY_MAP[key]
      if (mapped !== null) out.push(mapped) // null = drop
    } else {
      out.push(m) // unrecognized → pass through to strict validator
    }
  }

  return out.length ? out.join(", ") : null
}

/**
 * Read-side predicate: does this job_type value express interest in full-time
 * work? True when the (canonicalized) value contains 'Full-time' OR 'Any'
 * ('Any' subsumes full-time — job_type overhaul §7). Multi-aware; lenient on
 * legacy/dirty input (coerces before checking) so it's safe on raw stored or
 * incoming values. Empty/null → false.
 */
export function includesFullTimeInterest(
  input: string | string[] | null | undefined,
): boolean {
  const { value } = normalizeJobType(canonicalizeLegacyJobType(input))
  if (!value) return false
  const members = value.split(",").map((s) => s.trim())
  return members.includes("Full-time") || members.includes("Any")
}

export function normalizeJobType(
  input: string | string[] | null | undefined,
): { value: string | null; invalid: string[] } {
  // 1. Coerce to a flat list of trimmed, non-empty raw members.
  const rawMembers: string[] =
    input == null
      ? []
      : (Array.isArray(input) ? input : [input])
          .flatMap((x) => String(x).split(","))
          .map((s) => s.trim())
          .filter((s) => s.length > 0)

  // 2. Partition by canonical membership (exact match).
  const canonical = new Set<string>(JOB_TYPE_OPTIONS)
  const valid = new Set<string>()
  const invalid: string[] = []
  for (const m of rawMembers) {
    if (canonical.has(m)) valid.add(m)
    else invalid.push(m)
  }

  // 3. 'Any' mutual-exclusion — 'Any' subsumes every other selection.
  if (valid.has("Any")) {
    return { value: "Any", invalid }
  }

  // 4. De-dupe + canonical order (filter the source-of-truth array).
  const ordered = JOB_TYPE_OPTIONS.filter((o) => valid.has(o))
  return { value: ordered.length ? ordered.join(", ") : null, invalid }
}
