// Per-field state and the "enough to start sending" threshold.
//
// Pure, and its own module: a Next page/component file is a bad home for logic
// two test layers need to reach, and the threshold in particular is a product
// rule rather than a rendering detail.
//
// WHY A THRESHOLD AT ALL: the profile is a one-time setup someone rushes
// through once. 17 fields with a single all-or-nothing meter tells a user who
// has done the useful 12 exactly the same thing it tells one who has done two —
// "not finished" — so the honest stopping point is invisible and people either
// grind or abandon. The threshold names the point where the tool starts working.

/** Genuinely skippable. Everything else is expected-but-not-blocking, which is
 *  why only these four are labelled and none of them gate the threshold. */
export const OPTIONAL_FIELDS = new Set(["grad_year", "degree", "resume_link", "calendar_link"])

/**
 * The four that gate "enough to start sending".
 *
 * Not "the important ones" — the ones a first message cannot be written
 * without. [NAME] and [FIRM] come from the contact, so what the PROFILE has to
 * supply is who you are (client_first), what you are reaching for (target_role,
 * target_field), and the paragraph that makes it sound like a person wrote it
 * (elevator_pitch). Below these, every template renders with blanks in it.
 */
export const MUST_HAVE = ["client_first", "target_role", "target_field", "elevator_pitch"] as const

export type FieldState = "filled" | "required-empty" | "optional-empty"

function hasValue(v: unknown): boolean {
  return typeof v === "string" ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : false
}

export function fieldState(key: string, value: unknown): FieldState {
  if (hasValue(value)) return "filled"
  return OPTIONAL_FIELDS.has(key) ? "optional-empty" : "required-empty"
}

export type SendReadiness = {
  ready: boolean
  /** Must-have keys still empty, in MUST_HAVE order. */
  missing: string[]
  /** How many more must-haves to cross the threshold. 0 once ready. */
  remaining: number
}

export function sendReadiness(profile: Record<string, unknown> | null | undefined): SendReadiness {
  const p = profile ?? {}
  const missing = MUST_HAVE.filter((k) => !hasValue(p[k]))
  return { ready: missing.length === 0, missing: [...missing], remaining: missing.length }
}

/** Filled / total for one group of fields, for the per-section counts. */
export function groupProgress(
  keys: readonly string[],
  profile: Record<string, unknown> | null | undefined,
): { filled: number; total: number } {
  const p = profile ?? {}
  return { filled: keys.filter((k) => hasValue(p[k])).length, total: keys.length }
}
