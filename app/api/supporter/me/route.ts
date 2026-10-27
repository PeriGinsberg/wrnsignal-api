// app/api/supporter/me/route.ts
//
// Who this supporter supports. The supporter area's first read: an empty list
// means "not a supporter, or nothing live", and the page says so.
//
// A client whose plan flag is off drops out of the list rather than erroring,
// the same answer resolveSupporterScope gives on every other route.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { routeError } from "../../_lib/routeError"
import { getAuthedUser, getSupabaseAdmin } from "@/lib/collab/identity"
import { featureAllowed } from "@/lib/features"
import { firstName } from "@/lib/supporters"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from("client_supporters")
      .select("id, client_profile_id, display_name")
      .eq("supporter_user_id", userId)
      .eq("status", "active")
      .order("accepted_at", { ascending: true })
    if (error) throw new Error(`Supporter lookup failed: ${error.message}`)

    const rows = data ?? []
    const ids = rows.map((r) => r.client_profile_id as string)
    const { data: clients } = ids.length
      ? await supabase.from("client_profiles").select("id, name").in("id", ids)
      : { data: [] as { id: string; name: string | null }[] }
    const nameOf = new Map((clients ?? []).map((c: any) => [c.id as string, c.name as string | null]))

    const supporting = []
    for (const r of rows) {
      if (!(await featureAllowed(supabase, "supporters", r.client_profile_id))) continue
      supporting.push({
        supporter_id: r.id,
        client_profile_id: r.client_profile_id,
        client_first_name: firstName(nameOf.get(r.client_profile_id), "Your contact"),
        display_name: r.display_name,
      })
    }
    return withCorsJson(req, { ok: true, email, supporting })
  } catch (err) {
    return routeError(req, err)
  }
}
