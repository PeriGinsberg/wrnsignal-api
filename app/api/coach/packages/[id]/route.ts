// app/api/coach/packages/[id]/route.ts
//
// Coach Packages — per-row read / edit / delete. Auth / scoping / pricing come
// from the shared helpers in app/api/_lib/coachPackages.ts.
//
// Routes:
//   GET    — single package + deliverables + pricing (404 if not found/owned).
//   PATCH  — partial update; allow-listed fields only { name?, description?,
//            discount? (DOLLARS), active?, sort_order? }.
//   DELETE — hard delete; coach_package_milestones rows go via FK CASCADE.
//
// SECURITY: every query matches BOTH id (URL) AND coach_profile_id (token), so a
// row owned by another coach (or a bad id) → 404.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  parseDiscountToCents,
  getApiPackageById,
} from "../../../_lib/coachPackages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── GET: single package (deliverables + pricing) ──
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    const pkg = await getApiPackageById(supabase, coachProfileId, id)
    if (!pkg) return withCorsJson(req, { ok: false, error: "Package not found" }, 404)
    return withCorsJson(req, { ok: true, package: pkg })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

// ── PATCH: partial update (allow-listed fields), scoped to the coach ──
const PATCH_ALLOWED = new Set(["name", "description", "discount", "active", "sort_order"])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const unknown = Object.keys(body).filter((k) => !PATCH_ALLOWED.has(k))
    if (unknown.length) {
      return withCorsJson(req, { ok: false, error: `Unknown field(s): ${unknown.join(", ")}` }, 400)
    }

    const updates: Record<string, any> = {}
    if ("name" in body) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return withCorsJson(req, { ok: false, error: "name cannot be empty" }, 400)
      }
      updates.name = body.name.trim()
    }
    if ("description" in body) {
      if (body.description !== null && typeof body.description !== "string") {
        return withCorsJson(req, { ok: false, error: "description must be a string or null" }, 400)
      }
      const v = typeof body.description === "string" ? body.description.trim() : ""
      updates.description = v ? v : null
    }
    // Client sends `discount` in DOLLARS; the column is discount_cents.
    if ("discount" in body) {
      const parsed = parseDiscountToCents(body.discount)
      if ("error" in parsed) {
        return withCorsJson(req, { ok: false, error: parsed.error }, 400)
      }
      updates.discount_cents = parsed.cents
    }
    if ("active" in body) {
      if (typeof body.active !== "boolean") {
        return withCorsJson(req, { ok: false, error: "active must be a boolean" }, 400)
      }
      updates.active = body.active
    }
    if ("sort_order" in body) {
      if (typeof body.sort_order !== "number" || !Number.isInteger(body.sort_order)) {
        return withCorsJson(req, { ok: false, error: "sort_order must be an integer" }, 400)
      }
      updates.sort_order = body.sort_order
    }

    if (Object.keys(updates).length === 0) {
      return withCorsJson(req, { ok: false, error: "No updatable fields supplied" }, 400)
    }

    const supabase = getSupabaseAdmin()
    // Match BOTH id and coach_profile_id → another coach's row (or bad id) → 404.
    const { data: updated, error: upErr } = await supabase
      .from("coach_packages")
      .update(updates)
      .eq("id", id)
      .eq("coach_profile_id", coachProfileId)
      .select("id")
      .maybeSingle()
    if (upErr) {
      return withCorsJson(req, { ok: false, error: `Failed to update package: ${upErr.message}` }, 500)
    }
    if (!updated) {
      return withCorsJson(req, { ok: false, error: "Package not found" }, 404)
    }

    const pkg = await getApiPackageById(supabase, coachProfileId, id)
    return withCorsJson(req, { ok: true, package: pkg })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

// ── DELETE: hard delete (CASCADE removes the join rows), scoped to the coach ──
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    const { data: deleted, error: delErr } = await supabase
      .from("coach_packages")
      .delete()
      .eq("id", id)
      .eq("coach_profile_id", coachProfileId)
      .select("id")
      .maybeSingle()
    if (delErr) {
      return withCorsJson(req, { ok: false, error: `Failed to delete package: ${delErr.message}` }, 500)
    }
    if (!deleted) {
      return withCorsJson(req, { ok: false, error: "Package not found" }, 404)
    }

    return withCorsJson(req, { ok: true, deleted: (deleted as { id: string }).id })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
