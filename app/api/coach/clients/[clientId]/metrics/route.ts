// app/api/coach/clients/[clientId]/metrics/route.ts
//
// Phase 2 Commit 2.4 — Client Dashboard metric tiles. Returns four
// values for the per-client metric tiles on /dashboard/coach/clients/
// [clientId] Dashboard tab:
//
//   totalJobs   all-time count of signal_applications for this client
//   interviews  apps with current status 'interviewing' OR transitioned
//               to 'interviewing' in last 30 days
//   offers      same logic with 'offer' (last 30 days)
//   rejected    same logic with 'rejected' (last 30 days)
//
// Status detection uses signal_applications_status_history changed_at
// where available, falls back to signal_applications.created_at + current
// application_status when no history row exists (the pre-2026-05-07
// no-backfill case — see supabase/migrations/20260507_coach_home_landing.sql).
//
// Distinct endpoint rather than folding into needs-attention because the
// two surfaces have different shapes — needs-attention is action items,
// this is application aggregates.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"

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

async function getCoachProfileId(userId: string, email: string | null): Promise<string | null> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("id, is_coach")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return data.is_coach ? (data.id as string) : null
  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id, is_coach")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) return byEmail.is_coach ? (byEmail.id as string) : null
  }
  return null
}

const MS_DAY = 24 * 60 * 60 * 1000
const daysAgo = (d: number) => new Date(Date.now() - d * MS_DAY).toISOString()

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId: clientProfileId } = await params
    const { userId, email } = await getAuthedUser(req)
    const coachProfileId = await getCoachProfileId(userId, email)
    if (!coachProfileId) {
      return withCorsJson(req, { ok: false, error: "Forbidden: caller is not a coach" }, 403)
    }

    const supabase = getSupabaseAdmin()

    // Verify the coach owns this client (active relationship). Mirrors the
    // pattern used by the tracker / profile / annotate routes.
    const { data: rel } = await supabase
      .from("coach_clients")
      .select("id, access_level")
      .eq("coach_profile_id", coachProfileId)
      .eq("client_profile_id", clientProfileId)
      .eq("status", "active")
      .maybeSingle()
    if (!rel) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }

    // Pull all of the client's applications + the recent status-history
    // rows. Same shape the Coach Home aggregation uses.
    const since30dIso = daysAgo(30)
    const { data: apps, error: appsErr } = await supabase
      .from("signal_applications")
      .select("id, application_status, created_at")
      .eq("profile_id", clientProfileId)
    if (appsErr) throw new Error(`Applications lookup failed: ${appsErr.message}`)
    const appList = (apps || []) as Array<{
      id: string
      application_status: string
      created_at: string
    }>

    const totalJobs = appList.length

    const appIds = appList.map((a) => a.id)
    let historyRows: Array<{ application_id: string; to_status: string; changed_at: string }> = []
    const anyHistory = new Set<string>()
    if (appIds.length > 0) {
      const { data: hist } = await supabase
        .from("signal_applications_status_history")
        .select("application_id, to_status, changed_at")
        .in("application_id", appIds)
      historyRows = (hist || []) as any
      for (const h of historyRows) anyHistory.add(h.application_id)
    }

    // Build per-target Set of app_ids that transitioned to target in 30d.
    function transitionedIn30d(target: string): Set<string> {
      const s = new Set<string>()
      for (const h of historyRows) {
        if (h.to_status === target && h.changed_at >= since30dIso) {
          s.add(h.application_id)
        }
      }
      return s
    }

    function countWithFallback(target: string): number {
      const transitioned = transitionedIn30d(target)
      let n = 0
      for (const a of appList) {
        if (transitioned.has(a.id)) { n++; continue }
        // Fallback: no history row for this app AND current status is the
        // target AND created in 30d (pre-backfill apps land here).
        if (
          !anyHistory.has(a.id) &&
          a.application_status === target &&
          a.created_at >= since30dIso
        ) n++
      }
      return n
    }

    return withCorsJson(req, {
      ok: true,
      metrics: {
        totalJobs,
        interviews: countWithFallback("interviewing"),
        offers: countWithFallback("offer"),
        rejected: countWithFallback("rejected"),
      },
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
