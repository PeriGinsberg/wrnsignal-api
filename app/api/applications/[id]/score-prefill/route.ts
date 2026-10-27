// app/api/applications/[id]/score-prefill/route.ts
//
// What JobFit needs to score a job that is already on the tracker: the row's
// company, title, location and posting link. Framer reads it when the tracker
// opens /signal/jobfit?score_app=<id>, fills the form, and sends the same id
// back as application_id on POST /api/jobfit, which attaches the run to this
// row instead of creating one (see the SCORING A JOB ALREADY ON THE TRACKER
// block in app/api/jobfit/route.ts).
//
// Owner only. A row that is not the caller's is a 404, the same answer as a
// row that does not exist.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { routeError } from "../../../_lib/routeError"
import { getCallerProfile, getSupabaseAdmin } from "@/lib/collab/identity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const me = await getCallerProfile(req, "id")
    const { data, error } = await getSupabaseAdmin()
      .from("signal_applications")
      .select("id, company_name, job_title, location, job_url, jobfit_run_id")
      .eq("id", id)
      .eq("profile_id", me.id)
      .maybeSingle()
    if (error) throw new Error(`Application lookup failed: ${error.message}`)
    if (!data) return withCorsJson(req, { ok: false, error: "That tracker job was not found." }, 404)
    return withCorsJson(req, { ok: true, application: data })
  } catch (err) {
    return routeError(req, err)
  }
}
