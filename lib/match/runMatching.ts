/**
 * Phase 3 matching run for one client: rules on every live posting, Haiku on
 * the ones that pass and have a description, results in posting_matches.
 *
 * INCREMENTAL. A posting is evaluated when it has no match row for this client,
 * or its description changed (description_md5), or what the client's matching
 * reads changed (criteria_hash: the criteria row, the profile fields the judge
 * reads, and the judge prompt). A row the coach already acted on is never
 * re-evaluated: the decision stands.
 *
 * A POSTING WAITING FOR ENRICHMENT IS SKIPPED, not matched half-read: its years,
 * salary and graduation window are what the rules check, and enriching it later
 * does not change description_md5, so it would never be re-matched. It is
 * picked up by the first run after it is enriched.
 *
 * THE QUEUE IS RANKED, NOT FILTERED (decided 2026-10-25): client_match_queue
 * shows every posting that passes the rules, best score first. A posting with
 * no description passes unjudged and sorts last (SmartRecruiters today).
 *
 * Writes posting_matches and one match_runs row. Never touches postings.
 */

import { createHash } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { postingText } from "../ingest/enrichPostings"
import type { MatchCriteria, Market } from "./criteria"
import { applyRules, parseLocations, RULES_VERSION, type MatchPosting } from "./rules"
import { judge, JUDGE_PROMPT_SHA256, type JudgeUsage, type PastDecision } from "./judge"

/** Postings not seen on their source for longer than this are out of the queue, and not evaluated. */
export const LIVE_DAYS = 14
const EXAMPLES = 10

const PROFILE_COLS = "id, grad_date, education_status, timeline, resume_text, profile_text, coach_notes_avoid, coach_notes_concerns"

/** client_match_criteria row + client_profiles row -> what rules and judge read. */
export function criteriaFromRow(row: any, profile: any): MatchCriteria {
  const notes = [profile.coach_notes_avoid && `Avoid: ${profile.coach_notes_avoid}`, profile.coach_notes_concerns && `Concerns: ${profile.coach_notes_concerns}`, row.notes]
    .filter(Boolean).join("\n") || null
  return {
    clientProfileId: row.client_profile_id,
    markets: (row.markets ?? []) as Market[],
    radiusMiles: row.radius_miles ?? null,
    remoteOk: row.remote_ok,
    maxYearsRequired: row.max_years_required ?? null,
    jobTypes: row.job_types ?? [],
    gradDate: profile.grad_date ?? null,
    educationStatus: profile.education_status ?? null,
    timeline: profile.timeline ?? null,
    availableFrom: row.available_from ?? null,
    salaryFloor: row.salary_floor !== null && row.salary_floor !== undefined ? { amount: Number(row.salary_floor), period: row.salary_floor_period } : null,
    excludedTitleKeywords: row.excluded_title_keywords ?? [],
    excludedEmployers: row.excluded_employers ?? [],
    targetRoles: row.target_roles ?? [],
    targetIndustries: row.target_industries ?? [],
    excludedIndustries: row.excluded_industries ?? [],
    notes,
    background: [profile.resume_text, profile.profile_text].map((t: string | null) => (t ?? "").trim()).find((t: string) => t.length > 200) ?? null,
  }
}

export const criteriaHash = (c: MatchCriteria) =>
  createHash("sha256").update(JSON.stringify(c) + "|" + JUDGE_PROMPT_SHA256 + "|" + RULES_VERSION).digest("hex")

/** A postings row (enriched or not) in the matcher's shape. `text` is filled in later for the ones judged. */
export function fromPosting(p: any, text = ""): MatchPosting {
  const loc = String(p.location ?? "")
  return {
    title: p.cleaned_title ?? p.title,
    company: p.company,
    locations: parseLocations(loc),
    remote: /\bremote\b/i.test(loc) ? true : null,
    yearsMin: p.years_min ?? null,
    yearsMax: p.years_max ?? null,
    yearsBasis: p.years_basis ?? null,
    employmentTypes: p.employment_types ?? null,
    salaryLow: p.salary_low !== null && p.salary_low !== undefined ? Number(p.salary_low) : null,
    salaryHigh: p.salary_high !== null && p.salary_high !== undefined ? Number(p.salary_high) : null,
    salaryPeriod: p.salary_period ?? null,
    graduationFrom: p.graduation_from ?? null,
    graduationTo: p.graduation_to ?? null,
    level: p.level ?? null,
    startType: p.start_type ?? null,
    startDate: p.start_date ?? null,
    startSeason: p.start_season ?? null,
    startYear: p.start_year ?? null,
    campus: p.campus_signal ?? null,
    text: text || p.requirements_summary || "",
  }
}

async function pageAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? [])); if (!data || data.length < 1000) break
  }
  return out
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { for (;;) { const i = next++; if (i >= items.length) return; await fn(items[i]) } }))
}

export type MatchSummary = {
  runId: string | null
  scanned: number
  /** Live postings with a description not yet enriched: skipped this run. */
  awaitingEnrichment: number
  evaluated: number
  ruleFailed: number
  judged: number
  unjudgedNoDescription: number
  judgeErrors: number
  newlyQueued: number
  costUsd: number
  apiCalls: number
}

export async function runMatching(
  sb: SupabaseClient,
  opts: { clientProfileId: string; effort?: "low" | "medium"; dryRun?: boolean; triggeredBy?: string; limit?: number },
): Promise<MatchSummary> {
  const effort = opts.effort ?? "low"
  const { data: row, error: cErr } = await sb.from("client_match_criteria").select("*").eq("client_profile_id", opts.clientProfileId).single()
  if (cErr || !row) throw new Error(`no client_match_criteria for ${opts.clientProfileId}: ${cErr?.message ?? "missing"}`)
  if (!row.active) throw new Error("criteria inactive")
  const { data: profile, error: pErr } = await sb.from("client_profiles").select(PROFILE_COLS).eq("id", opts.clientProfileId).single()
  if (pErr || !profile) throw new Error(`client_profiles: ${pErr?.message}`)
  const criteria = criteriaFromRow(row, profile)
  const hash = criteriaHash(criteria)

  const since = new Date(Date.now() - LIVE_DAYS * 86400e3).toISOString()
  const postings = await pageAll<any>((a, b) => sb.from("postings_canonical")
    .select("id, source, title, cleaned_title, company, location, years_min, years_max, years_basis, salary_low, salary_high, salary_period, graduation_from, graduation_to, level, requirements_summary, description_md5, enriched_at, employment_types, start_type, start_date, start_season, start_year, campus_signal")
    .gte("last_seen_at", since).order("id").range(a, b))
  const existing = new Map((await pageAll<any>((a, b) => sb.from("posting_matches")
    .select("posting_id, criteria_hash, description_md5, action").eq("client_profile_id", opts.clientProfileId).order("posting_id").range(a, b)))
    .map((m) => [m.posting_id, m]))

  const awaitingEnrichment = postings.filter((p) => p.description_md5 && !p.enriched_at).length
  let work = postings.filter((p) => {
    if (p.description_md5 && !p.enriched_at) return false
    const m = existing.get(p.id)
    return !m || (!m.action && (m.criteria_hash !== hash || m.description_md5 !== p.description_md5))
  })
  if (opts.limit) work = work.slice(0, opts.limit)

  // The coach's latest decisions for this client: matches and their lanes' results.
  const lanes = await pageAll<any>((a, b) => sb.from("search_lanes").select("id").eq("client_profile_id", opts.clientProfileId).range(a, b))
  const pastLane = lanes.length ? await pageAll<any>((a, b) => sb.from("lane_results").select("title, company, action, reason, note, actioned_at")
    .in("lane_id", lanes.map((l) => l.id)).in("action", ["push", "dismiss"]).range(a, b)) : []
  const pastMatch = await pageAll<any>((a, b) => sb.from("posting_matches").select("action, dismiss_reason, note, actioned_at, postings(title, company)")
    .eq("client_profile_id", opts.clientProfileId).in("action", ["push", "dismiss"]).range(a, b))
  const examples: PastDecision[] = [
    ...pastLane.map((d) => ({ title: d.title, company: d.company, action: d.action, reason: d.reason, note: d.note, at: d.actioned_at })),
    ...pastMatch.map((d) => ({ title: d.postings?.title, company: d.postings?.company, action: d.action, reason: d.dismiss_reason, note: d.note, at: d.actioned_at })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, EXAMPLES).map(({ at: _at, ...d }) => d as PastDecision)

  let runId: string | null = null
  const startedAt = new Date().toISOString()
  if (!opts.dryRun) {
    const { data, error } = await sb.from("match_runs").insert({
      triggered_by: opts.triggeredBy ?? "manual", client_profile_id: opts.clientProfileId,
      model: "claude-haiku-5-5", effort, prompt_sha256: JUDGE_PROMPT_SHA256,
    }).select("id").single()
    if (error) throw new Error("match_runs insert failed: " + error.message)
    runId = data.id
  }

  const base = (p: any) => ({
    client_profile_id: opts.clientProfileId, posting_id: p.id, criteria_hash: hash, description_md5: p.description_md5,
    match_run_id: runId, prompt_sha256: JUDGE_PROMPT_SHA256,
  })
  const upsert = async (rows: any[]) => {
    if (opts.dryRun || !rows.length) return
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("posting_matches").upsert(rows.slice(i, i + 500), { onConflict: "client_profile_id,posting_id" })
      if (error) throw new Error("posting_matches upsert failed: " + error.message)
    }
  }
  const cleared = { score: null, judge_reason: null, judge_evidence: null, judge_error: null, judged_at: null }

  const evaluated = work.map((p) => ({ p, fails: applyRules(criteria, fromPosting(p)) }))
  const failed = evaluated.filter((e) => e.fails.length)
  const noText = evaluated.filter((e) => !e.fails.length && !e.p.description_md5)
  const toJudge = evaluated.filter((e) => !e.fails.length && e.p.description_md5)

  const usage: JudgeUsage[] = []
  let judgeErrors = 0
  try {
    await upsert([
      ...failed.map((e) => ({ ...base(e.p), ...cleared, rule_failures: e.fails })),
      ...noText.map((e) => ({ ...base(e.p), ...cleared, rule_failures: [] })),
    ])

    // Descriptions only for the postings being judged: raw is the heavy column.
    const raws = new Map<string, any>()
    for (let i = 0; i < toJudge.length; i += 100) {
      const { data, error } = await sb.from("postings").select("id, source, raw").in("id", toJudge.slice(i, i + 100).map((e) => e.p.id))
      if (error) throw new Error(error.message)
      for (const r of data ?? []) raws.set(r.id, r)
    }
    const judgedRows: any[] = []
    await pool(toJudge, 5, async (e) => {
      const r = raws.get(e.p.id)
      try {
        const { judgment, usage: u } = await judge(criteria, fromPosting(e.p, postingText(r?.source ?? e.p.source, r?.raw)), { effort, examples })
        usage.push(u)
        judgedRows.push({ ...base(e.p), rule_failures: [], score: judgment.score, judge_reason: judgment.reason, judge_evidence: judgment.evidence || null, judge_error: null, judged_at: new Date().toISOString() })
      } catch (err: any) {
        judgeErrors++
        // Shown unjudged rather than hidden: a failed judgment must not drop a posting.
        judgedRows.push({ ...base(e.p), ...cleared, rule_failures: [], judge_error: String(err?.message ?? err).slice(0, 500) })
      }
      if (judgedRows.length >= 100) await upsert(judgedRows.splice(0))
    })
    await upsert(judgedRows)
  } catch (e: any) {
    if (runId) await sb.from("match_runs").update({ status: "error", error: String(e?.message ?? e).slice(0, 2000), finished_at: new Date().toISOString() }).eq("id", runId)
    throw e
  }

  let newlyQueued = 0
  if (!opts.dryRun) {
    const { count } = await sb.from("posting_matches").select("id", { count: "exact", head: true })
      .eq("client_profile_id", opts.clientProfileId).gte("first_queued_at", startedAt)
    newlyQueued = count ?? 0
  }
  const sum = (k: keyof JudgeUsage) => usage.reduce((n, u) => n + Number(u[k]), 0)
  const summary: MatchSummary = {
    runId, scanned: postings.length, awaitingEnrichment, evaluated: work.length, ruleFailed: failed.length, judged: usage.length,
    unjudgedNoDescription: noText.length, judgeErrors, newlyQueued, costUsd: sum("costUsd"), apiCalls: usage.length + judgeErrors,
  }
  if (runId) {
    const { error } = await sb.from("match_runs").update({
      status: "ok", finished_at: new Date().toISOString(),
      postings_scanned: summary.scanned, evaluated: summary.evaluated, rule_failed: summary.ruleFailed, judged: summary.judged,
      unjudged_no_description: summary.unjudgedNoDescription, judge_errors: judgeErrors, newly_queued: newlyQueued, api_calls: summary.apiCalls,
      input_tokens: sum("inputTokens"), cache_read_tokens: sum("cacheReadTokens"), cache_write_tokens: sum("cacheWriteTokens"),
      output_tokens: sum("outputTokens"), cost_usd: Number(summary.costUsd.toFixed(6)),
    }).eq("id", runId)
    if (error) throw new Error("match_runs update failed: " + error.message)
  }
  return summary
}
