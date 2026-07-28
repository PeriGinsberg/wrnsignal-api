// app/api/network/companies/[companyId]/route.ts
// PATCH a company's editable fields (tier, status, domain, notes, name).
//   OWNER-ONLY — like every board write, a coach cannot edit in v1.
// DELETE the company. OWNER-ONLY.
//
// DELETE DOES NOT DELETE CONTACTS. network_contacts.company_id is
// ON DELETE SET NULL (see 20260723_network_tracker_v3_reconcile.sql), so the
// contacts survive and become standalone — the DB enforces this, the route does
// not have to. What IS lost, permanently and with no undo, is the record of
// which firm those people belonged to. The UI therefore requires the company
// name to be typed to confirm whenever contact_count > 0; an empty company is a
// plain confirm because nothing is lost.
//
// The response reports how many contacts were released so the client can say
// something true afterwards rather than guessing.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TIERS = new Set(["dream", "strong", "backup"])
const STATUSES = new Set(["researching", "actively_working", "paused", "closed"])
const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  try {
    const { companyId } = await params
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()

    // Load by id, then owner-gate — authority comes from the row's own owner,
    // never from a URL param.
    const { data: existing } = await supabase
      .from("network_companies").select("id, client_profile_id").eq("id", companyId).maybeSingle()
    if (!existing) return withCorsJson(req, { ok: false, error: "Company not found" }, 404)
    if (existing.client_profile_id !== profileId)
      return withCorsJson(req, { ok: false, error: "Forbidden: company edits are owner-only" }, 403)

    const body = await req.json().catch(() => null)
    if (body == null) return withCorsJson(req, { ok: false, error: "nothing to update" }, 400)

    // Only keys PRESENT in the body are touched — an absent key is a no-op, an
    // empty string clears to NULL. Same contract as the contact PATCH.
    const patch: Record<string, any> = {}
    if ("domain" in body) patch.domain = clean(body.domain)
    if ("notes" in body) patch.notes = clean(body.notes)
    if ("name" in body) {
      const name = clean(body.name)
      if (!name) return withCorsJson(req, { ok: false, error: "Company name cannot be empty." }, 400)
      patch.name = name
    }
    if ("tier" in body) {
      const tier = clean(body.tier)
      if (tier && !TIERS.has(tier)) return withCorsJson(req, { ok: false, error: "invalid tier" }, 400)
      patch.tier = tier
    }
    if ("status" in body) {
      const status = clean(body.status)
      if (status && !STATUSES.has(status)) return withCorsJson(req, { ok: false, error: "invalid status" }, 400)
      patch.status = status
    }
    if (Object.keys(patch).length === 0)
      return withCorsJson(req, { ok: false, error: "nothing to update" }, 400)

    const { data: updated, error: updErr } = await supabase
      .from("network_companies").update(patch).eq("id", companyId)
      .select("id, name, domain, tier, status, notes, created_at").single()
    if (updErr) {
      if (updErr.code === "23505")
        return withCorsJson(req, { ok: false, error: `You already have a company named ${patch.name}.` }, 409)
      throw new Error(`Update failed: ${updErr.message}`)
    }

    return withCorsJson(req, { ok: true, company: updated }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  try {
    const { companyId } = await params
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()

    const { data: existing } = await supabase
      .from("network_companies").select("id, client_profile_id, name").eq("id", companyId).maybeSingle()
    if (!existing) return withCorsJson(req, { ok: false, error: "Company not found" }, 404)
    if (existing.client_profile_id !== profileId)
      return withCorsJson(req, { ok: false, error: "Forbidden: delete is owner-only" }, 403)

    // Count BEFORE the delete — afterwards the link is gone and the number is
    // unrecoverable. This is what the client echoes back to the user.
    const { count } = await supabase
      .from("network_contacts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)

    const { error } = await supabase.from("network_companies").delete().eq("id", companyId)
    if (error) throw new Error(`Delete failed: ${error.message}`)

    // contacts_released: made standalone by ON DELETE SET NULL, not deleted.
    return withCorsJson(req, { ok: true, deleted: 1, contacts_released: count ?? 0, name: existing.name }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
