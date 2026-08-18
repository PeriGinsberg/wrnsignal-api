// lib/laneRunner.ts
//
// Running one search lane: fan out to hiring.cafe, one query per lane title,
// filter, and upsert into lane_results.
//
// Extracted from scripts/run-search-lane.ts when the nightly cron needed the
// same behaviour. The CLI and the cron must agree exactly — a lane that behaves
// one way when a person runs it and another way at 02:00 is untestable — so the
// logic lives here and both callers are thin.
//
// Dedup: (lane_id, job_id) is unique, so re-running is idempotent. A job the
// lane already knows about gets its mutable fields refreshed and last_seen_at
// advanced; first_seen_at is left alone, because "when did this lane first
// surface this job" is the whole point of keeping history. That is why the
// upsert cannot be a blind whole-row overwrite.
//
// The same job legitimately arrives from more than one title in a single run
// (a posting matches both "sports coordinator" and "partnership coordinator").
// We fold in memory before touching the database, because sending both to one
// upsert call would have them collide on the unique constraint inside a single
// statement — Postgres rejects that outright ("cannot affect row a second
// time"), rather than picking a winner.

import { type SupabaseClient } from "@supabase/supabase-js"
import { fetchJobs, queryFor, SENIORITY_LEVELS, type JobRow } from "./hiringcafe"

export type Lane = {
  id: string
  client_profile_id: string
  name: string
  active: boolean
  titles: string[]
  keyword: string | null
  // presets: [] means no geographic filter (nationwide). Absent is NOT the same
  // thing — see resolvePresets(). `preset` is the pre-2026-08-18 single-market
  // shape, still read so old rows keep working.
  location: { presets?: string[]; preset?: string | null; radius_miles?: number; days_posted?: number }
  years_max: number | null
  companies: string[]
  exclusions: { companies?: string[]; title_keywords?: string[] }
}

export type TitleOutcome = {
  title: string
  query: string
  fetched: number
  available: number
  capped: boolean
  kept: number
  fresh: number
  dropped: Record<string, number>
}

export type LaneRunResult = {
  laneId: string
  perTitle: TitleOutcome[]
  unique: number
  added: number
  refreshed: number
  written: number
}

const norm = (s: string) => String(s || "").trim().toLowerCase()

/**
 * Coerce to a whole number for the integer columns, preserving null.
 *
 * hiring.cafe annualizes hourly postings by multiplying out, so yearly
 * compensation arrives fractional ("58219.2" from $27.99/hr). Postgres rejects
 * that outright for an integer column and the whole upsert fails, taking every
 * other row in the batch with it. Rounding here rather than widening the column
 * to numeric: the figure is already a derived approximation, so sub-dollar
 * precision on an annual salary is false precision, and integer columns keep
 * range filters and sorts simple.
 */
const int = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Math.round(Number(v))

/**
 * The lane's markets, as three distinct states rather than two.
 *
 *   {"presets": ["nyc", "miami"]}  → those markets, ORed by the board
 *   {"presets": []}                → no geographic filter; runs nationwide
 *   {}                             → rejected
 *
 * The third case is the one worth spelling out. `location` defaults to '{}' at
 * the column level, so a lane inserted without one lands here, and both of the
 * other answers are wrong for it: defaulting to a market silently narrows a lane
 * nobody scoped, and defaulting to nationwide silently widens it. Neither
 * failure shows up in the results — you get plausible jobs either way — so the
 * lane has to say which it meant.
 *
 * The single-market `preset` shape predates 2026-08-18 and is normalised here
 * rather than migrated away in the readers, so exactly one place knows both
 * shapes exist.
 */
export function resolvePresets(l: Lane): string[] {
  const loc = l.location || {}
  if (Array.isArray(loc.presets)) return loc.presets
  if ("preset" in loc) return loc.preset == null ? [] : [loc.preset]
  throw new Error(
    `lane "${l.name}" has no location.presets. Set {"presets": ["nyc"], "radius_miles": 25} ` +
      `for a metro search, or {"presets": []} for no geographic filter.`
  )
}

/**
 * Lane-level filters, applied after the fetch rather than pushed into
 * searchState. Two reasons: the board's own company filter is dropped from
 * searchState on some code paths, and doing it here means the rule that
 * rejected a job is inspectable in one place instead of split across a
 * remote query and local code.
 */
export function applyLaneFilters(rows: JobRow[], lane: Lane): { kept: JobRow[]; dropped: Record<string, number> } {
  const dropped: Record<string, number> = {}
  const drop = (reason: string) => {
    dropped[reason] = (dropped[reason] || 0) + 1
    return false
  }

  const allow = (lane.companies || []).map(norm)
  const exCompanies = (lane.exclusions?.companies || []).map(norm)
  const exKeywords = (lane.exclusions?.title_keywords || []).map(norm)

  const kept = rows.filter((r) => {
    const company = norm(r.company || "")
    const title = norm(r.title || "")

    // Empty allowlist means "no restriction", never "match nothing".
    if (allow.length && !allow.some((a) => company.includes(a))) return drop("not in companies allowlist")
    if (exCompanies.some((e) => company.includes(e))) return drop("excluded company")
    if (exKeywords.some((k) => title.includes(k))) return drop("excluded title keyword")

    // years_max only bites when the posting actually stated a minimum.
    // min_yoe null means "never said" — dropping those would throw away most
    // of the board on a strict lane.
    if (lane.years_max != null && r.min_yoe != null && r.min_yoe > lane.years_max) {
      return drop(`min_yoe > ${lane.years_max}`)
    }
    if (r.is_expired) return drop("expired")
    return true
  })

  return { kept, dropped }
}

export function toRow(lane: Lane, r: JobRow, matchedTitle: string) {
  return {
    lane_id: lane.id,
    job_id: r.id,
    matched_title: matchedTitle,
    title: r.title,
    normalized_title: r.normalized_title,
    company: r.company,
    company_website: r.company_website,
    company_size: int(r.company_size),
    company_industries: r.company_industries,
    apply_url: r.apply_url,
    source: r.source,
    location: r.location,
    workplace_type: r.workplace_type,
    cities: r.cities,
    states: r.states,
    geo: r.geo,
    seniority: r.seniority,
    role_type: r.role_type,
    commitment: r.commitment,
    category: r.category,
    min_yoe: int(r.min_yoe),
    min_mgmt_yoe: int(r.min_mgmt_yoe),
    bachelors: r.bachelors,
    bachelors_fields: r.bachelors_fields,
    tools: r.tools,
    certifications: r.certifications,
    requirements_summary: r.requirements_summary,
    salary_min: int(r.salary_min),
    salary_max: int(r.salary_max),
    salary_currency: r.salary_currency,
    salary_frequency: r.salary_frequency,
    salary_transparent: r.salary_transparent,
    posted_at: r.posted_at,
    visa_sponsorship: r.visa_sponsorship,
    security_clearance: r.security_clearance,
    is_expired: r.is_expired,
    last_seen_at: new Date().toISOString(),
  }
}

/** Through Mid Level, the band a lane searches. */
export const LANE_SENIORITY = [...SENIORITY_LEVELS].slice(0, 3)

/**
 * Run one lane end to end.
 *
 * `dryRun` fetches and filters without writing, which is what the CLI's
 * --dry-run and an unsaved proposal both need.
 */
export async function runLane(
  lane: Lane,
  supabase: SupabaseClient,
  opts: {
    days?: number
    pages?: number
    dryRun?: boolean
    /** Called after each title, so a CLI can print progress as it happens. */
    onTitle?: (o: TitleOutcome) => void
  } = {}
): Promise<LaneRunResult> {
  const presets = resolvePresets(lane)
  const radius = lane.location?.radius_miles ?? 25
  const days = opts.days ?? lane.location?.days_posted ?? 29
  const pages = opts.pages ?? 1

  // job_id -> row. First title to surface a job wins matched_title; that is
  // the fold that keeps the upsert from self-colliding (see header).
  const byJobId = new Map<string, ReturnType<typeof toRow>>()
  const perTitle: TitleOutcome[] = []

  for (const title of lane.titles) {
    const query = queryFor(title, lane.keyword)
    const { rows, total } = await fetchJobs({
      query,
      locations: presets,
      radiusMiles: radius,
      days,
      seniority: LANE_SENIORITY,
      pages,
    })
    const { kept, dropped } = applyLaneFilters(rows, lane)

    let fresh = 0
    for (const r of kept) {
      if (byJobId.has(r.id)) continue
      byJobId.set(r.id, toRow(lane, r, title))
      fresh++
    }

    // `available` is the board's whole match count; `fetched` is what one page
    // actually returned. Reporting only the former next to the pass count reads
    // as "the difference was dropped", which is a lie when the difference is
    // simply un-fetched.
    const outcome: TitleOutcome = {
      title,
      query,
      fetched: rows.length,
      available: total,
      capped: total > rows.length,
      kept: kept.length,
      fresh,
      dropped,
    }
    perTitle.push(outcome)
    opts.onTitle?.(outcome)
  }

  const rows = [...byJobId.values()]
  if (opts.dryRun) {
    return { laneId: lane.id, perTitle, unique: rows.length, added: 0, refreshed: 0, written: 0 }
  }
  if (!rows.length) {
    return { laneId: lane.id, perTitle, unique: 0, added: 0, refreshed: 0, written: 0 }
  }

  // Which ones does the lane already know about? Needed only for the summary —
  // the upsert itself is safe either way.
  const { data: existing } = await supabase
    .from("lane_results")
    .select("job_id")
    .eq("lane_id", lane.id)
    .in("job_id", rows.map((r) => r.job_id))
  const known = new Set((existing || []).map((e: any) => e.job_id))

  // ignoreDuplicates:false = update on conflict. first_seen_at is absent from
  // the payload, so the existing value survives; last_seen_at is present, so
  // it advances.
  const { data: written, error } = await supabase
    .from("lane_results")
    .upsert(rows, { onConflict: "lane_id,job_id", ignoreDuplicates: false })
    .select("job_id")
  if (error) throw new Error(`upsert failed: ${error.message}`)

  return {
    laneId: lane.id,
    perTitle,
    unique: rows.length,
    added: rows.length - known.size,
    refreshed: known.size,
    written: written?.length ?? 0,
  }
}

/**
 * Run a lane and record the attempt, whichever way it goes.
 *
 * Every caller that runs a lane must also log it — the cron, the create call,
 * the CLI, and now the Run now button — and a caller that forgets leaves a lane
 * that appears never to have run. Sharing it is what stops the fourth copy
 * drifting from the first.
 *
 * Never throws: a run that fails is a logged fact, not an exception for the
 * caller to re-handle. The cron does NOT use this, deliberately — it writes its
 * row before running so a function killed mid-lane still leaves a visible
 * failure, which is a different guarantee than this one.
 */
export async function runLaneLogged(
  lane: Lane,
  supabase: SupabaseClient,
  trigger: "cron" | "manual"
): Promise<
  | { ok: true; result: LaneRunResult; found: number }
  | { ok: false; error: string }
> {
  const startedAt = Date.now()
  try {
    const result = await runLane(lane, supabase)
    const found = result.perTitle.reduce((n, t) => n + t.kept, 0)
    await supabase.from("lane_runs").insert({
      lane_id: lane.id,
      status: "ok",
      trigger,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      titles_run: result.perTitle.length,
      jobs_found: found,
      jobs_added: result.added,
      detail: result.perTitle,
    })
    return { ok: true, result, found }
  } catch (err: any) {
    const error = err?.message || String(err)
    await supabase.from("lane_runs").insert({
      lane_id: lane.id,
      status: "error",
      trigger,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      error: String(error).slice(0, 1000),
    })
    return { ok: false, error }
  }
}
