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
//   PUT    — update body, type, priority, or completed_at on a single note
//   DELETE — soft delete (sets deleted_at + updated_at)
//
// Ownership rule: the note's coach_client_id must match access.id
// returned by verifyCoachClientAccess. A 403 fires otherwise — same
// error shape as the refactored client-keyed [noteId] route (Commit 2a).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NOTE_TYPES = ["session_recap", "action_item", "other"] as const
type NoteType = (typeof NOTE_TYPES)[number]

const NOTE_PRIORITIES = ["urgent", "this_week", "when_ready"] as const
type NotePriority = (typeof NOTE_PRIORITIES)[number]
const DEFAULT_ACTION_ITEM_PRIORITY: NotePriority = "this_week"

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
    .eq("coach_profile_id", coachProfileId)
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
      .select("id, coach_client_id, type, priority, completed_at, deleted_at")
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

    const updates: Record<string, any> = {}

    if ("body" in body) {
      const trimmed = typeof body.body === "string" ? body.body.trim() : ""
      if (!trimmed) {
        return withCorsJson(req, { ok: false, error: "body cannot be empty" }, 400)
      }
      updates.body = trimmed
    }

    // Type can no longer be null. Caller must omit type to leave it as-is
    // or pass a valid enum value.
    let nextType: NoteType = existing.type as NoteType
    if ("type" in body) {
      if (body.type === null || body.type === "" || !(NOTE_TYPES as readonly string[]).includes(body.type)) {
        return withCorsJson(req, { ok: false, error: "Invalid type" }, 400)
      }
      nextType = body.type as NoteType
      updates.type = nextType
    }
    const typeChanged = "type" in body && nextType !== existing.type

    // Priority is only meaningful for action_item. Three resolution paths:
    //   (a) caller passed priority explicitly → validate it
    //   (b) type changed to action_item with no priority supplied →
    //       default if existing was null
    //   (c) type changed away from action_item → clear priority
    let nextPriority: NotePriority | null = (existing.priority as NotePriority | null) ?? null
    if ("priority" in body) {
      if (body.priority === null || body.priority === "") {
        nextPriority = null
      } else if ((NOTE_PRIORITIES as readonly string[]).includes(body.priority)) {
        nextPriority = body.priority as NotePriority
      } else {
        return withCorsJson(req, { ok: false, error: "Invalid priority" }, 400)
      }
    }

    if (nextType === "action_item" && nextPriority === null) {
      nextPriority = DEFAULT_ACTION_ITEM_PRIORITY
    }
    if (nextType !== "action_item" && nextPriority !== null) {
      nextPriority = null
    }

    if (nextPriority !== ((existing.priority as NotePriority | null) ?? null)) {
      updates.priority = nextPriority
    }

    if ("completed_at" in body) {
      // Toggling completion. The DB CHECK constraint enforces that
      // completed_at can only be set when type='action_item', but we
      // surface a clearer 400 here for the API caller.
      if (body.completed_at === null) {
        updates.completed_at = null
      } else if (typeof body.completed_at === "string") {
        const parsed = new Date(body.completed_at)
        if (Number.isNaN(parsed.getTime())) {
          return withCorsJson(req, { ok: false, error: "Invalid completed_at timestamp" }, 400)
        }
        if (nextType !== "action_item") {
          return withCorsJson(req, { ok: false, error: "completed_at can only be set on action_item notes" }, 400)
        }
        updates.completed_at = parsed.toISOString()
      } else {
        return withCorsJson(req, { ok: false, error: "Invalid completed_at value" }, 400)
      }
    } else if (typeChanged && nextType !== "action_item" && existing.completed_at) {
      // If the type changed away from action_item, clear any stale
      // completed_at to keep the row consistent with the CHECK constraint.
      updates.completed_at = null
    }

    if (Object.keys(updates).length === 0) {
      return withCorsJson(req, { ok: false, error: "No fields to update" }, 400)
    }

    updates.updated_at = new Date().toISOString()

    const { data: updated, error: updErr } = await supabase
      .from("coach_client_notes")
      .update(updates)
      .eq("id", noteId)
      .select("id, type, body, priority, completed_at, created_at, updated_at")
      .single()

    if (updErr) throw new Error(`Note update failed: ${updErr.message}`)

    return withCorsJson(req, { ok: true, note: updated })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
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

    const now = new Date().toISOString()
    const { error: delErr } = await supabase
      .from("coach_client_notes")
      .update({ deleted_at: now, updated_at: now })
      .eq("id", noteId)

    if (delErr) throw new Error(`Note delete failed: ${delErr.message}`)

    return withCorsJson(req, { ok: true })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
