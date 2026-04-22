// app/api/coach/recommend-job/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import {
  assembleProfileForScoring,
  runJobFitForProfile,
} from "../../_lib/runJobFitForProfile"

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
    const dryRun = body.dry_run === true

    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "client_profile_id is required" }, 400)
    if (!jobDescription) return withCorsJson(req, { ok: false, error: "job_description is required" }, 400)
    if (!jobTitle) return withCorsJson(req, { ok: false, error: "job_title is required" }, 400)
    if (!companyName) return withCorsJson(req, { ok: false, error: "company_name is required" }, 400)

    const access = await verifyCoachAccess(coachProfileId, clientProfileId, "full", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: full access required to recommend jobs" }, 403)
    }

    // Persona selection is now explicit: the coach dashboard must pass
    // persona_id. The previous "auto-pick latest persona" behavior has been
    // removed to match the client-side path in /api/jobfit, so coach and
    // client produce identical output for the same (client, persona, job).
    const personaId = body.persona_id ? String(body.persona_id).trim() : null

    // Assembled profile is used for persona metadata (id/name) in the
    // coach_job_recommendations / signal_applications rows. When we run
    // fresh scoring below it's passed through as `preassembled` so the
    // profile is not loaded twice.
    const assembled = await assembleProfileForScoring({
      clientProfileId,
      personaId,
      supabase,
    })

    // Determine fullAnalysis: use cached if provided, otherwise run the
    // full shared JobFit pipeline (identical to /api/jobfit output).
    let fullAnalysis: any

    if (!dryRun && body.cached_analysis && body.cached_analysis.decision !== undefined && body.cached_analysis.score !== undefined) {
      // Use cached analysis from the coach's prior dry_run — no re-computation
      fullAnalysis = body.cached_analysis
    } else {
      const result = await runJobFitForProfile({
        clientProfileId,
        personaId,
        jobText: jobDescription,
        jobTitle,
        companyName,
        jobUrl: body.job_url || null,
        supabase,
        preassembled: assembled,
      })

      fullAnalysis = {
        decision: result.decision,
        score: result.score,
        icon: result.icon,
        bullets: result.bullets,
        risk_flags: result.risk_flags,
        next_step: result.next_step,
        why_codes: result.why_codes,
        risk_codes: result.risk_codes,
        job_signals: result.job_signals,
        profile_signals: result.profile_signals,
        gate_triggered: result.gate_triggered,
        score_breakdown: result.score_breakdown,
        location_constraint: result.location_constraint,
        why: result.why,
        risk: result.risk,
        why_structured: result.why_structured,
        risk_structured: result.risk_structured,
        cover_letter_strategy: result.cover_letter_strategy,
      }
    }

    const persona = assembled.persona

    // Dry run: return analysis result without creating any DB rows
    if (dryRun) {
      return withCorsJson(req, { ok: true, dry_run: true, jobfit: fullAnalysis })
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

    // Create a jobfit_runs row for audit trail (owned by client)
    const { data: runRow } = await supabase
      .from("jobfit_runs")
      .insert({
        client_profile_id: clientProfileId,
        job_url: body.job_url || null,
        fingerprint_hash: `coach-${coachProfileId}-${Date.now()}`,
        fingerprint_code: `COACH-${Date.now().toString(36).toUpperCase()}`,
        verdict: String(fullAnalysis.decision || "unknown"),
        result_json: fullAnalysis,
        job_description: jobDescription,
        persona_id: persona?.id || null,
        sourced_by_coach_id: coachProfileId,
      })
      .select("id")
      .single()

    const jobfitRunId = runRow?.id || null

    // Create coach_job_recommendations row with full analysis
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
        signal_decision: fullAnalysis.decision,
        signal_score: fullAnalysis.score,
        jobfit_run_id: jobfitRunId,
        full_analysis: fullAnalysis,
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
        signal_decision: fullAnalysis.decision,
        signal_score: fullAnalysis.score,
        signal_run_at: new Date().toISOString(),
        jobfit_run_id: jobfitRunId,
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
      jobfit: fullAnalysis,
    }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
