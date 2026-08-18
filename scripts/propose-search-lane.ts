#!/usr/bin/env tsx
/**
 * Propose a search lane from a client profile.
 *
 * Usage:
 *   npx tsx scripts/propose-search-lane.ts --profile <uuid>
 *   npx tsx scripts/propose-search-lane.ts --profile aiden      # name/email substring
 *   npx tsx scripts/propose-search-lane.ts --profile <uuid> --json
 *   npx tsx scripts/propose-search-lane.ts --profile <uuid> --dry-run
 *
 * --dry-run queries the board once per proposed title before anything is
 * saved, drops the titles that return nothing, flags the ones truncated by the
 * page cap, and outputs the pruned config. It still writes nothing.
 *
 * Reads only. This script never writes to search_lanes — the output is a
 * proposal for a human to edit and insert. That is deliberate and not just
 * caution: three of the five fields below are inferred from free text a client
 * typed into an intake form, and the failure mode of a wrong lane is silent
 * (a lane with the wrong keyword returns plausible jobs from the wrong
 * industry, and nobody can tell from the results that the config was wrong).
 *
 * Hits whatever SUPABASE_URL points to in .env.local.
 *
 * What it reads, and what each field is derived from:
 *
 *   titles     ← client_profiles.target_roles, split on separators
 *   keyword    ← the sector with the most word-boundary evidence across the
 *                profile's targeting text and resume
 *   location   ← client_profiles.target_locations, matched against the
 *                fetcher's LOCATIONS preset table
 *   years_max  ← graduation year if the resume states one, else the
 *                candidate_targeting career_stage, plus headroom
 *   exclusions ← seniority words above the candidate's stage
 *   companies  ← always [], because no profile field carries an employer
 *                allowlist and inventing one would silently shrink the search
 *
 * Every field prints the evidence that produced it. A proposal you cannot
 * argue with is a proposal you cannot correct.
 */

import { createClient } from "@supabase/supabase-js"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { LOCATIONS, SENIORITY_LEVELS, fetchJobs, queryFor } from "../lib/hiringcafe"

function loadEnvLocal() {
  for (const name of [".env.local", ".env.development.local"]) {
    const path = join(process.cwd(), name)
    if (!existsSync(path)) continue
    try {
      // @ts-ignore - Node 20.6+
      if (typeof process.loadEnvFile === "function") {
        // @ts-ignore
        process.loadEnvFile(path)
        return
      }
    } catch {}
  }
}
loadEnvLocal()

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local)")
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY)

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
const SECTOR_TERMS: Array<{ keyword: string; terms: string[] }> = [
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

function countTerm(haystack: string, term: string): number {
  const re = new RegExp(`\\b${escape(term)}\\b`, "gi")
  return (haystack.match(re) || []).length
}

function scoreSectors(text: string) {
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
const KEYWORD_MIN_SCORE = 3

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
const MAX_TITLES = 8

function deriveTitles(targetRoles: string | null): { titles: string[]; dropped: string[] } {
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
const PRESET_ALIASES: Record<string, string[]> = {
  nyc: ["nyc", "new york", "new york city", "manhattan", "brooklyn", "ny metro", "tri-state"],
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

function deriveLocation(locationText: string, resumeText: string) {
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
const HEADROOM_YEARS = 3

const STAGE_YEARS_MAX: Record<string, number | null> = {
  student: 3,
  early_career: 5,
  mid_career: 10,
  executive: null, // no ceiling — a stated minimum is never the reason to skip
}

const DEGREE_LINE = /\b(bachelor|b\.?s\.?|b\.?a\.?|master|m\.?s\.?|mba|associate)\b/i

function deriveYearsMax(resumeText: string, careerStage: string | null) {
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

function deriveExclusions(careerStage: string | null, yearsMax: number | null) {
  const junior = careerStage === "student" || careerStage === "early_career" || (yearsMax != null && yearsMax <= 5)
  return junior ? { title_keywords: [...JUNIOR_STAGE_EXCLUSIONS] } : {}
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase())

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
const PROBE_DAYS = 29
const PROBE_SENIORITY = [...SENIORITY_LEVELS].slice(0, 3) // through Mid Level, as the runner does

type Probe = { title: string; query: string; fetched: number; available: number; capped: boolean }

async function probeTitles(
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
const MAX_KEYWORD_CANDIDATES = 3

// Above this share of the baseline surviving, the keyword is not narrowing
// anything and only adds a word to every query (cf. "baseball operations
// baseball" → 26 of 26).
const NO_OP_RETENTION = 0.9

// A keyword that leaves fewer than this many postings across ALL titles has
// not narrowed the lane, it has closed it.
const MIN_SURVIVING_FETCHED = 5

// Killing outright more than this share of the titles that DO return something
// disqualifies a keyword, however good its ratio looks on the survivors.
const MAX_ZERO_FRACTION = 0.5

type KeywordScore = {
  keyword: string | null
  cells: Probe[]
  totalFetched: number
  retention: number
  zeroed: string[]
  liveTitles: number
  qualified: boolean
  disqualifiedBecause: string | null
}

async function scoreKeywords(
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

  // Most selective keyword that is still alive. Ties keep candidate order,
  // which is resume-evidence order, so the client's own sector breaks a tie.
  const qualified = scored.filter((s) => s.qualified).sort((a, b) => a.retention - b.retention)
  return { baseline, scored, chosen: qualified[0] ?? baseline }
}

// ---------------------------------------------------------------------------

async function findProfile(needle: string) {
  const cols =
    "id, name, email, job_type, target_roles, target_locations, preferred_locations, timeline, profile_text, resume_text"

  if (UUID.test(needle)) {
    const { data, error } = await sb.from("client_profiles").select(cols).eq("id", needle).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error(`no client_profile with id ${needle}`)
    return data as any
  }

  const { data, error } = await sb
    .from("client_profiles")
    .select(cols)
    .or(`name.ilike.%${needle}%,email.ilike.%${needle}%`)
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error(`no client_profile matching "${needle}"`)
  if (data.length > 1) {
    // Never guess. This app has many near-duplicate test accounts and
    // proposing a lane against the wrong one wastes the review, not just the run.
    const lines = (data as any[]).map(
      (p) => `  ${p.id}  ${p.name ?? "(no name)"}  ${p.email ?? ""}  roles: ${p.target_roles ?? "—"}`
    )
    throw new Error(`"${needle}" matches ${data.length} profiles — re-run with --profile <uuid>:\n${lines.join("\n")}`)
  }
  return data[0] as any
}

async function main() {
  const needle = arg("profile")
  if (!needle) {
    console.error("usage: propose-search-lane.ts --profile <uuid|name|email> [--json]")
    process.exit(1)
  }

  const p = await findProfile(needle)

  const { data: targeting } = await sb
    .from("candidate_targeting")
    .select("career_stage, career_stage_locked_by, primary_lane, primary_other_description")
    .eq("profile_id", p.id)
    .maybeSingle()

  const { data: existing } = await sb
    .from("search_lanes")
    .select("id, name, active, titles, keyword, location, years_max")
    .eq("client_profile_id", p.id)

  const locationText = [p.target_locations, p.preferred_locations].filter(Boolean).join("; ")
  const sectorText = [p.target_roles, targeting?.primary_other_description, p.profile_text, p.resume_text]
    .filter(Boolean)
    .join("\n")

  const { titles, dropped } = deriveTitles(p.target_roles)
  const sectors = scoreSectors(sectorText)
  const keyword = sectors.length && sectors[0].score >= KEYWORD_MIN_SCORE ? sectors[0].keyword : null
  const loc = deriveLocation(locationText, String(p.resume_text || ""))
  const years = deriveYearsMax(String(p.resume_text || ""), targeting?.career_stage ?? null)
  const exclusions = deriveExclusions(targeting?.career_stage ?? null, years.years_max)

  const scope = loc.preset ? loc.preset.toUpperCase() : "Anywhere"
  const proposal = {
    client_profile_id: p.id,
    name: `${titles.length ? titleCase(titles[0]) : "Untitled"} — ${scope}`,
    active: true,
    titles,
    keyword,
    // radius_miles is omitted when there is no preset: carrying a radius next
    // to a null preset invites someone to read it as a constraint that applies.
    location: loc.preset ? { preset: loc.preset, radius_miles: loc.radius_miles } : { preset: null },
    years_max: years.years_max,
    companies: [] as string[],
    exclusions,
  }

  // --- probe (--dry-run) ----------------------------------------------------
  // Runs before --json returns, so the emitted config is the pruned one. A
  // --dry-run that printed the unpruned config would be worse than no probe:
  // the counts would say one thing and the JSON someone pipes to an insert
  // would say another.
  const dryRun = process.argv.includes("--dry-run")
  let probes: Probe[] = []
  let scoring: Awaited<ReturnType<typeof scoreKeywords>> | null = null
  if (dryRun && titles.length) {
    // The resume-scored sectors become the candidate shortlist; the board
    // decides which one the lane actually gets.
    scoring = await scoreKeywords(titles, sectors.map((s) => s.keyword), loc.preset, loc.radius_miles)
    proposal.keyword = scoring.chosen.keyword
    probes = scoring.chosen.cells

    const kept = probes.filter((pr) => pr.available > 0).map((pr) => pr.title)
    proposal.titles = kept
    // The name is derived from the first title, so pruning can invalidate it.
    proposal.name = `${kept.length ? titleCase(kept[0]) : "Untitled"} — ${scope}`
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(proposal, null, 2))
    return
  }

  // --- report ---------------------------------------------------------------
  const flags: string[] = []

  console.log(`profile:  ${p.name ?? "(no name)"}  <${p.email ?? "no email"}>`)
  console.log(`          ${p.id}`)
  console.log(`  target_roles:      ${p.target_roles ?? "(none)"}`)
  console.log(`  target_locations:  ${p.target_locations ?? "(none)"}`)
  console.log(`  preferred_locations: ${p.preferred_locations ?? "(none)"}`)
  console.log(
    `  career_stage:      ${targeting?.career_stage ?? "(no candidate_targeting row)"}` +
      (targeting?.career_stage_locked_by ? ` (${targeting.career_stage_locked_by})` : "")
  )
  console.log(`  existing lanes:    ${existing?.length ? existing.map((l: any) => l.name).join(", ") : "(none)"}`)
  console.log()

  console.log(dryRun ? "PROPOSED LANE (as derived, before the probe)" : "PROPOSED LANE")
  console.log(`  name:       ${proposal.name}`)
  console.log(`  titles:     ${titles.length ? titles.join(" | ") : "(none — target_roles produced nothing usable)"}`)
  console.log(`  keyword:    ${keyword ?? "(none)"}`)
  console.log(`  location:   ${loc.preset ? `${loc.preset} ${loc.radius_miles}mi` : "(no filter — nationwide)"}`)
  console.log(`  years_max:  ${years.years_max ?? "none"}`)
  console.log(`  companies:  (no restriction)`)
  console.log(`  exclusions: ${JSON.stringify(exclusions)}`)
  console.log()

  console.log("WHY")
  console.log(`  titles      ${titles.length} of ${titles.length + dropped.length} from target_roles`)
  if (dropped.length) flags.push(`${dropped.length} title(s) over the ${MAX_TITLES} cap not proposed: ${dropped.join(", ")}`)

  if (sectors.length) {
    const top = sectors[0]
    const evidence = Object.entries(top.hits)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t, n]) => `${t}×${n}`)
      .join(", ")
    console.log(`  keyword     "${top.keyword}" scored ${top.score} — ${evidence}`)
    const runnersUp = sectors.slice(1, 4).map((s) => `${s.keyword} (${s.score})`)
    if (runnersUp.length) console.log(`              runners-up: ${runnersUp.join(", ")}`)
    if (!keyword) flags.push(`keyword left null — best sector "${top.keyword}" scored ${top.score}, under the ${KEYWORD_MIN_SCORE} floor`)
  } else {
    console.log(`  keyword     no sector terms matched`)
    flags.push("keyword left null — no sector terms matched the profile at all")
  }

  console.log(
    `  location    ${loc.named.length ? `matched preset(s) ${loc.named.join(", ")}, radius ${loc.radius_miles}mi` : "no preset named in target_locations → no geographic filter"}` +
      ` (${loc.relocating ? "relocation-open" : "anchored"})`
  )
  if (loc.unsupported.length) {
    flags.push(
      `client named ${loc.unsupported.length} market(s) with no preset — ${loc.unsupported.join(", ")}. ` +
        `A lane can only search presets in LOCATIONS (${loc.presets.join(", ")}); each of those needs a full ` +
        `Google Places payload added.` +
        (loc.preset
          ? ""
          : ` Until then this lane searches nationwide, which is WIDER than what the client asked for — ` +
            `expect results in states they never named.`)
    )
  }

  console.log(`  years_max   ${years.rule}`)
  console.log(`  exclusions  ${Object.keys(exclusions).length ? "junior stage → drop titles above it" : "no stage-based exclusions"}`)
  console.log()

  if (dryRun && scoring) {
    const cols = [scoring.baseline, ...scoring.scored]
    const w = Math.max(22, ...titles.map((t) => t.length + 2))
    const head = (s: KeywordScore) => (s.keyword === null ? "alone" : `+${s.keyword}`)

    console.log(
      `KEYWORD SCORING  (fetched counts, ${loc.preset ? `${loc.preset} ${loc.radius_miles}mi` : "no location"}, ` +
        `posted ≤ ${PROBE_DAYS}d, 1 page — the board decides, the resume only nominated)`
    )
    console.log("  " + "title".padEnd(w) + cols.map((c) => head(c).padStart(15)).join(""))
    for (const t of titles) {
      const row = cols.map((c) => {
        const cell = c.cells.find((x) => x.title === t)!
        return `${cell.fetched}${cell.capped ? "⚠" : ""}`.padStart(15)
      })
      console.log("  " + t.padEnd(w) + row.join(""))
    }
    console.log("  " + "─".repeat(w + 15 * cols.length))
    console.log("  " + "total fetched".padEnd(w) + cols.map((c) => String(c.totalFetched).padStart(15)).join(""))
    console.log(
      "  " + "kept vs alone".padEnd(w) + cols.map((c) => `${(c.retention * 100).toFixed(0)}%`.padStart(15)).join("")
    )
    console.log(
      "  " +
        "titles zeroed".padEnd(w) +
        cols.map((c) => (c.keyword === null ? "—" : `${c.zeroed.length}/${c.liveTitles}`).padStart(15)).join("")
    )
    console.log(
      "  " +
        "verdict".padEnd(w) +
        cols
          .map((c) =>
            (c === scoring!.chosen ? "CHOSEN" : c.keyword === null ? "baseline" : c.qualified ? "ok" : "✗").padStart(15)
          )
          .join("")
    )
    for (const c of scoring.scored) {
      if (c.disqualifiedBecause) console.log(`    ✗ ${c.keyword}: ${c.disqualifiedBecause}`)
    }
    if (scoring.chosen.keyword === null) {
      const nominated = scoring.scored.map((s) => s.keyword).join(", ")
      console.log(
        `    → no keyword: ${nominated ? `none of [${nominated}] narrowed without emptying the lane` : "no candidates nominated"}`
      )
      if (scoring.scored.length) {
        flags.push(
          `keyword dropped to null — the resume nominated ${scoring.scored
            .map((s) => `"${s.keyword}"`)
            .join(", ")} and the board rejected all of them. Without a keyword this lane is broader than the ` +
            `client's sector; expect wrong-industry results in the review queue.`
        )
      }
    } else if (scoring.chosen.keyword !== keyword) {
      flags.push(
        `keyword changed from "${keyword}" (resume evidence) to "${scoring.chosen.keyword}" (board evidence). ` +
          `The resume-scored pick kept ${(
            (scoring.scored.find((s) => s.keyword === keyword)?.retention ?? 1) * 100
          ).toFixed(0)}% of baseline.`
      )
    }
    console.log()

    console.log(
      `PROBE  (${loc.preset ? `${loc.preset} ${loc.radius_miles}mi` : "no location"}, posted ≤ ${PROBE_DAYS}d, ` +
        `through Mid Level, 1 page — raw board counts, lane filters not applied)`
    )
    for (const pr of probes) {
      const verdict = pr.available === 0 ? "DROP" : pr.capped ? "keep⚠" : "keep"
      console.log(
        `  ${verdict.padEnd(6)} "${pr.query}"`.padEnd(52) +
          `${pr.fetched} fetched of ${pr.available} available` +
          (pr.capped ? `  ⚠ page cap — the real total is ${pr.available}` : "")
      )
    }

    const zeros = probes.filter((pr) => pr.available === 0)
    const capped = probes.filter((pr) => pr.capped)
    console.log(
      `\n  ${proposal.titles.length} of ${probes.length} titles kept` +
        (zeros.length ? `, ${zeros.length} dropped for returning nothing` : "")
    )
    if (zeros.length) {
      flags.push(
        `dropped ${zeros.length} title(s) that returned zero: ${zeros.map((z) => `"${z.title}"`).join(", ")}. ` +
          `Zero here means the PHRASE does not exist on the board, which is not the same as the client being ` +
          `unemployable in that role — check whether the keyword is what killed it before rewording.`
      )
    }
    if (capped.length) {
      flags.push(
        `${capped.length} title(s) hit the one-page cap: ${capped
          .map((c) => `"${c.title}" (${c.fetched} of ${c.available})`)
          .join(", ")}. The lane will under-collect on these until it runs with --pages.`
      )
    }
    if (!proposal.titles.length) {
      flags.push(`EVERY title returned zero — there is no lane to save here, only a targeting conversation to have.`)
    }
    console.log()
  }

  // Overlap with what the client already has. A second lane that queries the
  // same titles does not find more jobs, it splits one review queue in two.
  for (const l of existing || []) {
    const overlap = (l.titles as string[]).filter((t) => titles.includes(String(t).toLowerCase()))
    if (overlap.length) flags.push(`overlaps existing lane "${l.name}" on ${overlap.length} title(s): ${overlap.join(", ")}`)
  }

  if (flags.length) {
    console.log("REVIEW BEFORE SAVING")
    for (const f of flags) console.log(`  ⚠ ${f}`)
    console.log()
  }

  console.log("row (nothing was written):")
  console.log(JSON.stringify(proposal, null, 2))
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
