// app/api/coach/clients/[clientId]/note-feed/route.ts
//
// Typed-notes feed for the coach client detail experience (Phase 1 of the
// Client Dashboard build). Distinct from the legacy single-string
// /api/coach/clients/[clientId]/notes route which patches
// coach_clients.private_notes.
//
// Routes:
//   POST   — create a note (body required; type and topic optional)
//   GET    — list active (non-soft-deleted) notes; optional ?type filter
//
// Per-note operations live in ./[noteId]/route.ts.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { coachClientIdsForClient } from "../../../../_lib/coachClientIds"
import { resolveDelegation } from "@/lib/collab/delegation"
import { withNoteTasks } from "@/lib/notes/actionItems"
import { NOTE_COLUMNS, parseNoteCreate } from "@/lib/notes/model"
import { getAuthedUser, getProfileId } from "@/lib/collab/identity"
import { errorStatus } from "@/app/api/_lib/routeError"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The ?type filter accepts the retired action_item too: those rows still exist.
const NOTE_TYPES = ["session_recap", "action_item", "other"] as const
type NoteType = (typeof NOTE_TYPES)[number]


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

    const access = await verifyCoachAccess(profileId, clientProfileId, "view", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }

    // Optional ?type filter. Empty / missing = all types (including untyped).
    const url = new URL(req.url)
    const typeParam = url.searchParams.get("type")
    if (typeParam !== null && typeParam !== "" && !(NOTE_TYPES as readonly string[]).includes(typeParam)) {
      return withCorsJson(req, { ok: false, error: "Invalid type filter" }, 400)
    }

    // Shape-1 collaboration: scope to the SET of coach_client_id rows for this
    // client (ALL statuses — a soft-revoked coach's authored notes persist),
    // so every collaborating coach reads one shared feed. Byte-identical for a
    // solo client (exactly one coach_clients row per the (coach_profile_id,
    // client_profile_id) unique constraint). Scoping by the coach_client_id set
    // — not client_profile_id — also keeps prospect-era notes whose
    // client_profile_id is NULL: they live on a coach_client_id in the set.
    const ccIds = await coachClientIdsForClient(supabase, clientProfileId)
    let q = supabase
      .from("coach_client_notes")
      .select("id, type, topic, body, priority, completed_at, created_at, updated_at, coach_profile_id")
      .in("coach_client_id", ccIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (typeParam) q = q.eq("type", typeParam as NoteType)

    const { data, error } = await q
    if (error) throw new Error(`Notes list failed: ${error.message}`)

    // Author attribution (additive display). Batch-resolve coach_profile_id →
    // client_profiles.name. LEFT-join-safe: rows come from the notes query and
    // are only annotated, so an author that fails to resolve is just
    // author_name: null (UI falls back to initials) — the note is never dropped.
    // is_self lets the UI render "you" vs the other coach's name.
    const notesRows = data ?? []
    const authorIds = Array.from(
      new Set(notesRows.map((n: any) => n.coach_profile_id as string).filter(Boolean)),
    )
    const authorNameById = new Map<string, string | null>()
    if (authorIds.length > 0) {
      const { data: authors } = await supabase.from("client_profiles").select("id, name").in("id", authorIds)
      for (const a of authors ?? []) authorNameById.set(a.id as string, (a.name as string | null) ?? null)
    }
    const notes = await withNoteTasks(supabase, notesRows.map((n: any) => ({
      ...n,
      author_name: authorNameById.get(n.coach_profile_id as string) ?? null,
      is_self: n.coach_profile_id === profileId,
    })))

    return withCorsJson(req, { ok: true, notes })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId: clientProfileId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "clientId is required" }, 400)

    // Pilot decision (mirrors profile PATCH): writing a note requires
    // 'annotate' or 'full' access. View-only coaches can read but not author.
    const access = await verifyCoachAccess(profileId, clientProfileId, "annotate", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: annotate or full access required" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    // Recap or Other, with an optional topic. Action Item is refused: work to
    // do is a task (lib/notes/model.ts).
    const parsed = parseNoteCreate(body)
    if (!parsed.ok) return withCorsJson(req, { ok: false, error: parsed.error }, 400)

    const { data: inserted, error: insertErr } = await supabase
      .from("coach_client_notes")
      .insert({
        coach_client_id: access.id,
        coach_profile_id: profileId,
        client_profile_id: clientProfileId,
        ...parsed.value,
      })
      .select(NOTE_COLUMNS)
      .single()

    if (insertErr) throw new Error(`Note insert failed: ${insertErr.message}`)
    return withCorsJson(req, { ok: true, note: { ...inserted, task: null } }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
