// app/api/coach/my-recommendations/[id]/respond/route.ts
// Client responds to a coach recommendation (applying, not_for_me, etc.)
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { logStatusChange } from "../../../../_lib/applicationStatusHistory"

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
  return m?.[1]?.trim() || null
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  if (!token) throw new Error("Unauthorized: missing bearer token")
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return { userId: data.user.id, email: (data.user.email ?? "").trim().toLowerCase() || null }
}

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase.from("client_profiles").select("id").eq("user_id", userId).maybeSingle()
  if (data) return data.id as string
  if (email) {
    const { data: byEmail } = await supabase.from("client_profiles").select("id").eq("email", email).maybeSingle()
    if (byEmail) return byEmail.id as string
  }
  throw new Error("Profile not found")
}

const VALID_STATUSES = ["interested", "applying", "applied", "not_for_me"]

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: recId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // Verify this recommendation belongs to this client
    const { data: rec, error: recErr } = await supabase
      .from("coach_job_recommendations")
      .select("id, client_profile_id, application_id")
      .eq("id", recId)
      .single()

    if (recErr || !rec) return withCorsJson(req, { error: "Recommendation not found" }, 404)
    if (rec.client_profile_id !== profileId) return withCorsJson(req, { error: "Forbidden" }, 403)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") return withCorsJson(req, { error: "Invalid body" }, 400)

    const clientStatus = String(body.client_status || "").trim()
    if (!VALID_STATUSES.includes(clientStatus)) {
      return withCorsJson(req, { error: `Invalid client_status. Must be one of: ${VALID_STATUSES.join(", ")}` }, 400)
    }

    // TWO WRITES, TWO DIFFERENT QUESTIONS.
    //
    //   coach_job_recommendations   what the answer IS now. Read by the hub's
    //                               Required Actions, the tracker banner filter
    //                               and the coach's client page. An UPDATE, so
    //                               it always holds the latest answer.
    //
    //   coach_recommendation_responses   every answer, in order. An INSERT, so
    //                               a client who says Interested and later Not
    //                               interested leaves both. That change of mind
    //                               is a real event the coach should see, and
    //                               until 2026-08-10 it was not recorded at all
    //                               — the UPDATE simply overwrote the first
    //                               answer and the History timeline could only
    //                               ever show the latest one.
    //
    // client_responded_at stays on the parent because the coach's "Since last
    // visit" strip filters on it. It was absent until 2026-08-10, which is why
    // 0 of 131 prod rows had it and that strip had never rendered a response.
    const now = new Date().toISOString()
    const { error: updateErr } = await supabase
      .from("coach_job_recommendations")
      .update({ client_status: clientStatus, client_responded_at: now, updated_at: now })
      .eq("id", recId)

    if (updateErr) throw new Error(`Update failed: ${updateErr.message}`)

    // The log entry. Failing here would leave the current state updated with no
    // record of how it got there, so it is not swallowed — but it is also not
    // rolled back, because there is no transaction across two PostgREST calls
    // and re-answering is cheap. A 500 tells the client it did not save; the
    // box stays up and a retry appends exactly one row.
    const { error: logErr } = await supabase
      .from("coach_recommendation_responses")
      .insert({
        recommendation_id: recId,
        client_profile_id: profileId,
        application_id: rec.application_id,
        client_status: clientStatus,
        responded_at: now,
      })

    if (logErr) throw new Error(`Response log failed: ${logErr.message}`)

    // If applying, also update the linked application status
    if (clientStatus === "applying" && rec.application_id) {
      const { data: prev } = await supabase
        .from("signal_applications")
        .select("application_status")
        .eq("id", rec.application_id)
        .maybeSingle()
      await supabase
        .from("signal_applications")
        .update({ application_status: "applied", updated_at: new Date().toISOString() })
        .eq("id", rec.application_id)
      if (prev) {
        await logStatusChange(supabase, rec.application_id, prev.application_status, "applied", profileId)
      }
    }

    return withCorsJson(req, { ok: true, client_status: clientStatus })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.includes("Unauthorized") ? 401 : msg.includes("Forbidden") ? 403 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
