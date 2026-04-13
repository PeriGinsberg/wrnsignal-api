// app/api/coach/recommend-job/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { runJobFit } from "../../_lib/jobfitEvaluator"
import { mapClientProfileToOverrides } from "../../_lib/jobfitProfileAdapter"

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

async function verifyCoach(profileId: string, supabase: any): Promise<boolean> {
  const { data } = await supabase
    .from("client_profiles")
    .select("is_coach")
    .eq("id", profileId)
    .single()
  return data?.is_coach === true
}

async function verifyCoachAccess(coachProfileId: string, clientProfileId: string, requiredLevel: string, supabase: any) {
  const levels: Record<string, string[]> = { view: ["view", "annotate", "full"], annotate: ["annotate", "full"], full: ["full"] }
  const { data } = await supabase
    .from("coach_clients")
    .select("id, access_level, status")
    .eq("coach_profile_id", coachProfileId)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
    .maybeSingle()
  if (!data) return null
  if (!levels[requiredLevel]?.includes(data.access_level)) return null
  return data
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const coachProfileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const isCoach = await verifyCoach(coachProfileId, supabase)
    if (!isCoach) {
      return withCorsJson(req, { ok: false, error: "Forbidden: caller is not a coach" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const clientProfileId = String(body.client_profile_id || "").trim()
    const jobDescription = String(body.job_description || "").trim()
    const jobTitle = String(body.job_title || "").trim()
    const companyName = String(body.company_name || "").trim()

    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "client_profile_id is required" }, 400)
    if (!jobDescription) return withCorsJson(req, { ok: false, error: "job_description is required" }, 400)
    if (!jobTitle) return withCorsJson(req, { ok: false, error: "job_title is required" }, 400)
    if (!companyName) return withCorsJson(req, { ok: false, error: "company_name is required" }, 400)

    const access = await verifyCoachAccess(coachProfileId, clientProfileId, "full", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: full access required to recommend jobs" }, 403)
    }

    // Look up coach_client_id (required NOT NULL FK on coach_job_recommendations)
    const { data: coachClientRow, error: ccErr } = await supabase
      .from("coach_clients")
      .select("id")
      .eq("coach_profile_id", coachProfileId)
      .eq("client_profile_id", clientProfileId)
      .eq("status", "active")
      .maybeSingle()
    if (ccErr || !coachClientRow) throw new Error("coach_clients relationship not found")

    // Load client profile and persona — use CLIENT's data, not coach's
    const { data: clientProfile, error: cpErr } = await supabase
      .from("client_profiles")
      .select("*")
      .eq("id", clientProfileId)
      .single()
    if (cpErr || !clientProfile) throw new Error("Client profile not found")

    // Determine which persona to use (optional body.persona_id, else active/first)
    let persona: any = null
    if (body.persona_id) {
      const { data: p } = await supabase
        .from("client_personas")
        .select("*")
        .eq("id", body.persona_id)
        .eq("profile_id", clientProfileId)
        .single()
      persona = p || null
    } else {
      const { data: personas } = await supabase
        .from("client_personas")
        .select("*")
        .eq("profile_id", clientProfileId)
        .order("created_at", { ascending: false })
        .limit(1)
      persona = personas?.[0] || null
    }

    const profileText = [
      clientProfile.profile_text || "",
      persona?.resume_text || "",
    ].filter(Boolean).join("\n\n")

    const profileOverrides = mapClientProfileToOverrides({
      profileText,
      profileStructured: clientProfile.profile_structured || persona?.structured_data || null,
      targetRoles: clientProfile.target_roles || null,
      preferredLocations: clientProfile.preferred_locations || null,
    })

    // Run JobFit using client's profile
    const result = await runJobFit({
      profileText,
      jobText: jobDescription,
      profileOverrides,
      userJobTitle: jobTitle,
      userCompanyName: companyName,
    })

    // Determine jobfit_run_id if available
    const jobfitRunId: string | null = (result as any).run_id || null

    // Create coach_job_recommendations row
    const { data: recRow, error: recErr } = await supabase
      .from("coach_job_recommendations")
      .insert({
        coach_client_id: coachClientRow.id,
        coach_profile_id: coachProfileId,
        client_profile_id: clientProfileId,
        job_title: jobTitle,
        company_name: companyName,
        job_description: jobDescription,
        job_url: body.job_url || null,
        persona_id: persona?.id || null,
        persona_name: persona?.name || null,
        signal_decision: result.decision,
        signal_score: result.score,
        jobfit_run_id: jobfitRunId,
        coaching_note: body.coaching_note || null,
        priority: body.priority || "this_week",
        recommended_action: body.recommended_action || "apply",
        apply_by_date: body.apply_by_date || null,
        client_status: "new",
      })
      .select("*")
      .single()

    if (recErr) throw new Error(`Failed to create recommendation: ${recErr.message}`)

    // Create signal_applications row owned by the client
    const { data: appRow, error: appErr } = await supabase
      .from("signal_applications")
      .insert({
        profile_id: clientProfileId,
        company_name: companyName,
        job_title: jobTitle,
        job_url: body.job_url || null,
        persona_id: persona?.id || null,
        application_status: "saved",
        signal_decision: result.decision,
        signal_score: result.score,
        signal_run_at: new Date().toISOString(),
      })
      .select("*")
      .single()

    if (appErr) throw new Error(`Failed to create application: ${appErr.message}`)

    // Link recommendation back to application
    await supabase
      .from("coach_job_recommendations")
      .update({ application_id: appRow.id })
      .eq("id", recRow.id)

    return withCorsJson(req, {
      ok: true,
      recommendation: { ...recRow, application_id: appRow.id },
      application: appRow,
      jobfit: {
        decision: result.decision,
        score: result.score,
        icon: result.icon,
        bullets: result.bullets,
        risk_flags: result.risk_flags,
        next_step: result.next_step,
        why_codes: result.why_codes,
        risk_codes: result.risk_codes,
      },
    }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
