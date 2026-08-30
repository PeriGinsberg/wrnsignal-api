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
      // application_id and job_url are the two columns that make a deep-linked
      // run as addressable as a freshly scanned one. The scan populates both
      // (jobfit_runs.application_id is back-filled right after the
      // signal_applications write; job_url is set from the request), but this
      // select never read them, so /signal/jobfit?run=<id> could rebuild the
      // results and the job text and still not know WHICH tracked application
      // it was looking at. Everything downstream of that gap was a link the UI
      // could not offer.
      .select("id, client_profile_id, fingerprint_hash, fingerprint_code, verdict, result_json, job_description, created_at, application_id, job_url")
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

    // Cover letter: resolve coverletter_runs by the same jobfit_run_id link
    // (stamped at cover letter write — 20260720 migration). Same precise
    // this-job match as positioning. Latest if multiple.
    async function fetchCoverLetter(): Promise<any> {
      try {
        const { data } = await supabase
          .from("coverletter_runs")
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

    // Networking still resolves by shared fingerprint_hash — known-dead today
    // (each function fingerprints independently). Left untouched; fixed in its
    // own slice.
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
      fetchCoverLetter(),
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
      // The tracked application this run is bound to, and the posting link.
      //
      // camelCase, matching every other top-level field this endpoint returns,
      // rather than POST /api/jobfit's signal_application_id / job_url. The two
      // endpoints have never shared a top-level naming convention (runId vs
      // jobfit_run_id, jobDescription vs nothing at all), and the one place
      // parity actually matters is already handled below by stamping
      // jobfit_run_id INSIDE the jobfit blob. Deliberately not mirrored a
      // second time here: two spellings of one fact is how they drift.
      //
      // NULL IS NORMAL FOR BOTH, and means different things. A null
      // applicationId is a run whose signal_applications write failed (the scan
      // route wraps it in a catch that does not fail the scan) or predates the
      // auto-create. A null or empty jobUrl is simply a job that was pasted as
      // text rather than fetched from a link, which is most of them.
      applicationId: run.application_id ?? null,
      jobUrl: run.job_url ?? null,
      // Include jobfit_run_id inside the jobfit object so this endpoint's
      // shape matches POST /api/jobfit's response (which decorates the
      // result with jobfit_run_id at the top level). The Framer deep-link
      // handler hydrates jobFitResult from this field. Defensive
      // null/non-object guard for the rare malformed-row case.
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
