// app/api/coach/prospects/[id]/notes/[noteId]/route.ts
//
// Per-note operations for the Prospects v0.1 surface (Commit 2b,
// 2026-05-23). FRD: docs/Features/coaches-center-prospects-frd.md §6.5.
//
// Counterpart to /api/coach/clients/[clientId]/note-feed/[noteId]/route.ts
// but keyed on coach_clients.id directly. Works for any
// lifecycle_status (Prospect / Active / Inactive / Archived) since
// ownership is verified via coach_client_id alone (canonical
// post-Commit-2a).
//
// Routes:
//   PUT    — update body, type or topic (see lib/notes/edit.ts)
//   DELETE — soft delete (sets deleted_at + updated_at)
//
// Ownership rule: the note's coach_client_id must match access.id
// returned by verifyCoachClientAccess. A 403 fires otherwise — same
// error shape as the refactored client-keyed [noteId] route (Commit 2a).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { resolveDelegation } from "@/lib/collab/delegation"
import { deleteNote, editNote, type ExistingNote } from "@/lib/notes/edit"
import { getAuthedUser, getProfileId } from "@/lib/collab/identity"
import { errorStatus } from "@/app/api/_lib/routeError"


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

// Same helper as the GET/POST sibling (./route.ts). Inlined per route
// file per the established coach-route duplication pattern.
async function verifyCoachClientAccess(
  coachClientId: string,
  coachProfileId: string,
  requiredLevel: string,
  supabase: any,
): Promise<{
  id: string
  access_level: string
  status: string
  lifecycle_status: string
  client_profile_id: string | null
} | null> {
  const levels: Record<string, string[]> = {
    view: ["view", "annotate", "full"],
    annotate: ["annotate", "full"],
    full: ["full"],
  }
  const { data } = await supabase
    .from("coach_clients")
    .select("id, access_level, status, lifecycle_status, client_profile_id")
    .eq("id", coachClientId)
    .in("coach_profile_id", (await resolveDelegation(supabase, coachProfileId)).actingIds)
    .eq("status", "active")
    .maybeSingle()
  if (!data) return null
  if (!levels[requiredLevel]?.includes(data.access_level)) return null
  return data
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const { id: coachClientId, noteId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!coachClientId || !noteId) {
      return withCorsJson(req, { ok: false, error: "id and noteId are required" }, 400)
    }

    const access = await verifyCoachClientAccess(coachClientId, profileId, "annotate", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: annotate or full access required" }, 403)
    }

    // Load existing note + ownership check. Excludes soft-deleted rows
    // so a deleted note can't be re-edited back to life. Ownership is
    // verified via coach_client_id (canonical post-Commit-2a).
    const { data: existing, error: readErr } = await supabase
      .from("coach_client_notes")
      .select("id, coach_client_id, client_profile_id, type, topic, body, priority, completed_at, deleted_at")
      .eq("id", noteId)
      .maybeSingle()
    if (readErr) throw new Error(`Note read failed: ${readErr.message}`)
    if (!existing || existing.deleted_at) {
      return withCorsJson(req, { ok: false, error: "Note not found" }, 404)
    }
    if (existing.coach_client_id !== access.id) {
      return withCorsJson(req, { ok: false, error: "Forbidden: note does not belong to this coach-client relationship" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    // What an edit means lives in lib/notes/edit.ts, shared with the other
    // note route. This route decides only who may make it.
    const result = await editNote(supabase, existing as ExistingNote, body)
    return withCorsJson(req, result.json, result.status)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const { id: coachClientId, noteId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!coachClientId || !noteId) {
      return withCorsJson(req, { ok: false, error: "id and noteId are required" }, 400)
    }

    const access = await verifyCoachClientAccess(coachClientId, profileId, "annotate", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: annotate or full access required" }, 403)
    }

    // Ownership verified via coach_client_id (canonical post-Commit-2a).
    // Soft-delete is idempotent at the caller level: a second DELETE of
    // an already-deleted note returns 404 "Note not found" because the
    // load query filters on deleted_at IS NULL.
    const { data: existing, error: readErr } = await supabase
      .from("coach_client_notes")
      .select("id, coach_client_id, deleted_at")
      .eq("id", noteId)
      .maybeSingle()
    if (readErr) throw new Error(`Note read failed: ${readErr.message}`)
    if (!existing || existing.deleted_at) {
      return withCorsJson(req, { ok: false, error: "Note not found" }, 404)
    }
    if (existing.coach_client_id !== access.id) {
      return withCorsJson(req, { ok: false, error: "Forbidden: note does not belong to this coach-client relationship" }, 403)
    }

    // Soft delete. An old action item's task is its own record and stays.
    await deleteNote(supabase, noteId)

    return withCorsJson(req, { ok: true })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
