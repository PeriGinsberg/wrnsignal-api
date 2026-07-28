// lib/network-tracker/client-profile-seed.ts
// Phase 7b — ONE-TIME seed of network_client_profile from what SIGNAL already
// stores. Pure functions: sources in, field values out. No I/O, so the mapping
// rules are testable without a database.
//
// Seeds 10 of the 17 fields. The other 7 start blank because no honest source
// exists (affinity 1/2/3, calendar_link, elevator_pitch, resume_link, degree) or
// because the available source means something else (city — see below).
//
// NEVER A LIVE MIRROR. See the migration header for why; the short version is
// that key_strength comes from a coach's private note and a pitch is worded
// differently from a formal profile.

export type SeedSources = {
  name: string | null                    // client_profiles.name
  university: string | null              // client_profiles.university
  target_roles: string | null            // client_profiles.target_roles
  grad_date: string | null               // client_profiles.grad_date  (YYYY-MM-DD)
  timeline: string | null                // client_profiles.timeline
  coach_notes_strengths: string | null   // client_profiles.coach_notes_strengths
  targetFamilies: string[] | null        // profile_structured.targetFamilies, else inferred
  currentRole: { title: string; company: string } | null // résumé extractor, most recent role
}

/** The fields the seed is allowed to write. Anything outside this list is
 *  user-only and a refresh must never touch it. */
export const SEEDABLE_FIELDS = [
  "client_first", "school", "target_role", "target_field", "grad_year",
  "timeframe", "key_strength", "current_role_title", "current_employer",
] as const
export type SeedableField = (typeof SEEDABLE_FIELDS)[number]

/** Every text field on the row, for the completeness meter. 17 = 16 merge
 *  variables + the elevator pitch. */
export const ALL_FIELDS = [
  "client_first", "current_role_title", "current_employer", "school", "grad_year",
  "degree", "target_field", "target_role", "timeframe", "city",
  "affinity_1", "affinity_2", "affinity_3", "key_strength",
  "resume_link", "calendar_link", "elevator_pitch",
] as const
export type ProfileField = (typeof ALL_FIELDS)[number]

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim()
  return t.length ? t : null
}

/** First token of the full name. A mononym seeds whole; a compound surname keeps
 *  only the first word, which is what a greeting wants anyway. */
export function firstNameFrom(name: string | null): string | null {
  const t = clean(name)
  return t ? (t.split(/\s+/)[0] ?? null) : null
}

/** target_roles is free text and often a list ("In House Council, Private
 *  Practice"). The merge var is singular, so take the first entry — the client
 *  can retype if the wrong one leads. */
export function firstTargetRole(targetRoles: string | null): string | null {
  const t = clean(targetRoles)
  if (!t) return null
  return clean(t.split(/[,;\n/]|(?:\s+\bor\b\s+)/i)[0])
}

/** grad_date is validated YYYY-MM-DD upstream, so the year is the first four
 *  characters — but accept a bare year too rather than trusting that. */
export function gradYearFrom(gradDate: string | null): string | null {
  const t = clean(gradDate)
  if (!t) return null
  const m = t.match(/\b(19|20)\d{2}\b/)
  return m ? m[0] : null
}

/** targetFamilies is a taxonomy list ("Marketing", "Analytics"); the merge var
 *  is one field. Take the first — it is the primary target and the one a pitch
 *  would name. */
export function targetFieldFrom(families: string[] | null): string | null {
  if (!families || families.length === 0) return null
  return clean(families[0])
}

/**
 * The seed values, per field. Returns ONLY fields it has a real value for —
 * a null source seeds nothing rather than writing an empty string, so the
 * completeness meter and touched-tracking both stay honest.
 *
 * `city` is deliberately absent. The only stored location is target_locations /
 * preferred_locations, which is where the client wants to WORK, not where they
 * are. Seeding it would be wrong in a way that looks right — the client would
 * see a plausible city already filled and never correct it.
 */
export function computeSeed(src: SeedSources): Partial<Record<SeedableField, string>> {
  const out: Partial<Record<SeedableField, string>> = {}
  const put = (k: SeedableField, v: string | null) => { if (v) out[k] = v }

  put("client_first", firstNameFrom(src.name))
  put("school", clean(src.university))
  put("target_role", firstTargetRole(src.target_roles))
  put("target_field", targetFieldFrom(src.targetFamilies))
  put("grad_year", gradYearFrom(src.grad_date))
  put("timeframe", clean(src.timeline))
  // The coach's words about the client, seeded as an EDITABLE DRAFT. Mirroring
  // this would mean a coach's private note silently rewriting client-facing copy.
  put("key_strength", clean(src.coach_notes_strengths))
  put("current_role_title", clean(src.currentRole?.title ?? null))
  put("current_employer", clean(src.currentRole?.company ?? null))

  return out
}

/**
 * A refresh re-seeds only what the user has never written. `touched` is the
 * authority, NOT emptiness: a field the client deliberately cleared is touched,
 * and putting the old value back would be the single most annoying thing this
 * feature could do.
 */
export function computeRefresh(
  src: SeedSources,
  touched: readonly string[],
): Partial<Record<SeedableField, string>> {
  const seed = computeSeed(src)
  const t = new Set(touched)
  const out: Partial<Record<SeedableField, string>> = {}
  for (const [k, v] of Object.entries(seed) as [SeedableField, string][]) {
    if (!t.has(k)) out[k] = v
  }
  return out
}

/** The two fields that need a live résumé extraction (phase 2 of the seed).
 *  Everything else is a plain column read. */
export const RESUME_SEEDED_FIELDS = ["current_role_title", "current_employer"] as const

/** Seedable fields that cost nothing to resolve — the auto-fill set. */
export const CHEAP_SEEDED_FIELDS = SEEDABLE_FIELDS.filter(
  (f) => !(RESUME_SEEDED_FIELDS as readonly string[]).includes(f),
)

/**
 * Cost guard. Loading the sources costs a query, so skip it entirely unless
 * there is at least one cheap field that auto-fill could actually populate.
 * On a settled profile this makes every GET a plain read again.
 */
export function hasFillableBlanks(
  current: Partial<Record<SeedableField, string | null>>,
  touched: readonly string[],
): boolean {
  const t = new Set(touched)
  return CHEAP_SEEDED_FIELDS.some((f) => !t.has(f) && !((current[f] ?? "").trim()))
}

/**
 * AUTO-FILL: what a GET may write without being asked.
 *
 * A field qualifies only when it is EMPTY *and* untouched *and* its source now
 * has a value. The empty test is the whole safety argument — `touched` cannot
 * distinguish "never seen it" from "read it and was happy with it", so filling
 * any untouched field would silently rewrite copy the client had already
 * accepted. Filling a blank is help; replacing something they have seen needs
 * their intent, and that is what computeRefresh + the Refresh button are for.
 *
 * The case this exists for: a client opens their networking profile early, the
 * seed finds an empty source, and the source fills in afterwards. Without this
 * the profile stays blank until someone thinks to press Refresh.
 */
export function computeAutoFill(
  src: SeedSources,
  current: Partial<Record<SeedableField, string | null>>,
  touched: readonly string[],
): Partial<Record<SeedableField, string>> {
  const t = new Set(touched)
  const out: Partial<Record<SeedableField, string>> = {}
  for (const [k, v] of Object.entries(computeSeed(src)) as [SeedableField, string][]) {
    if (t.has(k)) continue                          // the user owns it
    if ((current[k] ?? "").trim()) continue         // they have seen this value
    out[k] = v
  }
  return out
}

export type Completeness = { filled: number; total: number; missing: ProfileField[] }

/** X of 17 — the 16 merge variables plus the elevator pitch. Counting the pitch
 *  because a template that interpolates an empty pitch is exactly the gap this
 *  meter exists to surface. */
export function completeness(row: Partial<Record<ProfileField, string | null>>): Completeness {
  const missing = ALL_FIELDS.filter((f) => !clean(row[f] ?? null))
  return { filled: ALL_FIELDS.length - missing.length, total: ALL_FIELDS.length, missing: [...missing] }
}

/** Merge a PATCH into the touched set. Only keys actually present in the patch
 *  count as touched — a PATCH that sets one field must not mark the other 16. */
export function mergeTouched(existing: readonly string[], patchKeys: readonly string[]): string[] {
  return [...new Set([...existing, ...patchKeys])].sort()
}
