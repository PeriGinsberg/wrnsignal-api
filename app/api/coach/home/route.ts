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

// Phase 5 — metrics time-window toggle. Resolves the `?window=` query
// param to a threshold ISO string (or null for "all time"). Invalid /
// missing values default to 30d, preserving backward-compatibility for
// any caller that doesn't know about the new param.
type MetricsWindow = "7d" | "30d" | "all"
function parseWindow(raw: string | null): MetricsWindow {
  if (raw === "7d" || raw === "30d" || raw === "all") return raw
  return "30d"
}
function windowThreshold(w: MetricsWindow): string | null {
  if (w === "7d") return daysAgo(7)
  if (w === "30d") return daysAgo(30)
  return null // "all" → no lower bound
}

// ── Prospect helpers (duplicated inline from /api/coach/prospects/route.ts
//    per the established coach-route duplication pattern; keeps the home
//    endpoint self-contained without a shared module). Used to build the
//    `recentProspects` Coach Home My Prospects card data. ──

const PROSPECT_SELECT_COLS = [
  "id",
  "name",
  "invited_email",
  "phone",
  "source_category",
  "source_detail",
  "lifecycle_status",
  "invited_at",
  "client_profile_id",
  "phase_initial_contact_made",
  "phase_initial_contact_made_at",
  "phase_discovery_call_scheduled",
  "phase_discovery_call_scheduled_at",
  "phase_discovery_call_completed",
  "phase_discovery_call_completed_at",
  "phase_sow_sent",
  "phase_sow_sent_at",
  "phase_sow_signed",
  "phase_sow_signed_at",
  "phase_invoice_sent",
  "phase_invoice_sent_at",
  "phase_invoice_paid",
  "phase_invoice_paid_at",
].join(", ")

type ProspectRow = {
  id: string
  name: string | null
  invited_email: string | null
  phone: string | null
  source_category: string | null
  source_detail: string | null
  lifecycle_status: string
  invited_at: string
  client_profile_id: string | null
  phase_initial_contact_made: boolean
  phase_initial_contact_made_at: string | null
  phase_discovery_call_scheduled: boolean
  phase_discovery_call_scheduled_at: string | null
  phase_discovery_call_completed: boolean
  phase_discovery_call_completed_at: string | null
  phase_sow_sent: boolean
  phase_sow_sent_at: string | null
  phase_sow_signed: boolean
  phase_sow_signed_at: string | null
  phase_invoice_sent: boolean
  phase_invoice_sent_at: string | null
  phase_invoice_paid: boolean
  phase_invoice_paid_at: string | null
}

function computeProspectLastActivityAt(row: ProspectRow, latestNoteCreatedAt: string | null): string | null {
  const candidates = [
    row.phase_initial_contact_made_at,
    row.phase_discovery_call_scheduled_at,
    row.phase_discovery_call_completed_at,
    row.phase_sow_sent_at,
    row.phase_sow_signed_at,
    row.phase_invoice_sent_at,
    row.phase_invoice_paid_at,
    latestNoteCreatedAt,
  ].filter((v): v is string => v !== null && v !== undefined)
  if (candidates.length === 0) return null
  return candidates.reduce((a, b) => (a > b ? a : b))
}

function buildProspectCard(
  row: ProspectRow,
  lastActivityAt: string | null,
  resolvedName: string | null = null,
) {
  return {
    id: row.id,
    // Coach-edited name (coach_clients.name) wins; resolvedName from
    // client_profiles only fills in when coach_clients.name is NULL.
    // Preserves coach edits made via the prospect detail page while
    // still rescuing seed-fixture rows from rendering as "Unnamed".
    name: row.name ?? resolvedName,
    invited_email: row.invited_email,
    phone: row.phone,
    source_category: row.source_category,
    source_detail: row.source_detail,
    phases: {
      initial_contact_made:     { checked: row.phase_initial_contact_made,     at: row.phase_initial_contact_made_at },
      discovery_call_scheduled: { checked: row.phase_discovery_call_scheduled, at: row.phase_discovery_call_scheduled_at },
      discovery_call_completed: { checked: row.phase_discovery_call_completed, at: row.phase_discovery_call_completed_at },
      sow_sent:                 { checked: row.phase_sow_sent,                 at: row.phase_sow_sent_at },
      sow_signed:               { checked: row.phase_sow_signed,               at: row.phase_sow_signed_at },
      invoice_sent:             { checked: row.phase_invoice_sent,             at: row.phase_invoice_sent_at },
      invoice_paid:             { checked: row.phase_invoice_paid,             at: row.phase_invoice_paid_at },
    },
    lifecycle_status: row.lifecycle_status,
    client_profile_id: row.client_profile_id,
    last_activity_at: lastActivityAt,
    created_at: row.invited_at,
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// Coach Home's "requiresAction" array reuses the EngagementSignal shape
// exported by the shared heuristics module. Same fields, same semantics —
// just a re-alias so the response shape stays stable for the client.
type ActionItem = EngagementSignal

// Phase 1e (Coach Calendar Integration): parse CALENDAR_BETA_PROFILE_IDS into a
// UUID allowlist — same parsing as /api/coach/calendar/connect. Empty/unset =
// empty allowlist = fail-closed. Inline per the no-shared-helper convention.
const CALENDAR_BETA_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function calendarBetaAllowlist(): string[] {
  return (process.env.CALENDAR_BETA_PROFILE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => CALENDAR_BETA_UUID_RE.test(s))
}

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
      .select("id, client_profile_id, invited_email, access_level, status, lifecycle_status, accepted_at, last_viewed_at, private_notes, name")
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
        // cpid is null for prospect-lifecycle rows (Prospects v0.1
        // Commit 3 / FRD §6.3 NULL hardening). Per-client stat queries
        // below are guarded — prospects have no apps/recs to count, so
        // the queries can be skipped entirely.
        const cpid = rel.client_profile_id as string | null
        const profile = cpid ? profileMap[cpid] : null
        const baseline = visitBaselineByRel.get(rel.id)!

        // Apps for stats + updates count. Prospects (no
        // client_profile_id) have no apps; skip the query.
        let apps: Array<{ id: string; application_status: string; created_at: string }> = []
        if (cpid) {
          const { data } = await supabase
            .from("signal_applications")
            .select("id, application_status, created_at")
            .eq("profile_id", cpid)
          apps = (data as any) ?? []
        }

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
        // not returned to the client). Skip for prospects.
        let pendingRecsCount = 0
        if (cpid) {
          const { data: pendingRecs } = await supabase
            .from("coach_job_recommendations")
            .select("id, created_at")
            .eq("client_profile_id", cpid)
            .eq("coach_profile_id", coachProfileId)
            .eq("client_status", "new")
          pendingRecsCount = pendingRecs?.length ?? 0
        }

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

        // Rec-response count — skip for prospects (no recs exist).
        let recResponseCount: number | null = 0
        if (cpid) {
          const { count } = await supabase
            .from("coach_job_recommendations")
            .select("id", { count: "exact", head: true })
            .eq("client_profile_id", cpid)
            .eq("coach_profile_id", coachProfileId)
            .gt("client_responded_at", baseline)
          recResponseCount = count
        }

        const updates_since_visit = statusChangesCount + newAppsCount + (recResponseCount ?? 0)

        // Attention level: same intent as pre-Phase-2 (pending coach recs
        // OR interviewing apps → "medium"). Uses internal pendingRecsCount
        // since `stats.pending_recs` no longer exists.
        const attention_level: "high" | "medium" | "low" =
          pendingRecsCount > 0 || stats.interviewing > 0 ? "medium" : "low"

        return {
          id: rel.id,
          client_profile_id: cpid,
          // Name precedence: client_profiles.name (post-onboarding
          // canonical) wins; falls back to coach_clients.name for rows
          // where the coach captured a prospect name but no SIGNAL
          // profile is linked yet (Active-no-profile case). Same
          // precedence as the /api/coach/prospects builder (bf8e31c6).
          name: profile?.name ?? rel.name ?? null,
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

    // ── 3.5 Prospect roster (Coach Home My Prospects section) ─────────
    //
    // Separate query rather than reusing clientCards because the prospect
    // card needs phase + source fields that clientCards doesn't carry.
    // Server-side slice to PROSPECT_CARD_LIMIT avoids overfetching for
    // coaches with many prospects; same N as the frontend's
    // COLLAPSED_LIMIT. Sort: last_activity_at DESC NULLS LAST, then
    // invited_at DESC — matches /api/coach/prospects GET list.
    const PROSPECT_CARD_LIMIT = 5

    const { data: prospectRows, error: prospectErr } = await supabase
      .from("coach_clients")
      .select(PROSPECT_SELECT_COLS)
      .eq("coach_profile_id", coachProfileId)
      .eq("status", "active")
      .eq("lifecycle_status", "Prospect")
    if (prospectErr) {
      throw new Error(`Failed to fetch prospects: ${prospectErr.message}`)
    }

    // Batch latest-note lookup (N+1 avoidance). One SELECT for all
    // candidate prospect ids; group in-memory and pick the first
    // (most recent) created_at per id.
    const prospectIds = (prospectRows || []).map((r: any) => r.id as string)
    const latestNoteByProspect = new Map<string, string>()
    if (prospectIds.length > 0) {
      const { data: notes } = await supabase
        .from("coach_client_notes")
        .select("coach_client_id, created_at")
        .in("coach_client_id", prospectIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
      for (const n of notes || []) {
        const cid = n.coach_client_id as string
        if (!latestNoteByProspect.has(cid)) {
          latestNoteByProspect.set(cid, n.created_at as string)
        }
      }
    }

    // Batch client_profiles lookup for prospect rows with a linked
    // client_profile_id. Same name-resolution pattern as
    // /api/coach/prospects (list) and /[id] (detail).
    const prospectProfileIds = Array.from(new Set(
      (prospectRows || [])
        .map((r: any) => r.client_profile_id as string | null)
        .filter((id): id is string => !!id),
    ))
    const prospectProfileNameById = new Map<string, string>()
    if (prospectProfileIds.length > 0) {
      const { data: profs } = await supabase
        .from("client_profiles")
        .select("id, name")
        .in("id", prospectProfileIds)
      for (const p of profs ?? []) {
        if (typeof p.name === "string" && p.name.trim()) {
          prospectProfileNameById.set(p.id as string, p.name)
        }
      }
    }

    const prospectCards = (prospectRows || [])
      .map((row: any) => {
        const lastNote = latestNoteByProspect.get(row.id as string) ?? null
        const lastActivityAt = computeProspectLastActivityAt(row as ProspectRow, lastNote)
        const resolvedName = row.client_profile_id
          ? prospectProfileNameById.get(row.client_profile_id as string) ?? null
          : null
        return {
          card: buildProspectCard(row as ProspectRow, lastActivityAt, resolvedName),
          lastActivityAt,
        }
      })
      .sort((a, b) => {
        // last_activity_at DESC NULLS LAST, then created_at DESC
        if (a.lastActivityAt === null && b.lastActivityAt === null) {
          return (b.card.created_at ?? "").localeCompare(a.card.created_at ?? "")
        }
        if (a.lastActivityAt === null) return 1
        if (b.lastActivityAt === null) return -1
        return b.lastActivityAt.localeCompare(a.lastActivityAt)
      })
      .slice(0, PROSPECT_CARD_LIMIT)
      .map((entry) => entry.card)

    // ── 4. Engagement signals (R1–R6) ─────────────────────────────────
    //
    // The R1-R6 heuristic engine was extracted to a shared module in
    // Phase 3 Commit 3.0 so both this cross-client surface and the
    // per-client /needs-attention endpoint share one implementation.
    // The engine's input shape (HeuristicClient[]) is a strict subset of
    // the clientCards we already built above — map it down.
    // Prospects have NULL client_profile_id + NULL user_id — exclude
    // them from the heuristic input. R1-R6 all require these to
    // operate; passing NULLs leads to no-op queries OR spurious
    // signal IDs like "r1:null" (NULL string-coerces in template
    // literals). Defensive guard in runHeuristics catches stragglers
    // if any get through (belt-and-suspenders). Prospects v0.1
    // Commit 3 / FRD §6.3.
    const heuristicClients: HeuristicClient[] = clientCards
      .filter((c) => c.client_profile_id !== null && c._user_id !== null)
      .map((c) => ({
        client_profile_id: c.client_profile_id as string,
        name: c.name,
        email: c.email,
        user_id: c._user_id as string,
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
    //
    // Phase 5: the lower-bound threshold is now driven by the ?window=
    // query param (7d | 30d | all). `windowSince` is null for "all time"
    // — downstream queries skip the .gte(... ) filter in that case.
    const metricsWindow = parseWindow(req.nextUrl.searchParams.get("window"))
    const windowSince = windowThreshold(metricsWindow)

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
      // Defensive null filter: client_profile_id is nullable (NULL for
      // prospects). Today the lifecycle gate already excludes Prospect
      // from both buckets so we're safe by construction, but the
      // explicit guard makes the intent clear and future-proofs against
      // any other lifecycle ever producing a NULL cpid. Prospects v0.1
      // Commit 3 / FRD §6.3.
      if (c.client_profile_id && (ls === "Active" || ls === "Inactive")) {
        aiProfileIds.push(c.client_profile_id)
        aiAppIds.push(...c._appIds)
      }
      if (c.client_profile_id && (ls === "Active" || ls === "Inactive" || ls === "Archived")) {
        aiaProfileIds.push(c.client_profile_id)
        aiaAppIds.push(...c._appIds)
      }
    }

    // Total Applications: A+I scope, created within the active window
    // (or all-time when windowSince is null).
    let totalApplications = 0
    if (aiProfileIds.length > 0) {
      let q = supabase
        .from("signal_applications")
        .select("id", { count: "exact", head: true })
        .in("profile_id", aiProfileIds)
      if (windowSince) q = q.gte("created_at", windowSince)
      const { count } = await q
      totalApplications = count ?? 0
    }

    // Status-history rows (within the active window) for both scopes.
    // One query per scope since the app-id sets differ; both queries
    // chunk through the same table. Returned rows include
    // `application_id` so we can dedupe.
    async function transitionedAppIds(scopeAppIds: string[], toStatus: string): Promise<Set<string>> {
      if (scopeAppIds.length === 0) return new Set()
      let q = supabase
        .from("signal_applications_status_history")
        .select("application_id")
        .in("application_id", scopeAppIds)
        .eq("to_status", toStatus)
      if (windowSince) q = q.gte("changed_at", windowSince)
      const { data } = await q
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
          (windowSince === null || a.created_at >= windowSince)
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
      recentProspects: prospectCards,
      requiresAction,
      // Phase 1e: client-side beta gate for the TodaysSchedule component.
      calendar_beta_enabled: calendarBetaAllowlist().includes(coachProfileId),
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
