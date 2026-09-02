// app/api/network/companies/route.ts
// GET the company board: all target companies for a board, with contact counts.
// Owner by default; coach view via ?client_profile_id=<id> (gated 'view').
// (Grouping by tier is a UI concern; the route returns them ordered by name.)

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { routeError } from "../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveOwnerScope, resolveRequestScope } from "@/lib/collab/scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TIERS = new Set(["dream", "strong", "backup"])
const STATUSES = new Set(["researching", "actively_working", "paused", "closed"])
const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    // Actor, subject and authorisation in one call. The `|| profileId` default
    // and the "view" level are unchanged; they moved inside resolveRequestScope.
    const scope = await resolveRequestScope(req, supabase, { require: "read" })

    const { data, error } = await supabase
      .from("network_companies")
      .select("id, name, domain, tier, status, notes, created_at, network_contacts(count)")
      .eq("client_profile_id", scope.subjectId)
      .order("name", { ascending: true })
    if (error) throw new Error(`Company board failed: ${error.message}`)

    const companies = (data ?? []).map((c: any) => ({
      ...c,
      contact_count: Array.isArray(c.network_contacts) ? (c.network_contacts[0]?.count ?? 0) : 0,
      network_contacts: undefined,
    }))
    return withCorsJson(req, { ok: true, companies }, 200)
  } catch (err: any) {
    return routeError(req, err)
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
    // Owner-only by design; resolveOwnerScope never consults the query
    // string, so this cannot widen into coach access by accident.
    const scope = await resolveOwnerScope(req)
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
        client_profile_id: scope.subjectId,
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
    return routeError(req, err)
  }
}
