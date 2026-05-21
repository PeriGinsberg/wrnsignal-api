// app/api/coach/applications-recent/route.ts
//
// Phase 2 Commit 2.3 — cross-client applications list backing the
// /dashboard/coach/applications-recent surface. The three application-
// count tiles on Coach Home (Total Applications / Interviewing / Offers)
// route here with a ?status= param:
//
//   ?status=all          all apps in the 30-day window, lifecycle scope
//                        Active + Inactive
//   ?status=interviewing apps with current status 'interviewing' OR a
//                        transition to 'interviewing' in 30d, lifecycle
//                        scope Active + Inactive
//   ?status=offer        apps with current status 'offer' OR a transition
//                        to 'offer' in 30d, lifecycle scope Active +
//                        Inactive + ARCHIVED (per the marketing rule:
//                        clients off-boarded after an offer should still
//                        count for the coach's portfolio narrative)
//
// Status detection uses the same status-history-preferred /
// signal_applications.created_at fallback as the totals query in
// /api/coach/home (Phase 2 Item 14). Pre-2026-05-07 apps were not
// backfilled into status_history — they fall back to their created_at
// and current status. See supabase/migrations/20260507_coach_home_landing.sql.
//
// Returned shape (per app): application_id, job_title, company,
// application_status (current), transition_timestamp (when entered the
// reported status), client_profile_id, client_name, client_lifecycle_status.
// Sorted by transition_timestamp DESC (most recent first).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

async function getCoachProfile(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("id, is_coach")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return data
  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id, is_coach")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) return byEmail
  }
  return null
}

const MS_DAY = 24 * 60 * 60 * 1000
const daysAgo = (d: number) => new Date(Date.now() - d * MS_DAY).toISOString()

const ALLOWED_STATUS = ["all", "interviewing", "offer"] as const
type StatusFilter = (typeof ALLOWED_STATUS)[number]

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const coach = await getCoachProfile(userId, email)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 404)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: caller is not a coach" }, 403)

    const supabase = getSupabaseAdmin()
    const coachProfileId = coach.id as string

    // Validate ?status= against allowlist; default to 'all'.
    const statusParam = req.nextUrl.searchParams.get("status")
    const status: StatusFilter = (statusParam && (ALLOWED_STATUS as readonly string[]).includes(statusParam))
      ? (statusParam as StatusFilter)
      : "all"

    // Lifecycle scope per status. Offer includes Archived per spec.
    const scopeLifecycleStatuses =
      status === "offer"
        ? ["Active", "Inactive", "Archived"]
        : ["Active", "Inactive"]

    // ── 1. Coach's clients in the relevant lifecycle scope ──────────
    const { data: relRows, error: relErr } = await supabase
      .from("coach_clients")
      .select("client_profile_id, lifecycle_status")
      .eq("coach_profile_id", coachProfileId)
      .eq("status", "active")
      .in("lifecycle_status", scopeLifecycleStatuses)
    if (relErr) throw new Error(`Coach clients lookup failed: ${relErr.message}`)
    const relationships = (relRows || []).filter((r: any) => r.client_profile_id)
    if (relationships.length === 0) {
      return withCorsJson(req, { ok: true, status, rows: [] })
    }
    const clientProfileIds = relationships.map((r: any) => r.client_profile_id as string)
    const lifecycleByClient = new Map<string, string>(
      relationships.map((r: any) => [r.client_profile_id as string, (r.lifecycle_status as string) || "Active"]),
    )

    // ── 2. Client names ─────────────────────────────────────────────
    const { data: profs } = await supabase
      .from("client_profiles")
      .select("id, name, email")
      .in("id", clientProfileIds)
    const nameByClient = new Map<string, string>(
      (profs || []).map((p: any) => [p.id as string, (p.name as string) || (p.email as string) || "(unknown)"]),
    )

    // ── 3. Applications in the 30-day window ────────────────────────
    //
    // For all three status modes, we limit candidate apps to the 30-day
    // window up front. For ?status=all, that's apps created in 30d. For
    // status-filtered modes, candidates are apps whose CREATED_AT is in
    // 30d OR which appear in a 30d-windowed history row — but the
    // candidate filter below uses created_at only as a coarse pre-filter
    // (since a transition implies the row exists; history-only matches
    // happen via the history query below).
    const since30dIso = daysAgo(30)
    const { data: apps, error: appsErr } = await supabase
      .from("signal_applications")
      .select("id, profile_id, company_name, job_title, application_status, created_at")
      .in("profile_id", clientProfileIds)
    if (appsErr) throw new Error(`Applications lookup failed: ${appsErr.message}`)
    const allApps = (apps || []) as Array<{
      id: string
      profile_id: string
      company_name: string | null
      job_title: string | null
      application_status: string
      created_at: string
    }>
    const appIds = allApps.map((a) => a.id)

    // ── 4. Status history in the 30-day window ──────────────────────
    let historyRows: Array<{ application_id: string; to_status: string; changed_at: string }> = []
    let appsWithAnyHistorySet = new Set<string>()
    if (appIds.length > 0) {
      const { data: hist } = await supabase
        .from("signal_applications_status_history")
        .select("application_id, to_status, changed_at")
        .in("application_id", appIds)
      historyRows = (hist || []) as any
      for (const h of historyRows) appsWithAnyHistorySet.add(h.application_id)
    }
    // For "latest transition to current status" (used by ?status=all):
    //   appLatestHistory[app_id] = most-recent history row regardless of to_status.
    // For "transitioned to <target> in 30d":
    //   appTargetTransition[app_id] = most-recent history row with to_status=target AND changed_at>=30d.
    const appLatestHistory = new Map<string, { to_status: string; changed_at: string }>()
    for (const h of historyRows) {
      const cur = appLatestHistory.get(h.application_id)
      if (!cur || h.changed_at > cur.changed_at) {
        appLatestHistory.set(h.application_id, { to_status: h.to_status, changed_at: h.changed_at })
      }
    }
    const appTargetTransitionAt = new Map<string, string>()
    if (status !== "all") {
      for (const h of historyRows) {
        if (h.to_status !== status) continue
        if (h.changed_at < since30dIso) continue
        const cur = appTargetTransitionAt.get(h.application_id)
        if (!cur || h.changed_at > cur) {
          appTargetTransitionAt.set(h.application_id, h.changed_at)
        }
      }
    }

    // ── 5. Build rows ───────────────────────────────────────────────
    type Row = {
      application_id: string
      job_title: string | null
      company: string | null
      application_status: string
      transition_timestamp: string
      client_profile_id: string
      client_name: string
      client_lifecycle_status: string
    }
    const rows: Row[] = []
    for (const a of allApps) {
      let transitionTs: string | null = null
      if (status === "all") {
        // All apps created in 30d. transition_timestamp = latest history
        // event's changed_at, fallback to created_at.
        if (a.created_at < since30dIso) continue
        const latest = appLatestHistory.get(a.id)
        transitionTs = latest?.changed_at || a.created_at
      } else {
        // status-filtered. Two paths:
        //   (a) has a history row with to_status=target AND changed_at >= 30d
        //   (b) no history row at all AND current status === target AND
        //       created_at >= 30d (fallback for pre-backfill apps)
        const t = appTargetTransitionAt.get(a.id)
        if (t) {
          transitionTs = t
        } else if (
          !appsWithAnyHistorySet.has(a.id) &&
          a.application_status === status &&
          a.created_at >= since30dIso
        ) {
          transitionTs = a.created_at
        } else {
          continue
        }
      }
      rows.push({
        application_id: a.id,
        job_title: a.job_title,
        company: a.company_name,
        application_status: a.application_status,
        transition_timestamp: transitionTs!,
        client_profile_id: a.profile_id,
        client_name: nameByClient.get(a.profile_id) || "(unknown)",
        client_lifecycle_status: lifecycleByClient.get(a.profile_id) || "Active",
      })
    }

    rows.sort((x, y) => (y.transition_timestamp.localeCompare(x.transition_timestamp)))

    return withCorsJson(req, { ok: true, status, rows })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const httpStatus = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, httpStatus)
  }
}
