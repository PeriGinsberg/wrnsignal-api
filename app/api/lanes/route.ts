// app/api/lanes/route.ts
// GET the caller's search lanes, each with its unreviewed count.
// Owner-only: a lane belongs to exactly one client_profile_id.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from("search_lanes")
      .select("id, name, active, titles, location, years_max")
      .eq("client_profile_id", profileId)
      .order("created_at", { ascending: true })
    if (error) throw new Error(`Lanes failed: ${error.message}`)

    // Queue depth per lane. Counted here rather than joined so the number
    // means the same thing as the review page's own filter — action IS NULL.
    const lanes = await Promise.all(
      (data ?? []).map(async (l: any) => {
        const { count } = await supabase
          .from("lane_results")
          .select("id", { count: "exact", head: true })
          .eq("lane_id", l.id)
          .is("action", null)
        return { ...l, unreviewed: count ?? 0 }
      })
    )

    return withCorsJson(req, { ok: true, lanes }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
