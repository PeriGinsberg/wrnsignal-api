// app/api/network/companies/route.ts
// GET the company board: all target companies for a board, with contact counts.
// Owner by default; coach view via ?client_profile_id=<id> (gated 'view').
// (Grouping by tier is a UI concern; the route returns them ordered by name.)

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
      .from("network_companies")
      .select("id, name, domain, tier, status, notes, created_at, network_contacts(count)")
      .eq("client_profile_id", target)
      .order("name", { ascending: true })
    if (error) throw new Error(`Company board failed: ${error.message}`)

    const companies = (data ?? []).map((c: any) => ({
      ...c,
      contact_count: Array.isArray(c.network_contacts) ? (c.network_contacts[0]?.count ?? 0) : 0,
      network_contacts: undefined,
    }))
    return withCorsJson(req, { ok: true, companies }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
