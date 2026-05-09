// app/api/coach/clients/[clientId]/since-last-visit/route.ts
//
// Returns the bulleted "since your last visit" activity for one client,
// using the coach_clients.last_viewed_at timestamp as the baseline.
// Activity buckets (matching /api/coach/home's per-client logic):
//   - new applications added
//   - application status transitions (signal_applications_status_history)
//   - client responses to coach recommendations
//
// Notes added by the coach themselves are NOT activity — coach already
// knows about their own notes. Notes by other actors don't exist in the
// pilot data model.
//
// The route reads last_viewed_at, computes activity since that value,
// and returns both. The fire-and-forget bump on /profile is independent;
// race is benign (both target NOW).

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

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return data.id as string
  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) return byEmail.id as string
  }
  throw new Error("Profile not found")
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

type ActivityItem = {
  kind: "application_added" | "status_change" | "rec_response"
  text: string
  occurred_at: string
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId: clientProfileId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "clientId is required" }, 400)

    // Read coach_clients link + last_viewed_at + accepted_at in one query.
    const { data: link } = await supabase
      .from("coach_clients")
      .select("id, status, access_level, last_viewed_at, accepted_at")
      .eq("coach_profile_id", profileId)
      .eq("client_profile_id", clientProfileId)
      .eq("status", "active")
      .maybeSingle()
    if (!link) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }

    // If never viewed, fall back to accepted_at as the baseline. Avoids
    // showing "all time" activity on first visit.
    const baseline =
      link.last_viewed_at || link.accepted_at || new Date(Date.now() - 14 * 86400_000).toISOString()

    // ── Apps for this client (used for both new-app activity + status FK) ──
    const { data: apps } = await supabase
      .from("signal_applications")
      .select("id, company_name, job_title, application_status, created_at")
      .eq("profile_id", clientProfileId)
    const appById = new Map<string, { company_name: string; job_title: string }>(
      (apps ?? []).map((a) => [a.id as string, { company_name: a.company_name, job_title: a.job_title }])
    )

    const newApps = (apps ?? []).filter((a) => a.created_at > baseline)

    // ── Status changes since baseline ─────────────────────────────────
    const appIds = (apps ?? []).map((a) => a.id)
    let statusChanges: any[] = []
    if (appIds.length > 0) {
      const { data: hist } = await supabase
        .from("signal_applications_status_history")
        .select("id, application_id, from_status, to_status, changed_at")
        .in("application_id", appIds)
        .gt("changed_at", baseline)
        .order("changed_at", { ascending: false })
      statusChanges = hist ?? []
    }

    // ── Client responses to this coach's recs since baseline ───────────
    const { data: recResponses } = await supabase
      .from("coach_job_recommendations")
      .select("id, company_name, job_title, client_status, client_responded_at")
      .eq("coach_profile_id", profileId)
      .eq("client_profile_id", clientProfileId)
      .gt("client_responded_at", baseline)
      .order("client_responded_at", { ascending: false })

    const items: ActivityItem[] = []

    for (const a of newApps) {
      items.push({
        kind: "application_added",
        text: `Added ${a.company_name || "an application"}${a.job_title ? ` — ${a.job_title}` : ""}`,
        occurred_at: a.created_at,
      })
    }

    for (const h of statusChanges) {
      const ctx = appById.get(h.application_id as string)
      const co = ctx?.company_name || "an application"
      items.push({
        kind: "status_change",
        text: `Moved ${co} → ${(h.to_status as string).replace(/_/g, " ")}`,
        occurred_at: h.changed_at as string,
      })
    }

    for (const r of recResponses ?? []) {
      const co = r.company_name || "a recommendation"
      items.push({
        kind: "rec_response",
        text: `Responded ${(r.client_status as string)} on ${co}`,
        occurred_at: r.client_responded_at as string,
      })
    }

    // Newest first across all kinds. Cap at 10 to keep the strip readable.
    items.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    const capped = items.slice(0, 10)

    return withCorsJson(req, {
      ok: true,
      baseline,
      activity: capped,
      total_count: items.length,
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
