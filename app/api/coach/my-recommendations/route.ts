// app/api/coach/my-recommendations/route.ts
// Client fetches coach recommendations targeted at them
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
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // Fetch all coach recommendations for this client
    const { data: recs, error: recErr } = await supabase
      .from("coach_job_recommendations")
      .select("*")
      .eq("client_profile_id", profileId)
      .order("created_at", { ascending: false })

    if (recErr) throw new Error(`Recommendations lookup failed: ${recErr.message}`)

    // Fetch coach names
    const coachIds = [...new Set((recs || []).map((r: any) => r.coach_profile_id).filter(Boolean))]
    let coachNames: Record<string, string> = {}
    if (coachIds.length > 0) {
      const { data: coaches } = await supabase
        .from("client_profiles")
        .select("id, name")
        .in("id", coachIds)
      for (const c of coaches || []) coachNames[c.id] = c.name || "Your Coach"
    }

    const recommendations = (recs || []).map((r: any) => ({
      ...r,
      coach_name: coachNames[r.coach_profile_id] || "Your Coach",
    }))

    return withCorsJson(req, { ok: true, recommendations })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

// NO PATCH HANDLER, DELIBERATELY. This route used to expose
// { action: "mark_all_seen" }, which flipped every 'new' recommendation to
// 'interested' in one write. It was reached from a text button labelled
// "Mark all seen" — the language of clearing a notification — and it did two
// things that label did not admit to:
//
//   It told the coach the client was INTERESTED in every job in the list,
//   including ones never opened. 'interested' is what the coach sees.
//
//   It did not even dismiss the banner it belonged to. That banner counted
//   rows with client_status 'new' OR 'interested', so moving everything from
//   the first to the second left the count unchanged and the banner in place,
//   permanently, since no surviving control could move a row any further.
//
// Responding is now per-job and explicit: the box at the top of the job
// detail page, PATCH /api/coach/my-recommendations/[id]/respond. Removed
// 2026-08-10 along with 25 prod rows reset from 'interested' back to 'new',
// because which of them were real answers was unrecoverable.
