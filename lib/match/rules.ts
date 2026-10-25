/**
 * Phase 3, first pass: hard rules. Free, no API call.
 *
 * NOT STATED NEVER FAILS. Each rule fires only on a value the posting states;
 * a missing location, years figure, salary, graduation window or employment
 * type passes, and the judgment pass sees the posting.
 *
 * Every rule is deliberately narrower than it could be, because a wrong fail is
 * a job the coach never sees, which is the quiet failure (BUILD-PLAN Phase 3).
 * Measured against 73 recorded pushes before any rule was allowed to stay:
 *   - location fails only when EVERY location the posting names is outside the
 *     states the client's markets reach (clients pushed suburbs inside their
 *     radius, and no source gives coordinates); distance is the judge's call
 *   - job type fails only a full-time client against an internship-only
 *     posting (a full-time client pushed a part-time seasonal role)
 */

import type { MatchCriteria } from "./criteria"
import { citiesOf } from "../ingest/link"

/**
 * Bumped whenever a rule changes, and folded into criteria_hash by
 * runMatching, so every stored match is re-evaluated under the new rules.
 *   2026-10-25.1  first prod run (Alex)
 *   2026-10-25.2  trailing country names read; "remote" abroad is not remote
 *   2026-10-25.3  SmartRecruiters' "Kentucky (KY)" state form read
 *   2026-10-25.4  start timing against available_from; employment types read
 */
export const RULES_VERSION = "2026-10-25.4"

/** Country names a location can end with. US spellings are handled separately. */
const COUNTRIES = new Set([
  "united kingdom", "uk", "england", "scotland", "wales", "northern ireland", "ireland", "germany", "france", "spain",
  "italy", "netherlands", "belgium", "luxembourg", "switzerland", "austria", "sweden", "norway", "denmark", "finland",
  "iceland", "poland", "portugal", "czech republic", "czechia", "slovakia", "slovenia", "hungary", "romania", "bulgaria",
  "croatia", "serbia", "greece", "cyprus", "malta", "ukraine", "lithuania", "latvia", "estonia", "turkey", "israel",
  "uae", "united arab emirates", "saudi arabia", "qatar", "kuwait", "bahrain", "oman", "egypt", "morocco", "south africa",
  "nigeria", "kenya", "india", "pakistan", "bangladesh", "sri lanka", "china", "hong kong", "taiwan", "japan",
  "south korea", "korea", "singapore", "malaysia", "indonesia", "thailand", "vietnam", "philippines", "australia",
  "new zealand", "canada", "mexico", "brazil", "argentina", "chile", "colombia", "peru", "uruguay", "costa rica",
])
const US = /^(united states( of america)?|usa|us|u\.s\.a?\.?)$/i

/**
 * A postings.location string -> locations with their country.
 * "London, , United Kingdom" -> [{ country: "United Kingdom" }]; "Chicago, IL" ->
 * [{ city: "chicago", state: "il", country: "US" }]. A part that names neither a
 * placeable city nor a country is left out; nothing placeable at all -> null
 * (not stated, which passes).
 */
export function parseLocations(raw: string | null | undefined): PostingLocation[] | null {
  const out: PostingLocation[] = []
  // SmartRecruiters writes "Louisville, Kentucky (KY), United States": drop the "(KY)".
  const cleaned = String(raw ?? "").replace(/\s*\([A-Z]{2}\)/g, "")
  for (const seg of cleaned.split(/\s*;\s*|\s+or\s+/i)) {
    const parts = seg.split(",").map((s) => s.trim()).filter(Boolean)
    const last = (parts[parts.length - 1] ?? "").toLowerCase()
    const country = US.test(last) ? "US" : COUNTRIES.has(last) ? parts[parts.length - 1] : null
    const cities = country && country !== "US" ? [] : citiesOf(seg)
    if (cities.length) out.push(...cities.map((c) => ({ city: c.city, state: c.state, country: c.state ? "US" : country })))
    else if (country && country !== "US") out.push({ city: parts.length > 1 ? parts[0] : null, state: null, country })
  }
  return out.length ? out : null
}

export type PostingLocation = { city: string | null; state: string | null; country: string | null }

/** The posting as matching sees it, from postings (enriched) or lane_results. */
export type MatchPosting = {
  title: string
  company: string
  /** null = not stated. */
  locations: PostingLocation[] | null
  remote: boolean | null
  yearsMin: number | null
  yearsMax: number | null
  yearsBasis: "required" | "preferred" | null
  /** full_time, internship, part_time, temporary, seasonal, contract. null = not stated. */
  employmentTypes: string[] | null
  salaryLow: number | null
  salaryHigh: number | null
  salaryPeriod: string | null
  graduationFrom: string | null
  graduationTo: string | null
  level: string | null
  /** When the job starts, as stated. startType null = not stated. */
  startType: "date" | "season" | "immediate" | null
  startDate: string | null
  startSeason: string | null
  startYear: number | null
  /** What the judge reads: description, or a requirements summary when that is all there is. */
  text: string
}

export type RuleFailure = "location" | "years" | "graduation" | "excluded_title" | "excluded_employer" | "salary" | "job_type" | "start"

/** "Clearly before" allows a month: a June 1 start for a client free June 15 is not a mismatch. */
const START_GRACE_DAYS = 31
const SEASON_END: Record<string, (y: number) => string> = {
  spring: (y) => `${y}-05-31`, summer: (y) => `${y}-08-31`, fall: (y) => `${y}-11-30`, winter: (y) => `${y}-03-31`,
}
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10)

/**
 * Does the posting start clearly before the client can? Only a stated start
 * can fail; "start not stated" always passes.
 *   immediate -> fails when the client is not free within a month of today
 *   date      -> fails when it is more than a month before available_from
 *   season    -> fails when the whole season is over before available_from
 */
export function startsTooEarly(availableFrom: string, p: Pick<MatchPosting, "startType" | "startDate" | "startSeason" | "startYear">, today: string): boolean {
  if (p.startType === "immediate") return availableFrom > addDays(today, START_GRACE_DAYS)
  if (p.startType === "date" && p.startDate) return addDays(p.startDate, START_GRACE_DAYS) < availableFrom
  if (p.startType === "season" && p.startSeason && p.startYear) return SEASON_END[p.startSeason](p.startYear) < availableFrom
  return false
}

const ym = (d: string) => d.slice(0, 7)

export function applyRules(c: MatchCriteria, p: MatchPosting, today = new Date().toISOString().slice(0, 10)): RuleFailure[] {
  const out: RuleFailure[] = []

  // location. "Remote" passes only when it is not remote from abroad.
  const abroadOnly = !!p.locations?.length && p.locations.every((l) => l.country && l.country !== "US")
  if (c.markets.length && p.locations?.length && !(p.remote && c.remoteOk && !abroadOnly)) {
    const allowed = new Set(c.markets.flatMap((m) => m.states))
    const placed = p.locations.filter((l) => l.state || (l.country && l.country !== "US"))
    // Every location must be placeable to fail: one unknown location passes.
    if (placed.length === p.locations.length && placed.every((l) => (l.country && l.country !== "US") || !allowed.has(l.state!))) {
      out.push("location")
    }
  }

  // years: only a stated, required minimum above the client's maximum
  if (c.maxYearsRequired !== null && p.yearsBasis === "required" && p.yearsMin !== null && p.yearsMin > c.maxYearsRequired) {
    out.push("years")
  }

  // graduation window: only an absolute window, only a known graduation date
  if (c.gradDate && (p.graduationFrom || p.graduationTo)) {
    const g = ym(c.gradDate)
    const from = p.graduationFrom ? (p.graduationFrom.length === 4 ? p.graduationFrom + "-01" : p.graduationFrom) : null
    const to = p.graduationTo ? (p.graduationTo.length === 4 ? p.graduationTo + "-12" : p.graduationTo) : null
    if ((from && g < from) || (to && g > to)) out.push("graduation")
  }

  // exclusions
  const t = p.title.toLowerCase()
  if (c.excludedTitleKeywords.some((k) => new RegExp(`\\b${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t))) out.push("excluded_title")
  const co = p.company.toLowerCase().trim()
  if (c.excludedEmployers.some((e) => e.toLowerCase().trim() === co)) out.push("excluded_employer")

  // salary floor: the best pay the posting allows, same period only, never converted
  if (c.salaryFloor && p.salaryPeriod === c.salaryFloor.period) {
    // The ceiling is the best case. "From X" has high NULL: no ceiling, so it can
    // never fall below a floor. A single figure has high = low.
    if (p.salaryHigh !== null && p.salaryHigh < c.salaryFloor.amount) out.push("salary")
  }

  // job type: a full-time client against an internship-only posting
  if (c.jobTypes.length === 1 && c.jobTypes[0] === "full_time" && p.employmentTypes?.length) {
    const types = new Set(p.employmentTypes)
    if (types.has("internship") && !types.has("full_time")) out.push("job_type")
  }

  // start timing: only a stated start, only when the client named a date
  if (c.availableFrom && startsTooEarly(c.availableFrom, p, today)) out.push("start")

  return out
}
