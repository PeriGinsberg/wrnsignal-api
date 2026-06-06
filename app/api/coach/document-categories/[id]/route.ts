// app/api/coach/document-categories/[id]/route.ts
//
// Client Library — per-category edit/delete. Per-row REST.
//
// Routes:
//   PATCH  — partial update { name?, sort_order? } (rename / reorder). Matches
//            the row on BOTH id (URL) AND coach_profile_id (token) → 404 if not
//            found / not owned.
//   DELETE — SOFT delete only: set active=false. NEVER hard-delete (the row must
//            persist so the lazy-seed guard keeps seeing >= 1 row and never
//            re-seeds). Same id + coach_profile_id match → 404 otherwise.
//
// Auth/scoping via _lib/coachAuth (resolveCoach). coach_document_categories has
// NO RLS — every query filters on coach_profile_id from the bearer token.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin, resolveCoach, errStatus } from "../../../_lib/coachAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NAME_MAX = 60

type CategoryRow = {
  id: string
  coach_profile_id: string
  name: string
  sort_order: number
  is_custom: boolean
  active: boolean
  created_at: string
  updated_at: string
}

const CATEGORY_SELECT =
  "id, coach_profile_id, name, sort_order, is_custom, active, created_at, updated_at"

function toApiCategory(r: CategoryRow) {
  return {
    id: r.id,
    name: r.name,
    sort_order: r.sort_order,
    is_custom: r.is_custom,
    active: r.active,
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── PATCH: rename / reorder (allow-listed fields), scoped to the coach ──
const PATCH_ALLOWED = new Set(["name", "sort_order"])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { coachProfileId, error: authErr } = await resolveCoach(req)
    if (authErr) return authErr

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
      if (body.name.trim().length > NAME_MAX) {
        return withCorsJson(req, { ok: false, error: `name too long (max ${NAME_MAX})` }, 400)
      }
      updates.name = body.name.trim()
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
    // Match BOTH id and coach_profile_id → a row owned by another coach (or a
    // nonexistent id) matches nothing → 404.
    const { data: updated, error: upErr } = await supabase
      .from("coach_document_categories")
      .update(updates)
      .eq("id", id)
      .eq("coach_profile_id", coachProfileId)
      .select(CATEGORY_SELECT)
      .maybeSingle()
    if (upErr) {
      return withCorsJson(req, { ok: false, error: `Failed to update category: ${upErr.message}` }, 500)
    }
    if (!updated) {
      return withCorsJson(req, { ok: false, error: "Category not found" }, 404)
    }

    return withCorsJson(req, { ok: true, category: toApiCategory(updated as CategoryRow) })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

// ── DELETE: SOFT delete (active=false), scoped to the coach ──
//
// Never hard-deletes. Soft-deleting keeps the row so the GET seed guard (which
// counts ALL rows) continues to see >= 1 and never re-seeds — i.e. a coach who
// removes every category gets an empty list, NOT a re-seeded default set.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { coachProfileId, error: authErr } = await resolveCoach(req)
    if (authErr) return authErr

    const supabase = getSupabaseAdmin()
    // Match BOTH id and coach_profile_id; .select() returns the row so we can
    // distinguish a real soft-delete from a no-op (not found / not owned → 404).
    const { data: updated, error: upErr } = await supabase
      .from("coach_document_categories")
      .update({ active: false })
      .eq("id", id)
      .eq("coach_profile_id", coachProfileId)
      .select("id")
      .maybeSingle()
    if (upErr) {
      return withCorsJson(req, { ok: false, error: `Failed to delete category: ${upErr.message}` }, 500)
    }
    if (!updated) {
      return withCorsJson(req, { ok: false, error: "Category not found" }, 404)
    }

    return withCorsJson(req, { ok: true, deleted: (updated as { id: string }).id })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
