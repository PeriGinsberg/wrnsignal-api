// app/api/me/activities/[activity_id]/route.ts
//
// CLIENT-FACING WRITE — a coached client marks one of THEIR OWN engagement
// activities (owner 'client' or 'both') not_started → in_progress → complete.
// This is the first client write path; the INVERTED ownership guard is the
// load-bearing piece: it proves client ownership by walking the chain from the
// client_profile_id end (the mirror of the coach route's coach_profile_id walk).
//
// PATCH { status } — writes ONLY coach_client_engagement_activities.status for
// the one [activity_id]. Plain-client identity (getBearerToken → getAuthedUser →
// getProfileId); NOT coachAuth (no is_coach / no resolveCoach). Service-role
// bypasses RLS, so the explicit walk + owner re-check ARE the guard.
//
// The guard (every failure → 404, never leak):
//   1. my ACTIVE coach relationship (active-only writes);
//   2. the activity exists (capture prior status for event de-dup);
//   3. owner ∈ ('client','both') — a client cannot write a coach-only activity
//      EVEN on their own engagement (re-checked server-side, never trusted);
//   4. activity → deliverable → engagement, and engagement.coach_client_id ===
//      my active relationship id — this is what blocks another client's activity
//      (its chain won't terminate at MY relationship).
//
// On a transition INTO complete, mirrors the coach route's de-duped
// activity_completed event, attributed to the client (actor + by_client:true),
// landing in the SAME coach_client_events the coach's History reads.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getActiveCoachRelationship } from "../../../_lib/coachedClient"
import { ACTIVITY_STATUSES, isValidActivityStatus } from "../../../_lib/coachEngagements"
import { logCoachClientEvent } from "../../../_lib/coachClientEvents"

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
  const { data, error } = await supabase
    .from("client_profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string

  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles")
      .select("id, user_id")
      .eq("email", email)
      .maybeSingle()
    if (emailErr) throw new Error(`Profile email lookup failed: ${emailErr.message}`)
    if (byEmail) return byEmail.id as string
  }
  throw new Error("Profile not found")
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ activity_id: string }> },
) {
  try {
    const { activity_id } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }
    if (!isValidActivityStatus(body.status)) {
      return withCorsJson(req, { ok: false, error: `status must be one of: ${ACTIVITY_STATUSES.join(", ")}` }, 400)
    }
    const nextStatus = body.status

    const supabase = getSupabaseAdmin()

    // (1) My ACTIVE coach relationship. None (no row / paused / revoked /
    //     pending) → 404: a non-active client has nothing to write.
    const rel = await getActiveCoachRelationship(supabase, profileId)
    if (!rel) return withCorsJson(req, { ok: false, error: "Activity not found" }, 404)

    // (2) The activity — prior status for event de-dup, owner + name + chain.
    const { data: activity, error: actErr } = await supabase
      .from("coach_client_engagement_activities")
      .select("id, name, status, owner, engagement_deliverable_id")
      .eq("id", activity_id)
      .maybeSingle()
    if (actErr) return withCorsJson(req, { ok: false, error: `Failed to read activity: ${actErr.message}` }, 500)
    if (!activity) return withCorsJson(req, { ok: false, error: "Activity not found" }, 404)

    // (3) Owner re-check — a client may only write 'client'/'both' activities,
    //     even on their own engagement. Never trust the caller's id choice.
    if (activity.owner !== "client" && activity.owner !== "both") {
      return withCorsJson(req, { ok: false, error: "Activity not found" }, 404)
    }

    // (4) Walk up to the engagement and require it terminates at MY active
    //     relationship. This blocks another client's activity.
    const { data: deliverable, error: delErr } = await supabase
      .from("coach_client_engagement_deliverables")
      .select("engagement_id")
      .eq("id", activity.engagement_deliverable_id)
      .maybeSingle()
    if (delErr) return withCorsJson(req, { ok: false, error: `Failed to read deliverable: ${delErr.message}` }, 500)
    if (!deliverable) return withCorsJson(req, { ok: false, error: "Activity not found" }, 404)

    const { data: engagement, error: engErr } = await supabase
      .from("coach_client_engagements")
      .select("id, coach_client_id, name")
      .eq("id", deliverable.engagement_id)
      .maybeSingle()
    if (engErr) return withCorsJson(req, { ok: false, error: `Failed to read engagement: ${engErr.message}` }, 500)
    if (!engagement || engagement.coach_client_id !== rel.id) {
      return withCorsJson(req, { ok: false, error: "Activity not found" }, 404)
    }

    const priorStatus = activity.status as string

    // Write ONLY status on ONLY this activity (chain verified above).
    const { error: upErr } = await supabase
      .from("coach_client_engagement_activities")
      .update({ status: nextStatus })
      .eq("id", activity_id)
    if (upErr) {
      return withCorsJson(req, { ok: false, error: `Failed to update activity status: ${upErr.message}` }, 500)
    }

    // Best-effort event — ONLY on a transition INTO complete (de-dup on prior),
    // attributed to the client. Lands in coach_client_events for rel.id (the
    // coach's History source). Mirrors the coach route; never throws.
    if (nextStatus === "complete" && priorStatus !== "complete") {
      await logCoachClientEvent({
        coachClientId: rel.id,
        eventType: "activity_completed",
        actorProfileId: profileId,
        context: { name: activity.name, engagement_name: engagement.name, by_client: true },
      })
    }

    return withCorsJson(req, {
      ok: true,
      activity: { id: activity.id, name: activity.name, status: nextStatus, owner: activity.owner },
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
