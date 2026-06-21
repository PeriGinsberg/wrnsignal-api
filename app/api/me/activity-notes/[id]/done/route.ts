// app/api/me/activity-notes/[id]/done/route.ts
//
// CLIENT-FACING WRITE — a coached client marks a coach action-required note
// DONE. Sets coach_client_activity_notes.client_done_at = now() (a coach-visible
// acknowledgement; one-way/idempotent). Mirrors the activity PATCH ownership
// walk, but from the NOTE end: note → activity → deliverable → engagement, and
// the engagement must terminate at MY active relationship. Every failure → 404
// (never leak). Also requires the note be client-owned + visible_to_client +
// action_required — a client may only "do" a task the coach actually surfaced.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { getActiveCoachRelationship } from "../../../../_lib/coachedClient"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
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
  return { userId: data.user.id, email: (data.user.email ?? "").trim().toLowerCase() || null }
}

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_profiles").select("id, user_id").eq("user_id", userId).maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string
  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles").select("id, user_id").eq("email", email).maybeSingle()
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
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // (1) My ACTIVE coach relationship — none → 404.
    const rel = await getActiveCoachRelationship(supabase, profileId)
    if (!rel) return withCorsJson(req, { ok: false, error: "Note not found" }, 404)

    // (2) The note — exists, not deleted, mine, and a client-visible action item.
    const { data: note, error: noteErr } = await supabase
      .from("coach_client_activity_notes")
      .select("id, engagement_activity_id, client_profile_id, visible_to_client, action_required, client_done_at, deleted_at")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle()
    if (noteErr) return withCorsJson(req, { ok: false, error: `Failed to read note: ${noteErr.message}` }, 500)
    if (!note || note.client_profile_id !== profileId || !note.visible_to_client || !note.action_required) {
      return withCorsJson(req, { ok: false, error: "Note not found" }, 404)
    }

    // (3) Walk note → activity → deliverable → engagement; require it terminates
    //     at MY active relationship (blocks a note on another client's engagement).
    const { data: activity, error: actErr } = await supabase
      .from("coach_client_engagement_activities")
      .select("id, engagement_deliverable_id")
      .eq("id", note.engagement_activity_id)
      .maybeSingle()
    if (actErr) return withCorsJson(req, { ok: false, error: `Failed to read activity: ${actErr.message}` }, 500)
    if (!activity) return withCorsJson(req, { ok: false, error: "Note not found" }, 404)

    const { data: deliverable, error: delErr } = await supabase
      .from("coach_client_engagement_deliverables")
      .select("engagement_id")
      .eq("id", activity.engagement_deliverable_id)
      .maybeSingle()
    if (delErr) return withCorsJson(req, { ok: false, error: `Failed to read deliverable: ${delErr.message}` }, 500)
    if (!deliverable) return withCorsJson(req, { ok: false, error: "Note not found" }, 404)

    const { data: engagement, error: engErr } = await supabase
      .from("coach_client_engagements")
      .select("id, coach_client_id")
      .eq("id", deliverable.engagement_id)
      .maybeSingle()
    if (engErr) return withCorsJson(req, { ok: false, error: `Failed to read engagement: ${engErr.message}` }, 500)
    if (!engagement || engagement.coach_client_id !== rel.id) {
      return withCorsJson(req, { ok: false, error: "Note not found" }, 404)
    }

    // (4) One-way + idempotent: set client_done_at only if not already set.
    const doneAt = note.client_done_at || new Date().toISOString()
    if (!note.client_done_at) {
      const { error: upErr } = await supabase
        .from("coach_client_activity_notes")
        .update({ client_done_at: doneAt })
        .eq("id", id)
      if (upErr) return withCorsJson(req, { ok: false, error: `Failed to mark done: ${upErr.message}` }, 500)
    }

    return withCorsJson(req, { ok: true, note: { id, client_done_at: doneAt } })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
