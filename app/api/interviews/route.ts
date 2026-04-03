// app/api/interviews/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

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
  return { userId: data.user.id }
}

async function getProfileId(userId: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (!data) throw new Error("Profile not found")
  return data.id as string
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getAuthedUser(req)
    const profileId = await getProfileId(userId)
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
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await getAuthedUser(req)
    const profileId = await getProfileId(userId)
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
      "interviewer_names", "interview_date", "thank_you_sent",
      "status", "confidence_level", "notes",
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
    }

    return withCorsJson(req, { ok: true, interview: data }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
