/**
 * What job sourcing costs, and whether it is on pace.
 *
 * TWO CLOCKS, deliberately. Spend is by calendar month: the AI costs
 * (enrichment_runs and match_runs, every trigger, so manual runs count) plus
 * the SearchApi plan fee, counted once as a fixed cost rather than per search.
 * Searches are by SearchApi's billing period, read from SearchApi itself
 * (/api/v1/me), which also counts dev's searches: dev and prod share the
 * account, and only SearchApi sees both.
 *
 * PACE IS LINEAR: so far / time elapsed x the whole period. It is noisy early
 * (one $2 re-match on the 1st projects $60), so neither alert can fire until
 * MIN_PACE_DAYS have passed. Each alert fires once per period (cost_alerts).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { STEPS, type Step } from "./runs"
import { GOOGLE_JOBS_SOURCES } from "../ingest/googleJobs"
import { loadPickInputs, projectLongestWaits, searchCapFromEnv } from "./pairs"
import { queueSettings, type ClientRelease, type QueueSettings } from "./queueRelease"

export const MONTHLY_BUDGET_USD = Number(process.env.JOB_SOURCING_MONTHLY_BUDGET_USD ?? 110)
export const SEARCHAPI_MONTHLY_FEE_USD = Number(process.env.SEARCHAPI_MONTHLY_FEE_USD ?? 40)
export const MIN_PACE_DAYS = 2

const DAY = 86400e3

export type MonthWindow = { start: Date; end: Date; days: number; elapsedDays: number; label: string }

export function monthWindow(now: Date): MonthWindow {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start, end, days: (end.getTime() - start.getTime()) / DAY, elapsedDays: (now.getTime() - start.getTime()) / DAY, label: start.toISOString().slice(0, 7) }
}

/** Fee plus AI spend so far scaled to the whole month. */
export function projectSpend(aiMtd: number, fee: number, w: MonthWindow): number {
  return fee + (w.elapsedDays > 0 ? (aiMtd / w.elapsedDays) * w.days : 0)
}

export type SearchApiAccount = { used: number; allowance: number; periodStart: string; periodEnd: string }

export function projectSearches(a: SearchApiAccount, now: Date): { projected: number; elapsedDays: number } {
  const start = new Date(a.periodStart).getTime(), end = new Date(a.periodEnd).getTime()
  const elapsed = Math.max(0, now.getTime() - start)
  return { projected: elapsed > 0 ? (a.used / elapsed) * (end - start) : 0, elapsedDays: elapsed / DAY }
}

export type PaceInput = {
  spend: { mtd: number; projected: number; budget: number; elapsedDays: number; month: string }
  searches: { used: number; projected: number; allowance: number; elapsedDays: number; periodStart: string } | null
}
export type PaceAlert = { kind: "spend" | "searches"; period: string; text: string }

/** The alerts this pace calls for, before the once-per-period check. */
export function paceAlerts(p: PaceInput): PaceAlert[] {
  const out: PaceAlert[] = []
  const s = p.spend
  if (s.elapsedDays >= MIN_PACE_DAYS && s.projected > s.budget) {
    out.push({ kind: "spend", period: s.month, text: `Job sourcing spend is on pace for $${s.projected.toFixed(2)} in ${s.month}, over the $${s.budget} limit. Month to date: $${s.mtd.toFixed(2)} after ${s.elapsedDays.toFixed(1)} days.` })
  }
  const q = p.searches
  if (q && q.elapsedDays >= MIN_PACE_DAYS && q.projected > q.allowance) {
    out.push({ kind: "searches", period: q.periodStart.slice(0, 10), text: `SearchApi is on pace for ${Math.round(q.projected)} searches this billing period, over the ${q.allowance} plan. Used so far: ${q.used} in ${q.elapsedDays.toFixed(1)} days (dev and prod together).` })
  }
  return out
}

export async function searchApiAccount(apiKey: string): Promise<SearchApiAccount> {
  const res = await fetch("https://www.searchapi.io/api/v1/me", { headers: { Authorization: `Bearer ${apiKey}` } })
  const j: any = await res.json().catch(() => null)
  if (!res.ok || !j?.account) throw new Error(`SearchApi /me answered ${res.status}${j?.error ? ": " + j.error : ""}`)
  return { used: j.account.current_month_usage, allowance: j.account.monthly_allowance, periodStart: j.subscription.period_start, periodEnd: j.subscription.period_end }
}

async function pageAll<T>(q: (a: number, b: number) => any): Promise<T[]> {
  const out: T[] = []
  for (let a = 0; ; a += 1000) {
    const { data, error } = await q(a, a + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

export type AiSpend = { enrichNightly: number; matchNightly: number; enrichManual: number; matchManual: number; total: number }

/** AI spend in [from, to): every enrichment and match run, split nightly (pipeline) vs manual. */
export async function aiSpend(sb: SupabaseClient, from: Date, to: Date): Promise<AiSpend> {
  const read = (table: string) => pageAll<any>((a, b) => sb.from(table).select("cost_usd, triggered_by")
    .gte("started_at", from.toISOString()).lt("started_at", to.toISOString()).range(a, b))
  const [e, m] = await Promise.all([read("enrichment_runs"), read("match_runs")])
  const sum = (rows: any[], nightly: boolean) => rows.filter((r) => String(r.triggered_by).startsWith("nightly:") === nightly).reduce((n, r) => n + Number(r.cost_usd), 0)
  const s = { enrichNightly: sum(e, true), matchNightly: sum(m, true), enrichManual: sum(e, false), matchManual: sum(m, false) }
  return { ...s, total: s.enrichNightly + s.matchNightly + s.enrichManual + s.matchManual }
}

export type StepTotals = Record<Step, { cost: number; units: number; searches: number; runs: number }>

/** Per-step totals from pipeline_runs over nights [fromNight, toNight]. */
export async function stepTotals(sb: SupabaseClient, fromNight: string, toNight: string): Promise<StepTotals> {
  const rows = await pageAll<any>((a, b) => sb.from("pipeline_runs").select("step, cost_usd, units, searches")
    .gte("night", fromNight).lte("night", toNight).range(a, b))
  const t = Object.fromEntries(STEPS.map((s) => [s, { cost: 0, units: 0, searches: 0, runs: 0 }])) as StepTotals
  for (const r of rows) { const x = t[r.step as Step]; if (!x) continue; x.cost += Number(r.cost_usd); x.units += r.units; x.searches += r.searches; x.runs++ }
  return t
}

/** Spend so far this month, the projection, and SearchApi's count: everything the pace check and the weekly email read. */
export async function costPosition(sb: SupabaseClient, now: Date, apiKey: string | undefined) {
  const w = monthWindow(now)
  const ai = await aiSpend(sb, w.start, now)
  const mtd = SEARCHAPI_MONTHLY_FEE_USD + ai.total
  const projected = projectSpend(ai.total, SEARCHAPI_MONTHLY_FEE_USD, w)
  let account: SearchApiAccount | null = null, searchError: string | null = null
  if (!apiKey) searchError = "SEARCHAPI_KEY is not set here"
  else try { account = await searchApiAccount(apiKey) } catch (e: any) { searchError = String(e?.message ?? e) }
  const sp = account ? projectSearches(account, now) : null
  const pace: PaceInput = {
    spend: { mtd, projected, budget: MONTHLY_BUDGET_USD, elapsedDays: w.elapsedDays, month: w.label },
    searches: account && sp ? { used: account.used, projected: sp.projected, allowance: account.allowance, elapsedDays: sp.elapsedDays, periodStart: account.periodStart } : null,
  }
  return { window: w, ai, mtd, projected, account, searchError, pace }
}

/**
 * Sends each pace alert at most once per period. The cost_alerts row is
 * written before the email; if the email fails the row is removed, so the next
 * check tries again rather than the alert being lost.
 */
export async function runPaceCheck(
  sb: SupabaseClient,
  opts: { now?: Date; apiKey?: string; send: (subject: string, text: string) => Promise<void> },
): Promise<{ sent: PaceAlert[]; alreadySent: PaceAlert[]; searchError: string | null }> {
  const pos = await costPosition(sb, opts.now ?? new Date(), opts.apiKey)
  const sent: PaceAlert[] = [], alreadySent: PaceAlert[] = []
  for (const a of paceAlerts(pos.pace)) {
    const { data, error } = await sb.from("cost_alerts").insert({ kind: a.kind, period: a.period, detail: pos.pace }).select("id").single()
    if (error?.code === "23505") { alreadySent.push(a); continue }
    if (error) throw new Error("cost_alerts insert failed: " + error.message)
    try {
      await opts.send(a.kind === "spend" ? `Job sourcing: on pace for $${pos.projected.toFixed(0)} this month` : "Job sourcing: SearchApi on pace to exceed the plan", a.text)
    } catch (e) {
      await sb.from("cost_alerts").delete().eq("id", data.id)
      throw e
    }
    sent.push(a)
  }
  return { sent, alreadySent, searchError: pos.searchError }
}

const STEP_LABEL: Record<Step, string> = {
  ats_grnhse: "Greenhouse sweep", ats_smartrecruiters: "SmartRecruiters sweep", google_jobs: "Google Jobs",
  enrich: "Enrichment", match: "Matching", queue_release: "Queue release", link_check: "Link check",
}
const UNIT_LABEL: Record<Step, string> = {
  ats_grnhse: "board runs", ats_smartrecruiters: "board runs", google_jobs: "searches",
  enrich: "postings", match: "judgments", queue_release: "jobs released", link_check: "links",
}

export type WeeklyInput = {
  weekFrom: string
  weekTo: string
  steps: StepTotals
  weekAi: AiSpend
  mtd: number
  projected: number
  budget: number
  fee: number
  month: string
  account: SearchApiAccount | null
  searchesProjected: number | null
  searchError: string | null
  /** Google Jobs coverage per client for the week, with the fair share (pairs.ts). Absent: no section. */
  coverage?: { rows: CoverageRow[]; cap: number; clients: number; nights: number }
  /** The Job Queue release per client for the week (queueRelease.ts). Absent: no section. */
  queue?: { rows: QueueRow[]; settings: QueueSettings; nightsRun: number; nights: number }
}

/**
 * One client's Google Jobs week: their pairs are the ones whose title is a
 * target role. projectedWaitDays: the longest any of their pairs would wait
 * over the next 28 nights under the fair share (null: one would never be searched).
 */
export type CoverageRow = { name: string; pairs: number; searches: number; nightsSearched: number; longestWaitDays: number | null; projectedWaitDays?: number | null }
/** One client's Job Queue week: released (shown), expired unreleased, and arrived under the floor. */
export type QueueRow = { name: string; shown: number; expired: number; belowFloor: number; deadline: number }

/** ET calendar date of a timestamp, so a night's run that crosses midnight UTC stays one night. */
const etDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" })

/**
 * Pure. Per client: searches of their pairs in [from, to), distinct nights with
 * one, and the longest any of their active pairs had gone unsearched at `to`
 * (null: a pair with no search in the runs given, so longer than they cover).
 */
export function coverageRows(
  clients: { id?: string; name: string; targetRoles: string[] }[],
  pairs: { id: string; title: string }[],
  runs: { pair_id: string; started_at: string }[],
  from: Date,
  to: Date,
  projected?: Map<string, number | null>,
): CoverageRow[] {
  const key = (t: string) => t.trim().toLowerCase()
  const lastAt = new Map<string, number>()
  for (const r of runs) {
    const t = new Date(r.started_at).getTime()
    if (t < to.getTime() && t > (lastAt.get(r.pair_id) ?? 0)) lastAt.set(r.pair_id, t)
  }
  const inWeek = (r: { started_at: string }) => { const t = new Date(r.started_at).getTime(); return t >= from.getTime() && t < to.getTime() }
  return clients.map((c) => {
    const roles = new Set(c.targetRoles.map(key))
    const ids = new Set(pairs.filter((p) => roles.has(key(p.title))).map((p) => p.id))
    const week = runs.filter((r) => ids.has(r.pair_id) && inWeek(r))
    const waits = [...ids].map((id) => (lastAt.has(id) ? (to.getTime() - lastAt.get(id)!) / DAY : null))
    return {
      name: c.name, pairs: ids.size, searches: week.length,
      nightsSearched: new Set(week.map((r) => etDate(r.started_at))).size,
      longestWaitDays: !ids.size ? 0 : waits.includes(null) ? null : Math.max(...(waits as number[])),
      ...(projected && c.id && projected.has(c.id) ? { projectedWaitDays: !ids.size ? 0 : projected.get(c.id)! } : {}),
    }
  }).sort((a, b) => a.nightsSearched - b.nightsSearched || a.name.localeCompare(b.name))
}

function coverageText(cv: NonNullable<WeeklyInput["coverage"]>): string[] {
  const lines = ["", `Search coverage by client (Google Jobs, ${cv.nights} nights):`]
  if (cv.clients) lines.push(`  Each client's share each night: ${(cv.cap / cv.clients).toFixed(1)} searches (cap ${cv.cap} across ${cv.clients} active clients); unused share goes to the clients furthest behind`)
  for (const r of cv.rows) {
    const missed = cv.nights - r.nightsSearched
    const wait = r.longestWaitDays === null ? "a pair not searched in 30 days" : `longest wait ${r.longestWaitDays.toFixed(1)} days`
    const proj = r.projectedWaitDays === undefined ? "" : r.projectedWaitDays === null ? ", projected: a pair never searched" : `, projected longest wait ${r.projectedWaitDays.toFixed(1)} days`
    const flag = !r.pairs ? "  NO PAIRS" : missed > 0 ? `  MISSED ${missed} night${missed === 1 ? "" : "s"}` : ""
    lines.push(`  ${r.name.padEnd(22)} ${String(r.searches).padStart(3)} searches of ${r.pairs} pairs, searched ${r.nightsSearched} of ${cv.nights} nights, ${wait}${proj}${flag}`)
  }
  return lines
}

function queueText(q: NonNullable<WeeklyInput["queue"]>): string[] {
  const s = q.settings
  const lines = ["", `Job Queue by client (${q.nightsRun} of ${q.nights} nightly releases ran; floor ${s.floor}, ${s.limit} a night, expire after ${s.expireNights} nights, deadline rule at ${s.deadlineMin}+):`]
  for (const r of q.rows) {
    lines.push(`  ${r.name.padEnd(22)} shown ${String(r.shown).padStart(3)}, expired ${String(r.expired).padStart(4)}, below floor ${String(r.belowFloor).padStart(5)}${r.deadline ? `  (${r.deadline} shown early for a deadline)` : ""}`)
  }
  const sum = (k: "shown" | "expired" | "belowFloor") => q.rows.reduce((n, r) => n + r[k], 0)
  lines.push(`  ${"All clients".padEnd(22)} shown ${String(sum("shown")).padStart(3)}, expired ${String(sum("expired")).padStart(4)}, below floor ${String(sum("belowFloor")).padStart(5)}`)
  return lines
}

/** The Monday email. Google Jobs' cost is its share of the flat fee ($fee / allowance per search); the month total counts the fee once. */
export function weeklyReportText(x: WeeklyInput): string {
  const money = (n: number) => `$${n.toFixed(2)}`
  const lines = [`Job sourcing cost, week of ${x.weekFrom} to ${x.weekTo}`, "", "By step (nightly pipeline):"]
  for (const s of STEPS) {
    const t = x.steps[s]
    const amount = s === "google_jobs" ? `${money(t.cost)} (share of the $${x.fee} plan)` : money(t.cost)
    lines.push(`  ${STEP_LABEL[s].padEnd(22)} ${amount.padEnd(28)} ${t.units} ${UNIT_LABEL[s]}, ${t.runs} run${t.runs === 1 ? "" : "s"}`)
  }
  const manual = x.weekAi.enrichManual + x.weekAi.matchManual
  lines.push(`  ${"Manual runs".padEnd(22)} ${money(manual).padEnd(28)} enrichment ${money(x.weekAi.enrichManual)}, matching ${money(x.weekAi.matchManual)}`)
  lines.push("", `Month to date (${x.month}): ${money(x.mtd)}, of which $${x.fee} is the SearchApi plan`)
  lines.push(`Projected for ${x.month}: ${money(x.projected)} (limit $${x.budget})${x.projected > x.budget ? "  OVER" : ""}`)
  lines.push("")
  if (x.account) {
    lines.push(`SearchApi: ${x.account.used} of ${x.account.allowance} searches used, billing period ${x.account.periodStart.slice(0, 10)} to ${x.account.periodEnd.slice(0, 10)} (dev and prod)`)
    if (x.searchesProjected !== null) lines.push(`  on pace for ${Math.round(x.searchesProjected)} this period${x.searchesProjected > x.account.allowance ? "  OVER" : ""}`)
  } else {
    lines.push(`SearchApi usage unavailable: ${x.searchError}`)
  }
  if (x.coverage) lines.push(...coverageText(x.coverage))
  if (x.queue) lines.push(...queueText(x.queue))
  return lines.join("\n")
}

/** Last week, Monday to Sunday (UTC), for a report sent on `now`. */
export function lastWeek(now: Date): { from: Date; to: Date; fromNight: string; toNight: string } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const sinceMonday = (today.getUTCDay() + 6) % 7
  const to = new Date(today.getTime() - sinceMonday * DAY)
  const from = new Date(to.getTime() - 7 * DAY)
  return { from, to, fromNight: from.toISOString().slice(0, 10), toNight: new Date(to.getTime() - DAY).toISOString().slice(0, 10) }
}

/**
 * The week's coverage: active clients' criteria, active Google Jobs pairs, their
 * runs from 30 days before `to`, and each client's projected longest wait from
 * today's state under the fair share at the current cap.
 */
export async function searchCoverage(sb: SupabaseClient, wk: { from: Date; to: Date; fromNight: string; toNight: string }, now = new Date()): Promise<NonNullable<WeeklyInput["coverage"]>> {
  const inputs = await loadPickInputs(sb)
  const ids = inputs.clients.map((c) => c.clientProfileId)
  const names = await clientNames(sb, ids)
  const runs = await pageAll<any>((a, b) => sb.from("ingest_runs").select("pair_id, started_at").in("source", [...GOOGLE_JOBS_SOURCES]).not("pair_id", "is", null)
    .gte("started_at", new Date(wk.to.getTime() - 30 * DAY).toISOString()).lt("started_at", wk.to.toISOString()).order("started_at").range(a, b))
  const cap = searchCapFromEnv()
  const projected = projectLongestWaits(inputs.pairs, inputs.last, inputs.clients, { cap, maxPages: 3, from: now })
  return {
    rows: coverageRows(inputs.clients.map((c) => ({ id: c.clientProfileId, name: names.get(c.clientProfileId) ?? c.clientProfileId.slice(0, 8), targetRoles: c.targetRoles })), inputs.pairs, runs, wk.from, wk.to, projected),
    cap, clients: ids.length,
    nights: Math.round((wk.to.getTime() - wk.from.getTime()) / DAY),
  }
}

async function clientNames(sb: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  return new Map((await pageAll<any>((a, b) => sb.from("client_profiles").select("id, name").in("id", ids).range(a, b))).map((p) => [p.id, p.name]))
}

/** Pure. Sums the week's queue_release details per client; every active client gets a row. */
export function queueRows(details: { clients?: Record<string, ClientRelease> }[], clients: { id: string; name: string }[]): QueueRow[] {
  const sum = new Map(clients.map((c) => [c.id, { name: c.name, shown: 0, expired: 0, belowFloor: 0, deadline: 0 }]))
  for (const d of details) for (const [id, c] of Object.entries(d.clients ?? {})) {
    const r = sum.get(id)
    if (!r) continue
    r.shown += c.released; r.expired += c.expired; r.belowFloor += c.belowFloor; r.deadline += c.deadline
  }
  return [...sum.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The week's Job Queue release, from pipeline_runs (queue_release rows over the week's nights). */
export async function queueWeek(sb: SupabaseClient, wk: { fromNight: string; toNight: string; from: Date; to: Date }): Promise<NonNullable<WeeklyInput["queue"]>> {
  const runs = await pageAll<any>((a, b) => sb.from("pipeline_runs").select("detail").eq("step", "queue_release").eq("status", "ok")
    .gte("night", wk.fromNight).lte("night", wk.toNight).order("started_at").range(a, b))
  const crit = await pageAll<any>((a, b) => sb.from("client_match_criteria").select("client_profile_id").eq("active", true).range(a, b))
  const names = await clientNames(sb, crit.map((c) => c.client_profile_id))
  return {
    rows: queueRows(runs.map((r) => r.detail ?? {}), crit.map((c) => ({ id: c.client_profile_id, name: names.get(c.client_profile_id) ?? c.client_profile_id.slice(0, 8) }))),
    settings: runs.at(-1)?.detail?.settings ?? queueSettings(),
    nightsRun: runs.length,
    nights: Math.round((wk.to.getTime() - wk.from.getTime()) / DAY),
  }
}

/** Builds and sends the Monday email for the week just ended. */
export async function runWeeklyReport(
  sb: SupabaseClient,
  opts: { now?: Date; apiKey?: string; send?: (subject: string, text: string) => Promise<void> },
): Promise<{ subject: string; text: string }> {
  const now = opts.now ?? new Date()
  const wk = lastWeek(now)
  const [steps, weekAi, pos, coverage, queue] = await Promise.all([stepTotals(sb, wk.fromNight, wk.toNight), aiSpend(sb, wk.from, wk.to), costPosition(sb, now, opts.apiKey), searchCoverage(sb, wk, now), queueWeek(sb, wk)])
  const text = weeklyReportText({
    weekFrom: wk.fromNight, weekTo: wk.toNight, steps, weekAi, mtd: pos.mtd, projected: pos.projected,
    budget: MONTHLY_BUDGET_USD, fee: SEARCHAPI_MONTHLY_FEE_USD, month: pos.window.label,
    account: pos.account, searchesProjected: pos.pace.searches?.projected ?? null, searchError: pos.searchError, coverage, queue,
  })
  const subject = `Job sourcing cost: week of ${wk.fromNight}, $${pos.mtd.toFixed(2)} month to date`
  if (opts.send) await opts.send(subject, text)
  return { subject, text }
}
