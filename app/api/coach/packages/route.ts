// app/api/coach/packages/route.ts
//
// Coach Packages — bundles of deliverables with live pricing (list + create).
// Backed by coach_packages + coach_package_milestones (dev migration verified
// 2026-06-04). Auth / scoping mirror app/api/coach/milestones exactly, via the
// shared helpers in app/api/_lib/coachPackages.ts.
//
// Routes:
//   GET  — list this coach's packages, each with deliverables[] + pricing.
//   POST — create { name, description?, discount?, deliverable_ids?[] }.
//          discount is DOLLARS → cents. deliverable_ids are dual-ownership
//          checked BEFORE create, then linked. 201 on success.
//
// SECURITY: no RLS — every query is scoped on coach_profile_id from the token.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  UUID_RE,
  parseDiscountToCents,
  PACKAGE_SELECT,
  type PackageRow,
  toApiPackages,
  findUnownedMilestones,
  getApiPackageById,
} from "../../_lib/coachPackages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── GET: list this coach's packages (with deliverables + pricing) ──
export async function GET(req: NextRequest) {
  try {
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    const { data, error: readErr } = await supabase
      .from("coach_packages")
      .select(PACKAGE_SELECT)
      .eq("coach_profile_id", coachProfileId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
    if (readErr) {
      return withCorsJson(req, { ok: false, error: `Failed to read packages: ${readErr.message}` }, 500)
    }

    const packages = await toApiPackages(supabase, coachProfileId, (data as PackageRow[]) ?? [])
    return withCorsJson(req, { ok: true, packages })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

// ── POST: create one package, optionally linking deliverables ──
//
// Body: { name (required), description?, discount? (DOLLARS), deliverable_ids?:
//         string[] (milestone UUIDs) }. The coach id comes from the token.
export async function POST(req: NextRequest) {
  try {
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) return withCorsJson(req, { ok: false, error: "name is required" }, 400)
    const description =
      typeof body.description === "string" && body.description.trim() ? body.description.trim() : null

    const discountParsed = parseDiscountToCents(body.discount)
    if ("error" in discountParsed) {
      return withCorsJson(req, { ok: false, error: discountParsed.error }, 400)
    }

    let deliverableIds: string[] = []
    if (body.deliverable_ids !== undefined && body.deliverable_ids !== null) {
      if (
        !Array.isArray(body.deliverable_ids) ||
        !body.deliverable_ids.every((x: any) => typeof x === "string" && UUID_RE.test(x))
      ) {
        return withCorsJson(req, { ok: false, error: "deliverable_ids must be an array of milestone UUIDs" }, 400)
      }
      deliverableIds = [...new Set(body.deliverable_ids as string[])]
    }

    const supabase = getSupabaseAdmin()

    // Dual ownership: every deliverable must belong to this coach — checked
    // BEFORE create so a cross-coach id can't leave an orphan package behind.
    if (deliverableIds.length) {
      const unowned = await findUnownedMilestones(supabase, coachProfileId, deliverableIds)
      if (unowned.length) {
        return withCorsJson(req, { ok: false, error: `Deliverable(s) not found: ${unowned.join(", ")}` }, 404)
      }
    }

    // sort_order = this coach's current max + 1 (scoped to the coach).
    const { data: maxRow, error: maxErr } = await supabase
      .from("coach_packages")
      .select("sort_order")
      .eq("coach_profile_id", coachProfileId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (maxErr) {
      return withCorsJson(req, { ok: false, error: `Failed to compute sort_order: ${maxErr.message}` }, 500)
    }
    const nextSortOrder = (typeof maxRow?.sort_order === "number" ? maxRow.sort_order : 0) + 1

    const { data: inserted, error: insErr } = await supabase
      .from("coach_packages")
      .insert({
        coach_profile_id: coachProfileId,
        name,
        description,
        discount_cents: discountParsed.cents,
        sort_order: nextSortOrder,
      })
      .select("id")
      .single()
    if (insErr || !inserted) {
      return withCorsJson(req, { ok: false, error: `Failed to create package: ${insErr?.message ?? "unknown error"}` }, 500)
    }
    const packageId = (inserted as { id: string }).id

    if (deliverableIds.length) {
      const linkRows = deliverableIds.map((mid, i) => ({
        package_id: packageId,
        milestone_id: mid,
        sort_order: i + 1,
      }))
      // Idempotent on UNIQUE(package_id, milestone_id).
      const { error: linkErr } = await supabase
        .from("coach_package_milestones")
        .upsert(linkRows, { onConflict: "package_id,milestone_id", ignoreDuplicates: true })
      if (linkErr) {
        return withCorsJson(req, { ok: false, error: `Package created but linking failed: ${linkErr.message}` }, 500)
      }
    }

    const pkg = await getApiPackageById(supabase, coachProfileId, packageId)
    return withCorsJson(req, { ok: true, package: pkg }, 201)
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
