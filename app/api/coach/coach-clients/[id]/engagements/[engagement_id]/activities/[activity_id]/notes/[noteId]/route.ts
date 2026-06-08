// app/api/coach/coach-clients/[id]/engagements/[engagement_id]/activities/[activity_id]/notes/[noteId]/route.ts
//
// Per-note operations on a FROZEN engagement activity's notes.
//   PUT    — { body?, visible_to_client?, action_required? } edit in place (allow-list).
//   DELETE — soft-delete (deleted_at = now()).
//
// SECURITY — the SAME three-level ownership walk as the collection route
// (resolveOwnedEngagementActivity), PLUS a 4th nested-resource check: the note's
// engagement_activity_id must equal [activity_id], so a note can't be reached via a
// DIFFERENT activity the coach also owns. Any failure → 404. Soft-deleted notes read
// as 404 (can't be re-edited back to life).

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  resolveOwnedEngagementActivity,
} from "../../../../../../../../../_lib/coachEngagements"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_NOTE_LEN = 5000
const NOTE_SELECT = "id, body, visible_to_client, action_required, created_at, updated_at"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// Walk ownership of the activity, then load the note and confirm it belongs to
// THIS activity and isn't soft-deleted. Returns the note row or an error Response.
async function loadOwnedNote(
  req: NextRequest,
  supabase: ReturnType<typeof getSupabaseAdmin>,
  coachProfileId: string,
  id: string,
  engagement_id: string,
  activity_id: string,
  noteId: string,
): Promise<{ note: { id: string; engagement_activity_id: string; deleted_at: string | null }; error?: undefined } | { note?: undefined; error: Response }> {
  const owned = await resolveOwnedEngagementActivity(supabase, coachProfileId, id, engagement_id, activity_id)
  if (!owned) return { error: withCorsJson(req, { ok: false, error: "Activity not found" }, 404) }

  const { data: note, error: readErr } = await supabase
    .from("coach_client_activity_notes")
    .select("id, engagement_activity_id, deleted_at")
    .eq("id", noteId)
    .maybeSingle()
  if (readErr) return { error: withCorsJson(req, { ok: false, error: `Failed to read note: ${readErr.message}` }, 500) }
  // 4th check: the note must belong to THIS activity (nested-resource guard).
  if (!note || note.deleted_at || note.engagement_activity_id !== activity_id) {
    return { error: withCorsJson(req, { ok: false, error: "Note not found" }, 404) }
  }
  return { note }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string; activity_id: string; noteId: string }> },
) {
  try {
    const { id, engagement_id, activity_id, noteId } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    // Allow-list: body, visible_to_client, action_required. Validate any present.
    const updates: { body?: string; visible_to_client?: boolean; action_required?: boolean } = {}
    if ("body" in body) {
      const trimmed = typeof body.body === "string" ? body.body.trim() : ""
      if (!trimmed) return withCorsJson(req, { ok: false, error: "body cannot be empty" }, 400)
      if (trimmed.length > MAX_NOTE_LEN) {
        return withCorsJson(req, { ok: false, error: `body exceeds ${MAX_NOTE_LEN} characters` }, 400)
      }
      updates.body = trimmed
    }
    if ("visible_to_client" in body) {
      if (typeof body.visible_to_client !== "boolean") {
        return withCorsJson(req, { ok: false, error: "visible_to_client must be a boolean" }, 400)
      }
      updates.visible_to_client = body.visible_to_client
    }
    if ("action_required" in body) {
      if (typeof body.action_required !== "boolean") {
        return withCorsJson(req, { ok: false, error: "action_required must be a boolean" }, 400)
      }
      updates.action_required = body.action_required
    }
    if (Object.keys(updates).length === 0) {
      return withCorsJson(req, { ok: false, error: "No fields to update" }, 400)
    }

    const supabase = getSupabaseAdmin()
    const owned = await loadOwnedNote(req, supabase, coachProfileId, id, engagement_id, activity_id, noteId)
    if (owned.error) return owned.error

    const { data: updated, error: updErr } = await supabase
      .from("coach_client_activity_notes")
      .update(updates) // updated_at maintained by trg_activity_notes_set_updated_at
      .eq("id", noteId)
      .select(NOTE_SELECT)
      .single()
    if (updErr) return withCorsJson(req, { ok: false, error: `Failed to update note: ${updErr.message}` }, 500)

    return withCorsJson(req, { ok: true, note: updated })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string; activity_id: string; noteId: string }> },
) {
  try {
    const { id, engagement_id, activity_id, noteId } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    const owned = await loadOwnedNote(req, supabase, coachProfileId, id, engagement_id, activity_id, noteId)
    if (owned.error) return owned.error

    const { error: delErr } = await supabase
      .from("coach_client_activity_notes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", noteId)
    if (delErr) return withCorsJson(req, { ok: false, error: `Failed to delete note: ${delErr.message}` }, 500)

    return withCorsJson(req, { ok: true })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
