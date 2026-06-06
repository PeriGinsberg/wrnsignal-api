// app/api/coach/coach-clients/[id]/documents/[doc_id]/route.ts
//
// Client Library — edit / soft-delete a single document link.
//
//   PATCH  — partial update { title?, url?, category_id?, sort_order? }.
//   DELETE — soft-delete (deleted_at = now()); the row persists.
//
// SECURITY (two-step): (1) the coach_clients row [id] must belong to the authed
// coach (→ 404); (2) the doc is matched on BOTH doc_id AND coach_client_id = [id]
// (nested-resource guard) — a coach can't reach a doc by pairing it with a
// relationship they own. category_id, if changed, must be one of THIS coach's
// own active categories. activity_id is not editable in this slice.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  UUID_RE,
  isCoachClientOwnedByCoach,
  DOCUMENT_SELECT,
  toApiDocument,
  validateTitle,
  normalizeUrl,
  isCategoryOwnedActive,
  type DocumentRow,
} from "../../../../../_lib/coachClientDocuments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── PATCH: partial update (allow-listed fields), scoped to the coach ──
// activity_id is intentionally absent from the allow-list → "Unknown field".
const PATCH_ALLOWED = new Set(["title", "url", "category_id", "sort_order"])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; doc_id: string }> },
) {
  try {
    const { id, doc_id } = await params
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
    if ("title" in body) {
      const parsed = validateTitle(body.title)
      if ("error" in parsed) return withCorsJson(req, { ok: false, error: parsed.error }, 400)
      updates.title = parsed.title
    }
    if ("url" in body) {
      const parsed = normalizeUrl(body.url)
      if ("error" in parsed) return withCorsJson(req, { ok: false, error: parsed.error, code: "INVALID_URL" }, 400)
      updates.url = parsed.url
    }
    let categoryToCheck: string | null = null
    if ("category_id" in body) {
      if (body.category_id === null || body.category_id === "") {
        updates.category_id = null // move to Uncategorized
      } else if (typeof body.category_id !== "string" || !UUID_RE.test(body.category_id)) {
        return withCorsJson(req, { ok: false, error: "category_id must be a category UUID" }, 400)
      } else {
        updates.category_id = body.category_id
        categoryToCheck = body.category_id
      }
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
    if (!(await isCoachClientOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }
    if (categoryToCheck && !(await isCategoryOwnedActive(supabase, coachProfileId, categoryToCheck))) {
      return withCorsJson(req, { ok: false, error: "Category not found" }, 404)
    }

    // Match on BOTH doc_id and coach_client_id = [id] (nested guard); only an
    // active doc is editable (deleted_at IS NULL).
    const { data: updated, error: upErr } = await supabase
      .from("coach_client_documents")
      .update(updates)
      .eq("id", doc_id)
      .eq("coach_client_id", id)
      .is("deleted_at", null)
      .select(DOCUMENT_SELECT)
      .maybeSingle()
    if (upErr) {
      return withCorsJson(req, { ok: false, error: `Failed to update document: ${upErr.message}` }, 500)
    }
    if (!updated) {
      return withCorsJson(req, { ok: false, error: "Document not found" }, 404)
    }

    return withCorsJson(req, { ok: true, document: toApiDocument(updated as DocumentRow) })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

// ── DELETE: soft-delete (deleted_at = now()), scoped to the coach ──
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; doc_id: string }> },
) {
  try {
    const { id, doc_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }

    // Match on BOTH doc_id and coach_client_id = [id]; only soft-delete a doc
    // that's still active (deleted_at IS NULL) so a repeat call → 404.
    const { data: deleted, error: delErr } = await supabase
      .from("coach_client_documents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", doc_id)
      .eq("coach_client_id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle()
    if (delErr) {
      return withCorsJson(req, { ok: false, error: `Failed to delete document: ${delErr.message}` }, 500)
    }
    if (!deleted) {
      return withCorsJson(req, { ok: false, error: "Document not found" }, 404)
    }

    return withCorsJson(req, { ok: true, deleted: (deleted as { id: string }).id })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
