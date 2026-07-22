// app/api/coach/clients/[clientId]/applications/[applicationId]/notes/route.ts
//
// Coach notes, phase 1: WRITE (POST) and coach READ (GET) of a job's notes.
// No client-facing surface.
//
// SECURITY — both verbs share one gate (authorizeForApp): authority is derived
// from the APPLICATION'S OWN owner, never the clientId in the URL (IDOR-safe),
// and on write, attribution is set from the SESSION, never the body.
//   1. resolveCaller -> coachProfileId + isCoach            (lib/collab identity)
//   2. must be a coach
//   3. load the application by applicationId ONLY
//   4. ownerClientId = application.profile_id; reject if it != the URL clientId
//   5. verifyCoachAccess(coach, ownerClientId, <level>)     (lib/collab access)
//        - GET  reads at 'view'     (a read, like the detail endpoint)
//        - POST writes at 'annotate' (a note is an annotate action)
//
// A coach with an active link to client A hitting an application owned by client
// B resolves the app -> B, finds no active link to B at the required level, and
// returns 403 with no read/write.

import { type NextRequest } from "next/server"
import { type SupabaseClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { verifyCoachAccess } from "@/lib/collab/access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ARTIFACT_TYPES = new Set(["jobfit", "coverletter"])
const VISIBILITIES = new Set(["private", "shared"])

type AuthzOk = {
  ok: true
  supabase: SupabaseClient
  coachProfileId: string
  ownerClientId: string
  jobfitRunId: string | null
}
type AuthzErr = { ok: false; status: number; error: string }

// Shared gate for GET + POST. resolveCaller may throw (Unauthorized / Profile
// not found); the handler's catch maps those to 401/404.
async function authorizeForApp(
  req: Request,
  urlClientId: string,
  applicationId: string,
  requiredLevel: "view" | "annotate" | "full",
): Promise<AuthzOk | AuthzErr> {
  if (!applicationId) return { ok: false, status: 400, error: "applicationId is required" }

  const { profileId: coachProfileId, isCoach } = await resolveCaller(req)
  if (!isCoach) return { ok: false, status: 403, error: "Forbidden: caller is not a coach" }
  const supabase = getSupabaseAdmin()

  // Load the application by id ONLY — do not trust the URL clientId yet.
  const { data: app, error: appErr } = await supabase
    .from("signal_applications")
    .select("id, profile_id, jobfit_run_id")
    .eq("id", applicationId)
    .maybeSingle()
  if (appErr) throw new Error(`Application lookup failed: ${appErr.message}`)
  if (!app) return { ok: false, status: 404, error: "Application not found" }

  // Authority = the application's REAL owner. Reject a URL/owner mismatch.
  const ownerClientId = app.profile_id as string | null
  if (!ownerClientId) return { ok: false, status: 404, error: "Application has no owner" }
  if (urlClientId && ownerClientId !== urlClientId) {
    return { ok: false, status: 403, error: "Forbidden: application does not belong to this client" }
  }

  const access = await verifyCoachAccess(coachProfileId, ownerClientId, requiredLevel, supabase)
  if (!access) {
    return { ok: false, status: 403, error: `Forbidden: no active coaching relationship with ${requiredLevel} access` }
  }

  return {
    ok: true,
    supabase,
    coachProfileId,
    ownerClientId,
    jobfitRunId: (app.jobfit_run_id as string) ?? null,
  }
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

// GET — coach reads ALL of their own notes (private + shared) for this job,
// newest first. Gated at 'view'.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string; applicationId: string }> },
) {
  try {
    const { clientId: urlClientId, applicationId } = await params
    const authz = await authorizeForApp(req, urlClientId, applicationId, "view")
    if (!authz.ok) return withCorsJson(req, { ok: false, error: authz.error }, authz.status)

    let notes: any[] = []
    if (authz.jobfitRunId) {
      const { data, error } = await authz.supabase
        .from("coaching_notes")
        .select("id, artifact_type, body, visibility, author_role, created_at")
        .eq("jobfit_run_id", authz.jobfitRunId)
        .eq("client_profile_id", authz.ownerClientId)
        .eq("coach_profile_id", authz.coachProfileId) // the caller's own notes
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

// POST — write a note. Gated at 'annotate'. Attribution + link fields are set
// SERVER-SIDE, never from the body.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string; applicationId: string }> },
) {
  try {
    const { clientId: urlClientId, applicationId } = await params
    const authz = await authorizeForApp(req, urlClientId, applicationId, "annotate")
    if (!authz.ok) return withCorsJson(req, { ok: false, error: authz.error }, authz.status)

    // A note attaches to the job's jobfit run (coaching_notes.jobfit_run_id is
    // NOT NULL). If the application has no linked run, there's nothing to key to.
    if (!authz.jobfitRunId) {
      return withCorsJson(req, { ok: false, error: "Application has no linked jobfit run to attach a note to" }, 422)
    }

    // Validate the request body (reject bad values before writing).
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
    const { data: note, error: insErr } = await authz.supabase
      .from("coaching_notes")
      .insert({
        coach_profile_id: authz.coachProfileId, // from session — attribution, never the body
        client_profile_id: authz.ownerClientId, // resolved owner
        jobfit_run_id: authz.jobfitRunId,        // the application's job
        author_role: "coach",                    // phase 1 writes are always coach
        parent_note_id: null,                    // no replies in phase 1
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
