// app/api/lanes/route.ts
// GET — lanes the caller may see, each with its unreviewed count.
//
// SCOPE. The caller's own lanes plus every client they actively coach, so this
// is the all-clients view for a coach and simply "my lanes" for a client. Each
// lane carries its owner's name, because once a list can span people, a lane
// name alone ("Baseball Operations") no longer says whose queue you are about
// to review.
//
// ?client_profile_id=<uuid> narrows to one owner. The id must be inside the
// caller's own scope — passing someone else's is a 403, not an empty list, so a
// mistake is visible rather than looking like a client with no lanes.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { laneScopeIds } from "@/lib/collab/laneAccess"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()
    const requested = new URL(req.url).searchParams.get("client_profile_id")

    const scope = await laneScopeIds(profileId, supabase)
    if (requested && !scope.includes(requested)) {
      return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)
    }
    const owners = requested ? [requested] : scope

    // Returned so an empty list can say WHOSE list is empty. Lanes are owned
    // per profile and this app has many test accounts, so "no lanes" is nearly
    // always a question of which account rather than of none existing — and an
    // empty state that cannot tell you that sends you off creating a duplicate.
    const { data: profiles } = await supabase
      .from("client_profiles")
      .select("id, name, email")
      .in("id", owners)
    const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]))

    const { data, error } = await supabase
      .from("search_lanes")
      .select("id, client_profile_id, name, active, titles, keyword, location, years_max")
      .in("client_profile_id", owners)
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
        const owner = byId.get(l.client_profile_id)
        return {
          ...l,
          unreviewed: count ?? 0,
          client_name: owner?.name ?? null,
          client_email: owner?.email ?? null,
          is_own: l.client_profile_id === profileId,
        }
      })
    )

    const self = byId.get(profileId)
    return withCorsJson(
      req,
      {
        ok: true,
        profile: self ?? { id: profileId },
        // The scope this list was built from, so a UI can distinguish "you
        // coach nobody" from "your clients have no lanes".
        scope_size: scope.length,
        lanes,
      },
      200
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
