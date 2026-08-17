#!/usr/bin/env tsx
/**
 * Run one search lane: fan out to hiring.cafe, one query per lane title, then
 * upsert the results into lane_results.
 *
 * Usage:
 *   npx tsx scripts/run-search-lane.ts --lane <uuid>
 *   npx tsx scripts/run-search-lane.ts --lane <uuid> --dry-run   # fetch + filter, no writes
 *   npx tsx scripts/run-search-lane.ts --list                    # lanes with counts
 *   npx tsx scripts/run-search-lane.ts --lane <uuid> --days 14
 *
 * Hits whatever SUPABASE_URL points to in .env.local.
 *
 * Dedup: (lane_id, job_id) is unique, so re-running is idempotent. A job the
 * lane already knows about gets its mutable fields refreshed and last_seen_at
 * advanced; first_seen_at is left alone, because "when did this lane first
 * surface this job" is the whole point of keeping history. That is why the
 * upsert cannot be a blind whole-row overwrite.
 *
 * The same job legitimately arrives from more than one title in a single run
 * (a posting matches both "sports coordinator" and "partnership coordinator").
 * We fold in memory before touching the database, because sending both to one
 * upsert call would have them collide on the unique constraint inside a single
 * statement — Postgres rejects that outright ("cannot affect row a second
 * time"), rather than picking a winner.
 */

import { createClient } from "@supabase/supabase-js"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fetchJobs, SENIORITY_LEVELS, type JobRow } from "./fetch-hiringcafe"

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

type Lane = {
  id: string
  client_profile_id: string
  name: string
  active: boolean
  titles: string[]
  location: { preset?: string; radius_miles?: number; days_posted?: number }
  years_max: number | null
  companies: string[]
  exclusions: { companies?: string[]; title_keywords?: string[] }
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
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
 * Lane-level filters, applied after the fetch rather than pushed into
 * searchState. Two reasons: the board's own company filter is dropped from
 * searchState on some code paths, and doing it here means the rule that
 * rejected a job is inspectable in one place instead of split across a
 * remote query and local code.
 */
function applyLaneFilters(rows: JobRow[], lane: Lane): { kept: JobRow[]; dropped: Record<string, number> } {
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

function toRow(lane: Lane, r: JobRow, matchedTitle: string) {
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

async function listLanes() {
  const { data, error } = await sb
    .from("search_lanes")
    .select("id, name, active, titles, location, years_max, client_profile_id")
    .order("created_at")
  if (error) throw new Error(error.message)
  if (!data?.length) return console.log("no lanes")
  for (const l of data) {
    const { count } = await sb
      .from("lane_results")
      .select("*", { count: "exact", head: true })
      .eq("lane_id", l.id)
    console.log(
      `${l.id}  ${l.active ? "active " : "paused "} ${String(l.name).padEnd(28)} ` +
        `${(l.titles as string[]).length} titles  ${count ?? 0} results`
    )
  }
}

async function runLane(laneId: string, opts: { dryRun: boolean; days: number; pages: number }) {
  const { data: lane, error } = await sb.from("search_lanes").select("*").eq("id", laneId).single()
  if (error) throw new Error(`lane ${laneId}: ${error.message}`)
  const l = lane as Lane

  if (!l.active) console.log(`(lane is paused — running anyway because it was named explicitly)\n`)

  const preset = l.location?.preset || "nyc"
  const radius = l.location?.radius_miles ?? 25
  const days = opts.days ?? l.location?.days_posted ?? 29
  const seniority = [...SENIORITY_LEVELS].slice(0, 3) // through Mid Level

  console.log(`lane: ${l.name}  (${l.id})`)
  console.log(`  titles:     ${l.titles.join(" | ")}`)
  console.log(`  location:   ${preset} ${radius}mi, posted ≤ ${days}d`)
  console.log(`  years_max:  ${l.years_max ?? "none"}`)
  console.log(`  companies:  ${l.companies?.length ? l.companies.join(", ") : "(no restriction)"}`)
  console.log(`  exclusions: ${JSON.stringify(l.exclusions || {})}`)
  console.log()

  // job_id -> row. First title to surface a job wins matched_title; that is
  // the fold that keeps the upsert from self-colliding (see header).
  const byJobId = new Map<string, ReturnType<typeof toRow>>()
  const perTitle: Array<{ title: string; total: number; kept: number; dropped: Record<string, number> }> = []

  for (const title of l.titles) {
    const { rows, total } = await fetchJobs({
      query: title,
      location: preset,
      radiusMiles: radius,
      days,
      seniority,
      pages: opts.pages,
    })
    const { kept, dropped } = applyLaneFilters(rows, l)
    perTitle.push({ title, total, kept: kept.length, dropped })

    let fresh = 0
    for (const r of kept) {
      if (byJobId.has(r.id)) continue
      byJobId.set(r.id, toRow(l, r, title))
      fresh++
    }
    const dropStr = Object.entries(dropped).map(([k, v]) => `${v} ${k}`).join(", ")
    // `total` is the board's whole match count; rows.length is what one page
    // actually returned. Printing only `total` next to the pass count reads as
    // "the difference was dropped", which is a lie when the difference is
    // simply un-fetched. A cap that isn't stated reads as full coverage.
    const capped = total > rows.length
    console.log(
      `  "${title}" → ${rows.length} fetched of ${total} available, ` +
        `${kept.length} pass filters, ${fresh} new to this run` +
        (dropStr ? `  [dropped: ${dropStr}]` : "") +
        (capped ? `  ⚠ capped at ${opts.pages} page(s) — pass --pages to go deeper` : "")
    )
  }

  const rows = [...byJobId.values()]
  console.log(`\n${rows.length} unique jobs after folding titles`)

  if (opts.dryRun) {
    console.log("(--dry-run: nothing written)\n")
    printTable(rows)
    return
  }

  // Which ones does the lane already know about? Needed only for the summary
  // line — the upsert itself is safe either way.
  const { data: existing } = await sb
    .from("lane_results")
    .select("job_id")
    .eq("lane_id", l.id)
    .in("job_id", rows.map((r) => r.job_id))
  const known = new Set((existing || []).map((e: any) => e.job_id))

  // ignoreDuplicates:false = update on conflict. first_seen_at is absent from
  // the payload, so the existing value survives; last_seen_at is present, so
  // it advances.
  const { error: upErr, data: written } = await sb
    .from("lane_results")
    .upsert(rows, { onConflict: "lane_id,job_id", ignoreDuplicates: false })
    .select("job_id, first_seen_at, last_seen_at")
  if (upErr) throw new Error(`upsert failed: ${upErr.message}`)

  const added = rows.length - known.size
  console.log(`upserted ${written?.length ?? 0}: ${added} new, ${known.size} refreshed\n`)
  printTable(rows)
}

function printTable(rows: Array<ReturnType<typeof toRow>>) {
  const money = (r: any) =>
    r.salary_min && r.salary_max ? `$${Math.round(r.salary_min / 1000)}-${Math.round(r.salary_max / 1000)}k` : "—"
  for (const r of rows.sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at)))) {
    console.log(
      `  ${String(r.posted_at).slice(0, 10)}  ${String(r.seniority ?? "?").padEnd(12)} ` +
        `${String(money(r)).padEnd(11)} ${String(r.company ?? "?").slice(0, 26).padEnd(26)} ${r.title}`
    )
  }
}

async function main() {
  if (process.argv.includes("--list")) return listLanes()

  const laneId = arg("lane")
  if (!laneId) {
    console.error("usage: run-search-lane.ts --lane <uuid> [--dry-run] [--days N] [--pages N]\n       run-search-lane.ts --list")
    process.exit(1)
  }
  await runLane(laneId, {
    dryRun: process.argv.includes("--dry-run"),
    days: Number(arg("days", "29")),
    pages: Number(arg("pages", "1")),
  })
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
