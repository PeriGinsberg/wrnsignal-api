// app/api/coach/coach-clients/[id]/documents/route.ts
//
// Client Library — per-client document links. Keyed by coach_clients.id ([id]).
//
//   GET  — list this relationship's ACTIVE docs (deleted_at IS NULL), ordered by
//          category sort_order then doc sort_order.
//   POST — create one doc { title, url, category_id? }. URL is normalized +
//          validated (http/https only). category_id, if given, must be one of
//          THIS coach's own active categories. activity_id is NOT accepted in
//          this slice. 201 on success.
//
// SECURITY: the coach_clients row [id] must belong to the authed coach (→ 404).
// coach_profile_id + client_profile_id are denormalized from the relationship
// row, never from the client.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { coachClientIdsForClient } from "../../../../_lib/coachClientIds"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  UUID_RE,
  DOCUMENT_SELECT,
  toApiDocument,
  validateTitle,
  normalizeUrl,
  getOwnedRelationship,
  isCategoryOwnedActive,
  listApiDocuments,
  type DocumentRow,
} from "../../../../_lib/coachClientDocuments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── GET: list this relationship's active docs ──
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    const rel = await getOwnedRelationship(supabase, coachProfileId, id)
    if (!rel) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }

    // Shape-1 collaboration: list docs across ALL coach_client_id rows for this
    // client so both coaches share the library. Byte-identical for a solo client
    // (one row). A not-yet-linked relationship (client_profile_id NULL) can hold
    // no docs, so fall back to [id] — byte-identical, empty either way.
    const ccIds = rel.client_profile_id
      ? await coachClientIdsForClient(supabase, rel.client_profile_id)
      : [id]
    const documents = await listApiDocuments(supabase, coachProfileId, ccIds)
    return withCorsJson(req, { ok: true, documents })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

// ── POST: create one doc ──
export async function POST(
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

    // Slice A does not wire activity links — reject rather than silently store.
    if ("activity_id" in body && body.activity_id !== null && body.activity_id !== undefined) {
      return withCorsJson(req, { ok: false, error: "activity_id is not supported yet" }, 400)
    }

    const titleParsed = validateTitle(body.title)
    if ("error" in titleParsed) {
      return withCorsJson(req, { ok: false, error: titleParsed.error }, 400)
    }
    const urlParsed = normalizeUrl(body.url)
    if ("error" in urlParsed) {
      return withCorsJson(req, { ok: false, error: urlParsed.error, code: "INVALID_URL" }, 400)
    }

    // category_id: optional. undefined / null / "" → Uncategorized. A provided
    // id must be a UUID and one of THIS coach's own active categories.
    let categoryId: string | null = null
    if (body.category_id !== undefined && body.category_id !== null && body.category_id !== "") {
      if (typeof body.category_id !== "string" || !UUID_RE.test(body.category_id)) {
        return withCorsJson(req, { ok: false, error: "category_id must be a category UUID" }, 400)
      }
      categoryId = body.category_id
    }

    // visible_to_client: optional; default false (private) — matches the column
    // default and the curated-workspace posture (nothing reaches the client until
    // explicitly shared).
    let visibleToClient = false
    if (body.visible_to_client !== undefined) {
      if (typeof body.visible_to_client !== "boolean") {
        return withCorsJson(req, { ok: false, error: "visible_to_client must be a boolean" }, 400)
      }
      visibleToClient = body.visible_to_client
    }

    const supabase = getSupabaseAdmin()
    const rel = await getOwnedRelationship(supabase, coachProfileId, id)
    if (!rel) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }
    if (!rel.client_profile_id) {
      // Documents denormalize a non-null client_profile_id; a prospect with no
      // linked profile can't hold library docs yet.
      return withCorsJson(req, { ok: false, error: "This client relationship has no linked profile" }, 400)
    }
    if (categoryId && !(await isCategoryOwnedActive(supabase, coachProfileId, categoryId))) {
      return withCorsJson(req, { ok: false, error: "Category not found" }, 404)
    }

    // Next sort_order = current max active doc across the CLIENT's shared
    // library (all coaches' coach_client_id rows) + 1, so numbering is
    // per-client not per-coach-row. rel.client_profile_id is non-null here
    // (guarded above).
    const ccIds = await coachClientIdsForClient(supabase, rel.client_profile_id)
    const { data: maxRow, error: maxErr } = await supabase
      .from("coach_client_documents")
      .select("sort_order")
      .in("coach_client_id", ccIds)
      .is("deleted_at", null)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (maxErr) {
      return withCorsJson(req, { ok: false, error: `Failed to compute sort_order: ${maxErr.message}` }, 500)
    }
    const nextSortOrder = (typeof maxRow?.sort_order === "number" ? maxRow.sort_order : -1) + 1

    const { data: inserted, error: insErr } = await supabase
      .from("coach_client_documents")
      .insert({
        coach_client_id: id,
        coach_profile_id: coachProfileId,
        client_profile_id: rel.client_profile_id,
        category_id: categoryId,
        title: titleParsed.title,
        url: urlParsed.url,
        sort_order: nextSortOrder,
        visible_to_client: visibleToClient,
      })
      .select(DOCUMENT_SELECT)
      .single()
    if (insErr || !inserted) {
      return withCorsJson(req, { ok: false, error: `Failed to create document: ${insErr?.message ?? "unknown error"}` }, 500)
    }

    return withCorsJson(req, { ok: true, document: toApiDocument(inserted as DocumentRow) }, 201)
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
