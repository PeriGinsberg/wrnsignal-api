// app/api/coach/recommendations/[id]/route.ts
// Coach updates their own recommendation (note, priority, action, date)
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getAuthedUser, getProfileId } from "@/lib/collab/identity"
import { errorStatus } from "@/app/api/_lib/routeError"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

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

    // Verify this recommendation belongs to this coach
    const { data: rec, error: recErr } = await supabase
      .from("coach_job_recommendations")
      .select("id, coach_profile_id")
      .eq("id", recId)
      .single()

    if (recErr || !rec) return withCorsJson(req, { error: "Recommendation not found" }, 404)
    if (rec.coach_profile_id !== profileId) return withCorsJson(req, { error: "Forbidden" }, 403)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") return withCorsJson(req, { error: "Invalid body" }, 400)

    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (body.coaching_note !== undefined) updates.coaching_note = body.coaching_note || null
    if (body.priority !== undefined) updates.priority = body.priority
    if (body.recommended_action !== undefined) updates.recommended_action = body.recommended_action
    if (body.apply_by_date !== undefined) updates.apply_by_date = body.apply_by_date || null

    const { data: updated, error: updateErr } = await supabase
      .from("coach_job_recommendations")
      .update(updates)
      .eq("id", recId)
      .select("*")
      .single()

    if (updateErr) throw new Error(`Update failed: ${updateErr.message}`)

    return withCorsJson(req, { ok: true, recommendation: updated })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
