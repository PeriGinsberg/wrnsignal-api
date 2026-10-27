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
  /**
   * Rank this market's postings above an equal score elsewhere in the same
   * timing tier (Daniel, 2026-10-27: US-wide, Chicago first). Never passes or
   * fails a posting.
   */
  preferred?: boolean
  /**
   * Only for these employers (an EMPLOYER_PRESETS key): the market's states
   * count only when the posting's employer is on that list. Anthony,
   * 2026-10-27: pro teams and leagues anywhere in the US, everything else near
   * NYC.
   */
  employers?: string
}

/**
 * Employer lists a market can be limited to. Full names only: a bare nickname
 * ("Liberty", "Kings", "Heat") would also match Liberty Mutual or Burger King.
 * Matched as whole words on the company name, case and punctuation ignored.
 */
export const EMPLOYER_PRESETS: Record<string, string[]> = {
  pro_sports: [
    // leagues and their offices
    "nfl", "national football league", "nba", "national basketball association", "nba g league", "wnba",
    "women's national basketball association", "mlb", "major league baseball", "minor league baseball", "milb", "nhl",
    "national hockey league", "mls", "major league soccer", "nwsl", "national women's soccer league", "usl",
    "united soccer league", "pwhl", "professional women's hockey league",
    // groups that run teams
    "kroenke sports & entertainment", "harris blitzer sports & entertainment", "monumental sports & entertainment",
    "maple leaf sports & entertainment", "fenway sports group", "madison square garden sports", "msg sports",
    "ilitch sports + entertainment", "pegula sports and entertainment", "comcast spectacor", "rock entertainment group",
    "tampa bay sports & entertainment", "bse global", "jacksonville jaguars llc",
    // NFL
    "arizona cardinals", "atlanta falcons", "baltimore ravens", "buffalo bills", "carolina panthers", "chicago bears",
    "cincinnati bengals", "cleveland browns", "dallas cowboys", "denver broncos", "detroit lions", "green bay packers",
    "houston texans", "indianapolis colts", "jacksonville jaguars", "kansas city chiefs", "las vegas raiders",
    "los angeles chargers", "los angeles rams", "miami dolphins", "minnesota vikings", "new england patriots",
    "new orleans saints", "new york giants", "new york jets", "philadelphia eagles", "pittsburgh steelers",
    "san francisco 49ers", "seattle seahawks", "tampa bay buccaneers", "tennessee titans", "washington commanders",
    // NBA
    "atlanta hawks", "boston celtics", "brooklyn nets", "charlotte hornets", "chicago bulls", "cleveland cavaliers",
    "dallas mavericks", "denver nuggets", "detroit pistons", "golden state warriors", "houston rockets", "indiana pacers",
    "la clippers", "los angeles clippers", "los angeles lakers", "memphis grizzlies", "miami heat", "milwaukee bucks",
    "minnesota timberwolves", "new orleans pelicans", "new york knicks", "oklahoma city thunder", "orlando magic",
    "philadelphia 76ers", "phoenix suns", "portland trail blazers", "sacramento kings", "san antonio spurs",
    "toronto raptors", "utah jazz", "washington wizards",
    // MLB
    "arizona diamondbacks", "atlanta braves", "baltimore orioles", "boston red sox", "chicago cubs", "chicago white sox",
    "cincinnati reds", "cleveland guardians", "colorado rockies", "detroit tigers", "houston astros", "kansas city royals",
    "los angeles angels", "los angeles dodgers", "miami marlins", "milwaukee brewers", "minnesota twins", "new york mets",
    "new york yankees", "oakland athletics", "sacramento athletics", "las vegas athletics", "philadelphia phillies",
    "pittsburgh pirates", "san diego padres", "san francisco giants", "seattle mariners", "st louis cardinals",
    "tampa bay rays", "texas rangers", "toronto blue jays", "washington nationals",
    // NHL
    "anaheim ducks", "boston bruins", "buffalo sabres", "calgary flames", "carolina hurricanes", "chicago blackhawks",
    "colorado avalanche", "columbus blue jackets", "dallas stars", "detroit red wings", "edmonton oilers",
    "florida panthers", "los angeles kings", "minnesota wild", "montreal canadiens", "nashville predators",
    "new jersey devils", "new york islanders", "new york rangers", "ottawa senators", "philadelphia flyers",
    "pittsburgh penguins", "san jose sharks", "seattle kraken", "st louis blues", "tampa bay lightning",
    "toronto maple leafs", "utah mammoth", "utah hockey club", "vancouver canucks", "vegas golden knights",
    "washington capitals", "winnipeg jets",
    // MLS
    "atlanta united", "austin fc", "charlotte fc", "chicago fire", "fc cincinnati", "colorado rapids", "columbus crew",
    "dc united", "fc dallas", "houston dynamo", "inter miami", "la galaxy", "lafc", "los angeles fc", "minnesota united",
    "cf montreal", "nashville sc", "new england revolution", "new york city fc", "nycfc", "new york red bulls",
    "orlando city", "philadelphia union", "portland timbers", "real salt lake", "san diego fc", "san jose earthquakes",
    "seattle sounders", "sporting kansas city", "st louis city sc", "toronto fc", "vancouver whitecaps",
    // WNBA
    "atlanta dream", "chicago sky", "connecticut sun", "dallas wings", "golden state valkyries", "indiana fever",
    "las vegas aces", "los angeles sparks", "minnesota lynx", "new york liberty", "phoenix mercury", "seattle storm",
    "washington mystics", "toronto tempo", "portland fire",
    // NWSL
    "angel city fc", "bay fc", "chicago stars fc", "houston dash", "kansas city current", "gotham fc",
    "north carolina courage", "orlando pride", "portland thorns", "racing louisville", "san diego wave", "seattle reign",
    "utah royals", "washington spirit", "boston legacy", "denver summit",
  ],
}

/** "St. Louis Cardinals, LLC" -> " st louis cardinals llc ": ampersand and plus kept as words, dots dropped. */
const employerWords = (s: string) =>
  ` ${s.toLowerCase().replace(/[.’']/g, "").replace(/&/g, " & ").replace(/\+/g, " + ").replace(/[^a-z0-9&+]+/g, " ").trim()} `

/** Is this company on the preset's list? Whole words, so "kings" alone never matches. */
export function employerInPreset(preset: string, company: string): boolean {
  const names = EMPLOYER_PRESETS[preset]
  if (!names) throw new UnknownEmployerPresetError(preset)
  const co = employerWords(company)
  return names.some((n) => co.includes(employerWords(n)))
}

/** A market names an employer list EMPLOYER_PRESETS does not have. Matching stops rather than guessing. */
export class UnknownEmployerPresetError extends Error {
  constructor(public preset: string) {
    super(`unknown employer preset "${preset}": add it to EMPLOYER_PRESETS in lib/match/criteria.ts or fix the market`)
    this.name = "UnknownEmployerPresetError"
  }
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
  /** Judgment only: the client's degree fields as the coach states them ("B.A. Psychology; minor Political Science"). */
  majors: string | null
  /** Judgment only: the client's background, from their resume (read from the profile at match time). */
  background: string | null
}

/**
 * Lane presets -> the city names a link or a slug can use for that market
 * ("new-york-ny", "us-pa-philadelphia"). Used only to prefer one of a
 * posting's apply links over another, never to pass or fail a posting.
 */
export const PRESET_CITIES: Record<string, string[]> = {
  nyc: ["new york", "nyc", "manhattan", "brooklyn", "jersey city", "hoboken", "newark", "stamford", "white plains"],
  boston: ["boston", "cambridge", "somerville", "waltham"],
  chicago: ["chicago", "evanston"],
  philadelphia: ["philadelphia", "king of prussia", "conshohocken"],
  miami: ["miami", "coral gables", "doral"],
  fort_lauderdale: ["fort lauderdale", "ft lauderdale"],
  west_palm_beach: ["west palm beach"],
  boca_raton: ["boca raton"],
  columbus: ["columbus"],
  indianapolis: ["indianapolis"],
  cincinnati: ["cincinnati"],
  atlanta: ["atlanta"],
  nashville: ["nashville"],
  washington_dc: ["washington dc", "washington d c", "district of columbia", "arlington", "mclean", "tysons", "reston", "bethesda", "alexandria"],
  south_florida: ["miami", "coral gables", "doral", "fort lauderdale", "ft lauderdale", "boca raton", "west palm beach"],
  // US-wide: no city names, so it never chooses one office's link over another.
  united_states: [],
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
  atlanta: ["ga"],
  nashville: ["tn"],
  washington_dc: ["dc", "md", "va"],
  south_florida: ["fl"],
  // US only, no metro limit: fails a posting only when every location it names is abroad.
  united_states: ["al", "ak", "az", "ar", "ca", "co", "ct", "de", "dc", "fl", "ga", "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me",
    "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc", "sd",
    "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy"],
}

/**
 * A lane names a location preset PRESET_STATES does not know. Seeding stops:
 * the old behaviour (2026-10-26, Sami Zivitz: "atlanta", "nashville") dropped
 * the whole location rule, so one unknown city widened the search to every
 * market. Add the preset or fix the lane.
 */
export class UnknownPresetError extends Error {
  constructor(public presets: string[]) {
    super(`unknown location preset${presets.length > 1 ? "s" : ""} ${presets.map((p) => `"${p}"`).join(", ")}: add to PRESET_STATES in lib/match/criteria.ts or fix the lane; nothing seeded`)
    this.name = "UnknownPresetError"
  }
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
  const unknown = presets.filter((p) => !PRESET_STATES[p])
  if (unknown.length) throw new UnknownPresetError(unknown)
  const markets: Market[] = presets.map((p) => ({ name: p, states: PRESET_STATES[p] }))

  const notes = [profile.coach_notes_avoid && `Avoid: ${profile.coach_notes_avoid}`, profile.coach_notes_concerns && `Concerns: ${profile.coach_notes_concerns}`]
    .filter(Boolean).join("\n") || null

  const criteria: MatchCriteria = {
    clientProfileId: profile.id,
    markets,
    radiusMiles: lane.location?.radius_miles ?? null,
    remoteOk: true,
    maxYearsRequired: lane.years_max ?? null,
    jobTypes: profile.job_type ? [normJobType(profile.job_type)] : [],
    gradDate: profile.grad_date ?? null,
    educationStatus: profile.education_status ?? null,
    timeline: profile.timeline ?? null,
    availableFrom: availableFromProfile(profile).date,
    salaryFloor: null,
    excludedTitleKeywords: splitList(lane.exclusions?.title_keywords),
    excludedEmployers: [],
    targetRoles: [...new Set([...splitList(lane.titles), ...splitList(profile.target_roles)].map((s) => s.toLowerCase()))],
    targetIndustries: splitList(profile.target_industries),
    excludedIndustries: splitList(profile.excluded_industries),
    notes,
    majors: null,
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

/**
 * When the client can start, from the profile (2026-10-26). In order:
 *   timeline     a month or season with a year ("June 2027", "Summer 2027")
 *   graduation   still in school with a graduation date after today
 *   relative     "6-12 months" / "3 months": today plus the first number
 *   none         "Now", "Actively looking", blank: available now (null)
 * A date after today puts the client in future-start mode: the queue's campus
 * tier. Otherwise the client is available now.
 */
export function availableFromProfile(
  p: { timeline?: string | null; grad_date?: string | null; education_status?: string | null },
  today = new Date().toISOString().slice(0, 10),
): { date: string | null; source: "timeline" | "graduation" | "relative" | "none" } {
  const t = parseTimeline(p.timeline ?? null)
  if (t) return { date: t, source: "timeline" }
  if (p.grad_date && p.grad_date > today && p.education_status !== "graduated") return { date: p.grad_date.slice(0, 10), source: "graduation" }
  const rel = String(p.timeline ?? "").toLowerCase().match(/\b(\d{1,2})\s*(?:-|to)?\s*(?:\d{1,2})?\s*months?\b/)
  if (rel) {
    const d = new Date(today + "T00:00:00Z")
    d.setUTCMonth(d.getUTCMonth() + Number(rel[1]))
    return { date: d.toISOString().slice(0, 10), source: "relative" }
  }
  return { date: null, source: "none" }
}

/** "Illinois, US" / "IL" / "illinois" -> "il"; null when unknown. */
export function toStateCode(v: string | null | undefined): string | null {
  const s = String(v ?? "").replace(/,\s*US$/i, "").trim()
  return stateCode(s)
}
