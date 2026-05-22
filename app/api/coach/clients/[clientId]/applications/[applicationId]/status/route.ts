// app/api/coach/clients/[clientId]/applications/[applicationId]/status/route.ts
//
// Phase 3 Commit 3.1 — coach edits an application's status from the
// Client Detail Job Tracker tab. Writes to signal_applications +
// signal_applications_status_history. Silent — no client-side
// notification beyond the next time they look at their tracker.
//
// Authorization: 'full' (matches the precedent set by other routes
// that modify the client's record — profile PATCH, personas, recommend-job).
// Status validation uses the shared APP_STATUSES allowlist so server +
// client + the coach edit pill agree on what's pickable. The
// 'coach_recommended' value is intentionally NOT in the allowlist —
// it's set by the rec-creation flow, not by manual edit; a coach
// transitioning a coach_recommended-status app picks one of the 6
// pickable values to move it forward, and the original state is
// preserved in status_history.
//
// History write reuses the existing logStatusChange helper from
// app/api/_lib/applicationStatusHistory.ts so the transition feeds
// the engagement heuristic engine (Phase 3.0) the same way the
// client's own status edits do. Net result: a coach changing
// applied → interviewing will trigger R3 (moved_interviewing) on
// both Coach Home and Client Dashboard once the days threshold hits.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../../../_lib/cors"
import { logStatusChange } from "../../../../../../_lib/applicationStatusHistory"
import {
  APP_STATUSES,
  isValidApplicationStatus,
} from "../../../../../../../_lib/applicationStatuses"

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

async function verifyCoachAccess(
  coachProfileId: string,
  clientProfileId: string,
  requiredLevel: "view" | "annotate" | "full",
  supabase: any,
) {
  const levels: Record<string, string[]> = {
    view: ["view", "annotate", "full"],
    annotate: ["annotate", "full"],
    full: ["full"],
  }
  const { data } = await supabase
    .from("coach_clients")
    .select("id, access_level, status")
    .eq("coach_profile_id", coachProfileId)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
    .maybeSingle()
  if (!data) return null
  if (!levels[requiredLevel]?.includes(data.access_level)) return null
  return data
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string; applicationId: string }> },
) {
  try {
    const { clientId: clientProfileId, applicationId } = await params
    const { userId, email } = await getAuthedUser(req)
    const coachProfileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!clientProfileId) {
      return withCorsJson(req, { ok: false, error: "clientId is required" }, 400)
    }
    if (!applicationId) {
      return withCorsJson(req, { ok: false, error: "applicationId is required" }, 400)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }
    const nextStatus = (body as any).status
    if (!isValidApplicationStatus(nextStatus)) {
      return withCorsJson(
        req,
        {
          ok: false,
          error: `Invalid status. Allowed: ${APP_STATUSES.join(", ")}`,
        },
        400,
      )
    }

    // Authz: coach must have 'full' access to this client (matches the
    // precedent for routes that modify the client's record — profile
    // PATCH, personas, recommend-job).
    const access = await verifyCoachAccess(coachProfileId, clientProfileId, "full", supabase)
    if (!access) {
      return withCorsJson(
        req,
        { ok: false, error: "Forbidden: full coach access required" },
        403,
      )
    }

    // Verify the application belongs to the client we're scoped to.
    // Capture the pre-update status so logStatusChange has from/to.
    const { data: existing, error: lookupErr } = await supabase
      .from("signal_applications")
      .select("id, profile_id, application_status")
      .eq("id", applicationId)
      .maybeSingle()
    if (lookupErr) throw new Error(`Application lookup failed: ${lookupErr.message}`)
    if (!existing) {
      return withCorsJson(req, { ok: false, error: "Application not found" }, 404)
    }
    if (existing.profile_id !== clientProfileId) {
      return withCorsJson(
        req,
        { ok: false, error: "Application does not belong to this client" },
        404,
      )
    }

    const fromStatus = existing.application_status as string
    if (fromStatus === nextStatus) {
      // No-op write — return the row unchanged so the client can reconcile
      // without an extra request.
      return withCorsJson(req, { ok: true, application: existing })
    }

    const { data: updated, error: updateErr } = await supabase
      .from("signal_applications")
      .update({
        application_status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicationId)
      .select("*")
      .single()
    if (updateErr) throw new Error(`Application status update failed: ${updateErr.message}`)

    // History: changed_by = the COACH's profile_id (so the audit row
    // attributes the change to the coach, not the client). The
    // engagement heuristic engine (R3-R5) reads to_status + changed_at;
    // changed_by is informational.
    await logStatusChange(
      supabase,
      applicationId,
      fromStatus,
      nextStatus,
      coachProfileId,
    )

    return withCorsJson(req, { ok: true, application: updated })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
