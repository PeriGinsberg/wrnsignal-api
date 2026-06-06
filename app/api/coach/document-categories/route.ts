// app/api/coach/document-categories/route.ts
//
// Client Library — per-coach document-category catalog (practice-level master
// list). Backed by coach_document_categories (dev migration 2026-06-06).
//
// Routes:
//   GET  — list the authed coach's ACTIVE categories, ordered by sort_order.
//          LAZY SEED: if the coach has ZERO rows (active OR inactive), seed the
//          8 curated defaults, then return them. The guard counts ALL rows — a
//          coach who soft-deletes every category still has rows, so the guard
//          sees >= 1 and never re-seeds. Deletions stick. (Mirrors the
//          pipeline seed shape; the guard is adapted to soft-delete semantics.)
//   POST — create one custom category { name }: is_custom=true, active=true,
//          sort_order = (this coach's current max) + 1. 201 on success.
//
// Auth/scoping via _lib/coachAuth (resolveCoach). coach_document_categories has
// NO RLS — every query filters on coach_profile_id resolved from the bearer
// token; the client never supplies the coach id.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin, resolveCoach, errStatus } from "../../_lib/coachAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── Curated default categories (spec order) ──
// Seeded verbatim on first GET. is_custom=false, active=true, sort_order 0..7.
const DEFAULT_CATEGORIES = [
  "Resume",
  "Cover Letter",
  "LinkedIn",
  "Interview Guides",
  "Career / Skill Assessments",
  "Networking",
  "Job Search Strategy",
  "Offer & Negotiation",
]

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

// Stable order: sort_order, then created_at as a tiebreaker.
function ordered(rows: CategoryRow[]) {
  return [...rows].sort(
    (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
  )
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── GET: list active categories (lazy-seed on first access) ──
export async function GET(req: NextRequest) {
  try {
    const { coachProfileId, error: authErr } = await resolveCoach(req)
    if (authErr) return authErr

    const supabase = getSupabaseAdmin()

    // Guard read: ALL rows for this coach (active AND inactive). The count of
    // this set — not the active subset — decides whether to seed.
    const { data: allData, error: readErr } = await supabase
      .from("coach_document_categories")
      .select(CATEGORY_SELECT)
      .eq("coach_profile_id", coachProfileId)
    if (readErr) {
      return withCorsJson(req, { ok: false, error: `Failed to read categories: ${readErr.message}` }, 500)
    }

    let rows = (allData as CategoryRow[]) ?? []
    let seeded = false

    if (rows.length === 0) {
      // No rows ever → seed the 8 defaults in one multi-row insert.
      const seedRows = DEFAULT_CATEGORIES.map((name, i) => ({
        coach_profile_id: coachProfileId,
        name,
        sort_order: i,
        is_custom: false,
        active: true,
      }))
      const { data: ins, error: seedErr } = await supabase
        .from("coach_document_categories")
        .insert(seedRows)
        .select(CATEGORY_SELECT)
      if (seedErr) {
        // A concurrent first-access request seeded first. There's no unique
        // constraint on name, so this won't surface as a constraint error —
        // but re-read regardless to return a single coherent set rather than
        // racing two inserts. (Catch-and-reread, mirroring pipeline.)
        const { data: reread, error: rrErr } = await supabase
          .from("coach_document_categories")
          .select(CATEGORY_SELECT)
          .eq("coach_profile_id", coachProfileId)
        if (rrErr || !reread || reread.length === 0) {
          return withCorsJson(req, { ok: false, error: `Failed to seed categories: ${seedErr.message}` }, 500)
        }
        rows = reread as CategoryRow[]
      } else {
        rows = (ins as CategoryRow[]) ?? []
        seeded = true
      }
    }

    const categories = ordered(rows.filter((r) => r.active)).map(toApiCategory)
    return withCorsJson(req, { ok: true, categories, ...(seeded ? { seeded: true } : {}) })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

// ── POST: create one custom category ──
//
// Body: { name: string (required) }. is_custom=true, active=true. sort_order is
// server-assigned = (this coach's current max across ALL rows) + 1, so a new
// category lands after the existing ones. The coach id comes from the token.
export async function POST(req: NextRequest) {
  try {
    const { coachProfileId, error: authErr } = await resolveCoach(req)
    if (authErr) return authErr

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) {
      return withCorsJson(req, { ok: false, error: "name is required" }, 400)
    }
    if (name.length > NAME_MAX) {
      return withCorsJson(req, { ok: false, error: `name too long (max ${NAME_MAX})` }, 400)
    }

    const supabase = getSupabaseAdmin()

    // Next sort_order = this coach's current max (over all rows) + 1.
    const { data: maxRow, error: maxErr } = await supabase
      .from("coach_document_categories")
      .select("sort_order")
      .eq("coach_profile_id", coachProfileId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (maxErr) {
      return withCorsJson(req, { ok: false, error: `Failed to compute sort_order: ${maxErr.message}` }, 500)
    }
    const nextSortOrder = (typeof maxRow?.sort_order === "number" ? maxRow.sort_order : -1) + 1

    const { data: inserted, error: insErr } = await supabase
      .from("coach_document_categories")
      .insert({
        coach_profile_id: coachProfileId,
        name,
        sort_order: nextSortOrder,
        is_custom: true,
        active: true,
      })
      .select(CATEGORY_SELECT)
      .single()
    if (insErr || !inserted) {
      return withCorsJson(req, { ok: false, error: `Failed to create category: ${insErr?.message ?? "unknown error"}` }, 500)
    }

    return withCorsJson(req, { ok: true, category: toApiCategory(inserted as CategoryRow) }, 201)
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
