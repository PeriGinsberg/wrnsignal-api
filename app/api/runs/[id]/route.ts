// app/api/runs/[id]/route.ts
//
// GET /api/runs/:id
// Returns the full result bundle for a jobfit run: jobfit result_json plus
// any positioning, cover letter, and networking runs that share the same
// fingerprint_hash + client_profile_id. Used by the "View in SIGNAL" deep
// link from the tracker.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) return withCorsJson(req, { error: "Missing run id" }, 400)

    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // Fetch the jobfit run
    const { data: run, error: runErr } = await supabase
      .from("jobfit_runs")
      .select("id, client_profile_id, fingerprint_hash, fingerprint_code, verdict, result_json, job_description, created_at")
      .eq("id", id)
      .maybeSingle()

    if (runErr) return withCorsJson(req, { error: `Fetch failed: ${runErr.message}` }, 500)
    if (!run) return withCorsJson(req, { error: "Run not found" }, 404)
    if (run.client_profile_id !== profileId) {
      return withCorsJson(req, { error: "Forbidden" }, 403)
    }

    // Positioning: resolve v1 positioning_runs by the direct jobfit_run_id
    // link (stamped at positioning write — 20260720 migration). `run.id` is the
    // deep-link jobfit run id, so this is a precise this-job match, replacing
    // the dead cross-function fingerprint join. Latest if multiple (re-runs).
    // Capture run.id in the outer (post-null-guard) scope — TS narrowing of
    // `run` doesn't carry into the closure.
    const jobfitRunId = run.id
    async function fetchPositioning(): Promise<any> {
      try {
        const { data } = await supabase
          .from("positioning_runs")
          .select("result_json")
          .eq("jobfit_run_id", jobfitRunId)
          .eq("client_profile_id", profileId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        return data?.result_json ?? null
      } catch {
        return null
      }
    }

    // Cover letter + networking still resolve by shared fingerprint_hash —
    // known-dead today (each function fingerprints independently). Left
    // untouched; fixed in their own slices.
    const fpHash = run.fingerprint_hash
    async function fetchRelated(table: string): Promise<any> {
      try {
        const { data } = await supabase
          .from(table)
          .select("result_json")
          .eq("client_profile_id", profileId)
          .eq("fingerprint_hash", fpHash)
          .maybeSingle()
        return data?.result_json ?? null
      } catch {
        return null
      }
    }

    const [posRes, clRes, netRes] = await Promise.all([
      fetchPositioning(),
      fetchRelated("coverletter_runs"),
      fetchRelated("networking_runs"),
    ])

    return withCorsJson(req, {
      runId: run.id,
      fingerprintCode: run.fingerprint_code,
      fingerprintHash: run.fingerprint_hash,
      verdict: run.verdict,
      score: run.result_json?.score ?? null,
      createdAt: run.created_at,
      jobDescription: run.job_description ?? null,
      jobTitle: run.result_json?.job_signals?.jobTitle ?? null,
      companyName: run.result_json?.job_signals?.companyName ?? null,
      // Include jobfit_run_id inside the jobfit object so this endpoint's
      // shape matches POST /api/jobfit's response (which decorates the
      // result with jobfit_run_id at the top level). The Framer deep-link
      // handler hydrates jobFitResult from this field and the Stage 1c
      // auto-trigger reads jobFitResult.jobfit_run_id to call
      // /api/positioning/v2/start. Defensive null/non-object guard for
      // the rare malformed-row case.
      jobfit:
        run.result_json && typeof run.result_json === "object"
          ? { ...(run.result_json as any), jobfit_run_id: run.id }
          : run.result_json,
      positioning: posRes,
      coverLetter: clRes,
      networking: netRes,
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    if (msg.includes("Unauthorized")) return withCorsJson(req, { error: msg }, 401)
    if (msg.includes("Profile not found")) return withCorsJson(req, { error: msg }, 404)
    console.error("[runs/[id]] error:", msg)
    return withCorsJson(req, { error: "Internal error" }, 500)
  }
}
