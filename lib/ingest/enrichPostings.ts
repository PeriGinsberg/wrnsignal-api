/**
 * The enrichment writer (v2): take the postings whose description has not been
 * read, extract with lib/ingest/enrich.ts (Haiku), write the fields.
 *
 * THE WORKLIST IS postings_enrichment_due (20261029_postings_enrichment_v2.sql):
 * description_md5 differs from enrichment_description_md5. That one comparison
 * covers never attempted, and description changed since the last attempt. A
 * failure on an unchanged description is NOT re-served: retrying it is a
 * deliberate act, not something every run repeats forever while the remaining
 * count never moves.
 *
 * EVERY POSTING THIS WRITER TOUCHES LEAVES IN A TERMINAL STATE, and records the
 * description it read (enrichment_description_md5):
 *   - extracted            -> enriched_at set, fields written
 *   - too short to read    -> only enrichment_description_md5 (not a failure:
 *                             there was nothing to extract, and the row comes
 *                             back by itself if a longer description arrives)
 *   - extractor gave up    -> enrichment_failed_at + reason
 *   - a rule was broken    -> enrichment_failed_at + reason (see toPatch)
 *   - write rejected       -> enrichment_failed_at + reason
 *
 * IT NEVER SENDS first_seen_at OR last_seen_at. postings_touch_last_seen pins
 * last_seen_at on any write that changes enriched_at, enrichment_failed_at or
 * enrichment_description_md5, which every write here does.
 *
 * function and industry are DISPLAY ONLY (decided 2026-10-25). A value that
 * cannot be stored is stored as not stated instead, never failing the posting
 * and losing its years, salary and dates: no quote, not in the list this code
 * knows, or rejected by the database's own list (which can lag the code's, as
 * dev's did on "Trading"). Each one is "demoted": recorded on the row in
 * enrichment_evidence.demoted, counted on the run, and logged.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { FUNCTION_VALUES, INDUSTRY_VALUES } from "./extractPosting"
import {
  DEFAULT_ENRICH_MODEL, ENRICH_PROMPT_SHA256, EnrichFailed, enrichPosting,
  type EnrichFields, type EnrichModel, type EnrichUsage,
} from "./enrich"

/** Greenhouse stores the description as HTML in raw.content. */
export function descriptionOf(raw: any): string {
  let s = String(raw?.content ?? "")
  if (!s) return ""
  s = s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'").replace(/&#x2F;/g, "/").replace(/&#xa;/gi, "\n")
  s = s
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|h[1-6]|tr)\s*>/gi, "\n\n")
    .replace(/<\s*li[^>]*>/gi, "\n  - ")
    .replace(/<\s*\/\s*li\s*>/gi, "")
    .replace(/<\s*\/?\s*(ul|ol)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
  return s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l) => l.trimEnd()).join("\n").trim()
}

/**
 * The text the extractor reads. Google Jobs rows (serpapi, searchapi) keep plain
 * text in raw.description, already stripped by their adapters; Greenhouse keeps
 * HTML in raw.content. These are the same two keys description_md5 hashes.
 */
export function postingText(source: string, raw: any): string {
  const d = typeof raw?.description === "string" ? raw.description.trim() : ""
  return d || descriptionOf(raw)
}

/** Google's original title for Google Jobs rows; the stored title otherwise. */
const titleFor = (p: Candidate) => (p.source === "serpapi" || p.source === "searchapi") && p.raw?.title ? String(p.raw.title) : p.title

/**
 * The database rejected a function or industry value its own list does not
 * have: store that field as not stated instead, and record why. null when the
 * error is anything else.
 */
export function demoteRejected(patch: Record<string, unknown>, dbError: string): { patch: Record<string, unknown>; demotion: Demotion } | null {
  const m = dbError.match(/postings_(function|industry)_known/)
  if (!m) return null
  const field = m[1] as Demotion["field"]
  const demotion: Demotion = { field, value: String(patch[field] ?? ""), why: "rejected_by_database" }
  const ev = { ...(patch.enrichment_evidence as Record<string, unknown>) }
  ev.demoted = [...((ev.demoted as Demotion[]) ?? []), demotion]
  return {
    demotion,
    patch: {
      ...patch,
      [field]: null,
      [field + "_evidence"]: null,
      enrichment_not_stated: [...(patch.enrichment_not_stated as string[]), field],
      enrichment_evidence: ev,
    },
  }
}

/** Shorter than this, a description cannot state anything worth a call. */
export const MIN_DESCRIPTION = 200

const YM = /^[0-9]{4}(-(0[1-9]|1[0-2]))?$/
const YMD = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

/** A rule the database would reject, or an answer that contradicts itself. */
export class EnrichViolation extends Error {
  constructor(message: string) { super(message); this.name = "EnrichViolation" }
}

/**
 * Extractor output -> postings columns. Pure; no clock, no ids. Throws
 * EnrichViolation for an answer that cannot be stored honestly.
 *
 * enrichment_not_stated names a field GROUP (see the migration header): years,
 * salary, salary_currency, graduation, application_deadline,
 * requirements_summary, tools, level, function, industry.
 */
export type Demotion = { field: "function" | "industry"; value: string; why: "no_quote" | "not_in_list" | "rejected_by_database" }

export function toPatch(f: EnrichFields, title: string): { patch: Record<string, unknown>; demoted: Demotion[] } {
  const notStated: string[] = []
  const demoted: Demotion[] = []
  const val = <T>(v: T | "not_stated"): T | null => (v === "not_stated" ? null : v)

  // years
  const yMin = val(f.years_min), yMax = val(f.years_max)
  let basis: string | null = null
  if (yMin === null && yMax === null) notStated.push("years")
  else {
    if (f.years_basis === "not_stated") throw new EnrichViolation("years figure returned with years_basis not_stated")
    if (yMin !== null && yMax !== null && yMax < yMin) throw new EnrichViolation(`years_max ${yMax} below years_min ${yMin}`)
    basis = f.years_basis
  }

  // salary: each end only as stated. "From $90,000" is low only and "up to
  // $120,000" high only; the missing end stays NULL, never copied across.
  const lo = val(f.salary_low), hi = val(f.salary_high)
  const anyPay = lo !== null || hi !== null
  if (!anyPay) notStated.push("salary")
  else if (lo !== null && hi !== null && hi < lo) throw new EnrichViolation(`salary_high ${hi} below salary_low ${lo}`)
  const period = !anyPay || f.salary_period === "not_stated" ? null : f.salary_period
  if (f.salary_currency === null) notStated.push("salary_currency")

  // graduation: the quote is the value; from/to only for an absolute window.
  const gradText = f.graduation_evidence.trim() || null
  if (!gradText && (f.graduation_from || f.graduation_to)) throw new EnrichViolation("graduation dates returned with no quote")
  for (const g of [f.graduation_from, f.graduation_to]) if (g && !YM.test(g)) throw new EnrichViolation(`graduation date "${g}" is not YYYY or YYYY-MM`)
  if (!gradText) notStated.push("graduation")

  // deadline: the quote is the value; the date only when it is a full, real date.
  const deadlineText = f.deadline_evidence.trim() || null
  if (!deadlineText && f.application_deadline) throw new EnrichViolation("application_deadline returned with no quote")
  const d = f.application_deadline
  // Round trip, so "2026-02-30" (which Date would roll to March 2) is rejected.
  const deadline = d && YMD.test(d) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d ? d : null
  if (!deadlineText) notStated.push("application_deadline")

  if (f.requirements_summary === null) notStated.push("requirements_summary")
  const tools = f.tools === "not_stated" ? null : f.tools
  if (tools === null) notStated.push("tools")
  if (f.level === null) notStated.push("level")

  // Display-only enums: a value that cannot be stored becomes not stated.
  const enumField = (v: string, evidence: string, field: Demotion["field"], allowed: readonly string[]): [string | null, string | null] => {
    if (v === "not_stated") { notStated.push(field); return [null, null] }
    const why = !allowed.includes(v) ? "not_in_list" : !evidence.trim() ? "no_quote" : null
    if (why) { notStated.push(field); demoted.push({ field, value: v, why }); return [null, null] }
    return [v, evidence]
  }
  const [fn, fnEv] = enumField(f.function, f.function_evidence, "function", FUNCTION_VALUES)
  const [ind, indEv] = enumField(f.industry, f.industry_evidence, "industry", INDUSTRY_VALUES)

  const evidence: Record<string, unknown> = {}
  for (const [k, v] of [["years", f.years_evidence], ["salary", f.salary_evidence], ["tools", f.tools_evidence], ["level", f.level_evidence]] as const) {
    if (v.trim()) evidence[k] = v.trim()
  }
  if (demoted.length) evidence.demoted = demoted

  return {
    demoted,
    patch: {
      cleaned_title: f.cleaned_title.trim() || title,
      years_min: yMin, years_max: yMax, years_basis: basis,
      salary_low: lo, salary_high: hi, salary_period: period, salary_currency: f.salary_currency,
      graduation_text: gradText, graduation_from: gradText ? f.graduation_from : null, graduation_to: gradText ? f.graduation_to : null,
      deadline_text: deadlineText, application_deadline: deadline,
      requirements_summary: f.requirements_summary,
      tools,
      level: f.level,
      function: fn, function_evidence: fnEv,
      industry: ind, industry_evidence: indEv,
      enrichment_evidence: evidence,
      enrichment_not_stated: notStated,
      enrichment_failed_at: null,
      enrichment_error: null,
    },
  }
}

type Candidate = {
  id: string
  source: string
  title: string
  company: string
  location: string | null
  raw: any
  description_md5: string
  reason: "new" | "changed"
}

export type EnrichRow = {
  id: string
  source: string
  company: string
  title: string
  reason: "new" | "changed"
  status: "enriched" | "skipped_short" | "failed"
  demoted: Demotion[]
  attempts: number
  error: string | null
  usage: EnrichUsage | null
}

export type EnrichSummary = {
  runId: string | null
  attempted: number
  succeeded: number
  skippedShort: number
  failed: number
  demoted: number
  apiCalls: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  costUsd: number
  rows: EnrichRow[]
}

export type WorklistCounts = {
  /** Due now: never attempted, or description changed since the last attempt. */
  due: number
  dueNew: number
  dueChanged: number
  enriched: number
  /** Last attempt failed on the description still stored. Not due until it changes. */
  failed: number
  /** Read, too short to extract from. Not due until it changes. */
  skippedShort: number
  /** Nothing stored to read (description_md5 NULL). */
  noDescription: number
  total: number
}

export async function countWorklist(sb: SupabaseClient): Promise<WorklistCounts> {
  const head = async (q: any) => {
    const { count, error } = await q
    if (error) throw new Error("count query failed: " + error.message)
    return count ?? 0
  }
  const p = () => sb.from("postings").select("id", { count: "exact", head: true })
  const due = () => sb.from("postings_enrichment_due").select("id", { count: "exact", head: true })
  return {
    due: await head(due()),
    dueNew: await head(due().eq("reason", "new")),
    dueChanged: await head(due().eq("reason", "changed")),
    enriched: await head(p().not("enriched_at", "is", null)),
    failed: await head(p().not("enrichment_failed_at", "is", null)),
    skippedShort: await head(p().is("enriched_at", null).is("enrichment_failed_at", null).not("enrichment_description_md5", "is", null)),
    noDescription: await head(p().is("description_md5", null)),
    total: await head(p()),
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; res[i] = await fn(items[i]) }
  }))
  return res
}

export async function runEnrichment(
  sb: SupabaseClient,
  opts: {
    limit?: number
    concurrency?: number
    dryRun?: boolean
    model?: EnrichModel
    triggeredBy?: string
    /** Only these sources. */
    sources?: string[]
    /** Only these posting ids (still only if due, unless retryFailed). */
    ids?: string[]
    /**
     * Take postings whose last attempt FAILED on the description still stored,
     * instead of the due worklist. Retrying a failure is a deliberate act (a
     * fixed prompt, constraint or outage), never something every run repeats.
     */
    retryFailed?: boolean
  } = {},
): Promise<EnrichSummary> {
  const limit = opts.limit ?? 500
  const concurrency = opts.concurrency ?? 5
  const dryRun = opts.dryRun ?? false
  const model = opts.model ?? DEFAULT_ENRICH_MODEL
  const effort = "medium" as const

  // Collect first, write after: rows leave the view as they are written, so
  // paging the view while writing would skip rows.
  const candidates: Candidate[] = []
  const PAGE = 200
  for (let from = 0; candidates.length < limit; from += PAGE) {
    let q = opts.retryFailed
      ? sb.from("postings")
          .select("id, source, title, company, location, raw, description_md5")
          .not("enrichment_failed_at", "is", null)
          .not("description_md5", "is", null)
      : sb.from("postings_enrichment_due")
          .select("id, source, title, company, location, raw, description_md5, reason")
      .order("first_seen_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (opts.sources?.length) q = q.in("source", opts.sources)
    if (opts.ids?.length) q = q.in("id", opts.ids)
    const { data, error } = await q
    if (error) throw new Error("worklist query failed: " + error.message)
    const page = ((data ?? []) as any[]).map((r) => ({ ...r, reason: r.reason ?? "changed" })) as Candidate[]
    candidates.push(...page.slice(0, limit - candidates.length))
    if (!data || data.length < PAGE) break
  }

  let runId: string | null = null
  if (!dryRun) {
    const { data, error } = await sb.from("enrichment_runs")
      .insert({ triggered_by: opts.triggeredBy ?? "manual", model, effort, prompt_sha256: ENRICH_PROMPT_SHA256 })
      .select("id").single()
    if (error) throw new Error("enrichment_runs insert failed: " + error.message)
    runId = data.id
  }

  const write = async (id: string, patch: Record<string, unknown>) => {
    if (dryRun) return null
    const { error } = await sb.from("postings").update({ ...patch, enrichment_run_id: runId }).eq("id", id)
    return error ? `write failed: ${error.code} ${error.message}` : null
  }
  const fail = async (c: Candidate, reason: string) => {
    await write(c.id, {
      enrichment_failed_at: new Date().toISOString(),
      enrichment_error: reason.slice(0, 2000),
      enrichment_description_md5: c.description_md5,
    })
  }

  let rows: EnrichRow[] = []
  try {
    rows = await pool(candidates, concurrency, async (c): Promise<EnrichRow> => {
      const base = { id: c.id, source: c.source, company: c.company, title: c.title, reason: c.reason, demoted: [] as Demotion[] }
      const text = postingText(c.source, c.raw)

      if (text.length < MIN_DESCRIPTION) {
        const err = await write(c.id, { enrichment_description_md5: c.description_md5 })
        if (err) { await fail(c, err); return { ...base, status: "failed", attempts: 0, error: err, usage: null } }
        return { ...base, status: "skipped_short", attempts: 0, error: null, usage: null }
      }

      let fields: EnrichFields, usage: EnrichUsage
      try {
        const r = await enrichPosting({ title: titleFor(c), company: c.company, location: c.location, description: text }, { model, effort })
        fields = r.fields
        usage = r.usage
      } catch (e: any) {
        const reason = String(e?.message ?? e)
        await fail(c, reason)
        return { ...base, status: "failed", attempts: e instanceof EnrichFailed ? e.attempts : 1, error: reason, usage: e instanceof EnrichFailed ? e.usage : null }
      }

      let patch: Record<string, unknown>, demoted: Demotion[]
      try {
        ({ patch, demoted } = toPatch(fields, c.title))
      } catch (e: any) {
        const reason = "rule broken: " + String(e?.message ?? e)
        await fail(c, reason)
        return { ...base, status: "failed", attempts: usage.attempts, error: reason, usage }
      }

      let err = await write(c.id, { ...patch, enriched_at: new Date().toISOString(), enrichment_description_md5: c.description_md5 })
      // At most one retry per field: function, then industry.
      for (let i = 0; err && i < 2; i++) {
        const d = demoteRejected(patch, err)
        if (!d) break
        patch = d.patch
        demoted = [...demoted, d.demotion]
        err = await write(c.id, { ...patch, enriched_at: new Date().toISOString(), enrichment_description_md5: c.description_md5 })
      }
      for (const d of demoted) console.warn(`  demoted ${d.field}="${d.value}" (${d.why}): ${c.company} | ${c.title}`)
      if (err) {
        await fail(c, err)
        return { ...base, status: "failed", attempts: usage.attempts, error: err, usage }
      }
      return { ...base, demoted, status: "enriched", attempts: usage.attempts, error: null, usage }
    })
  } catch (e: any) {
    if (runId) await sb.from("enrichment_runs").update({ status: "error", error: String(e?.message ?? e).slice(0, 2000), finished_at: new Date().toISOString() }).eq("id", runId)
    throw e
  }

  const sum = (k: keyof EnrichUsage) => rows.reduce((n, r) => n + Number(r.usage?.[k] ?? 0), 0)
  const summary: EnrichSummary = {
    runId,
    attempted: rows.length,
    succeeded: rows.filter((r) => r.status === "enriched").length,
    skippedShort: rows.filter((r) => r.status === "skipped_short").length,
    failed: rows.filter((r) => r.status === "failed").length,
    demoted: rows.filter((r) => r.demoted.length).length,
    apiCalls: sum("attempts"),
    inputTokens: sum("inputTokens"),
    cacheReadTokens: sum("cacheReadTokens"),
    cacheWriteTokens: sum("cacheWriteTokens"),
    outputTokens: sum("outputTokens"),
    costUsd: rows.reduce((n, r) => n + (r.usage?.costUsd ?? 0), 0),
    rows,
  }

  if (runId) {
    const { error } = await sb.from("enrichment_runs").update({
      status: "ok", finished_at: new Date().toISOString(),
      attempted: summary.attempted, succeeded: summary.succeeded, failed: summary.failed,
      skipped_short: summary.skippedShort, demoted: summary.demoted, api_calls: summary.apiCalls,
      input_tokens: summary.inputTokens, cache_read_tokens: summary.cacheReadTokens,
      cache_write_tokens: summary.cacheWriteTokens, output_tokens: summary.outputTokens,
      cost_usd: Number(summary.costUsd.toFixed(6)),
    }).eq("id", runId)
    if (error) throw new Error("enrichment_runs update failed: " + error.message)
  }
  return summary
}
