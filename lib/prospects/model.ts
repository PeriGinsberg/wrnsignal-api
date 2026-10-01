// lib/prospects/model.ts
//
// The prospect workflow's fixed vocabularies, in one place: lead sources, lost
// reasons, and the consult screen's choices. The routes validate against these
// and the screens render them, so a list cannot change in one and not the
// other. Before this, lead source alone was defined nine times.
//
// Keys are stored; labels are shown. A key never changes once rows hold it.

// ── Lead source ──────────────────────────────────────────────────────────────

/** The sources a coach can pick, in the order shown. */
export const LEAD_SOURCES = [
  "friend_family",
  "past_client",
  "online_community",
  "instagram_tiktok",
  "google_search",
  "ad",
  "free_resource",
  "other",
] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]

/**
 * Sources from before 2026-10-02. Still valid in the database so existing
 * prospects keep their value and still display, never offered for new picks.
 * ("other" is in both lists.)
 */
export const LEGACY_LEAD_SOURCES = ["referral", "social_media", "website", "personal_contact"] as const
export type LegacyLeadSource = (typeof LEGACY_LEAD_SOURCES)[number]
export type StoredLeadSource = LeadSource | LegacyLeadSource

export const LEAD_SOURCE_LABEL: Record<StoredLeadSource, string> = {
  friend_family: "A friend or family member",
  past_client: "A past client of Peri's",
  online_community: "Facebook group or online community",
  instagram_tiktok: "Instagram or TikTok",
  google_search: "Google search",
  ad: "Saw an ad",
  free_resource: "A free guide or resource I downloaded",
  other: "Other",
  referral: "Referral",
  social_media: "Social media",
  website: "Website",
  personal_contact: "Personal contact",
}

/** Every value a stored row may carry: what the database CHECK allows. */
export const STORED_LEAD_SOURCES: readonly StoredLeadSource[] = [...LEAD_SOURCES, ...LEGACY_LEAD_SOURCES]

/** The two sources a person referred, which is when "Referred by" applies. */
export const REFERRAL_SOURCES: readonly LeadSource[] = ["friend_family", "past_client"]

export function isPickableLeadSource(v: unknown): v is LeadSource {
  return typeof v === "string" && (LEAD_SOURCES as readonly string[]).includes(v)
}
export function isStoredLeadSource(v: unknown): v is StoredLeadSource {
  return typeof v === "string" && (STORED_LEAD_SOURCES as readonly string[]).includes(v)
}
export function takesReferredBy(source: string | null | undefined): boolean {
  return !!source && (REFERRAL_SOURCES as readonly string[]).includes(source)
}
export function leadSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null
  return LEAD_SOURCE_LABEL[source as StoredLeadSource] ?? source
}

// ── Lost ─────────────────────────────────────────────────────────────────────

export const LOST_REASONS = ["not_a_fit", "price", "timing", "chose_other", "no_response", "other"] as const
export type LostReason = (typeof LOST_REASONS)[number]
export const LOST_REASON_LABEL: Record<LostReason, string> = {
  not_a_fit: "Not a fit",
  price: "Price",
  timing: "Timing",
  chose_other: "Chose another option",
  no_response: "No response",
  other: "Other",
}
export function isLostReason(v: unknown): v is LostReason {
  return typeof v === "string" && (LOST_REASONS as readonly string[]).includes(v)
}

/** "Price", or "Other: moved abroad". Null when no reason is recorded (older lost rows). */
export function lostReasonText(p: { lost_reason?: string | null; lost_reason_detail?: string | null }): string | null {
  if (!p.lost_reason || !isLostReason(p.lost_reason)) return null
  return p.lost_reason === "other" && p.lost_reason_detail ? `Other: ${p.lost_reason_detail}` : LOST_REASON_LABEL[p.lost_reason]
}

// ── Consult ──────────────────────────────────────────────────────────────────

export const SEARCH_GOALS = ["internship", "first_job", "early_career_change", "seasoned_change", "other"] as const
export type SearchGoal = (typeof SEARCH_GOALS)[number]
export const SEARCH_GOAL_LABEL: Record<SearchGoal, string> = {
  internship: "Internship",
  first_job: "First job after graduation",
  early_career_change: "Early career change",
  seasoned_change: "Seasoned professional change",
  other: "Other",
}

/** Services of interest, Early Career Planning first. */
export const SERVICES = [
  "early_career_planning",
  "resume_cover_letter",
  "linkedin",
  "networking_strategy",
  "interview_coaching",
  "confidence_building",
  "job_search_support",
  "all",
] as const
export type Service = (typeof SERVICES)[number]
export const SERVICE_LABEL: Record<Service, string> = {
  early_career_planning: "Early Career Planning",
  resume_cover_letter: "Resume/Cover Letter",
  linkedin: "LinkedIn",
  networking_strategy: "Networking Strategy",
  interview_coaching: "Interview Coaching",
  confidence_building: "Confidence Building",
  job_search_support: "Job Search Support",
  all: "All of the above",
}

export const MATERIAL_STATES = ["have", "needs_work", "none"] as const
export type MaterialState = (typeof MATERIAL_STATES)[number]
export const MATERIAL_STATE_LABEL: Record<MaterialState, string> = {
  have: "Have",
  needs_work: "Needs work",
  none: "None",
}
export const MATERIALS = ["resume", "linkedin", "cover_letter"] as const
export type Material = (typeof MATERIALS)[number]
export const MATERIAL_LABEL: Record<Material, string> = {
  resume: "Resume",
  linkedin: "LinkedIn",
  cover_letter: "Cover letter",
}

export const CONSULT_OUTCOMES = ["completed", "no_show", "not_a_fit"] as const
export type ConsultOutcome = (typeof CONSULT_OUTCOMES)[number]

// ── Field validation ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** Optional free text. Missing = undefined (leave alone); "" or null = null (clear). */
export function optText(v: unknown, field: string, max: number): Parsed<string | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined }
  if (v === null) return { ok: true, value: null }
  if (typeof v !== "string") return { ok: false, error: `${field} must be text` }
  const t = v.trim()
  if (t.length > max) return { ok: false, error: `${field} too long (max ${max} chars)` }
  return { ok: true, value: t || null }
}

/** Optional email, lower-cased. Same missing/clear rules as optText. */
export function optEmail(v: unknown, field: string): Parsed<string | null | undefined> {
  const t = optText(v, field, 320)
  if (!t.ok || !t.value) return t
  const e = t.value.toLowerCase()
  if (!EMAIL_RE.test(e)) return { ok: false, error: `Invalid ${field} format` }
  return { ok: true, value: e }
}

/** Optional value from a fixed list. */
export function optEnum<T extends string>(v: unknown, field: string, allowed: readonly T[]): Parsed<T | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined }
  if (v === null || v === "") return { ok: true, value: null }
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    return { ok: false, error: `${field} must be one of: ${allowed.join(", ")}` }
  }
  return { ok: true, value: v as T }
}

/** Optional list of values from a fixed list, de-duplicated, in list order. */
export function optEnumList<T extends string>(v: unknown, field: string, allowed: readonly T[]): Parsed<T[] | undefined> {
  if (v === undefined) return { ok: true, value: undefined }
  if (v === null) return { ok: true, value: [] }
  if (!Array.isArray(v)) return { ok: false, error: `${field} must be a list` }
  for (const x of v) {
    if (typeof x !== "string" || !(allowed as readonly string[]).includes(x)) {
      return { ok: false, error: `${field} must only contain: ${allowed.join(", ")}` }
    }
  }
  return { ok: true, value: allowed.filter((a) => v.includes(a)) }
}

/** Optional calendar date, YYYY-MM-DD. */
export function optDay(v: unknown, field: string): Parsed<string | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined }
  if (v === null || v === "") return { ok: true, value: null }
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`))) {
    return { ok: false, error: `${field} must be a date (YYYY-MM-DD)` }
  }
  return { ok: true, value: v }
}

/**
 * Lead source and referred-by, together, because the second depends on the
 * first. Referred-by is kept only for the two referral sources: picking any
 * other source clears it, so a stale "Referred by" never sits on a Google
 * lead. "Other" keeps its specify text in source_detail.
 *
 * `current` is the row as stored, for edits that send only some of the keys.
 */
export function parseLeadSource(
  body: Record<string, unknown>,
  current: { source_category: string | null; referred_by_name: string | null; referred_by_email: string | null } | null,
  opts: { required: boolean },
): Parsed<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  let source = current?.source_category ?? null
  if ("source_category" in body) {
    const v = body.source_category
    if (v === null || v === "") {
      if (opts.required) return { ok: false, error: "source_category is required" }
      source = null
    } else if (current && v === current.source_category) {
      source = v as string // an unchanged legacy value is allowed to stay
    } else if (!isPickableLeadSource(v)) {
      return { ok: false, error: `source_category must be one of: ${LEAD_SOURCES.join(", ")}` }
    } else {
      source = v
    }
    out.source_category = source
  } else if (opts.required && !current) {
    return { ok: false, error: "source_category is required" }
  }

  const detail = optText(body.source_detail, "source_detail", 500)
  if (!detail.ok) return detail
  if (detail.value !== undefined) out.source_detail = detail.value

  if (takesReferredBy(source)) {
    const name = optText(body.referred_by_name, "referred_by_name", 200)
    if (!name.ok) return name
    const email = optEmail(body.referred_by_email, "referred_by_email")
    if (!email.ok) return email
    if (name.value !== undefined) out.referred_by_name = name.value
    if (email.value !== undefined) out.referred_by_email = email.value
  } else if (current?.referred_by_name || current?.referred_by_email || body.referred_by_name || body.referred_by_email) {
    out.referred_by_name = null
    out.referred_by_email = null
  }
  return { ok: true, value: out }
}

/** Parent / guardian contact. All optional. */
export function parseParent(body: Record<string, unknown>): Parsed<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  const name = optText(body.parent_name, "parent_name", 200)
  if (!name.ok) return name
  const email = optEmail(body.parent_email, "parent_email")
  if (!email.ok) return email
  const phone = optText(body.parent_phone, "parent_phone", 50)
  if (!phone.ok) return phone
  if (name.value !== undefined) out.parent_name = name.value
  if (email.value !== undefined) out.parent_email = email.value
  if (phone.value !== undefined) out.parent_phone = phone.value
  return { ok: true, value: out }
}
