/**
 * Per-client match criteria (Phase 3).
 *
 * The shape client_match_criteria will store, and the seed that builds it from
 * what exists today: the client's lane (search_lanes) and profile
 * (client_profiles). Decided 2026-10-25: a new table, edited from the client
 * profile, replaces lane config as what matching reads.
 *
 * Fields are split by who reads them:
 *   rules    -> markets, maxYearsRequired, jobTypes, gradDate, salaryFloor,
 *               excludedTitleKeywords, excludedEmployers
 *   judgment -> everything, including targetRoles, industries and notes, which
 *               are never hard filters (industry is display only)
 */

import { stateCode } from "../ingest/fingerprint"

export type Market = {
  /** As written: a lane preset ("nyc") or a profile city ("Cincinnati, OH"). */
  name: string
  /**
   * States a posting in this market can be in. Generous on purpose: the rule
   * only fails a posting whose every location is outside all of these, and the
   * judgment pass decides distance inside them.
   */
  states: string[]
}

export type MatchCriteria = {
  clientProfileId: string
  /** Empty = anywhere: no location rule. */
  markets: Market[]
  radiusMiles: number | null
  remoteOk: boolean
  /** Fails a posting whose REQUIRED minimum is above this. null = no rule. */
  maxYearsRequired: number | null
  /** "full_time", "internship", "part_time", ... as the profile states them. */
  jobTypes: string[]
  gradDate: string | null
  educationStatus: string | null
  timeline: string | null
  /** Earliest start the client can take (YYYY-MM-DD). null = available now: no start rule. */
  availableFrom: string | null
  salaryFloor: { amount: number; period: "year" | "hour" } | null
  excludedTitleKeywords: string[]
  excludedEmployers: string[]
  targetRoles: string[]
  targetIndustries: string[]
  excludedIndustries: string[]
  notes: string | null
  /** Judgment only: the client's background, from their resume (read from the profile at match time). */
  background: string | null
}

/**
 * Lane presets -> the states their metro can reach. Covers every preset the 13
 * replay lanes and Alex's lane use; an unknown preset is reported, not guessed.
 */
export const PRESET_STATES: Record<string, string[]> = {
  nyc: ["ny", "nj", "ct"],
  boston: ["ma", "nh", "ri"],
  chicago: ["il", "in", "wi"],
  philadelphia: ["pa", "nj", "de"],
  miami: ["fl"],
  fort_lauderdale: ["fl"],
  west_palm_beach: ["fl"],
  boca_raton: ["fl"],
  columbus: ["oh"],
  indianapolis: ["in"],
  cincinnati: ["oh", "ky", "in"],
}

const JOB_TYPES: Record<string, string> = {
  "full-time": "full_time", "full time": "full_time", fulltime: "full_time",
  internship: "internship", intern: "internship",
  "part-time": "part_time", "part time": "part_time",
  contract: "contract", temporary: "temporary",
}

export const normJobType = (v: string) => JOB_TYPES[v.trim().toLowerCase()] ?? v.trim().toLowerCase()

const splitList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean)
    : typeof v === "string" ? v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean) : []

/**
 * Seed criteria from a lane and a profile. Pure. `overrides` is what the coach
 * set on top (Alex, 2026-10-25: max years 2, Cincinnati added).
 */
export function seedCriteria(
  lane: { titles?: unknown; location?: any; years_max?: number | null; exclusions?: any; keyword?: string | null },
  profile: {
    id: string; job_type?: string | null; grad_date?: string | null; education_status?: string | null; timeline?: string | null
    target_roles?: string | null; target_industries?: unknown; excluded_industries?: unknown
    coach_notes_avoid?: string | null; coach_notes_concerns?: string | null
    resume_text?: string | null; profile_text?: string | null
  },
  overrides: Partial<MatchCriteria> & { addPresets?: string[] } = {},
): { criteria: MatchCriteria; warnings: string[] } {
  const warnings: string[] = []
  const presets = [...new Set([...(lane.location?.presets ?? []), ...(overrides.addPresets ?? [])].map((p: string) => p.toLowerCase()))]
  const markets: Market[] = []
  for (const p of presets) {
    const states = PRESET_STATES[p]
    if (states) markets.push({ name: p, states })
    else warnings.push(`unknown location preset "${p}": no location rule for it`)
  }
  // A preset we cannot place means the location rule cannot be trusted at all.
  const unknownPreset = warnings.length > 0

  const notes = [profile.coach_notes_avoid && `Avoid: ${profile.coach_notes_avoid}`, profile.coach_notes_concerns && `Concerns: ${profile.coach_notes_concerns}`]
    .filter(Boolean).join("\n") || null

  const criteria: MatchCriteria = {
    clientProfileId: profile.id,
    markets: unknownPreset ? [] : markets,
    radiusMiles: lane.location?.radius_miles ?? null,
    remoteOk: true,
    maxYearsRequired: lane.years_max ?? null,
    jobTypes: profile.job_type ? [normJobType(profile.job_type)] : [],
    gradDate: profile.grad_date ?? null,
    educationStatus: profile.education_status ?? null,
    timeline: profile.timeline ?? null,
    availableFrom: parseTimeline(profile.timeline ?? null),
    salaryFloor: null,
    excludedTitleKeywords: splitList(lane.exclusions?.title_keywords),
    excludedEmployers: [],
    targetRoles: [...new Set([...splitList(lane.titles), ...splitList(profile.target_roles)].map((s) => s.toLowerCase()))],
    targetIndustries: splitList(profile.target_industries),
    excludedIndustries: splitList(profile.excluded_industries),
    notes,
    background: [profile.resume_text, profile.profile_text].map((t) => (t ?? "").trim()).find((t) => t.length > 200) ?? null,
    ...overrides,
  }
  delete (criteria as any).addPresets
  return { criteria, warnings }
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
const SEASON_MONTH: Record<string, number> = { spring: 3, summer: 6, fall: 9, autumn: 9, winter: 1 }

/**
 * A profile timeline -> the earliest start date it names, or null.
 * "June 2027" -> 2027-06-01; "Summer 2027" -> 2027-06-01; "Fall 2026" -> 2026-09-01.
 * Anything relative or open ("Now", "Actively looking", "6-12 months",
 * "Exploring options") is null: no start rule, which is the safe direction.
 */
export function parseTimeline(t: string | null): string | null {
  const s = String(t ?? "").toLowerCase()
  const year = s.match(/\b(20\d\d)\b/)?.[1]
  if (!year) return null
  const month = MONTHS.findIndex((m) => new RegExp(`\\b${m.slice(0, 3)}[a-z]*\\b`).test(s))
  if (month >= 0) return `${year}-${String(month + 1).padStart(2, "0")}-01`
  const season = Object.keys(SEASON_MONTH).find((k) => new RegExp(`\\b${k}\\b`).test(s))
  if (season) return `${year}-${String(SEASON_MONTH[season]).padStart(2, "0")}-01`
  return null
}

/** "Illinois, US" / "IL" / "illinois" -> "il"; null when unknown. */
export function toStateCode(v: string | null | undefined): string | null {
  const s = String(v ?? "").replace(/,\s*US$/i, "").trim()
  return stateCode(s)
}
