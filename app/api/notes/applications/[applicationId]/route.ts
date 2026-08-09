// app/api/notes/applications/[applicationId]/route.ts
//
// Client-side coach-client notes: a CLIENT reads notes on their own job and
// writes their own notes. Client-facing path (not under /coach). No coach access
// check — gated purely by OWNERSHIP, exactly like GET /api/runs/[id].
//
// AUTH (shared by GET + POST):
//   1. resolveCaller -> profileId (the client). isCoach is irrelevant here.
//   2. load the application by applicationId ONLY
//   3. ownerClientId = application.profile_id; if it != profileId -> 403
//      (the caller must OWN this job). No verifyCoachAccess.
//
// READ (GET): notes for this job the client may see —
//   - the client's OWN notes (author_role='client'): private AND shared
//   - coach notes that are SHARED (author_role='coach' AND visibility='shared')
//   Coach PRIVATE notes are never returned. Newest-first.
//
// WRITE (POST): body { artifact_type, body, visibility, parent_note_id? }.
//   Server-set (never from body): client_profile_id = ownerClientId(=profileId),
//   author_role = 'client', coach_profile_id = null, jobfit_run_id = the app's
//   run, parent_note_id = null (replies land in the next step; any body value is
//   ignored for now). Body supplies only artifact_type / body / visibility.
//
// The API uses service-role (bypasses RLS), so the query filters here are the
// guard; the coaching_notes RLS policies are defense-in-depth for direct access.

import { type NextRequest } from "next/server"
import { type SupabaseClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ARTIFACT_TYPES = new Set(["jobfit", "coverletter"])
const VISIBILITIES = new Set(["private", "shared"])

type OwnerOk = {
  ok: true
  supabase: SupabaseClient
  profileId: string
  ownerClientId: string
  jobfitRunId: string | null
}
type OwnerErr = { ok: false; status: number; error: string }

// Ownership gate. resolveCaller may throw (Unauthorized / Profile not found);
// the handler's catch maps those to 401/404.
async function authorizeOwner(req: Request, applicationId: string): Promise<OwnerOk | OwnerErr> {
  if (!applicationId) return { ok: false, status: 400, error: "applicationId is required" }

  const { profileId } = await resolveCaller(req) // client identity; isCoach not used here
  const supabase = getSupabaseAdmin()

  const { data: app, error: appErr } = await supabase
    .from("signal_applications")
    .select("id, profile_id, jobfit_run_id")
    .eq("id", applicationId)
    .maybeSingle()
  if (appErr) throw new Error(`Application lookup failed: ${appErr.message}`)
  if (!app) return { ok: false, status: 404, error: "Application not found" }

  const ownerClientId = app.profile_id as string | null
  if (!ownerClientId) return { ok: false, status: 404, error: "Application has no owner" }

  // Ownership check — the caller must own this job (mirrors /api/runs/[id]).
  if (ownerClientId !== profileId) {
    return { ok: false, status: 403, error: "Forbidden: you do not own this job" }
  }

  return { ok: true, supabase, profileId, ownerClientId, jobfitRunId: (app.jobfit_run_id as string) ?? null }
}

function mapError(err: any): { status: number; error: string } {
  const msg = err?.message || String(err)
  const lower = msg.toLowerCase()
  const status = lower.includes("unauthorized") ? 401 : lower.includes("profile not found") ? 404 : 500
  return { status, error: msg }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// GET — notes on this job the client is allowed to see, newest-first.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  try {
    const { applicationId } = await params
    const authz = await authorizeOwner(req, applicationId)
    if (!authz.ok) return withCorsJson(req, { ok: false, error: authz.error }, authz.status)

    // KEYED ON THE APPLICATION, with the run as a FALLBACK for rows written
    // before the re-key. Both branches stay scoped by client_profile_id below,
    // so the fallback widens which rows are found, never whose.
    //
    // The run branch is temporary: it comes out once prod has been on the new
    // key long enough to trust it, and until then it is what stops a note
    // written last week vanishing the day this ships.
    //
    // TWO .or() CALLS, AND THAT IS DELIBERATE. PostgREST sends each as its own
    // `or=` parameter and ANDs them, which is exactly what is wanted here:
    // (this job, by either key) AND (mine, or a coach note shared with me).
    // Folding them into one .or() would make it a single flat disjunction and
    // leak coach-private notes.
    let notes: any[] = []
    {
      const keyFilter = authz.jobfitRunId
        ? `application_id.eq.${applicationId},jobfit_run_id.eq.${authz.jobfitRunId}`
        : `application_id.eq.${applicationId}`
      const { data, error } = await authz.supabase
        .from("coaching_notes")
        .select("id, artifact_type, body, visibility, author_role, parent_note_id, created_at")
        .or(keyFilter)
        .eq("client_profile_id", authz.ownerClientId)
        // client's own notes (any visibility) OR coach notes that are shared.
        // Coach PRIVATE notes match neither branch and are excluded.
        .or("author_role.eq.client,and(author_role.eq.coach,visibility.eq.shared)")
        .order("created_at", { ascending: false })
      if (error) throw new Error(`Notes lookup failed: ${error.message}`)
      notes = data ?? []
    }
    return withCorsJson(req, { ok: true, notes }, 200)
  } catch (err: any) {
    const { status, error } = mapError(err)
    return withCorsJson(req, { ok: false, error }, status)
  }
}

// POST — client writes their own note. Attribution/link fields are server-set.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  try {
    const { applicationId } = await params
    const authz = await authorizeOwner(req, applicationId)
    if (!authz.ok) return withCorsJson(req, { ok: false, error: authz.error }, authz.status)

    if (!authz.jobfitRunId) {
      return withCorsJson(req, { ok: false, error: "Application has no linked jobfit run to attach a note to" }, 422)
    }

    const parsed = await req.json().catch(() => null)
    if (!parsed || typeof parsed !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }
    const artifactType = (parsed as any).artifact_type
    if (typeof artifactType !== "string" || !ARTIFACT_TYPES.has(artifactType)) {
      return withCorsJson(req, { ok: false, error: "artifact_type must be 'jobfit' or 'coverletter'" }, 400)
    }
    const noteBody = typeof (parsed as any).body === "string" ? (parsed as any).body.trim() : ""
    if (!noteBody) {
      return withCorsJson(req, { ok: false, error: "body is required" }, 400)
    }
    const visibility = (parsed as any).visibility
    if (typeof visibility !== "string" || !VISIBILITIES.has(visibility)) {
      return withCorsJson(req, { ok: false, error: "visibility must be 'private' or 'shared'" }, 400)
    }

    // Write — attribution + link fields set SERVER-SIDE, never from the body.
    // parent_note_id is forced null for now (freestanding notes only; replies
    // are the next step), so any body-supplied value is ignored.
    const { data: note, error: insErr } = await authz.supabase
      .from("coaching_notes")
      .insert({
        client_profile_id: authz.ownerClientId, // = profileId (owner)
        coach_profile_id: null,                  // client-authored: no coach author
        application_id: applicationId,           // THE KEY. Every job has one.
        jobfit_run_id: authz.jobfitRunId,        // provenance; null on a hand-added job
        author_role: "client",                   // client write
        parent_note_id: null,                    // no replies yet
        artifact_type: artifactType,             // validated
        body: noteBody,                          // validated
        visibility,                              // validated
      })
      .select("*")
      .single()
    if (insErr) throw new Error(`Note create failed: ${insErr.message}`)

    return withCorsJson(req, { ok: true, note }, 201)
  } catch (err: any) {
    const { status, error } = mapError(err)
    return withCorsJson(req, { ok: false, error }, status)
  }
}
