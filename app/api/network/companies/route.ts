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

const TIERS = new Set(["dream", "strong", "backup"])
const STATUSES = new Set(["researching", "actively_working", "paused", "closed"])
const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

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

// POST: add a company directly — no contact required. A wishlist firm with zero
// contacts is first-class on the board (that is the whole point of the tier
// view: a dream employer you have no way into yet is exactly what you need to
// see). OWNER-ONLY, like every board write.
//
// Only `name` is required. tier/status/domain/notes are all optional and stay
// NULL when absent — the board renders a blank status as "—" rather than
// inventing one. Dedup is the DB's uq_network_companies_name expression index;
// a 23505 comes back as a clean 409, never a raw Postgres error.
export async function POST(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()

    const body = await req.json().catch(() => null)
    const name = clean(body?.name)
    if (!name) return withCorsJson(req, { ok: false, error: "Company name is required." }, 400)

    const tier = clean(body?.tier)
    if (tier && !TIERS.has(tier)) return withCorsJson(req, { ok: false, error: "invalid tier" }, 400)
    const status = clean(body?.status)
    if (status && !STATUSES.has(status)) return withCorsJson(req, { ok: false, error: "invalid status" }, 400)

    const { data: company, error: insErr } = await supabase
      .from("network_companies")
      .insert({
        client_profile_id: profileId,
        name,
        tier,
        status,
        domain: clean(body?.domain),
        notes: clean(body?.notes),
      })
      .select("id, name, domain, tier, status, notes, created_at")
      .single()

    if (insErr) {
      if (insErr.code === "23505") {
        return withCorsJson(req, { ok: false, error: `You already have a company named ${name}.` }, 409)
      }
      throw new Error(`Create failed: ${insErr.message}`)
    }

    // Shape-match GET so the client can drop it straight into board state.
    return withCorsJson(req, { ok: true, company: { ...company, contact_count: 0 } }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
