// app/api/network/worklist/route.ts
// GET the daily worklist: contacts due now, overdue first — ONE indexed scan on
// (client_profile_id, next_due_at). Owner by default; a coach may view a client's
// board via ?client_profile_id=<id> (gated at 'view').

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { assertBoardAccess } from "@/lib/network-tracker/access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()
    const target = new URL(req.url).searchParams.get("client_profile_id") || profileId

    const acc = await assertBoardAccess(supabase, profileId, target, "view")
    if (!acc) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)

    const { data, error } = await supabase
      .from("network_contacts")
      .select("id, first_name, last_name, stage, next_due_at, next_due_reason, company_id, network_companies(name)")
      .eq("client_profile_id", target)
      .lte("next_due_at", new Date().toISOString())     // NULL next_due_at excluded (not due)
      .order("next_due_at", { ascending: true })        // overdue first, backed by the index
    if (error) throw new Error(`Worklist failed: ${error.message}`)

    return withCorsJson(req, { ok: true, contacts: data ?? [] }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
