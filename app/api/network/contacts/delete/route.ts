// app/api/network/contacts/delete/route.ts
// POST { ids: [...] } — batch hard-delete contacts. OWNER-ONLY. Uses POST (not
// DELETE-with-body, which is unreliable across fetch/proxies). The delete is
// scoped to the caller's own rows (client_profile_id = owner AND id IN ids), so
// a request carrying another board's ids simply doesn't match them. Cap at 500
// so a malformed/hostile request can't wipe a whole board in one call.
// network_actions + network_comments cascade.
//
// (Static `delete/` segment — takes precedence over the [contactId] dynamic
// route, so no collision.)

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { routeError } from "../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveOwnerScope } from "@/lib/collab/scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BATCH = 500

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest) {
  try {
    // Owner-only by design; resolveOwnerScope never consults the query
    // string, so this cannot widen into coach access by accident.
    const scope = await resolveOwnerScope(req)
    const supabase = getSupabaseAdmin()

    const body = await req.json().catch(() => null)
    const ids = body?.ids
    if (!Array.isArray(ids) || ids.length === 0)
      return withCorsJson(req, { ok: false, error: "Provide ids to delete." }, 400)
    if (ids.length > MAX_BATCH)
      return withCorsJson(req, { ok: false, error: `Too many at once — delete up to ${MAX_BATCH} contacts per request.` }, 400)
    if (!ids.every((x) => typeof x === "string"))
      return withCorsJson(req, { ok: false, error: "Bad ids." }, 400)

    // Scoped to the caller's own board — foreign ids never match.
    const { data, error } = await supabase
      .from("network_contacts")
      .delete()
      .eq("client_profile_id", scope.subjectId)
      .in("id", ids)
      .select("id")
    if (error) throw new Error(`Batch delete failed: ${error.message}`)

    return withCorsJson(req, { ok: true, deleted: data?.length ?? 0 }, 200)
  } catch (err: any) {
    return routeError(req, err)
  }
}
