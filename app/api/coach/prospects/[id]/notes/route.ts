// app/api/coach/prospects/[id]/notes/route.ts
//
// Notes feed for the Prospects v0.1 surface (Commit 2b, 2026-05-23).
// FRD: docs/Features/coaches-center-prospects-frd.md §6.5
//
// Key difference from /api/coach/clients/[clientId]/note-feed/route.ts:
// the URL param is coach_clients.id (the relationship row id) instead
// of client_profiles.id. This route works for ANY lifecycle_status
// (Prospect / Active / Inactive / Archived), since notes are
// authoritatively scoped by coach_client_id post-Commit-2a. For
// prospects specifically, the parent coach_clients row has
// client_profile_id IS NULL, which is legal per Commit 1's schema
// migration.
//
// Routes:
//   POST   — create a note (body required; type optional)
//   GET    — list active (non-soft-deleted) notes; optional ?type filter
//
// Per-note operations live in ./[noteId]/route.ts.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"

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
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        const { error: attachErr } = await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
        if (attachErr) throw new Error(`Profile attach failed: ${attachErr.message}`)
      }
      return byEmail.id as string
    }
  }

  throw new Error("Profile not found")
}

// Direct-by-coach_client_id ownership check. Counterpart to
// verifyCoachAccess() in the client-keyed routes — same access-level
// hierarchy, just looks up the coach_clients row by its PK instead of
// (coach_profile_id, client_profile_id). Returns a tight subset of
// the row's columns; lifecycle_status and client_profile_id are
// surfaced so callers can branch on prospect-vs-client behavior or
// populate notes' client_profile_id link without a second lookup.
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: coachClientId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!coachClientId) return withCorsJson(req, { ok: false, error: "id is required" }, 400)

    const access = await verifyCoachClientAccess(coachClientId, profileId, "view", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }

    // Optional ?type filter. Empty / missing = all types.
    const url = new URL(req.url)
    const typeParam = url.searchParams.get("type")
    if (typeParam !== null && typeParam !== "" && !(NOTE_TYPES as readonly string[]).includes(typeParam)) {
      return withCorsJson(req, { ok: false, error: "Invalid type filter" }, 400)
    }

    // Notes are scoped by coach_client_id directly (canonical post-2a).
    // access.id == the URL param coachClientId, but we use access.id to
    // keep the trust chain explicit (helper guaranteed the row exists +
    // is owned by this coach).
    let q = supabase
      .from("coach_client_notes")
      .select("id, type, body, priority, completed_at, created_at, updated_at")
      .eq("coach_client_id", access.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (typeParam) q = q.eq("type", typeParam as NoteType)

    const { data, error } = await q
    if (error) throw new Error(`Notes list failed: ${error.message}`)

    return withCorsJson(req, { ok: true, notes: data ?? [] })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: coachClientId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!coachClientId) return withCorsJson(req, { ok: false, error: "id is required" }, 400)

    // Writing a note requires 'annotate' or 'full'. View-only coaches
    // can read but not author. Matches the existing client-keyed route.
    const access = await verifyCoachClientAccess(coachClientId, profileId, "annotate", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: annotate or full access required" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const noteBody = typeof body.body === "string" ? body.body.trim() : ""
    if (!noteBody) return withCorsJson(req, { ok: false, error: "body is required" }, 400)

    // Type defaults to 'session_recap' if absent. Explicit non-null
    // values must be one of the three valid types.
    let type: NoteType = "session_recap"
    if (body.type !== undefined && body.type !== null && body.type !== "") {
      if (!(NOTE_TYPES as readonly string[]).includes(body.type)) {
        return withCorsJson(req, { ok: false, error: "Invalid type" }, 400)
      }
      type = body.type as NoteType
    }

    // Priority is required for action_item, must be NULL for other
    // types. CHECK constraints on the table enforce this; we resolve
    // here so the caller doesn't have to know about constraint shapes.
    // Behavior parity with the existing client-keyed route: if priority
    // is sent on a non-action_item type, silently ignore it (do not
    // 400). Tightening this is a separate cross-route concern.
    let priority: NotePriority | null = null
    if (type === "action_item") {
      if (body.priority === undefined || body.priority === null || body.priority === "") {
        priority = DEFAULT_ACTION_ITEM_PRIORITY
      } else if ((NOTE_PRIORITIES as readonly string[]).includes(body.priority)) {
        priority = body.priority as NotePriority
      } else {
        return withCorsJson(req, { ok: false, error: "Invalid priority" }, 400)
      }
    }

    // client_profile_id is denormalized for index-only filtered queries
    // (per the table's schema comment). For prospects access.client_profile_id
    // is NULL, which is legal post-Commit-1's DROP NOT NULL. For Client
    // rows it's the populated profile id.
    const { data: inserted, error: insertErr } = await supabase
      .from("coach_client_notes")
      .insert({
        coach_client_id: access.id,
        coach_profile_id: profileId,
        client_profile_id: access.client_profile_id,
        type,
        body: noteBody,
        priority,
      })
      .select("id, type, body, priority, completed_at, created_at, updated_at")
      .single()

    if (insertErr) throw new Error(`Note insert failed: ${insertErr.message}`)

    return withCorsJson(req, { ok: true, note: inserted }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
