// app/api/interviews/[id]/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
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

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const { id: interviewId } = await params
    const supabase = getSupabaseAdmin()

    const { data: existing, error: lookupErr } = await supabase
      .from("signal_interviews")
      .select("id, profile_id")
      .eq("id", interviewId)
      .maybeSingle()

    if (lookupErr) throw new Error(`Interview lookup failed: ${lookupErr.message}`)
    if (!existing) return withCorsJson(req, { error: "Interview not found" }, 404)
    if (existing.profile_id !== profileId) {
      return withCorsJson(req, { error: "Not authorized" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { error: "Invalid JSON body" }, 400)
    }

    // Allow-list mirroring the POST handler's optional[] list. Same
    // rationale as PUT /api/applications/[id]: GET-side enrichment
    // (signal_decision, signal_score from joined signal_applications)
    // must not be writable back to this table — those columns don't
    // exist on signal_interviews and would crash the update.
    const ALLOWED_UPDATE_FIELDS = [
      "interview_stage", "interviewer_names", "interview_date", "interview_at",
      "interview_format", "thank_you_sent", "status", "confidence_level", "notes",
    ] as const

    const updates: Record<string, any> = {}
    for (const key of ALLOWED_UPDATE_FIELDS) {
      if (body[key] !== undefined) updates[key] = body[key]
    }
    updates.updated_at = new Date().toISOString()

    const { data: updated, error: updateErr } = await supabase
      .from("signal_interviews")
      .update(updates)
      .eq("id", interviewId)
      .select("*")
      .single()

    if (updateErr) throw new Error(`Interview update failed: ${updateErr.message}`)

    return withCorsJson(req, { ok: true, interview: updated })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const { id: interviewId } = await params
    const supabase = getSupabaseAdmin()

    const { data: existing, error: lookupErr } = await supabase
      .from("signal_interviews")
      .select("id, profile_id")
      .eq("id", interviewId)
      .maybeSingle()

    if (lookupErr) throw new Error(`Interview lookup failed: ${lookupErr.message}`)
    if (!existing) return withCorsJson(req, { error: "Interview not found" }, 404)
    if (existing.profile_id !== profileId) {
      return withCorsJson(req, { error: "Not authorized" }, 403)
    }

    const { error: deleteErr } = await supabase
      .from("signal_interviews")
      .delete()
      .eq("id", interviewId)

    if (deleteErr) throw new Error(`Interview delete failed: ${deleteErr.message}`)

    return withCorsJson(req, { ok: true, deleted: interviewId })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
