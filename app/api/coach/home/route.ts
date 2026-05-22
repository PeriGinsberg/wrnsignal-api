// app/api/coach/home/route.ts
//
// Single endpoint for the coach Home (My Clients landing) page.
// Returns:
//   - coach.firstName for the greeting
//   - metrics.activeClients (real) / activeProspects (pilot placeholder = 0)
//   - clients[] — per-client card data including updates_since_visit
//   - requiresAction[] — heuristic-driven action items
//
// Heuristic rules (decision 2026-05-07 — Option B, all 6 ship):
//   R1: client hasn't logged in 7+ days
//   R2: coach rec pending client review 3+ days
//   R3: client moved to Interviewing 2+ days ago, no coach view since
//   R4: client moved to Rejected 3+ days ago, no coach view since
//   R5: client has Offer 1+ day old, no coach view since
//   R6: poor-fit app (signal_score<60) added 5+ days ago, no coach rec sent
//
// "Recent coach activity" definition: coach_clients.last_viewed_at >
//   the relevant change/creation timestamp. Bumped by GET on
//   /api/coach/clients/[id]/profile (any tab open).
//
// Status-history rules (R3-R5) ship "quiet" for the first ~7 days
// post-launch since no backfill was performed (decision 2026-05-07).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import {
  runHeuristics,
  type HeuristicClient,
  type EngagementSignal,
} from "../../_lib/coachEngagementHeuristics"

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
    .select("id, name, is_coach, user_id")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return data
  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id, name, is_coach, user_id")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
      }
      return byEmail
    }
  }
  return null
}

const MS_DAY = 24 * 60 * 60 * 1000
const now = () => new Date()
const daysAgo = (d: number) => new Date(Date.now() - d * MS_DAY).toISOString()
const daysBetween = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / MS_DAY)

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// Coach Home's "requiresAction" array reuses the EngagementSignal shape
// exported by the shared heuristics module. Same fields, same semantics —
// just a re-alias so the response shape stays stable for the client.
type ActionItem = EngagementSignal

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const coach = await getCoachProfile(userId, email)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 404)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: caller is not a coach" }, 403)

    const supabase = getSupabaseAdmin()
    const coachProfileId = coach.id as string

    // ── 1. Active coach-client relationships ──────────────────────────
    const { data: relRows, error: relErr } = await supabase
      .from("coach_clients")
      .select("id, client_profile_id, invited_email, access_level, status, lifecycle_status, accepted_at, last_viewed_at, private_notes")
      .eq("coach_profile_id", coachProfileId)
      .eq("status", "active")
    if (relErr) throw new Error(`Failed to fetch coach relationships: ${relErr.message}`)
    const relationships = relRows || []
    const clientProfileIds = relationships.map((r) => r.client_profile_id).filter(Boolean) as string[]

    // ── 2. Client profile details ─────────────────────────────────────
    const profileMap: Record<string, any> = {}
    if (clientProfileIds.length > 0) {
      const { data: profs } = await supabase
        .from("client_profiles")
        .select("id, user_id, name, email, target_roles")
        .in("id", clientProfileIds)
      for (const p of profs || []) profileMap[p.id] = p
    }

    // Fall back: when last_viewed_at is null, treat accepted_at as the
    // baseline so "since last visit" doesn't show "all time."
    const visitBaselineByRel = new Map<string, string>()  // rel.id → ISO
    for (const r of relationships) {
      visitBaselineByRel.set(r.id, r.last_viewed_at || r.accepted_at || new Date(0).toISOString())
    }

    // ── 3. Per-client stats (existing pattern from /api/coach/clients) ──
    // Plus updates_since_visit count.
    const clientCards = await Promise.all(
      relationships.map(async (rel) => {
        const cpid = rel.client_profile_id as string
        const profile = profileMap[cpid]
        const baseline = visitBaselineByRel.get(rel.id)!

        // Apps for stats + updates count
        const { data: apps } = await supabase
          .from("signal_applications")
          .select("id, application_status, created_at")
          .eq("profile_id", cpid)

        // Per-client stats. `pending_recs` was removed Phase 1 (tile)
        // + Phase 2 (API surface). attention_level recomputed below from
        // the same pendingRecs query, no longer surfaced in stats.
        const stats = {
          applications: apps?.length ?? 0,
          interviewing: (apps || []).filter((a: any) => a.application_status === "interviewing").length,
          // offers + rejected added 2026-05-08 for the redesigned coach
          // landing's per-client mini-cells + top-level metrics aggregation.
          offers: (apps || []).filter((a: any) => a.application_status === "offer").length,
          rejected: (apps || []).filter((a: any) => a.application_status === "rejected").length,
          interview_rate: 0,
        }
        const appliedCount = (apps || []).filter((a: any) =>
          ["applied", "interviewing", "offer", "rejected", "withdrawn"].includes(a.application_status)
        ).length
        stats.interview_rate = appliedCount > 0 ? Math.round((stats.interviewing / appliedCount) * 100) : 0

        // Pending coach recs (used internally for attention_level sort only;
        // not returned to the client).
        const { data: pendingRecs } = await supabase
          .from("coach_job_recommendations")
          .select("id, created_at")
          .eq("client_profile_id", cpid)
          .eq("coach_profile_id", coachProfileId)
          .eq("client_status", "new")
        const pendingRecsCount = pendingRecs?.length ?? 0

        const lastActivity =
          (apps || []).map((a: any) => a.created_at).sort().reverse()[0] || null

        // updates_since_visit: status changes + new apps + rec responses
        // since the coach last viewed this client.
        const appIds = (apps || []).map((a: any) => a.id)

        let statusChangesCount = 0
        if (appIds.length > 0) {
          const { count } = await supabase
            .from("signal_applications_status_history")
            .select("id", { count: "exact", head: true })
            .in("application_id", appIds)
            .gt("changed_at", baseline)
          statusChangesCount = count ?? 0
        }

        const newAppsCount = (apps || []).filter((a: any) => a.created_at > baseline).length

        const { count: recResponseCount } = await supabase
          .from("coach_job_recommendations")
          .select("id", { count: "exact", head: true })
          .eq("client_profile_id", cpid)
          .eq("coach_profile_id", coachProfileId)
          .gt("client_responded_at", baseline)

        const updates_since_visit = statusChangesCount + newAppsCount + (recResponseCount ?? 0)

        // Attention level: same intent as pre-Phase-2 (pending coach recs
        // OR interviewing apps → "medium"). Uses internal pendingRecsCount
        // since `stats.pending_recs` no longer exists.
        const attention_level: "high" | "medium" | "low" =
          pendingRecsCount > 0 || stats.interviewing > 0 ? "medium" : "low"

        return {
          id: rel.id,
          client_profile_id: cpid,
          name: profile?.name ?? null,
          email: profile?.email ?? rel.invited_email,
          status: rel.status,
          lifecycle_status: rel.lifecycle_status ?? "Active",
          attention_level,
          stats,
          last_activity: lastActivity,
          last_viewed_at: rel.last_viewed_at,
          updates_since_visit,
          // Internal-only: app IDs feed the 30-day aggregation queries
          // below. Stripped before response.
          _appIds: appIds,
          // user_id reused below for R1 last-login lookup
          _user_id: profile?.user_id || null,
        }
      })
    )

    // Sort: most updates first, then by attention, then by name
    clientCards.sort((a, b) => {
      if (b.updates_since_visit !== a.updates_since_visit)
        return b.updates_since_visit - a.updates_since_visit
      if (a.attention_level !== b.attention_level)
        return a.attention_level === "medium" ? -1 : 1
      return (a.name || "").localeCompare(b.name || "")
    })

    // ── 4. Engagement signals (R1–R6) ─────────────────────────────────
    //
    // The R1-R6 heuristic engine was extracted to a shared module in
    // Phase 3 Commit 3.0 so both this cross-client surface and the
    // per-client /needs-attention endpoint share one implementation.
    // The engine's input shape (HeuristicClient[]) is a strict subset of
    // the clientCards we already built above — map it down.
    const heuristicClients: HeuristicClient[] = clientCards.map((c) => ({
      client_profile_id: c.client_profile_id,
      name: c.name,
      email: c.email,
      user_id: c._user_id,
      last_viewed_at: c.last_viewed_at,
    }))
    const requiresAction: ActionItem[] = await runHeuristics({
      supabase,
      coachProfileId,
      clients: heuristicClients,
    })

    // ── 5. Coach-level metric tiles (Phase 2 Item 14) ───────────────
    //
    // Six metrics, three of them date-windowed to last 30 days. Scoping
    // by lifecycle_status (added Phase 1):
    //   - activeProspects  → COUNT clients with lifecycle_status='Prospect'
    //   - activeClients    → COUNT clients with lifecycle_status='Active'
    //   - totalApplications→ apps from Active+Inactive clients, 30d window
    //   - totalInterviewing→ same scope, transitioned to 'interviewing' in 30d
    //   - totalOffers      → Active+Inactive+ARCHIVED scope, transitioned
    //                        to 'offer' in 30d (Archived included for
    //                        marketing: clients off-boarded after an offer)
    //   - avgInterviewRate → totalInterviewing / totalApplications,
    //                        null when denominator is 0 (UI shows "—")
    //
    // Status-transition timestamps come from signal_applications_status_history
    // where present; fall back to signal_applications.created_at for apps
    // with no history rows (pre-2026-05-07 apps were not backfilled —
    // see supabase/migrations/20260507_coach_home_landing.sql).
    const since30dIso = daysAgo(30)

    const aiProfileIds: string[] = []          // Active + Inactive
    const aiaProfileIds: string[] = []         // Active + Inactive + Archived
    const aiAppIds: string[] = []              // app IDs for A+I scope
    const aiaAppIds: string[] = []             // app IDs for A+I+A scope
    let activeProspectsCount = 0
    let activeClientsCount = 0
    for (const c of clientCards) {
      const ls = c.lifecycle_status
      if (ls === "Prospect") activeProspectsCount++
      else if (ls === "Active") activeClientsCount++
      if (ls === "Active" || ls === "Inactive") {
        aiProfileIds.push(c.client_profile_id)
        aiAppIds.push(...c._appIds)
      }
      if (ls === "Active" || ls === "Inactive" || ls === "Archived") {
        aiaProfileIds.push(c.client_profile_id)
        aiaAppIds.push(...c._appIds)
      }
    }

    // Total Applications: A+I scope, created in 30d.
    let totalApplications = 0
    if (aiProfileIds.length > 0) {
      const { count } = await supabase
        .from("signal_applications")
        .select("id", { count: "exact", head: true })
        .in("profile_id", aiProfileIds)
        .gte("created_at", since30dIso)
      totalApplications = count ?? 0
    }

    // Status-history rows (last 30d) for both scopes. One query per scope
    // since the app-id sets differ; both queries chunk through the same
    // table. Returned rows include `application_id` so we can dedupe.
    async function transitionedAppIds(scopeAppIds: string[], toStatus: string): Promise<Set<string>> {
      if (scopeAppIds.length === 0) return new Set()
      const { data } = await supabase
        .from("signal_applications_status_history")
        .select("application_id")
        .in("application_id", scopeAppIds)
        .eq("to_status", toStatus)
        .gte("changed_at", since30dIso)
      return new Set((data || []).map((r: any) => r.application_id as string))
    }

    // For the fallback path (apps with no history row), we also need the
    // set of apps that have ANY history row, so we know which apps to
    // fall back on. Single query per scope.
    async function appsWithAnyHistory(scopeAppIds: string[]): Promise<Set<string>> {
      if (scopeAppIds.length === 0) return new Set()
      const { data } = await supabase
        .from("signal_applications_status_history")
        .select("application_id")
        .in("application_id", scopeAppIds)
      return new Set((data || []).map((r: any) => r.application_id as string))
    }

    // Apps in A+I scope with current status + created_at for the fallback.
    // Reused for the "currently at status X with no history" branch.
    const appsByScope: Record<string, Array<{ id: string; application_status: string; created_at: string }>> = {
      ai: [],
      aia: [],
    }
    if (aiAppIds.length > 0) {
      const { data } = await supabase
        .from("signal_applications")
        .select("id, application_status, created_at")
        .in("id", aiAppIds)
      appsByScope.ai = (data || []) as any
    }
    if (aiaAppIds.length > 0) {
      const { data } = await supabase
        .from("signal_applications")
        .select("id, application_status, created_at")
        .in("id", aiaAppIds)
      appsByScope.aia = (data || []) as any
    }

    function countWithFallback(
      apps: Array<{ id: string; application_status: string; created_at: string }>,
      transitioned: Set<string>,
      anyHistory: Set<string>,
      targetStatus: string,
    ): number {
      let n = 0
      for (const a of apps) {
        if (transitioned.has(a.id)) n++
        else if (
          !anyHistory.has(a.id) &&
          a.application_status === targetStatus &&
          a.created_at >= since30dIso
        ) n++
      }
      return n
    }

    const [aiInterviewing, aiAnyHistory, aiaOffers, aiaAnyHistory] = await Promise.all([
      transitionedAppIds(aiAppIds, "interviewing"),
      appsWithAnyHistory(aiAppIds),
      transitionedAppIds(aiaAppIds, "offer"),
      appsWithAnyHistory(aiaAppIds),
    ])

    const totalInterviewing = countWithFallback(
      appsByScope.ai, aiInterviewing, aiAnyHistory, "interviewing",
    )
    const totalOffers = countWithFallback(
      appsByScope.aia, aiaOffers, aiaAnyHistory, "offer",
    )

    const avgInterviewRate: number | null =
      totalApplications > 0
        ? Math.round((totalInterviewing / totalApplications) * 100)
        : null

    // ── 6. Optional client-list filter (Phase 2 Item 12, revised) ────
    //
    // The coach can drill into the Active Prospects or Active Clients
    // tile from Coach Home; the resulting My Clients view is filtered to
    // the matching lifecycle_status bucket. Metrics stay unfiltered
    // (totals) — only the `clients` array shrinks.
    //
    // Application-count tiles (Total Apps / Interviewing / Offers) do
    // NOT route here — they go to /dashboard/coach/applications-recent
    // in Commit 2.3 because they're per-application, not per-client.
    //
    // Allowlist: prospect | active. Invalid values silently ignored.
    const ALLOWED_FILTERS = ["prospect", "active"] as const
    const filterParam = req.nextUrl.searchParams.get("filter")
    const activeFilter = (filterParam && (ALLOWED_FILTERS as readonly string[]).includes(filterParam))
      ? filterParam
      : null

    let filteredCards = clientCards
    if (activeFilter === "prospect") {
      filteredCards = clientCards.filter((c) => c.lifecycle_status === "Prospect")
    } else if (activeFilter === "active") {
      filteredCards = clientCards.filter((c) => c.lifecycle_status === "Active")
    }

    // Strip internals (_user_id, _appIds) before response.
    const cleanClients = filteredCards.map(({ _user_id, _appIds, ...rest }) => rest)

    const firstName = (coach.name || "").split(/\s+/)[0] || "Coach"

    return withCorsJson(req, {
      ok: true,
      coach: { firstName, fullName: coach.name },
      metrics: {
        activeProspects: activeProspectsCount,
        activeClients: activeClientsCount,
        totalApplications,
        totalInterviewing,
        totalOffers,
        avgInterviewRate,
      },
      // Echo back the filter that was actually applied (after allowlist
      // validation). null when no filter was requested OR when the
      // requested value was invalid. Lets the UI decide whether to render
      // a chip without re-implementing the allowlist.
      appliedFilter: activeFilter,
      clients: cleanClients,
      requiresAction,
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
