/**
 * The enrichment runner: take postings nothing has looked at yet, extract, write.
 *
 * THE WORKLIST IS "NEVER ATTEMPTED, AND THERE IS SOMETHING TO READ":
 *
 *   enriched_at IS NULL AND enrichment_failed_at IS NULL
 *   AND the stored description is long enough to state anything
 *
 * The first two halves are load-bearing. Dropping enrichment_failed_at
 * re-serves every posting that has already failed, on every run, forever, while
 * the remaining count never moves and the run reports success.
 *
 * THE THIRD HALF IS A FILTER, NOT A FAILURE, and that is a deliberate change.
 * 253 of dev's 545 postings are SmartRecruiters rows whose list endpoint
 * returns no description at all. Marking them failed was wrong twice over: it
 * blamed the extractor for something it never saw, and it buried a fixable
 * ingest gap (no per-posting fetch yet) inside a bucket meant for postings the
 * extractor could not handle. They are not failures. They are not ready.
 * When a per-posting fetch lands and descriptions arrive, they enter the
 * worklist on their own with nothing to clear.
 *
 * This is safe ONLY because the excluded rows are counted. countWorklist()
 * reports them as their own bucket, so "not ready" can never be mistaken for
 * "done" or hide a shrinking corpus. An uncounted exclusion would be the silent
 * skip this file exists to prevent.
 *
 * EVERY POSTING THIS RUNNER TOUCHES LEAVES IN A TERMINAL STATE:
 *   - extracted            -> enriched_at set, fields written
 *   - extractor gave up    -> enrichment_failed_at set, reason recorded
 *   - evidence rule broken -> enrichment_failed_at set, reason recorded
 *   - write rejected       -> enrichment_failed_at set, reason recorded
 *
 * IT NEVER SENDS first_seen_at OR last_seen_at. The database owns both. See
 * 20260919_postings_enrichment.sql for why an enrichment write must not look
 * like the posting was re-found on its board.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { extractPosting, type PostingFields } from "./extractPosting"

/** Rows the runner asks for. Deliberately narrow: raw is the big one. */
type Candidate = {
  id: string
  title: string
  company: string
  org_slug: string | null
  apply_url: string | null
  raw: any
  first_seen_at: string
  last_seen_at: string
}

export type EnrichRow = {
  id: string
  company: string
  title: string
  status: "enriched" | "failed"
  attempts: number
  error: string | null
  costUsd: number
  inputTokens: number
  outputTokens: number
}

export type EnrichSummary = {
  attempted: number
  succeeded: number
  failed: number
  /** attempts -> how many postings took that many API calls. */
  attemptsDistribution: Record<number, number>
  apiCalls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  rows: EnrichRow[]
}

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
  return s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l) => l.trimEnd()).join("\n").trim()
}

/**
 * A description this short cannot state anything. Extracting from it would
 * spend a call to learn nothing; the AMOREPACIFIC posting in the sample set is
 * three characters of junk.
 */
const MIN_DESCRIPTION = 200

/** The column patch for a successful extraction, plus the not-stated list. */
export function toPatch(f: PostingFields): Record<string, unknown> {
  const notStated: string[] = []

  // Numbers and arrays carry the literal marker; open strings carry null. Both
  // become NULL in the column, with the field name recorded in the array. That
  // array is the ONLY thing separating "states nothing" from "never looked".
  const num = (v: number | "not_stated", name: string) => {
    if (v === "not_stated") { notStated.push(name); return null }
    return v
  }
  const str = (v: string | null, name: string) => {
    if (v === null) { notStated.push(name); return null }
    return v
  }

  const tools = f.tools === "not_stated" ? (notStated.push("tools"), null) : f.tools
  const fn = f.function === "not_stated" ? (notStated.push("function"), null) : f.function
  const ind = f.industry === "not_stated" ? (notStated.push("industry"), null) : f.industry

  return {
    years_required: num(f.years_required, "years_required"),
    salary_min: num(f.salary_min, "salary_min"),
    salary_max: num(f.salary_max, "salary_max"),
    salary_currency: str(f.salary_currency, "salary_currency"),
    requirements_summary: str(f.requirements_summary, "requirements_summary"),
    tools,
    level: str(f.level, "level"),
    function: fn,
    industry: ind,
    // Only meaningful beside a value; NULL when the enum is not stated, which
    // is what postings_function_has_evidence expects.
    function_evidence: fn ? f.function_evidence : null,
    industry_evidence: ind ? f.industry_evidence : null,
    enrichment_not_stated: notStated,
    enriched_at: new Date().toISOString(),
    // A posting that succeeds stops being reported as failed.
    enrichment_failed_at: null,
    enrichment_error: null,
    // NOTE: no first_seen_at, no last_seen_at. The database owns both.
  }
}

/**
 * The evidence rule, enforced before the write rather than by the CHECK.
 *
 * The prompt says an enum value with an empty quote is a guess and must be
 * returned as not_stated instead. If the model does it anyway, letting it reach
 * the database raises a 23514 that names a constraint rather than a posting.
 * Failing here records WHICH posting and WHY, and keeps the violation countable
 * instead of demoting it to not_stated where it would never be noticed.
 */
function evidenceViolation(f: PostingFields): string | null {
  if (f.function !== "not_stated" && !String(f.function_evidence ?? "").trim())
    return "function=" + f.function + " returned with an empty evidence quote"
  if (f.industry !== "not_stated" && !String(f.industry_evidence ?? "").trim())
    return "industry=" + f.industry + " returned with an empty evidence quote"
  return null
}

export type WorklistCounts = {
  /** Never attempted AND has a description: what a run would take. */
  enrichable: number
  /** Has extracted data. */
  enriched: number
  /** Never attempted, but nothing stored to read yet. Not a failure. */
  noDescriptionYet: number
  /** Attempted and gave up. Shown so the three buckets always add up. */
  failed: number
  total: number
}

/**
 * The three counts, computed the same way the worklist filters, so the number
 * reported and the number processed cannot drift apart.
 *
 * Selects only raw->>content rather than the whole raw blob: the jsonb carries
 * up to 18 fields per posting and none of the others are needed to decide
 * whether there is text to read.
 */
export async function countWorklist(
  sb: SupabaseClient,
  opts: { source?: string } = {},
): Promise<WorklistCounts> {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from("postings")
      .select("id, enriched_at, enrichment_failed_at, content:raw->>content")
      .range(from, from + 999)
    if (opts.source) q = q.eq("source", opts.source)
    const { data, error } = await q
    if (error) throw new Error("count query failed: " + error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }

  let enrichable = 0, enriched = 0, noDescriptionYet = 0, failed = 0
  for (const r of rows) {
    if (r.enriched_at) { enriched++; continue }
    if (r.enrichment_failed_at) { failed++; continue }
    if (hasUsableDescription(r.content)) enrichable++
    else noDescriptionYet++
  }
  return { enrichable, enriched, noDescriptionYet, failed, total: rows.length }
}

/** The single definition of "there is something here to extract from". */
export function hasUsableDescription(content: unknown): boolean {
  return descriptionOf({ content }).length >= MIN_DESCRIPTION
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) { const i = next++; if (i >= items.length) return; res[i] = await fn(items[i]) }
  }))
  return res
}

export async function runEnrichment(
  sb: SupabaseClient,
  opts: { limit?: number; concurrency?: number; source?: string; dryRun?: boolean } = {},
): Promise<EnrichSummary> {
  const limit = opts.limit ?? 20
  const concurrency = opts.concurrency ?? 5
  const dryRun = opts.dryRun ?? false

  // Paged rather than a single .limit(): the description filter runs in this
  // process (Postgres cannot express "length after stripping HTML" without a
  // generated column), so a page can be thinned by it and we keep reading until
  // `limit` real candidates are in hand. Stops as soon as it has enough, so a
  // small run does not read the whole table.
  const candidates: Candidate[] = []
  const PAGE = 200
  for (let from = 0; candidates.length < limit; from += PAGE) {
    let q = sb
      .from("postings")
      .select("id, title, company, org_slug, apply_url, raw, first_seen_at, last_seen_at")
      .is("enriched_at", null)
      .is("enrichment_failed_at", null)
      // Oldest first, so a growing table cannot starve the back of the queue.
      .order("first_seen_at", { ascending: true })
      .range(from, from + PAGE - 1)
    if (opts.source) q = q.eq("source", opts.source)

    const { data, error } = await q
    if (error) throw new Error("worklist query failed: " + error.message)
    const page = (data ?? []) as Candidate[]

    for (const p of page) {
      if (candidates.length >= limit) break
      // NOT a failure: nothing has been stored for this posting to read yet.
      // Counted by countWorklist as noDescriptionYet so the exclusion is
      // visible rather than silent.
      if (!hasUsableDescription(p.raw?.content)) continue
      candidates.push(p)
    }
    if (page.length < PAGE) break
  }

  const rows: EnrichRow[] = await pool(candidates, concurrency, async (p) => {
    const base = { id: p.id, company: p.company, title: p.title }

    const zero = { costUsd: 0, inputTokens: 0, outputTokens: 0 }

    // No short-description branch here any more: the worklist already excluded
    // those, and they are reported as noDescriptionYet rather than failed.
    const description = descriptionOf(p.raw)

    let fields: PostingFields
    let attempts = 1
    let spend = zero
    try {
      const r = await extractPosting({ title: p.title, company: p.company, description })
      fields = r.fields
      attempts = r.usage.attempts
      spend = {
        costUsd: r.usage.costUsd,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
      }
    } catch (e: any) {
      const reason = String(e?.message ?? e).slice(0, 2000)
      if (!dryRun) await markFailed(sb, p.id, reason)
      return { ...base, status: "failed" as const, attempts: e?.attempts ?? 1, error: reason, ...zero }
    }

    const violation = evidenceViolation(fields)
    if (violation) {
      if (!dryRun) await markFailed(sb, p.id, violation)
      return { ...base, status: "failed" as const, attempts, error: violation, ...spend }
    }

    if (!dryRun) {
      const { error: wErr } = await sb.from("postings").update(toPatch(fields)).eq("id", p.id)
      if (wErr) {
        const reason = "write failed: " + wErr.code + " " + wErr.message
        // Best effort: if the field write failed, at least do not leave the row
        // looking untouched. If this write fails too the row stays in the
        // worklist, which is the safe direction.
        await markFailed(sb, p.id, reason)
        return { ...base, status: "failed" as const, attempts, error: reason, ...spend }
      }
    }

    return { ...base, status: "enriched" as const, attempts, error: null, ...spend }
  })

  const succeeded = rows.filter((r) => r.status === "enriched").length
  const dist: Record<number, number> = {}
  for (const r of rows) dist[r.attempts] = (dist[r.attempts] ?? 0) + 1

  return {
    attempted: rows.length,
    succeeded,
    failed: rows.length - succeeded,
    attemptsDistribution: dist,
    apiCalls: rows.reduce((s, r) => s + r.attempts, 0),
    inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
    costUsd: rows.reduce((s, r) => s + r.costUsd, 0),
    rows,
  }
}

async function markFailed(sb: SupabaseClient, id: string, reason: string): Promise<void> {
  await sb.from("postings").update({
    enrichment_failed_at: new Date().toISOString(),
    enrichment_error: reason.slice(0, 2000),
  }).eq("id", id)
}
