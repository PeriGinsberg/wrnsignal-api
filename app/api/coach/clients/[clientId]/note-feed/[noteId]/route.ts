// app/api/coach/clients/[clientId]/note-feed/[noteId]/route.ts
//
// Per-note operations on the typed-notes feed.
//
// Routes:
//   PUT    — update body, type or topic (see lib/notes/edit.ts)
//   DELETE — soft delete (sets deleted_at)
//
// Both routes require the authenticated coach to own the note (i.e.
// coach_profile_id matches). verifyCoachAccess on the parent client is
// the access gate; the per-note coach_profile_id check enforces that
// one coach can't edit another coach's notes for a shared client.

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

async function verifyCoachAccess(coachProfileId: string, clientProfileId: string, requiredLevel: string, supabase: any) {
  const levels: Record<string, string[]> = { view: ["view", "annotate", "full"], annotate: ["annotate", "full"], full: ["full"] }
  // A DELEGATE coach acts inside a principal's practice, so the row that grants
  // access may belong to the principal rather than the caller. Match any coach
  // this caller may act as and keep the strongest row; a delegation can only add
  // access, never lower what the caller already held in their own right.
  const { actingIds } = await resolveDelegation(supabase, coachProfileId)
  const { data, error } = await supabase
    .from("coach_clients")
    .select("id, access_level, status, coach_profile_id")
    .in("coach_profile_id", actingIds)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
  if (error) throw new Error(`coach_clients lookup failed: ${error.message}`)
  const rank: Record<string, number> = { view: 1, annotate: 2, full: 3 }
  const granted = (data ?? [])
    .filter((r: any) => levels[requiredLevel]?.includes(r.access_level))
    .sort((a: any, b: any) => rank[b.access_level] - rank[a.access_level])[0]
  return granted ?? null
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string; noteId: string }> }
) {
  try {
    const { clientId: clientProfileId, noteId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!clientProfileId || !noteId) {
      return withCorsJson(req, { ok: false, error: "clientId and noteId are required" }, 400)
    }

    const access = await verifyCoachAccess(profileId, clientProfileId, "annotate", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: annotate or full access required" }, 403)
    }

    // Load existing note + ownership check. Excludes soft-deleted rows so
    // a deleted note can't be re-edited back to life. Ownership is now
    // verified via coach_client_id (which uniquely identifies the
    // coach-client pair) instead of the legacy two-step coach_profile_id
    // + client_profile_id check. access.id came from verifyCoachAccess
    // above and is guaranteed to be the coach_clients row for (this
    // coach, this client). Canonicalized 2026-05-23, Prospects v0.1
    // Commit 2a — forward-compatible with prospect notes where
    // client_profile_id is NULL.
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
  { params }: { params: Promise<{ clientId: string; noteId: string }> }
) {
  try {
    const { clientId: clientProfileId, noteId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!clientProfileId || !noteId) {
      return withCorsJson(req, { ok: false, error: "clientId and noteId are required" }, 400)
    }

    const access = await verifyCoachAccess(profileId, clientProfileId, "annotate", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: annotate or full access required" }, 403)
    }

    // Ownership now verified via coach_client_id (see PUT handler comment).
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
