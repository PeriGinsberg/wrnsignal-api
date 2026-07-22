// app/api/coach/clients/[clientId]/applications/[applicationId]/notes/route.ts
//
// Coach notes, phase 1: WRITE a note to coaching_notes for one job. No read
// here, no client-facing surface.
//
// SECURITY — identical discipline to the per-job detail endpoint: authority is
// derived from the APPLICATION'S OWN owner, never from the clientId in the URL
// (IDOR-safe), and attribution fields are set from the SESSION, never the body.
//   1. resolveCaller -> coachProfileId + isCoach            (lib/collab identity)
//   2. must be a coach
//   3. load the application by applicationId ONLY
//   4. ownerClientId = application.profile_id; reject if it != the URL clientId
//   5. verifyCoachAccess(coach, ownerClientId, 'annotate')  (writing a note is
//      an annotate action, matching the other notes routes)
//   6. validate the body, then insert with server-set attribution
//
// A coach with an active link to client A posting to an application owned by
// client B resolves the app -> B, finds no active annotate link to B, and
// returns 403 with no write.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { verifyCoachAccess } from "@/lib/collab/access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ARTIFACT_TYPES = new Set(["jobfit", "coverletter"])
const VISIBILITIES = new Set(["private", "shared"])

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string; applicationId: string }> },
) {
  try {
    const { clientId: urlClientId, applicationId } = await params
    if (!applicationId) {
      return withCorsJson(req, { ok: false, error: "applicationId is required" }, 400)
    }

    // 1-2. Identity + coach gate.
    const { profileId: coachProfileId, isCoach } = await resolveCaller(req)
    if (!isCoach) {
      return withCorsJson(req, { ok: false, error: "Forbidden: caller is not a coach" }, 403)
    }
    const supabase = getSupabaseAdmin()

    // 3. Load the application by id ONLY — do not trust the URL clientId yet.
    const { data: app, error: appErr } = await supabase
      .from("signal_applications")
      .select("id, profile_id, jobfit_run_id")
      .eq("id", applicationId)
      .maybeSingle()
    if (appErr) throw new Error(`Application lookup failed: ${appErr.message}`)
    if (!app) {
      return withCorsJson(req, { ok: false, error: "Application not found" }, 404)
    }

    // 4. Authority = the application's REAL owner. Reject a URL/owner mismatch.
    const ownerClientId = app.profile_id as string | null
    if (!ownerClientId) {
      return withCorsJson(req, { ok: false, error: "Application has no owner" }, 404)
    }
    if (urlClientId && ownerClientId !== urlClientId) {
      return withCorsJson(req, { ok: false, error: "Forbidden: application does not belong to this client" }, 403)
    }

    // 5. Gate on the OWNER at 'annotate' (write access).
    const access = await verifyCoachAccess(coachProfileId, ownerClientId, "annotate", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coaching relationship with annotate access" }, 403)
    }

    // A note attaches to the job's jobfit run (coaching_notes.jobfit_run_id is
    // NOT NULL). If the application has no linked run, there's nothing to key to.
    if (!app.jobfit_run_id) {
      return withCorsJson(req, { ok: false, error: "Application has no linked jobfit run to attach a note to" }, 422)
    }

    // 6. Validate the request body (reject bad values before writing).
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
    const { data: note, error: insErr } = await supabase
      .from("coaching_notes")
      .insert({
        coach_profile_id: coachProfileId,   // from session — attribution, never the body
        client_profile_id: ownerClientId,   // resolved owner
        jobfit_run_id: app.jobfit_run_id,   // the application's job
        author_role: "coach",               // phase 1 writes are always coach
        parent_note_id: null,               // no replies in phase 1
        artifact_type: artifactType,        // validated
        body: noteBody,                     // validated
        visibility,                         // validated
      })
      .select("*")
      .single()
    if (insErr) throw new Error(`Note create failed: ${insErr.message}`)

    return withCorsJson(req, { ok: true, note }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const lower = msg.toLowerCase()
    const status = lower.includes("unauthorized") ? 401 : lower.includes("profile not found") ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
