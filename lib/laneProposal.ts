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
import { commitmentTypesFromJobType } from "./laneCommitment"
import { LEGACY_POSTING_WINDOW } from "./lanePostingWindow"

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

// Below this, the evidence is a passing mention rather than the client's field,
// and no amount of board checking can rescue it: a keyword is appended to EVERY
// title the lane queries, so a wrong one narrows the entire lane, not one query.
//
// This gates NOMINATION, not just the offline pick. The board can only choose
// among candidates it is given, so handing it weakly-evidenced sectors meant it
// dutifully picked the least-bad of them. Observed on real profiles: Zoe's top
// sector scored 1 and the rule still proposed "finance"; Josh's scored 6 and it
// proposed "healthcare" on evidence of 4.
//
// Set at 10 because that is where the data actually separates. A sector a client
// genuinely works in scores far higher than one merely mentioned:
//   Catherine  marketing 42, entertainment 10, finance 6
//   Aiden      baseball 18, sports 13, entertainment 7, marketing 1
//   Josh       entertainment 6, healthcare 4, finance 4
//   Zoe        healthcare 1, finance 1, marketing 1
// The gap between a field and a mention sits at 7-to-13 and 6-to-10.
export const MIN_SECTOR_EVIDENCE = 10

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

// A role name is short. Measured across every genuine title derived from the 93
// production profiles that state target roles: 97% are six words or fewer, and
// every single title above six words is a sentence fragment — "i want a job with
// the mlb", "put in my dues. my ultimate goal in 5-10 years is to grow in a front
// office role". The ceiling is where the data separates, not a guess.
const MAX_TITLE_WORDS = 6

/**
 * Some profiles store target_roles as a serialised list rather than free text.
 * Both shapes occur in production:
 *
 *   ["Energy Analyst", "Grid / Systems roles", "Project / Modeling roles"]
 *   {"marketing internships","creative design internships"}
 *
 * Split as prose, those leave quotes and brackets inside the titles, which then
 * go to the board verbatim — one lane was about to search for `"grid analyst"]`.
 */
function unwrapSerialisedList(raw: string): string {
  const s = raw.trim()
  if (!(s.startsWith("[") || s.startsWith("{"))) return raw
  try {
    const parsed = JSON.parse(s)
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed.join(", ")
  } catch {
    // Postgres array literals are not JSON. Fall through and strip instead.
  }
  return s
}

export function deriveTitles(targetRoles: string | null): {
  titles: string[]
  dropped: string[]
  discarded: string[]
} {
  const parts = unwrapSerialisedList(String(targetRoles || ""))
    // Brackets, braces, quotes and parentheses never belong inside a query. They
    // arrive from serialised lists that did not parse, and from asides like
    // "Real Estate (Development, Investment) Internships" — where dropping the
    // punctuation and keeping the words is what the client meant.
    .replace(/[\[\]{}"()]/g, " ")
    .split(TITLE_SPLIT)
    .map((s) =>
      s
        .toLowerCase()
        .replace(/[."]+$/g, "")
        // Stripping punctuation leaves gaps: "Real Estate (Development"
        // becomes "real estate  development" with two spaces, which is a
        // different query from the one anybody meant.
        .replace(/\s+/g, " ")
        .replace(/^(?:a|an|the|roles?\s+in|entry[- ]level)\s+/i, "")
        .trim()
    )
    .filter(Boolean)

  // Head-borrowing was tried here and REMOVED. The idea was that a coordinated
  // list shares one head noun — "trademark, copyright, IP, and data privacy
  // associate" being four roles — so bare entries borrowed the last entry's
  // final word. It fixed that profile and invented titles for 14 of the 93
  // production profiles: "analyst analyst" from "Associate, Analyst, Business
  // Analyst", "business fall" from "Business or Marketing Internships - Fall",
  // "marketing nightlife", "hrbp operations". The last word of the last entry is
  // as often a sector, a season or a repeat as it is a shared noun, and a
  // fabricated title is worse than a missing one: a coach can see that
  // "trademark" is absent, but has to already know the field to see that
  // "analyst management" was never asked for.
  //
  // What a bare entry does now is what it did before — get reported as
  // unusable, by name, in `discarded`.

  // A single word like "operations" is a sector, not a title; queried alone it
  // returns the whole board. Two words is the floor, six is the ceiling, and
  // what fails either is REPORTED rather than dropped on the floor, because a
  // title silently vanishing is indistinguishable from one never asked for.
  const ok = (t: string) => t.length > 2 && /\s/.test(t) && t.split(/\s+/).length <= MAX_TITLE_WORDS
  const usable = parts.filter(ok)
  const discarded = parts.filter((t) => !ok(t))

  const seen = new Set<string>()
  const unique = usable.filter((t) => (seen.has(t) ? false : (seen.add(t), true)))
  return { titles: unique.slice(0, MAX_TITLES), dropped: unique.slice(MAX_TITLES), discarded }
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
  columbus: ["columbus"],
  cleveland: ["cleveland"],
  cincinnati: ["cincinnati", "cincy"],
  indianapolis: ["indianapolis", "indy"],
  detroit: ["detroit", "metro detroit"],
  minneapolis: ["minneapolis", "twin cities", "st. paul", "saint paul"],
  st_louis: ["st. louis", "st louis", "saint louis", "stl"],
  kansas_city: ["kansas city", "kc metro"],
  milwaukee: ["milwaukee"],
  pittsburgh: ["pittsburgh"],
  charlotte: ["charlotte"],
  nashville: ["nashville", "middle tennessee"],
  austin: ["austin"],
  houston: ["houston"],
  san_diego: ["san diego"],
  // Resolves to Portland OR, the preset. A client meaning Portland ME gets the
  // wrong coast, which is why the alias list stops at the two unambiguous
  // spellings rather than reaching for "portland, maine" too.
  portland: ["portland", "pdx"],
  salt_lake_city: ["salt lake city", "salt lake", "slc"],
  // St. Petersburg is inside a 25-mile radius of Tampa, so the preset covers a
  // client who names it.
  tampa: ["tampa", "tampa bay", "st. petersburg", "saint petersburg"],
}

// Regions are genuinely several markets, so they only became representable when
// a lane stopped being one preset. Mapping "South Florida" to a single city was
// refused earlier for good reason — it silently dropped two thirds of what the
// client asked for. As a set it is simply true.
const REGION_ALIASES: Record<string, string[]> = {
  "south florida": ["miami", "fort_lauderdale", "west_palm_beach", "boca_raton"],
  "southeast florida": ["miami", "fort_lauderdale", "west_palm_beach", "boca_raton"],
  "tri-county": ["miami", "fort_lauderdale", "west_palm_beach"],
  "bay area": ["san_francisco"],
  "dmv": ["washington_dc"],
  "socal": ["los_angeles"],
}

// Cities clients name often. A superset of the searchable ones: an entry here
// that also has a PRESET_ALIASES alias is covered and drops out of
// `unsupported` below, and an entry that does not is reported by name rather
// than approximated with the nearest preset. Making one of the latter
// searchable means adding a payload sourced from /api/searchLocation to
// LOCATIONS, plus the alias — the preset alone leaves the city still listed
// here as uncovered.
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

  // EVERY market the client names, not the first. A client who says "Miami or
  // Chicago" means both, and the board ORs them in one search, so there is no
  // reason left to make them choose.
  const named: string[] = []
  const add = (p: string) => {
    if (presets.includes(p) && !named.includes(p)) named.push(p)
  }
  for (const [preset, aliases] of Object.entries(PRESET_ALIASES)) {
    if (aliases.some((a) => countTerm(locationText, a) > 0)) add(preset)
  }
  // Regions expand to their markets, after the explicit cities so a client who
  // names both keeps the city they actually said at the front of the list.
  for (const [region, expansion] of Object.entries(REGION_ALIASES)) {
    if (countTerm(locationText, region) > 0) expansion.forEach(add)
  }

  const unsupported = KNOWN_CITIES.filter(
    (c) =>
      countTerm(locationText, c) > 0 &&
      !Object.entries(PRESET_ALIASES).some(([p, aliases]) => named.includes(p) && aliases.includes(c)) &&
      !Object.entries(REGION_ALIASES).some(([r, exp]) => r === c && exp.some((p) => named.includes(p)))
  )

  const relocating = RELOCATION.test(locationText) || RELOCATION.test(resumeText)

  // A client who named no searchable market gets no geographic filter, which a
  // lane expresses as an empty list. This is a real answer for "Anywhere" and a
  // partial one for a client who named only markets we have no preset for — the
  // caller flags that second case, because nationwide is wider than what they
  // asked for, not narrower.

  // 50 miles for a client who will relocate or commute into a metro; 25 for one
  // anchored to a single named city. Irrelevant when the list is empty.
  const radius_miles = relocating || named.length !== 1 ? 50 : 25

  return { chosen: named, radius_miles, named, unsupported, relocating, presets }
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

// The EDUCATION section, when the resume has one. Years are read from the whole
// section rather than from lines that look like a degree, because matching a
// line is what got Alex Schwartz wrong: his date sits on the school line, which
// carries no degree word at all —
//
//   EDUCATION
//   Indiana University – Kelley School of Business | Bloomington, IN   May 2027
//   Bachelor of Science in Business, Major: Finance | Study Abroad: IES Abroad
//     Barcelona, Spain (Spring 2026)
//
// so the true year was dropped and the only line that did match handed over a
// STUDY ABROAD term. A May 2027 student came out "graduated 2026". Reading the
// section takes both years and lets the max settle it.
//
// Adding university/college to DEGREE_LINE would also have found his 2027, and
// is a trap: those words appear in work history — a peer tutor and a capstone
// on this very resume — and inferProfileGradYear (extract.ts) already excludes
// them for exactly that reason, having been bitten by "University of Florida,
// 2025" on a recruiter's client line.
//
// Falls back to the whole text when there is no EDUCATION header to find, and
// again when the section holds no year, so an unstructured resume is no worse
// off than before.
const EDU_HEADER =
  /^\s*(?:education(?:\s*(?:[&]|and)\s*(?:certifications?|training))?|academics?|academic background)\s*:?\s*$/i
const OTHER_HEADER =
  /^\s*(?:(?:professional|relevant|work|industry)?\s*experience|employment(?: history)?|internships?|career (?:history|experience)|academic projects?|projects?|leadership(?:\s*(?:[&]|and)\s*(?:activities|involvement))?|activities|involvement|extracurricular(?:\s*activities)?|volunteer(?:\s*(?:experience|work))?|community(?:\s*(?:service|involvement))?|affiliations?|certifications?|(?:technical\s*)?skills(?:\s*(?:[&]|and)\s*(?:tools|interests))?|tools(?:\s*(?:[&]|and)\s*systems)?|interests|awards(?:\s*(?:[&]|and)\s*honors)?|honors(?:\s*(?:[&]|and)\s*awards)?|hobbies|core competencies|summary|objective|profile|references|publications|coursework|training|additional(?:\s*information)?)\s*[:&]?\s*$/i

function extractEducationText(resumeText: string): string {
  if (!resumeText) return ""
  let inEducation = false
  const kept: string[] = []
  for (const raw of resumeText.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (EDU_HEADER.test(line)) {
      inEducation = true
      continue
    }
    if (OTHER_HEADER.test(line)) {
      inEducation = false
      continue
    }
    if (inEducation) kept.push(raw)
  }
  return kept.join("\n").trim()
}

const yearsIn = (text: string): number[] =>
  (text.match(/\b(?:19|20)\d{2}\b/g) || [])
    .map(Number)
    .filter((y) => y >= 1980 && y <= new Date().getFullYear() + 6)

// FALLBACK PATH ONLY, for a resume with no EDUCATION header. Which lines can
// carry a graduation year. A law student's JD line is the one that dates their
// clock, and its absence here let a 2024 bachelor's outrank a 2027 Juris
// Doctor — ageing a current student by three years.
//
// `associate` is a degree AND one of the commonest words in a student's work
// history, so it needs the degree context after it. Bare, it matched "Marketing
// Associate Intern, Acme Brands — May 2026 – August 2026" and read 2026 as a
// graduation, which is how a May 2027 student came out dated 2026. "Associate
// Producer", "Sales Associate" and "Associate Director" did the same.
// The bare initials are ambiguous too: "MS" is a master's and also Microsoft.
// "MS Excel, Tableau — certified 2025" on a skills line read 2025 as a
// graduation. Same denylist idea as `associate` needing its degree context.
const DEGREE_LINE =
  /\b(bachelor|b\.?s\.?|b\.?a\.?|master|m\.?s\.?(?!\s*(?:excel|word|office|outlook|powerpoint|project|teams|access|sql|visio|dynamics|sharepoint))|mba|juris|j\.?d\.?|ll\.?m\.?|ph\.?d\.?|doctorate)\b|\bassociate(?:['’]?s)?\s+(?:of|in|degree)\b/i

// The line that states the date is usually NOT the degree line — "Bachelor of
// Science in Marketing" and "Expected Graduation: May 2027" are two lines, and
// only the first carried a degree token. So the true year was dropped while a
// job line was kept, and nothing outranked the wrong one. Reading these as
// degree lines is the other half of that fix: with 2027 in the pool, the max
// below picks it even if a stray line still slips through.
//
// "graduation" counts when a date follows it — a colon, a dash, a month or a
// year. That is the shape every real dev resume uses, and they do NOT use the
// one an author guesses: two of sixteen write "Exp. Graduation May 2026", with
// no colon and no "expected", so a rule keyed on "expected graduation" or on
// punctuation misses both. What it still excludes is prose, where a word
// follows instead — "graduation ceremony volunteer, 2024".
//
// "expected" near a year counts too, with no "graduation" word anywhere. That
// is Jordan Bergman's resume on dev — "Bachelor of Arts in Economics" on one
// line, "Expected May 2026 | GPA: 3.6/4.0" on the next — which found no year at
// all and so got years_max null: a current student whose lane filtered nothing
// by stated minimum. Bounded to 20 characters so it reads a date rather than
// the next thing on the line, and it does accept "Expected start date June
// 2026", which on a resume is rare enough to be worth the student it rescues.
const MONTH = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec"
const GRAD_DATE_LINE = new RegExp(
  `\\bgraduation\\b\\s*(?:[:\\-–—]|(?:${MONTH})|(?:19|20)\\d{2})` +
    `|\\bexpected\\b[^\\n]{0,20}?\\b(?:19|20)\\d{2}\\b` +
    `|\\bclass\\s+of\\b|\\bgraduating\\b`,
  "i"
)

export function deriveYearsMax(resumeText: string, careerStage: string | null) {
  const text = String(resumeText || "")

  // The section first; the line scan only when it has nothing to say.
  const educationText = extractEducationText(text)
  let gradYears = educationText ? yearsIn(educationText) : []
  let source = "education section"
  if (!gradYears.length) {
    gradYears = yearsIn(
      text
        .split(/\r?\n/)
        .filter((line) => DEGREE_LINE.test(line) || GRAD_DATE_LINE.test(line))
        .join("\n")
    )
    source = "degree lines"
  }

  if (gradYears.length) {
    // Latest degree, not the first: the most recent graduation is the one that
    // dates the client's professional clock.
    const grad = Math.max(...gradYears)
    const since = Math.max(0, new Date().getFullYear() - grad)
    return {
      years_max: since + HEADROOM_YEARS,
      // The source is in the rule because this is the string a coach reads when
      // the number looks wrong, and "which lines did it even look at" is the
      // first question — the one that took four wrong fixes to ask about Alex.
      rule: `graduated ${grad} [${source}] → ${since}y since + ${HEADROOM_YEARS}y headroom`,
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
// The board's "3 weeks" token, not 29 days. See lib/lanePostingWindow.ts.
export const PROBE_DAYS = LEGACY_POSTING_WINDOW
const PROBE_SENIORITY = [...SENIORITY_LEVELS].slice(0, 3) // through Mid Level, as the runner does

export type Probe = { title: string; query: string; fetched: number; available: number; capped: boolean }

export async function probeTitles(
  titles: string[],
  keyword: string | null,
  presets: string[],
  radiusMiles: number,
  /**
   * The board filters the lane will carry. Passed through so the counts a coach
   * reviews are counts for the search the lane will ACTUALLY run — probing
   * unfiltered and then saving a filtered lane would put numbers on screen that
   * the lane can never reproduce.
   */
  filters: SearchFilters = {}
): Promise<Probe[]> {
  const out: Probe[] = []
  for (const title of titles) {
    const query = queryFor(title, keyword)
    const { rows, total } = await fetchJobs({
      query,
      locations: presets,
      radiusMiles,
      postedWithin: PROBE_DAYS,
      seniority: PROBE_SENIORITY,
      pages: 1,
      ...filters,
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
//
// Raised from 5 to 10 after the relative floor alone let a keyword through on a
// technicality: on a lane whose titles already contain "baseball", the keyword
// "baseball" is a measured no-op (100% retention) and is rightly rejected, which
// promoted "sports" — surviving on 5 postings. Five is not a queue; it is a
// rounding error that happens to clear a threshold. At 10 that candidate falls
// too and the lane gets no keyword, which is the correct answer when the titles
// already say the sector.
const MIN_SURVIVING_FETCHED = 10

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
  presets: string[],
  radiusMiles: number,
  filters: SearchFilters = {}
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

  const baselineCells = await probeTitles(titles, null, presets, radiusMiles, filters)
  const baseline = build(null, baselineCells, null)

  const scored: KeywordScore[] = []
  for (const k of candidates.slice(0, MAX_KEYWORD_CANDIDATES)) {
    scored.push(build(k, await probeTitles(titles, k, presets, radiusMiles, filters), baselineCells))
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
  /** The client's standing industry preference. Lanes inherit it at creation. */
  targetIndustries?: string[]
  excludedIndustries?: string[]
  /** client_profiles.job_type — translated, not passed through. */
  jobType?: string | null
}

/** camelCase, as searchState wants it. */
export type SearchFilters = {
  industries?: string[]
  excludedIndustries?: string[]
  companyKeywords?: string[]
  excludedCompanyKeywords?: string[]
  commitmentTypes?: string[]
}

export type ProposedLane = {
  client_profile_id: string
  name: string
  active: boolean
  titles: string[]
  keyword: string | null
  location: { presets: string[]; radius_miles?: number }
  years_max: number | null
  companies: string[]
  exclusions: { companies?: string[]; title_keywords?: string[] }
  /** Board-side filters, snake_case as the column stores them. */
  filters: {
    industries?: string[]
    excluded_industries?: string[]
    company_keywords?: string[]
    excluded_company_keywords?: string[]
    commitment_types?: string[]
  }
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

  const { titles, dropped, discarded } = deriveTitles(src.targetRoles)
  const sectors = scoreSectors(sectorText)
  // Only sectors with real evidence are eligible at all. Everything downstream —
  // the offline pick and the board's choice — draws from this list, so a client
  // with no clear field gets no keyword rather than the least-bad guess.
  const eligible = sectors.filter((x) => x.score >= MIN_SECTOR_EVIDENCE)
  const resumeKeyword = eligible.length ? eligible[0].keyword : null
  const loc = deriveLocation(locationText, String(src.resumeText || ""))
  const years = deriveYearsMax(String(src.resumeText || ""), src.careerStage)
  const exclusions = deriveExclusions(src.careerStage, years.years_max)
  // The name says where. One market names itself; several are summarised,
  // because "MIAMI + FORT_LAUDERDALE + WEST_PALM_BEACH + BOCA_RATON" is not a
  // name anybody wants on a tab.
  const commitments = commitmentTypesFromJobType(src.jobType)

  const scope =
    loc.chosen.length === 0
      ? "Anywhere"
      : loc.chosen.length === 1
        ? loc.chosen[0].toUpperCase()
        : `${loc.chosen.length} markets`

  const proposal: ProposedLane = {
    client_profile_id: src.clientProfileId,
    name: `${titles.length ? titleCase(titles[0]) : "Untitled"} — ${scope}`,
    active: true,
    titles,
    keyword: resumeKeyword,
    // radius_miles is omitted when there are no markets: carrying a radius next
    // to an empty list invites someone to read it as a constraint that applies.
    location: loc.chosen.length ? { presets: loc.chosen, radius_miles: loc.radius_miles } : { presets: [] },
    years_max: years.years_max,
    companies: [],
    exclusions,
    // Inherited from the profile. "Not education" is a fact about the client,
    // not about one search, so a lane starts where the profile already stands
    // and the coach edits from there.
    filters: {
      ...(src.targetIndustries?.length ? { industries: src.targetIndustries } : {}),
      ...(src.excludedIndustries?.length ? { excluded_industries: src.excludedIndustries } : {}),
      // A client who says Full-time should not be shown internships every
      // night. Translated from the profile's vocabulary to the board's.
      ...(commitments.length ? { commitment_types: commitments } : {}),
    },
  }

  if (dropped.length) flags.push(`${dropped.length} title(s) over the ${MAX_TITLES} cap were not proposed: ${dropped.join(", ")}`)
  if (discarded.length) {
    flags.push(
      `Could not turn ${discarded.length} entr${discarded.length === 1 ? "y" : "ies"} from the target roles into a title: ` +
        `${discarded.join(", ")}. A single word is a sector, not a role, and searching one returns the whole board.`
    )
  }
  if (loc.unsupported.length) {
    flags.push(
      `${loc.unsupported.join(", ")} ${loc.unsupported.length === 1 ? "is a market" : "are markets"} with no location preset. ` +
        (loc.chosen.length
          ? `This lane searches ${loc.chosen.join(", ")}.`
          : `This lane searches nationwide, which is WIDER than asked for — expect results in states nobody named.`)
    )
  }
  if (!titles.length) flags.push("No usable titles came out of the client's target roles.")
  if (commitments.length) {
    flags.push(
      `Commitment inherited from the profile's job type (${src.jobType}): ${commitments.join(", ")}. ` +
        `Postings of other kinds — internships, seasonal work — will not reach the queue.`
    )
  } else if (src.jobType) {
    flags.push(
      `Job type "${src.jobType}" set no commitment filter, so every kind of posting reaches the queue — ` +
        `internships and seasonal work included.`
    )
  }
  if (src.excludedIndustries?.length || src.targetIndustries?.length) {
    flags.push(
      `Inherited from the profile: ` +
        [
          src.targetIndustries?.length ? `only ${src.targetIndustries.join(", ")}` : "",
          src.excludedIndustries?.length ? `never ${src.excludedIndustries.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; ") +
        `. Every count below already has these applied.`
    )
  }
  if (!eligible.length) {
    const top = sectors[0]
    flags.push(
      top
        ? `No keyword proposed: the strongest sector in this profile is "${top.keyword}" at ${top.score}, below the ${MIN_SECTOR_EVIDENCE} needed to call it the client's field. The lane searches titles alone — wider, and honest about it.`
        : `No keyword proposed: nothing in this profile names a sector. The lane searches titles alone.`
    )
  }

  let probe: ProposalResult["probe"] = null

  if (opts.probe && titles.length) {
    // The resume nominates candidates; the board picks the winner.
    const scoring = await scoreKeywords(titles, eligible.map((s) => s.keyword), loc.chosen, loc.radius_miles, {
      industries: src.targetIndustries,
      excludedIndustries: src.excludedIndustries,
      commitmentTypes: commitments,
    })
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
