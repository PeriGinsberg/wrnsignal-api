// app/api/coach/clients/[clientId]/applications/[applicationId]/detail/route.ts
//
// Per-job full detail for the coach Job Tracker side panel: the FULL jobfit
// result_json and the FULL cover-letter content for ONE application's job.
//
// SECURITY — authority is derived from the APPLICATION'S OWN owner, never from
// the clientId in the URL (IDOR-safe):
//   1. resolveCaller -> coachProfileId + isCoach            (lib/collab identity)
//   2. must be a coach
//   3. load the application by applicationId ONLY
//   4. ownerClientId = application.profile_id; reject if it != the URL clientId
//   5. verifyCoachAccess(coach, ownerClientId, 'view')      (lib/collab access)
//   6. fetch content scoped to ownerClientId on EVERY query
// A coach with an active link to client A requesting an application owned by
// client B resolves the app -> B, finds no active link to B, and returns 403
// with no content.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { verifyCoachAccess } from "@/lib/collab/access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(
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

    // 5. Gate on the OWNER, not the URL clientId.
    const access = await verifyCoachAccess(coachProfileId, ownerClientId, "view", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coaching relationship with this client" }, 403)
    }

    // 6. Content — every query scoped to ownerClientId (defense in depth).
    let jobfit: any = null
    let coverLetter: any = null

    if (app.jobfit_run_id) {
      const { data: jf } = await supabase
        .from("jobfit_runs")
        .select("id, result_json")
        .eq("id", app.jobfit_run_id)
        .eq("client_profile_id", ownerClientId)
        .maybeSingle()
      if (jf) {
        // Full jobfit, matching the client's own view (result_json + jobfit_run_id).
        jobfit =
          jf.result_json && typeof jf.result_json === "object"
            ? { ...(jf.result_json as any), jobfit_run_id: jf.id }
            : jf.result_json ?? null
      }

      const { data: cl } = await supabase
        .from("coverletter_runs")
        .select("result_json")
        .eq("jobfit_run_id", app.jobfit_run_id)
        .eq("client_profile_id", ownerClientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      coverLetter = cl?.result_json ?? null
    }

    return withCorsJson(
      req,
      {
        ok: true,
        application_id: app.id,
        client_profile_id: ownerClientId,
        jobfit,        // full result_json (+ jobfit_run_id), or null
        coverLetter,   // full { letter, contact, context_used }, or null if not generated
      },
      200,
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const lower = msg.toLowerCase()
    const status = lower.includes("unauthorized") ? 401 : lower.includes("profile not found") ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
