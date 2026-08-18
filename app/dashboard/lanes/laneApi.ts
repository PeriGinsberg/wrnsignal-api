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
  location: { preset?: string | null; radius_miles?: number }
  years_max: number | null
  unreviewed: number
  // Present because a list can now span people; null when the owner profile
  // could not be read.
  client_name: string | null
  client_email: string | null
  is_own: boolean
}

export type LaneConfig = {
  id: string
  client_profile_id: string
  name: string
  active: boolean
  titles: string[]
  keyword: string | null
  location: { preset?: string | null; radius_miles?: number }
  years_max: number | null
  companies: string[]
  exclusions: { companies?: string[]; title_keywords?: string[] }
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

// Mirrors lane_results_reason_valid, last changed in
// 20260817_lane_result_drop_wrong_employer.sql. Slugs are stored; labels are
// for reading. Order is roughly how often each one gets used, so the common
// calls are the shortest travel.
export const REASONS: Array<{ value: string; label: string }> = [
  { value: "too_senior", label: "Too senior" },
  { value: "wrong_function", label: "Wrong function" },
  { value: "wrong_industry", label: "Wrong industry" },
  { value: "wrong_location", label: "Wrong location" },
  { value: "right_employer_wrong_level", label: "Right employer, wrong level" },
  { value: "doesnt_meet_requirements", label: "Doesn't meet requirements" },
]

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

/** How a lane's location reads on screen. Three states, as in the runner. */
export function locationLabel(l: LaneSummary["location"]): string {
  if (!l || !("preset" in l)) return "not set"
  if (l.preset === null) return "no location filter (nationwide)"
  return `${l.preset}${l.radius_miles ? ` · ${l.radius_miles}mi` : ""}`
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
