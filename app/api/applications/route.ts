// app/api/applications/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { logStatusChange } from "../_lib/applicationStatusHistory"
import { getHistoryBoundary, applyHistoryBoundary } from "../_lib/clientHistoryBoundary"

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

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

/**
 * The columns the networking surfaces need, and nothing else.
 *
 * WHY A SEPARATE PROJECTION. The unfiltered read below is `select("*")` plus
 * two embeds plus coach annotations plus jobfit_runs.job_description, which is
 * the whole pasted posting. On production that is up to 993 rows carrying full
 * job descriptions. The contact record wants to say "you have applied to 2 jobs
 * here" and must not pull megabytes of job text across the wire to do it.
 *
 * So `?company_id=` is not just a filter, it is a different, narrow read.
 */
const COMPANY_SCOPED_COLUMNS =
  "id, company_name, job_title, application_status, applied_date, signal_score, signal_decision, created_at"

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()
    const boundaryAt = await getHistoryBoundary(supabase, profileId)

    // Scoped read for the networking surfaces: the applications at one company.
    // Still filtered by profile_id, so a company_id belonging to someone else
    // returns an empty list rather than their applications.
    const companyId = new URL(req.url).searchParams.get("company_id")
    if (companyId) {
      const scoped = supabase
        .from("signal_applications")
        .select(COMPANY_SCOPED_COLUMNS)
        .eq("profile_id", profileId)
        .eq("company_id", companyId)
      const { data: rows, error: scopedErr } = await applyHistoryBoundary(scoped, boundaryAt)
        .order("created_at", { ascending: false })
      if (scopedErr) throw new Error(`Applications lookup failed: ${scopedErr.message}`)
      return withCorsJson(req, { ok: true, applications: rows ?? [] })
    }

    // `network_companies(network_contacts(count))` is a nested count embed
    // through signal_applications.company_id. It carries ONE INTEGER per row:
    // measured on dev against the busiest profile (35 applications), it adds
    // 875 bytes to a 132,668-byte response, under 1%.
    //
    // Chosen over a second aggregate request because the tracker list already
    // calls this endpoint, so the count arrives with data the page is fetching
    // anyway rather than needing its own round trip, loading state and failure
    // state. There is nothing to disambiguate: signal_applications has exactly
    // one FK to network_companies.
    //
    // Verified against a direct count on both linked dev rows before shipping,
    // because a wrong join returns a wrong NUMBER rather than an error, and a
    // badge quietly showing someone else's total would never look broken.
    const q = supabase
      .from("signal_applications")
      .select("*, signal_interviews(id), client_personas(name), jobfit_runs!jobfit_run_id(job_description), network_companies(network_contacts(count))")
      .eq("profile_id", profileId)
    const { data, error } = await applyHistoryBoundary(q, boundaryAt)
      .order("created_at", { ascending: false })

    if (error) throw new Error(`Applications lookup failed: ${error.message}`)

    // Enrich each application with the coach annotations the client is
    // allowed to see. Service-role bypasses RLS, so the route MUST
    // explicitly filter on client_profile_id + visible_to_client=true
    // (mirrors RLS policy "coach_annotation_access" in
    // supabase/migrations/20260413_coach_client_system.sql:140-155).
    // Matches the shape the tracker route's read uses for the coach
    // view: target_type="application" + target_id IN (appIds).
    const appIds = (data || []).map((app: any) => app.id as string)
    const annotationsByApp: Record<string, Array<Record<string, unknown>>> = {}
    if (appIds.length > 0) {
      const { data: annotations, error: annErr } = await supabase
        .from("coach_annotations")
        .select("id, target_id, note, priority, created_at")
        .in("target_id", appIds)
        .eq("target_type", "application")
        .eq("client_profile_id", profileId)
        .eq("visible_to_client", true)
        .order("created_at", { ascending: false })
      if (annErr) {
        throw new Error(`Annotations lookup failed: ${annErr.message}`)
      }
      for (const ann of annotations || []) {
        const tid = ann.target_id as string
        if (!annotationsByApp[tid]) annotationsByApp[tid] = []
        annotationsByApp[tid].push(ann as Record<string, unknown>)
      }
    }

    const apps = (data || []).map((app: any) => ({
      ...app,
      interview_count: Array.isArray(app.signal_interviews) ? app.signal_interviews.length : 0,
      persona_name: app.client_personas?.name || null,
      // Read-only JD captured at scoring time, surfaced for interview prep
      // after the posting comes down. Embedded via the jobfit_run_id FK
      // (disambiguated — jobfit_runs also has a reverse application_id FK).
      // Null for manual/legacy jobs with no run. GET-only; never PUT back.
      job_description: app.jobfit_runs?.job_description ?? null,
      // Flattened the same way interview_count is, so the client never has to
      // know the embed shape. Null company_id gives a null embed, which is 0
      // people rather than an unknown number.
      contact_count: Array.isArray(app.network_companies?.network_contacts)
        ? (app.network_companies.network_contacts[0]?.count ?? 0)
        : 0,
      signal_interviews: undefined,
      client_personas: undefined,
      jobfit_runs: undefined,
      network_companies: undefined,
      coach_annotations: annotationsByApp[app.id] || [],
    }))

    return withCorsJson(req, { ok: true, applications: apps })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { error: "Invalid JSON body" }, 400)
    }

    const company_name = String(body.company_name || "").trim()
    const job_title = String(body.job_title || "").trim()
    if (!company_name) return withCorsJson(req, { error: "company_name is required" }, 400)
    if (!job_title) return withCorsJson(req, { error: "job_title is required" }, 400)

    const row: Record<string, any> = {
      profile_id: profileId,
      company_name,
      job_title,
    }

    const optional = [
      "location", "date_posted", "job_url", "application_location",
      "application_status", "applied_date", "interest_level",
      "cover_letter_submitted", "referral", "notes",
      "signal_decision", "signal_score", "signal_run_at",
      "jobfit_run_id", "persona_id",
    ]
    for (const key of optional) {
      if (body[key] !== undefined) row[key] = body[key]
    }

    const { data, error } = await supabase
      .from("signal_applications")
      .insert(row)
      .select("*")
      .single()

    if (error) throw new Error(`Application create failed: ${error.message}`)

    // Status history: log initial state (from null → initial status).
    // Helper is no-op if to_status equals from_status.
    await logStatusChange(supabase, data.id, null, data.application_status, profileId)

    return withCorsJson(req, { ok: true, application: data }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
