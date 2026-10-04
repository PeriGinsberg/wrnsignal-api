// app/api/coach/clients/[clientId]/tracker/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { resolveDelegation } from "@/lib/collab/delegation"
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
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship with view access" }, 403)
    }

    // Fetch client applications
    const { data: applications, error: appsErr } = await supabase
      .from("signal_applications")
      .select("*, signal_interviews(id), client_personas(name), jobfit_runs!jobfit_run_id(job_description), linked_company:network_companies(id, name)")
      .eq("profile_id", clientProfileId)
      .order("created_at", { ascending: false })

    if (appsErr) throw new Error(`Applications lookup failed: ${appsErr.message}`)

    const appIds = (applications || []).map((a: any) => a.id)

    // Fetch coach annotations for these applications. Shape-1 collaboration:
    // scope by client_profile_id (not the caller's coach_profile_id) so BOTH
    // coaches' annotations show on the shared tracker. Byte-identical for a
    // solo client — only that one coach has annotations on this client.
    let annotationsByApp: Record<string, any[]> = {}
    if (appIds.length > 0) {
      const { data: annotations } = await supabase
        .from("coach_annotations")
        .select("*")
        .in("target_id", appIds)
        .eq("target_type", "application")
        .eq("client_profile_id", clientProfileId)
        .order("created_at", { ascending: false })

      for (const ann of annotations || []) {
        if (!annotationsByApp[ann.target_id]) annotationsByApp[ann.target_id] = []
        annotationsByApp[ann.target_id].push(ann)
      }
    }

    // Which of these apps' jobfit runs have a cover letter? Batch lookup by
    // jobfit_run_id so a tracker row can show/hide the "Cover letter" link
    // without loading any cover-letter content (that loads lazily in the panel).
    const jobfitRunIds = Array.from(
      new Set((applications || []).map((a: any) => a.jobfit_run_id).filter(Boolean)),
    )
    const coverLetterRunIds = new Set<string>()
    if (jobfitRunIds.length > 0) {
      const { data: clRows } = await supabase
        .from("coverletter_runs")
        .select("jobfit_run_id")
        .in("jobfit_run_id", jobfitRunIds)
      for (const row of clRows || []) {
        if (row.jobfit_run_id) coverLetterRunIds.add(row.jobfit_run_id as string)
      }
    }

    const enrichedApps = (applications || []).map((app: any) => ({
      ...app,
      interview_count: Array.isArray(app.signal_interviews) ? app.signal_interviews.length : 0,
      persona_name: app.client_personas?.name || null,
      // Read-only JD captured at scoring time (see /api/applications GET).
      job_description: app.jobfit_runs?.job_description ?? null,
      // Panel links: jobfit available when a run is linked; cover letter only
      // when a coverletter_run exists for this app's jobfit_run_id.
      has_jobfit: !!app.jobfit_run_id,
      has_cover_letter: app.jobfit_run_id ? coverLetterRunIds.has(app.jobfit_run_id) : false,
      // The networking-board company this job is linked to (company_id), for
      // the coach's link-to-company control. null when unlinked.
      linked_company: app.linked_company ?? null,
      signal_interviews: undefined,
      client_personas: undefined,
      jobfit_runs: undefined,
      coach_annotations: annotationsByApp[app.id] || [],
    }))

    // Fetch coach job recommendations for this client
    const { data: recommendations } = await supabase
      .from("coach_job_recommendations")
      .select("*")
      .in("coach_profile_id", (await resolveDelegation(supabase, profileId)).actingIds)
      .eq("client_profile_id", clientProfileId)
      .order("created_at", { ascending: false })

    // Fetch recent jobfit runs for history tab
    const { data: history } = await supabase
      .from("jobfit_runs")
      .select("id, created_at, verdict, result_json")
      .eq("client_profile_id", clientProfileId)
      .order("created_at", { ascending: false })
      .limit(20)

    const historyRuns = (history || []).map((r: any) => ({
      id: r.id,
      company: r.result_json?.job_signals?.companyName || null,
      title: r.result_json?.job_signals?.jobTitle || null,
      decision: r.result_json?.decision || r.verdict || null,
      score: r.result_json?.score ?? null,
      created_at: r.created_at,
    }))

    return withCorsJson(req, {
      ok: true,
      applications: enrichedApps,
      recommendations: recommendations || [],
      history: historyRuns,
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
