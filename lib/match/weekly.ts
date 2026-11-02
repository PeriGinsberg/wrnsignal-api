/**
 * The Job Queue's Monday job (app/api/internal/job-queue/weekly): what last
 * week's decisions say, per client with active criteria.
 *
 *   1. MEASURE   match_quality_weekly: fits and not-a-fits decided last week,
 *                the median queue-rank percentile of each when decided, and
 *                how many of each sat in the top 20. Free.
 *   2. EXAMPLES  client_match_criteria.judge_examples: up to 10 fits and 15
 *                misses from the last 60 days, one per job. Rebuilt only for a
 *                client with a decision since the last snapshot, because a new
 *                snapshot changes criteria_hash and re-judges the client's
 *                whole queue that night ($0.10-0.60 a client). Free here.
 *   3. PROPOSALS criteria_proposals: one Sonnet 5.5 call for a client with 5+
 *                decisions last week, up to 3 concrete edits, each naming the
 *                decisions behind it. Pending ones from earlier weeks are
 *                superseded. About $0.04 a client. Approved on the proposals
 *                page, never from the email (mail scanners follow links).
 *
 * Re-running the same week is safe: the measure is an upsert, the snapshot is
 * skipped when nothing new was decided, and proposals for that week are
 * replaced.
 */

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import type { SupabaseClient } from "@supabase/supabase-js"

export const PROPOSAL_MODEL = "claude-sonnet-5-5"
const PRICE = { in: 2, out: 10 }
const EXAMPLE_DAYS = 60
const MAX_FITS = 10
const MAX_MISSES = 15
const MIN_DECISIONS_FOR_PROPOSALS = 5

/** Monday 00:00 UTC of the week before `now`. */
export function lastWeek(now = new Date()): { weekOf: string; start: Date; end: Date } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const sinceMonday = (d.getUTCDay() + 6) % 7
  const end = new Date(d.getTime() - sinceMonday * 864e5)
  const start = new Date(end.getTime() - 7 * 864e5)
  return { weekOf: start.toISOString().slice(0, 10), start, end }
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

type Decision = {
  id: string; action: "push" | "dismiss"; dismiss_reason: string | null; note: string | null; actioned_at: string
  rank_at_action: number | null; queue_size_at_action: number | null; criteria_hash: string
  postings: { title: string; cleaned_title: string | null; company: string } | null
}

/** One per job: copies of a job carry the same decision. Newest first. Pure. */
export function snapshotExamples(decisions: Decision[]) {
  const seen = new Set<string>()
  const fits: any[] = [], misses: any[] = []
  for (const d of [...decisions].sort((a, b) => b.actioned_at.localeCompare(a.actioned_at))) {
    const title = d.postings?.cleaned_title ?? d.postings?.title
    const company = d.postings?.company
    if (!title || !company) continue
    const k = `${title.toLowerCase()}|${company.toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    const e = { title, company, action: d.action, reason: d.dismiss_reason, note: d.note }
    if (d.action === "push" && fits.length < MAX_FITS) fits.push(e)
    if (d.action === "dismiss" && misses.length < MAX_MISSES) misses.push(e)
  }
  return [...fits, ...misses]
}

/** The week's measure for one client. Pure. */
export function measureWeek(decisions: Decision[]) {
  const one = new Map<string, Decision>()
  // Copies share a decision: count the job once, at its best rank.
  for (const d of decisions) {
    const k = `${d.action}|${(d.postings?.cleaned_title ?? d.postings?.title ?? d.id).toLowerCase()}|${(d.postings?.company ?? "").toLowerCase()}`
    const prev = one.get(k)
    if (!prev || (d.rank_at_action ?? Infinity) < (prev.rank_at_action ?? Infinity)) one.set(k, d)
  }
  const ds = [...one.values()]
  const pct = (d: Decision) => (d.rank_at_action && d.queue_size_at_action ? (d.rank_at_action - 1) / Math.max(1, d.queue_size_at_action) : null)
  const fits = ds.filter((d) => d.action === "push"), misses = ds.filter((d) => d.action === "dismiss")
  const reasons: Record<string, number> = {}
  for (const d of misses) if (d.dismiss_reason) reasons[d.dismiss_reason] = (reasons[d.dismiss_reason] ?? 0) + 1
  return {
    fits: fits.length, not_fits: misses.length,
    fit_median_rank_pct: median(fits.map(pct).filter((x): x is number => x !== null)),
    not_fit_median_rank_pct: median(misses.map(pct).filter((x): x is number => x !== null)),
    top20_fits: fits.filter((d) => (d.rank_at_action ?? Infinity) <= 20).length,
    top20_not_fits: misses.filter((d) => (d.rank_at_action ?? Infinity) <= 20).length,
    reasons,
  }
}

export const ProposalSchema = z.object({
  edits: z.array(z.object({
    field: z.enum(["target_roles", "target_industries", "excluded_industries", "excluded_title_keywords", "excluded_employers", "max_years_required", "salary_floor", "notes"]),
    op: z.enum(["add", "remove", "set"]),
    value: z.string(),
    rationale: z.string(),
    decision_numbers: z.array(z.number().int()),
  })).max(3),
})

const PROPOSAL_SYSTEM = `You help a career coach tune one client's job-matching criteria. You get the
criteria and the coach's decisions from the last week on jobs the matcher
scored for this client: Fit (added to the client's tracker) or Not a fit, with
a reason and sometimes a note.

Propose at most 3 concrete edits to the criteria that would have put the fits
higher and the misses lower. Only propose an edit that at least 2 decisions
support, and name them by number. Prefer the narrowest edit: an excluded title
keyword or employer over a whole industry; a target role over a note. Never
remove something the fits depend on. If nothing is supported, return no edits.

Fields: target_roles, target_industries, excluded_industries,
excluded_title_keywords, excluded_employers (lists: op add or remove, value one
item); max_years_required (op set, value a whole number); salary_floor (op set,
value "<amount> per year" or "<amount> per hour"); notes (op add, value one
sentence the judge will read). rationale: one plain sentence, citing the
counts ("4 Not a fit, Wrong function: all sales roles").`

let anthropic: Anthropic | null = null

export async function proposeEdits(criteria: any, decisions: Decision[]) {
  anthropic ??= new Anthropic({ timeout: 120_000 })
  const list = decisions.map((d, i) =>
    `${i + 1}. ${d.action === "push" ? "FIT" : `NOT A FIT (${[d.dismiss_reason?.replace(/_/g, " "), d.note].filter(Boolean).join("; ")})`}: ${d.postings?.cleaned_title ?? d.postings?.title} | ${d.postings?.company}`).join("\n")
  const crit = {
    target_roles: criteria.target_roles, target_industries: criteria.target_industries, excluded_industries: criteria.excluded_industries,
    excluded_title_keywords: criteria.excluded_title_keywords, excluded_employers: criteria.excluded_employers,
    max_years_required: criteria.max_years_required, salary_floor: criteria.salary_floor && `${criteria.salary_floor} per ${criteria.salary_floor_period}`,
    markets: criteria.markets, job_types: criteria.job_types, notes: criteria.notes,
  }
  const res = await anthropic.messages.parse({
    model: PROPOSAL_MODEL,
    max_tokens: 4000,
    system: PROPOSAL_SYSTEM,
    messages: [{ role: "user", content: `CRITERIA\n${JSON.stringify(crit, null, 1)}\n\nDECISIONS\n${list}` }],
    output_config: { format: zodOutputFormat(ProposalSchema), effort: "low" } as any,
  })
  const u: any = res.usage ?? {}
  const costUsd = ((u.input_tokens ?? 0) * PRICE.in + (u.output_tokens ?? 0) * PRICE.out) / 1e6
  const parsed = res.parsed_output as z.infer<typeof ProposalSchema> | null
  if (!parsed) throw new Error(`no proposal (stop_reason ${res.stop_reason})`)
  return {
    costUsd,
    edits: parsed.edits.map((e) => ({
      ...e,
      matchIds: e.decision_numbers.map((n) => decisions[n - 1]?.id).filter(Boolean) as string[],
    })),
  }
}

export type WeeklyResult = {
  weekOf: string
  clients: { clientProfileId: string; name: string; fits: number; notFits: number; snapshot: boolean; proposals: number; error?: string }[]
  costUsd: number
}

export async function runWeekly(sb: SupabaseClient, opts: { now?: Date; propose?: boolean } = {}): Promise<WeeklyResult> {
  const { weekOf, start, end } = lastWeek(opts.now)
  const { data: crits, error } = await sb.from("client_match_criteria").select("*, client_profiles(name, email)").eq("active", true)
  if (error) throw new Error(`client_match_criteria: ${error.message}`)
  const out: WeeklyResult = { weekOf, clients: [], costUsd: 0 }
  const since60 = new Date(end.getTime() - EXAMPLE_DAYS * 864e5).toISOString()

  for (const c of crits ?? []) {
    const id = c.client_profile_id as string
    const name = (c.client_profiles?.name || c.client_profiles?.email || id) as string
    const row = { clientProfileId: id, name, fits: 0, notFits: 0, snapshot: false, proposals: 0 } as WeeklyResult["clients"][number]
    try {
      const { data: recent, error: dErr } = await sb.from("posting_matches")
        .select("id, action, dismiss_reason, note, actioned_at, rank_at_action, queue_size_at_action, criteria_hash, postings(title, cleaned_title, company)")
        .eq("client_profile_id", id).in("action", ["push", "dismiss"]).gte("actioned_at", since60).lt("actioned_at", end.toISOString())
        .order("actioned_at", { ascending: false }).limit(2000)
      if (dErr) throw new Error(dErr.message)
      const all = (recent ?? []) as unknown as Decision[]
      const week = all.filter((d) => d.actioned_at >= start.toISOString())

      // 1. Measure
      const m = measureWeek(week)
      row.fits = m.fits; row.notFits = m.not_fits
      const { error: mErr } = await sb.from("match_quality_weekly").upsert({
        week_of: weekOf, client_profile_id: id, ...m, criteria_hash: week[0]?.criteria_hash ?? null,
      }, { onConflict: "week_of,client_profile_id" })
      if (mErr) throw new Error(`match_quality_weekly: ${mErr.message}`)

      // 2. Examples, only when something was decided since the last snapshot.
      const newest = all[0]?.actioned_at
      if (newest && (!c.examples_taken_at || newest > c.examples_taken_at)) {
        const { error: sErr } = await sb.from("client_match_criteria")
          .update({ judge_examples: snapshotExamples(all), examples_taken_at: new Date().toISOString() }).eq("client_profile_id", id)
        if (sErr) throw new Error(`judge_examples: ${sErr.message}`)
        row.snapshot = true
      }

      // 3. Proposals
      if (opts.propose !== false && week.length >= MIN_DECISIONS_FOR_PROPOSALS) {
        const { edits, costUsd } = await proposeEdits(c, week)
        out.costUsd += costUsd
        await sb.from("criteria_proposals").update({ status: "superseded" }).eq("client_profile_id", id).eq("status", "pending")
        if (edits.length) {
          const { error: pErr } = await sb.from("criteria_proposals").insert(edits.map((e, i) => ({
            client_profile_id: id, week_of: weekOf, field: e.field, op: e.op, value: e.value, rationale: e.rationale,
            evidence_match_ids: e.matchIds, model: PROPOSAL_MODEL, cost_usd: i === 0 ? Number(costUsd.toFixed(6)) : 0,
          })))
          if (pErr) throw new Error(`criteria_proposals: ${pErr.message}`)
        }
        row.proposals = edits.length
      }
    } catch (e: any) {
      row.error = String(e?.message ?? e).slice(0, 300)
    }
    out.clients.push(row)
  }
  return out
}

/** Applies one approved proposal to client_match_criteria. Returns the updated field value. */
export async function applyProposal(sb: SupabaseClient, p: { client_profile_id: string; field: string; op: string; value: any }) {
  const { data: c, error } = await sb.from("client_match_criteria").select("*").eq("client_profile_id", p.client_profile_id).single()
  if (error || !c) throw new Error(`client_match_criteria: ${error?.message ?? "missing"}`)
  const v = typeof p.value === "string" ? p.value.trim() : String(p.value)
  let patch: Record<string, unknown>
  if (["target_roles", "target_industries", "excluded_industries", "excluded_title_keywords", "excluded_employers"].includes(p.field)) {
    const cur: string[] = c[p.field] ?? []
    const has = cur.some((x) => x.toLowerCase() === v.toLowerCase())
    patch = { [p.field]: p.op === "remove" ? cur.filter((x) => x.toLowerCase() !== v.toLowerCase()) : has ? cur : [...cur, v] }
  } else if (p.field === "max_years_required") {
    const n = parseInt(v, 10)
    if (!Number.isFinite(n) || n < 0) throw new Error(`not a number of years: ${v}`)
    patch = { max_years_required: n }
  } else if (p.field === "salary_floor") {
    const m = v.replace(/[$,]/g, "").match(/^(\d+(?:\.\d+)?)\s*(?:per|\/)\s*(year|hour)$/i)
    if (!m) throw new Error(`not a salary floor: ${v}`)
    patch = { salary_floor: Number(m[1]), salary_floor_period: m[2].toLowerCase() }
  } else if (p.field === "notes") {
    patch = { notes: [c.notes, v].filter(Boolean).join("\n") }
  } else throw new Error(`unknown field ${p.field}`)
  const { error: uErr } = await sb.from("client_match_criteria").update(patch).eq("client_profile_id", p.client_profile_id)
  if (uErr) throw new Error(`client_match_criteria update: ${uErr.message}`)
  return patch
}

export function weeklyEmail(r: WeeklyResult, appUrl: string): { subject: string; text: string } {
  const total = r.clients.reduce((n, c) => n + c.proposals, 0)
  const lines = r.clients.filter((c) => c.fits || c.notFits || c.proposals || c.error).map((c) =>
    `${c.name}: ${c.fits} fit, ${c.notFits} not a fit${c.snapshot ? "; examples refreshed (re-judged tonight)" : ""}${c.proposals ? `; ${c.proposals} proposed edit${c.proposals > 1 ? "s" : ""}` : ""}${c.error ? `; ERROR ${c.error}` : ""}`)
  return {
    subject: `Job Queue week of ${r.weekOf}: ${total} criteria proposal${total === 1 ? "" : "s"}`,
    text: [
      `Week of ${r.weekOf}.`,
      "",
      ...(lines.length ? lines : ["No Job Queue decisions last week."]),
      "",
      total ? `Review and approve: ${appUrl}/dashboard/coach/job-queue/proposals` : "Nothing to approve.",
      `Proposal cost: $${r.costUsd.toFixed(4)}`,
    ].join("\n"),
  }
}
