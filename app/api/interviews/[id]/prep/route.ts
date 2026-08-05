// app/api/interviews/[id]/prep/route.ts
//
// The prep run for one interview. The ONLY API change Prep Now commit 2 makes,
// and it exists purely because checklist ticks have to survive a reload.
//
//   GET    returns the prep run, or { prep: null }. NEVER creates.
//   PATCH  { checklist_state } — upserts. This is the lazy creation point.
//
// WHY GET NEVER CREATES. A row per page view would fill interview_prep_runs
// with empty rows for every interview anyone ever glanced at, and commit 3
// wants that table to mean "a prep was actually worked on". Creation is an
// interaction, not a visit.
//
// NOT IN THIS COMMIT: `generated` and `content_hash` stay null. There is no LLM
// call anywhere in this file.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
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
  return { userId: data.user.id, email: (data.user.email ?? "").trim().toLowerCase() || null }
}

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_profiles").select("id, user_id").eq("user_id", userId).maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string

  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles").select("id, user_id").eq("email", email).maybeSingle()
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

/**
 * Ownership gate. Service-role bypasses RLS, so this comparison IS the access
 * control, not a convenience. Returns the interview row on success.
 */
async function ownedInterview(supabase: ReturnType<typeof getSupabaseAdmin>, interviewId: string, profileId: string) {
  const { data, error } = await supabase
    .from("signal_interviews")
    .select("id, profile_id, application_id")
    .eq("id", interviewId)
    .maybeSingle()
  if (error) throw new Error(`Interview lookup failed: ${error.message}`)
  if (!data) return { status: 404 as const, interview: null }
  if (data.profile_id !== profileId) return { status: 403 as const, interview: null }
  return { status: 200 as const, interview: data }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) return withCorsJson(req, { ok: false, error: "Missing interview id" }, 400)

    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const gate = await ownedInterview(supabase, id, profileId)
    if (gate.status === 404) return withCorsJson(req, { ok: false, error: "Not found" }, 404)
    if (gate.status === 403) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)

    // Newest wins if more than one exists. Nothing creates duplicates today,
    // but reading defensively costs nothing and beats a 500 if that changes.
    //
    // `generated` is READ here but never written here — POST .../prep/generate
    // owns it, and PATCH's allowlist still refuses it. Returning it means a
    // cached prep renders on page load with no second round trip and no call.
    const { data, error } = await supabase
      .from("interview_prep_runs")
      .select("id, interview_id, jobfit_run_id, checklist_state, generated, created_at, updated_at")
      .eq("interview_id", id)
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`Prep lookup failed: ${error.message}`)

    return withCorsJson(req, { ok: true, prep: data ?? null })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : msg.includes("Profile not found") ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) return withCorsJson(req, { ok: false, error: "Missing interview id" }, 400)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    // Allowlisted and shape-checked. `checklist_state` is the only writable
    // field on this route; `generated` and `content_hash` belong to the
    // generator, not the client. Same lesson as PUT /api/profile: an allowlist
    // survives the table growing new columns, a denylist does not.
    const raw = body.checklist_state
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return withCorsJson(req, { ok: false, error: "checklist_state must be an object" }, 400)
    }
    // Normalise to { id: true }. Anything not literally true is dropped rather
    // than stored, so the blob cannot accumulate junk the reader has to guard.
    const checklist_state: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (v === true) checklist_state[k] = true

    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const gate = await ownedInterview(supabase, id, profileId)
    if (gate.status === 404) return withCorsJson(req, { ok: false, error: "Not found" }, 404)
    if (gate.status === 403) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)

    const { data: existing, error: findErr } = await supabase
      .from("interview_prep_runs")
      .select("id")
      .eq("interview_id", id)
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (findErr) throw new Error(`Prep lookup failed: ${findErr.message}`)

    if (existing) {
      const { data, error } = await supabase
        .from("interview_prep_runs")
        .update({ checklist_state })
        .eq("id", existing.id)
        .select("id, interview_id, jobfit_run_id, checklist_state, created_at, updated_at")
        .single()
      if (error) throw new Error(`Prep update failed: ${error.message}`)
      return withCorsJson(req, { ok: true, prep: data })
    }

    // LAZY CREATION — the first tick, not the page view. jobfit_run_id is
    // stamped from the parent application when there is one; roughly a third of
    // applications have a score with no run, so null here is a normal outcome
    // and never blocks the prep from existing.
    let jobfitRunId: string | null = null
    if (gate.interview?.application_id) {
      const { data: app } = await supabase
        .from("signal_applications")
        .select("jobfit_run_id")
        .eq("id", gate.interview.application_id)
        .maybeSingle()
      jobfitRunId = (app?.jobfit_run_id as string) ?? null
    }

    const { data, error } = await supabase
      .from("interview_prep_runs")
      .insert({
        interview_id: id,
        profile_id: profileId,
        jobfit_run_id: jobfitRunId,
        checklist_state,
      })
      .select("id, interview_id, jobfit_run_id, checklist_state, created_at, updated_at")
      .single()
    if (error) throw new Error(`Prep create failed: ${error.message}`)

    return withCorsJson(req, { ok: true, prep: data }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : msg.includes("Profile not found") ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
