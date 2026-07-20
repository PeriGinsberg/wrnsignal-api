// app/api/coach/client-runs/[client_profile_id]/notes/route.ts
//
// Full Coaches Access — Half A, write endpoint.
// POST: create a coach's private note against one run. Requires an active
// coaching relationship with annotate|full access. Validates that run_id
// exists in the matching run table AND belongs to this client. Auth mirrors
// coach/recommend-job.
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"

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

// function_type → the run table and its client-link column. positioning_runs_v2
// links via profile_id; the other three via client_profile_id.
const RUN_TABLES: Record<string, { table: string; clientCol: string }> = {
  jobfit: { table: "jobfit_runs", clientCol: "client_profile_id" },
  positioning: { table: "positioning_runs_v2", clientCol: "profile_id" },
  coverletter: { table: "coverletter_runs", clientCol: "client_profile_id" },
  networking: { table: "networking_runs", clientCol: "client_profile_id" },
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ client_profile_id: string }> }
) {
  try {
    const { client_profile_id: clientProfileId } = await params
    if (!clientProfileId) {
      return withCorsJson(req, { ok: false, error: "client_profile_id is required" }, 400)
    }

    const { userId, email } = await getAuthedUser(req)
    const coachProfileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const isCoach = await verifyCoach(coachProfileId, supabase)
    if (!isCoach) {
      return withCorsJson(req, { ok: false, error: "Forbidden: caller is not a coach" }, 403)
    }

    // Writing notes requires annotate or full (403 for view-only).
    const access = await verifyCoachAccess(coachProfileId, clientProfileId, "annotate", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: annotate or full access required to add notes" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const functionType = String((body as any).function_type || "").trim()
    const runId = String((body as any).run_id || "").trim()
    const noteBody = String((body as any).body || "").trim()

    if (!RUN_TABLES[functionType]) {
      return withCorsJson(req, { ok: false, error: "Invalid function_type (expected jobfit | positioning | coverletter | networking)" }, 400)
    }
    if (!runId) {
      return withCorsJson(req, { ok: false, error: "run_id is required" }, 400)
    }
    if (!noteBody) {
      return withCorsJson(req, { ok: false, error: "body is required" }, 400)
    }

    // Validate the run exists AND belongs to this client (prevents attaching
    // a note to another client's run or a nonexistent id).
    const { table, clientCol } = RUN_TABLES[functionType]
    const { data: runRow, error: runErr } = await supabase
      .from(table)
      .select("id")
      .eq("id", runId)
      .eq(clientCol, clientProfileId)
      .maybeSingle()
    if (runErr) {
      return withCorsJson(req, { ok: false, error: `Run lookup failed: ${runErr.message}` }, 500)
    }
    if (!runRow) {
      return withCorsJson(req, { ok: false, error: "run_id not found for this client and function_type" }, 404)
    }

    const { data: note, error: insertErr } = await supabase
      .from("coach_notes")
      .insert({
        coach_profile_id: coachProfileId,
        client_profile_id: clientProfileId,
        function_type: functionType,
        run_id: runId,
        body: noteBody,
        visibility: "coach_private",
      })
      .select("id, coach_profile_id, client_profile_id, function_type, run_id, body, visibility, created_at, updated_at")
      .single()

    if (insertErr || !note) {
      console.error("[client-runs notes] insert failed:", insertErr?.message)
      return withCorsJson(req, { ok: false, error: `Failed to create note: ${insertErr?.message || "unknown error"}` }, 500)
    }

    return withCorsJson(req, { ok: true, note }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[client-runs notes] Error:", msg)
    const lower = msg.toLowerCase()
    const status = lower.includes("unauthorized") ? 401 : lower.includes("profile not found") ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
