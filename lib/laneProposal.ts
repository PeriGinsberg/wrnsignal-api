// lib/laneProposal.ts
//
// Proposing a search lane from a client profile, and checking the proposal
// against the board before anyone saves it.
//
// Lifted out of scripts/propose-search-lane.ts when the coach UI needed the same
// thing. The CLI and the "Create search lane" button must produce identical
// proposals — a lane that differs depending on who asked for it is not a
// proposal, it is a coin toss — so the heuristics live here and both callers are
// thin.
//
// Nothing here touches Supabase or the environment: it takes the profile text it
// needs as arguments and returns a plain object. That is what lets the route
// authorize first and propose second.

import { fetchJobs, queryFor, LOCATIONS, SENIORITY_LEVELS } from "./hiringcafe"

// ---------------------------------------------------------------------------
// Sector keywords
// ---------------------------------------------------------------------------
// The lane keyword narrows by subject, not by the board's job_category (see
// 20260817_search_lane_keyword.sql). There is no field on the profile that
// states a sector, so it is counted out of the text.
//
// Terms are matched on word boundaries, not with .includes(). The scoring
// engine's single biggest bug source is bare substring matching (CLAUDE.md,
// debt item 1) — "sport" inside "transport" or "ops" inside "operations" is
// exactly that failure, and it would land here as a wrong keyword on every
// query the lane ever sends.
//
// Broader sectors come first: on a tie, the broader keyword wins, because a
// too-narrow keyword ("baseball") silently excludes adjacent jobs the client
// would take, while a too-broad one only adds noise the review queue catches.
export const SECTOR_TERMS: Array<{ keyword: string; terms: string[] }> = [
  { keyword: "sports", terms: ["sports", "sport", "athletics", "athletic", "game day", "gameday", "ncaa", "collegiate", "stadium", "ballpark", "arena", "fan engagement", "franchise", "team operations"] },
  { keyword: "baseball", terms: ["baseball", "mlb", "milb", "scouting", "sabermetrics", "sabr", "pitching", "ballclub"] },
  { keyword: "entertainment", terms: ["entertainment", "live events", "venue", "touring", "concerts", "hospitality", "ticketing"] },
  { keyword: "healthcare", terms: ["healthcare", "clinical", "patient", "hospital", "provider", "payer", "ehr", "hipaa"] },
  { keyword: "finance", terms: ["finance", "financial", "investment", "banking", "equities", "portfolio", "wealth management", "asset management"] },
  { keyword: "marketing", terms: ["marketing", "brand", "campaigns", "social media", "content strategy", "paid media"] },
  { keyword: "technology", terms: ["software", "saas", "engineering", "platform", "api", "developer", "technical"] },
  { keyword: "nonprofit", terms: ["nonprofit", "non-profit", "philanthropy", "fundraising", "development officer", "donor"] },
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function countTerm(haystack: string, term: string): number {
  const re = new RegExp(`\\b${escape(term)}\\b`, "gi")
  return (haystack.match(re) || []).length
}

export function scoreSectors(text: string) {
  return SECTOR_TERMS.map(({ keyword, terms }) => {
    const hits: Record<string, number> = {}
    let score = 0
    for (const t of terms) {
      const n = countTerm(text, t)
      if (n) {
        hits[t] = n
        score += n
      }
    }
    return { keyword, score, hits }
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score) // stable: ties keep SECTOR_TERMS order
}

// Below this, the evidence is a passing mention rather than the client's
// sector, and a wrong keyword is worse than none: it is appended to EVERY
// title the lane queries, so it narrows the entire lane, not one query.
export const KEYWORD_MIN_SCORE = 3

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------
// target_roles is one free-text line the client typed ("Guest Experience
// Coordinator, Event Operations Associate, ..."). Each entry becomes one
// board query, so the split is the whole of the fan-out.
const TITLE_SPLIT = /\s*(?:[,;/|]|\band\b|\bor\b|\n)\s*/i

// One fetch per title per run, so the list is capped rather than passed
// through whole. Capping silently would read as "these are all the roles" —
// the caller prints what it dropped.
export const MAX_TITLES = 8

export function deriveTitles(targetRoles: string | null): { titles: string[]; dropped: string[] } {
  const parts = String(targetRoles || "")
    .split(TITLE_SPLIT)
    .map((s) =>
      s
        .toLowerCase()
        .replace(/[."]+$/g, "")
        .replace(/^(?:a|an|the|roles?\s+in|entry[- ]level)\s+/i, "")
        .trim()
    )
    // A single word like "operations" is a sector, not a title; queried alone
    // it returns the whole board. Two words is the floor for a role name.
    .filter((s) => s.length > 2 && /\s/.test(s))

  const seen = new Set<string>()
  const unique = parts.filter((t) => (seen.has(t) ? false : (seen.add(t), true)))
  return { titles: unique.slice(0, MAX_TITLES), dropped: unique.slice(MAX_TITLES) }
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------
// A lane stores a preset KEY, because a location assembled from coordinates
// returns HTTP 200 with zero results and an ssrError rather than an error
// (fetch-hiringcafe.ts, note 3). So a city the client named that has no preset
// is not a location this lane can search — it has to be reported, not
// approximated with the nearest preset we happen to have.
// Order matters only when a client names more than one market: deriveLocation
// takes the first match, because a lane searches one place. The flag naming the
// markets it could not cover is what keeps that visible.
const PRESET_ALIASES: Record<string, string[]> = {
  nyc: ["nyc", "new york", "new york city", "manhattan", "brooklyn", "ny metro", "tri-state"],
  miami: ["miami", "miami-dade", "coral gables", "brickell"],
  boca_raton: ["boca raton", "boca"],
  fort_lauderdale: ["fort lauderdale", "ft lauderdale", "ft. lauderdale", "broward"],
  west_palm_beach: ["west palm beach", "palm beach", "palm beach county"],
  los_angeles: ["los angeles", "la metro", "socal", "southern california", "santa monica"],
  chicago: ["chicago", "chicagoland"],
  boston: ["boston", "cambridge ma", "greater boston"],
  san_francisco: ["san francisco", "sf", "bay area", "silicon valley"],
  atlanta: ["atlanta", "atl"],
  dallas: ["dallas", "dfw", "dallas-fort worth", "fort worth"],
  denver: ["denver", "front range"],
  philadelphia: ["philadelphia", "philly"],
  phoenix: ["phoenix", "scottsdale", "tempe"],
  seattle: ["seattle", "puget sound", "bellevue"],
  washington_dc: ["washington dc", "washington, d.c.", "d.c.", "dc metro", "dmv"],
}

// Cities clients name often. Recognised only so an unsupported one can be
// named in the output; none of these are searchable until someone adds a full
// Google Places payload to LOCATIONS.
const KNOWN_CITIES = [
  "san diego", "los angeles", "san francisco", "bay area", "seattle", "portland",
  "denver", "austin", "dallas", "houston", "chicago", "atlanta", "nashville",
  "charlotte", "miami", "south florida", "tampa", "orlando", "jacksonville",
  "tallahassee", "boston", "philadelphia", "washington", "dc", "baltimore",
  "phoenix", "las vegas", "minneapolis", "detroit", "cleveland", "pittsburgh",
  "st. louis", "kansas city", "milwaukee", "cincinnati", "indianapolis",
]

const RELOCATION = /\b(anywhere|nationwide|open to relocat\w*|willing to relocat\w*|relocation)\b/i

export function deriveLocation(locationText: string, resumeText: string) {
  const presets = Object.keys(LOCATIONS)

  const named: string[] = []
  for (const [preset, aliases] of Object.entries(PRESET_ALIASES)) {
    if (!presets.includes(preset)) continue
    if (aliases.some((a) => countTerm(locationText, a) > 0)) named.push(preset)
  }

  const unsupported = KNOWN_CITIES.filter(
    (c) =>
      countTerm(locationText, c) > 0 &&
      !Object.entries(PRESET_ALIASES).some(([p, aliases]) => named.includes(p) && aliases.includes(c))
  )

  const relocating = RELOCATION.test(locationText) || RELOCATION.test(resumeText)

  // A client who named no searchable market gets no geographic filter, which
  // the lane can now express as preset null. This is a real answer for
  // "Anywhere" and a partial one for a client who named only markets we have
  // no preset for — the caller flags that second case, because nationwide is
  // wider than what they asked for, not narrower.
  const preset = named[0] ?? null

  // 50 miles for a client who will relocate or commute into a metro; 25 for
  // one anchored to the city itself. Irrelevant when preset is null.
  const radius_miles = relocating || named.length !== 1 ? 50 : 25

  return { preset, radius_miles, named, unsupported, relocating, presets }
}

// ---------------------------------------------------------------------------
// years_max
// ---------------------------------------------------------------------------
// years_max drops postings whose STATED minimum exceeds it (postings that
// state nothing are kept — run-search-lane.ts). Headroom is therefore not
// slack: a posting asking for a few more years than the client has is still
// worth a human look, and the number that filters honestly is the client's
// experience plus a margin, not their experience.
export const HEADROOM_YEARS = 3

const STAGE_YEARS_MAX: Record<string, number | null> = {
  student: 3,
  early_career: 5,
  mid_career: 10,
  executive: null, // no ceiling — a stated minimum is never the reason to skip
}

const DEGREE_LINE = /\b(bachelor|b\.?s\.?|b\.?a\.?|master|m\.?s\.?|mba|associate)\b/i

export function deriveYearsMax(resumeText: string, careerStage: string | null) {
  const gradYears = String(resumeText || "")
    .split(/\r?\n/)
    .filter((line) => DEGREE_LINE.test(line))
    .flatMap((line) => (line.match(/\b(19|20)\d{2}\b/g) || []).map(Number))
    .filter((y) => y >= 1980 && y <= new Date().getFullYear() + 6)

  if (gradYears.length) {
    // Latest degree, not the first: the most recent graduation is the one that
    // dates the client's professional clock.
    const grad = Math.max(...gradYears)
    const since = Math.max(0, new Date().getFullYear() - grad)
    return {
      years_max: since + HEADROOM_YEARS,
      rule: `graduated ${grad} → ${since}y since + ${HEADROOM_YEARS}y headroom`,
    }
  }

  if (careerStage && careerStage in STAGE_YEARS_MAX) {
    return {
      years_max: STAGE_YEARS_MAX[careerStage],
      rule: `no graduation year in resume → career_stage "${careerStage}"`,
    }
  }

  return { years_max: null, rule: "no graduation year and no career_stage → no ceiling" }
}

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------
// Matched with .includes() against the posting title by the runner, so these
// have to be words that cannot appear in a title the client WOULD take.
// "senior" and "lead" are deliberately absent: "Senior Coordinator" is a
// two-year job at half the teams in the league, and excluding it would drop
// real matches to remove some noise.
const JUNIOR_STAGE_EXCLUSIONS = ["director", "vice president", "head of"]

export function deriveExclusions(careerStage: string | null, yearsMax: number | null) {
  const junior = careerStage === "student" || careerStage === "early_career" || (yearsMax != null && yearsMax <= 5)
  return junior ? { title_keywords: [...JUNIOR_STAGE_EXCLUSIONS] } : {}
}

export const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase())

// ---------------------------------------------------------------------------
// Probe (--dry-run)
// ---------------------------------------------------------------------------
// Ask the board what each proposed title actually returns, before anyone saves
// a lane built on it. A title derived from target_roles can be perfectly
// sensible English and still be a phrase no employer posts under — "pro
// scouting" returns one soccer job nationwide — and a lane full of those looks
// identical to a lane that is simply having a quiet week.
//
// Counts are RAW board counts. The lane's own years_max and exclusions are not
// applied here, so a title that survives the probe can still contribute
// nothing after filtering; the probe answers "does this phrase exist on the
// board", which is the question that decides whether to keep the title.
export const PROBE_DAYS = 29
const PROBE_SENIORITY = [...SENIORITY_LEVELS].slice(0, 3) // through Mid Level, as the runner does

export type Probe = { title: string; query: string; fetched: number; available: number; capped: boolean }

export async function probeTitles(
  titles: string[],
  keyword: string | null,
  preset: string | null,
  radiusMiles: number
): Promise<Probe[]> {
  const out: Probe[] = []
  for (const title of titles) {
    const query = queryFor(title, keyword)
    const { rows, total } = await fetchJobs({
      query,
      location: preset,
      radiusMiles,
      days: PROBE_DAYS,
      seniority: PROBE_SENIORITY,
      pages: 1,
    })
    // One page, same as a default run. total > fetched means the board has more
    // than this page holds — the title is not under-performing, it is truncated,
    // and reporting the two as one number would hide which.
    out.push({ title, query, fetched: rows.length, available: total, capped: total > rows.length })
  }
  return out
}

// ---------------------------------------------------------------------------
// Board-scored keyword selection (--dry-run only)
// ---------------------------------------------------------------------------
// The resume tells you what sector the client works in. It does not tell you
// whether employers put that word in their postings, and those are different
// facts: a team hiring a Guest Experience Coordinator writes "guest experience
// coordinator", not "sports". Scoring a keyword against the resume therefore
// measures the wrong thing, and measures it confidently — "sports" scored 28
// on one profile and zeroed all five of its titles.
//
// So the resume now only NOMINATES candidates. The board picks the winner, by
// the one property that matters: does appending this word narrow the result
// set without emptying it?
//
// Ratios are computed on FETCHED counts. Where a baseline is page-capped the
// ratio understates how much the keyword narrows, which is flagged in the
// table rather than silently corrected — a corrected number nobody can trace
// back to two visible counts is worse than an honest one with a caveat.
export const MAX_KEYWORD_CANDIDATES = 3

// Above this share of the baseline surviving, the keyword is not narrowing
// anything and only adds a word to every query (cf. "baseball operations
// baseball" → 26 of 26).
const NO_OP_RETENTION = 0.9

// Below this share, the keyword is not narrowing, it is gutting. A relative
// floor as well as the absolute one below, because "enough postings left" and
// "kept a sensible share of what the titles find" are different questions: 28
// postings is a fine lane in isolation and a bad trade when the titles were
// finding 418.
//
// This floor is why the rule changed. Preferring the MOST selective qualifying
// keyword picked "entertainment" (7% of baseline) over "marketing" (69%) for a
// client whose own words ranked marketing first — technically the most
// selective, and wrong.
//
// Set at 0.10 rather than 0.20 deliberately. Retention cannot distinguish "cut
// hard because the titles are generic" from "cut hard because the sector is
// wrong": on a lane of generic titles (account manager, manager brand
// marketing) the keyword "sports" keeps 13% and is doing exactly its job, while
// "entertainment" keeps 9% on creative-internship titles and is simply the
// wrong sector. 0.20 rejected both; 0.10 keeps the first and still rejects the
// second. It is a threshold fitted to observed cases, not a law — the candidate
// table is returned with every proposal so the coach can overrule it.
const MIN_RETENTION = 0.10

// A keyword that leaves fewer than this many postings across ALL titles has
// not narrowed the lane, it has closed it.
const MIN_SURVIVING_FETCHED = 5

// Killing outright more than this share of the titles that DO return something
// disqualifies a keyword, however good its ratio looks on the survivors.
const MAX_ZERO_FRACTION = 0.5

export type KeywordScore = {
  keyword: string | null
  cells: Probe[]
  totalFetched: number
  retention: number
  zeroed: string[]
  liveTitles: number
  qualified: boolean
  disqualifiedBecause: string | null
}

export async function scoreKeywords(
  titles: string[],
  candidates: string[],
  preset: string | null,
  radiusMiles: number
): Promise<{ baseline: KeywordScore; scored: KeywordScore[]; chosen: KeywordScore }> {
  const build = (keyword: string | null, cells: Probe[], baselineCells: Probe[] | null): KeywordScore => {
    const totalFetched = cells.reduce((n, c) => n + c.fetched, 0)
    const base = baselineCells ?? cells
    const baseTotal = base.reduce((n, c) => n + c.fetched, 0)
    // Only titles the board answers at all can be "zeroed" by a keyword; a
    // title that returns nothing on its own is the title's problem, not the
    // keyword's, and blaming the keyword for it would disqualify every
    // candidate on a profile whose titles are simply wrong.
    const live = base.filter((c) => c.fetched > 0)
    const zeroed = live.filter((c) => cells.find((x) => x.title === c.title)!.fetched === 0).map((c) => c.title)
    const retention = baseTotal === 0 ? 1 : totalFetched / baseTotal

    let disqualifiedBecause: string | null = null
    if (keyword !== null) {
      if (retention > NO_OP_RETENTION) disqualifiedBecause = `no-op — keeps ${(retention * 100).toFixed(0)}% of baseline`
      else if (retention < MIN_RETENTION)
        disqualifiedBecause = `over-narrows — keeps only ${(retention * 100).toFixed(0)}% of baseline`
      else if (totalFetched < MIN_SURVIVING_FETCHED) disqualifiedBecause = `leaves only ${totalFetched} posting(s)`
      else if (live.length && zeroed.length / live.length > MAX_ZERO_FRACTION)
        disqualifiedBecause = `zeroes ${zeroed.length} of ${live.length} live titles`
    }

    return {
      keyword,
      cells,
      totalFetched,
      retention,
      zeroed,
      liveTitles: live.length,
      qualified: keyword !== null && !disqualifiedBecause,
      disqualifiedBecause,
    }
  }

  const baselineCells = await probeTitles(titles, null, preset, radiusMiles)
  const baseline = build(null, baselineCells, null)

  const scored: KeywordScore[] = []
  for (const k of candidates.slice(0, MAX_KEYWORD_CANDIDATES)) {
    scored.push(build(k, await probeTitles(titles, k, preset, radiusMiles), baselineCells))
  }

  // The board's job here is to VETO, not to rank. Every candidate that survives
  // the band narrows meaningfully without gutting the lane, and among keywords
  // that all work the board has no opinion worth having about which sector the
  // client belongs to — their own resume does. So the first survivor wins, and
  // `scored` is in resume-evidence order.
  //
  // The rejected alternative was "most selective survivor", which reads as
  // rigorous and is not: it treats a keyword that throws away 93% of the results
  // as better than one that throws away 31%, purely because it cut more.
  const chosen = scored.find((s) => s.qualified)
  return { baseline, scored, chosen: chosen ?? baseline }
}


// ---------------------------------------------------------------------------
// The whole proposal, in one call
// ---------------------------------------------------------------------------

export type ProposalSources = {
  clientProfileId: string
  targetRoles: string | null
  targetLocations: string | null
  preferredLocations: string | null
  profileText: string | null
  resumeText: string | null
  careerStage: string | null
  primaryOtherDescription: string | null
}

export type ProposedLane = {
  client_profile_id: string
  name: string
  active: boolean
  titles: string[]
  keyword: string | null
  location: { preset: string | null; radius_miles?: number }
  years_max: number | null
  companies: string[]
  exclusions: { companies?: string[]; title_keywords?: string[] }
}

export type ProposalResult = {
  proposal: ProposedLane
  /** Why each field came out the way it did, for a screen that has to justify itself. */
  evidence: {
    titlesFromRoles: number
    titlesOverCap: string[]
    sectors: Array<{ keyword: string; score: number }>
    keywordFromResume: string | null
    locationPresets: string[]
    locationUnsupported: string[]
    relocating: boolean
    yearsRule: string
  }
  /** Null when probe was not requested. */
  probe: null | {
    chosenKeyword: string | null
    keywordChanged: boolean
    candidates: Array<{ keyword: string | null; totalFetched: number; retention: number; zeroed: number; disqualifiedBecause: string | null }>
    titles: Probe[]
    droppedZero: string[]
  }
  flags: string[]
}

/**
 * Derive a lane from a profile, and — with probe: true — check it against the
 * board before returning it.
 *
 * The probe is what makes this worth showing a coach. Without it the proposal is
 * a plausible guess: a client's own words about their sector do not predict the
 * words employers put in postings, and a lane built on the difference finds
 * nothing while looking perfectly reasonable.
 */
export async function proposeLane(
  src: ProposalSources,
  opts: { probe: boolean } = { probe: true }
): Promise<ProposalResult> {
  const flags: string[] = []

  const locationText = [src.targetLocations, src.preferredLocations].filter(Boolean).join("; ")
  const sectorText = [src.targetRoles, src.primaryOtherDescription, src.profileText, src.resumeText]
    .filter(Boolean)
    .join("\n")

  const { titles, dropped } = deriveTitles(src.targetRoles)
  const sectors = scoreSectors(sectorText)
  const resumeKeyword = sectors.length && sectors[0].score >= KEYWORD_MIN_SCORE ? sectors[0].keyword : null
  const loc = deriveLocation(locationText, String(src.resumeText || ""))
  const years = deriveYearsMax(String(src.resumeText || ""), src.careerStage)
  const exclusions = deriveExclusions(src.careerStage, years.years_max)
  const scope = loc.preset ? loc.preset.toUpperCase() : "Anywhere"

  const proposal: ProposedLane = {
    client_profile_id: src.clientProfileId,
    name: `${titles.length ? titleCase(titles[0]) : "Untitled"} — ${scope}`,
    active: true,
    titles,
    keyword: resumeKeyword,
    // radius_miles is omitted when there is no preset: carrying a radius next to
    // a null preset invites someone to read it as a constraint that applies.
    location: loc.preset ? { preset: loc.preset, radius_miles: loc.radius_miles } : { preset: null },
    years_max: years.years_max,
    companies: [],
    exclusions,
  }

  if (dropped.length) flags.push(`${dropped.length} title(s) over the ${MAX_TITLES} cap were not proposed: ${dropped.join(", ")}`)
  if (loc.unsupported.length) {
    flags.push(
      `${loc.unsupported.join(", ")} ${loc.unsupported.length === 1 ? "is a market" : "are markets"} with no location preset. ` +
        (loc.preset
          ? `This lane searches ${loc.preset} only.`
          : `This lane searches nationwide, which is WIDER than asked for — expect results in states nobody named.`)
    )
  }
  if (!titles.length) flags.push("No usable titles came out of the client's target roles.")

  let probe: ProposalResult["probe"] = null

  if (opts.probe && titles.length) {
    // The resume nominates candidates; the board picks the winner.
    const scoring = await scoreKeywords(titles, sectors.map((s) => s.keyword), loc.preset, loc.radius_miles)
    proposal.keyword = scoring.chosen.keyword

    const cells = scoring.chosen.cells
    const kept = cells.filter((c) => c.available > 0).map((c) => c.title)
    const droppedZero = cells.filter((c) => c.available === 0).map((c) => c.title)
    proposal.titles = kept
    proposal.name = `${kept.length ? titleCase(kept[0]) : "Untitled"} — ${scope}`

    probe = {
      chosenKeyword: scoring.chosen.keyword,
      keywordChanged: scoring.chosen.keyword !== resumeKeyword,
      candidates: [scoring.baseline, ...scoring.scored].map((c) => ({
        keyword: c.keyword,
        totalFetched: c.totalFetched,
        retention: c.retention,
        zeroed: c.zeroed.length,
        disqualifiedBecause: c.disqualifiedBecause,
      })),
      titles: cells,
      droppedZero,
    }

    if (droppedZero.length) {
      flags.push(
        `Dropped ${droppedZero.length} title(s) that returned nothing: ${droppedZero.join(", ")}. ` +
          `Zero means the phrase is not how the board titles that work — not that the client cannot do it.`
      )
    }
    const capped = cells.filter((c) => c.capped)
    if (capped.length) {
      flags.push(`${capped.length} title(s) hit the one-page sample cap, so their counts are a floor, not a total.`)
    }
    if (probe.keywordChanged) {
      flags.push(
        resumeKeyword
          ? `Keyword changed from "${resumeKeyword}" (what the client's own words suggest) to ${scoring.chosen.keyword ? `"${scoring.chosen.keyword}"` : "none"} (what the board actually answers).`
          : `Keyword set to "${scoring.chosen.keyword}" from board evidence.`
      )
    }
    if (!proposal.titles.length) flags.push("Every title returned zero. There is no lane to save here yet.")
  }

  return {
    proposal,
    evidence: {
      titlesFromRoles: titles.length,
      titlesOverCap: dropped,
      sectors: sectors.slice(0, 4).map((s) => ({ keyword: s.keyword, score: s.score })),
      keywordFromResume: resumeKeyword,
      locationPresets: loc.named,
      locationUnsupported: loc.unsupported,
      relocating: loc.relocating,
      yearsRule: years.rule,
    },
    probe,
    flags,
  }
}
