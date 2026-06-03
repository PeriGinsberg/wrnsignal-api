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
