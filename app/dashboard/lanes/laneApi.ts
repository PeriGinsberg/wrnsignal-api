// Shared lane types, vocabulary and fetch helpers.
//
// Extracted so the all-clients page, the per-client tab on a coach's client
// record, and the standalone edit screen agree on all three. The dismissal
// taxonomy in particular has to match a database CHECK constraint — a second
// copy of that list is a 500 waiting for whoever edits only one of them.

import { getSupabaseBrowser } from "../../../lib/supabase-browser"

export type LaneSummary = {
  id: string
  client_profile_id: string
  name: string
  active: boolean
  titles: string[]
  keyword: string | null
  location: { presets?: string[]; preset?: string | null; radius_miles?: number }
  days_posted: number | null
  seniority: string[] | null
  years_max: number | null
  unreviewed: number
  // Present because a list can now span people; null when the owner profile
  // could not be read.
  client_name: string | null
  client_email: string | null
  is_own: boolean
  // May the caller score a result onto this client's tracker? Requires full
  // coach access, the same bar /api/coach/recommend-job enforces.
  can_send: boolean
  /** The most recent run, or null if the lane has never run. */
  last_run: LaneRun | null
}

export type LaneRun = {
  status: "ok" | "error" | "skipped"
  trigger: "cron" | "manual"
  started_at: string
  jobs_found: number | null
  jobs_added: number | null
  error: string | null
}

/**
 * How a run reads on one line.
 *
 * `found` and `added` stay separate: a healthy lane reports 0 added for days,
 * so collapsing them would make a working lane look dead — the same reason the
 * columns are separate.
 */
export function lastRunLabel(r: LaneRun | null): string {
  if (!r) return "never run"
  const mins = Math.round((Date.now() - new Date(r.started_at).getTime()) / 60000)
  const when = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`
  if (r.status === "error") return `failed ${when}`
  if (r.status === "skipped") return `skipped ${when} — the sweep ran out of time`
  return `${when} · ${r.jobs_found ?? 0} found · ${r.jobs_added ?? 0} new`
}

export type LaneConfig = {
  id: string
  client_profile_id: string
  name: string
  active: boolean
  titles: string[]
  keyword: string | null
  location: { presets?: string[]; preset?: string | null; radius_miles?: number }
  /**
   * How far back a run looks, in days. Null only on a database where the column
   * has not been added yet; the editor renders that as the window every lane
   * used to run at rather than as a blank.
   */
  days_posted: number | null
  /**
   * Board seniority bands this lane searches. Null only on a database where the
   * column has not been added yet, which the editor renders as the three bands
   * every lane used to be pinned to.
   */
  seniority: string[] | null
  years_max: number | null
  companies: string[]
  exclusions: { companies?: string[]; title_keywords?: string[] }
  filters?: LaneFilters | null
}

/**
 * Board-side filters, snake_case as the column stores them. Distinct from
 * `exclusions`: these are sent to the board so the rows never arrive, while
 * exclusions drop rows the board already returned.
 */
export type LaneFilters = {
  industries?: string[]
  excluded_industries?: string[]
  company_keywords?: string[]
  excluded_company_keywords?: string[]
  commitment_types?: string[]
}

export type Result = {
  id: string
  job_id: string
  matched_title: string | null
  title: string | null
  company: string | null
  apply_url: string | null
  location: string | null
  workplace_type: string | null
  seniority: string | null
  min_yoe: number | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  tools: string[] | null
  requirements_summary: string | null
  posted_at: string | null
}

export type Found = { title: string; count: number; already: boolean }

export type Discovery = {
  query: string
  fetched: number
  available: number
  capped: boolean
  untitled: number
  titles: Found[]
}

export { LANE_REASONS as REASONS, REASONS_REQUIRING_NOTE } from "../../../lib/laneReasons"

async function getToken() {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

export async function authFetch(url: string, opts: RequestInit = {}) {
  const token = await getToken()
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(opts.body && typeof opts.body === "string" ? { "Content-Type": "application/json" } : {}),
    },
  })
}

export function money(r: Result): string | null {
  if (r.salary_min == null && r.salary_max == null) return null
  const k = (n: number) => `${Math.round(n / 1000)}k`
  const cur = r.salary_currency === "USD" || !r.salary_currency ? "$" : `${r.salary_currency} `
  if (r.salary_min != null && r.salary_max != null) {
    return r.salary_min === r.salary_max ? `${cur}${k(r.salary_min)}` : `${cur}${k(r.salary_min)}–${k(r.salary_max)}`
  }
  return `${cur}${k((r.salary_min ?? r.salary_max)!)}`
}

export function daysAgo(iso: string | null): string {
  if (!iso) return "—"
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (d <= 0) return "today"
  if (d === 1) return "yesterday"
  return `${d}d ago`
}

/**
 * How a lane's markets read on screen. Three states, as in the runner, and the
 * pre-2026-08-18 single-market shape normalised alongside them.
 */
export function locationLabel(l: LaneSummary["location"]): string {
  const presets = Array.isArray(l?.presets)
    ? l.presets
    : l && "preset" in l
      ? l.preset == null
        ? []
        : [l.preset]
      : null
  if (presets === null) return "not set"
  if (!presets.length) return "no location filter (nationwide)"
  return `${presets.join(", ")}${l?.radius_miles ? ` · ${l.radius_miles}mi` : ""}`
}

/**
 * The tab label for a lane.
 *
 * On a list that spans people the client's name leads, because the lane name
 * alone ("Baseball Operations") does not say whose queue you are about to
 * review. On a single client's record it would be the same name on every tab,
 * so it is dropped.
 */
export function laneTabLabel(l: LaneSummary, showClientName: boolean): string {
  if (!showClientName) return l.name
  const who = l.client_name || l.client_email || (l.is_own ? "You" : "Unknown")
  return `${who} · ${l.name}`
}
