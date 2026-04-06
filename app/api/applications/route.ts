// app/api/applications/route.ts
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

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from("signal_applications")
      .select("*, signal_interviews(id), client_personas(name)")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })

    if (error) throw new Error(`Applications lookup failed: ${error.message}`)

    const apps = (data || []).map((app: any) => ({
      ...app,
      interview_count: Array.isArray(app.signal_interviews) ? app.signal_interviews.length : 0,
      persona_name: app.client_personas?.name || null,
      signal_interviews: undefined,
      client_personas: undefined,
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

    return withCorsJson(req, { ok: true, application: data }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
