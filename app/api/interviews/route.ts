// app/api/interviews/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { logStatusChange } from "../_lib/applicationStatusHistory"
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

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from("signal_interviews")
      .select("*, signal_applications(signal_decision, signal_score)")
      .eq("profile_id", profileId)
      .order("interview_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })

    if (error) throw new Error(`Interviews lookup failed: ${error.message}`)

    const interviews = (data || []).map((row: any) => ({
      ...row,
      signal_decision: row.signal_applications?.signal_decision ?? null,
      signal_score: row.signal_applications?.signal_score ?? null,
      signal_applications: undefined,
    }))

    return withCorsJson(req, { ok: true, interviews })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
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

    const application_id = String(body.application_id || "").trim()
    if (!application_id) return withCorsJson(req, { error: "application_id is required" }, 400)

    const interview_stage = String(body.interview_stage || "").trim()
    if (!interview_stage) return withCorsJson(req, { error: "interview_stage is required" }, 400)

    // Verify application belongs to this user
    const { data: app, error: appErr } = await supabase
      .from("signal_applications")
      .select("id, profile_id, company_name, job_title, application_status")
      .eq("id", application_id)
      .maybeSingle()

    if (appErr) throw new Error(`Application lookup failed: ${appErr.message}`)
    if (!app) return withCorsJson(req, { error: "Application not found" }, 404)
    if (app.profile_id !== profileId) {
      return withCorsJson(req, { error: "Not authorized" }, 403)
    }

    const row: Record<string, any> = {
      application_id,
      profile_id: profileId,
      company_name: app.company_name,
      job_title: app.job_title,
      interview_stage,
    }

    const optional = [
      "interviewer_names", "interview_date", "interview_at", "interview_format",
      "thank_you_sent", "status", "confidence_level", "notes",
    ]
    for (const key of optional) {
      if (body[key] !== undefined) row[key] = body[key]
    }

    const { data, error } = await supabase
      .from("signal_interviews")
      .insert(row)
      .select("*")
      .single()

    if (error) throw new Error(`Interview create failed: ${error.message}`)

    // Auto-advance application status to 'interviewing'
    if (app.application_status === "saved" || app.application_status === "applied") {
      await supabase
        .from("signal_applications")
        .update({ application_status: "interviewing", updated_at: new Date().toISOString() })
        .eq("id", application_id)
      await logStatusChange(supabase, application_id, app.application_status, "interviewing", profileId)
    }

    return withCorsJson(req, { ok: true, interview: data }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
