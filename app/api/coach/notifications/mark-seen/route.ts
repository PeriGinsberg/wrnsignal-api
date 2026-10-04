// app/api/coach/notifications/mark-seen/route.ts
// Client-facing: marks recommendation notifications as seen.
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
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const body = await req.json().catch(() => null)

    // Optional: mark specific IDs, or mark all unseen
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : []

    let query = supabase
      .from("coach_job_recommendations")
      .update({ notification_seen: true })
      .eq("client_profile_id", profileId)
      .eq("notification_seen", false)

    if (ids.length > 0) {
      query = query.in("id", ids)
    }

    const { error: updateErr, count } = await query

    if (updateErr) throw new Error(`Failed to mark notifications seen: ${updateErr.message}`)

    return withCorsJson(req, { ok: true, marked_seen: count ?? 0 })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
