// app/api/coach/packages/[id]/deliverables/route.ts
//
// Coach Packages — link deliverables onto a package.
//
//   POST — { milestone_ids: string[] } → link each to this package. Idempotent
//          on UNIQUE(package_id, milestone_id): already-linked ids are no-ops.
//
// CRITICAL — dual ownership: BOTH the package AND every milestone must belong to
// the authed coach. Single-table scoping would let coach A link coach B's
// deliverable by guessing a UUID; the milestone-ownership check closes that.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  UUID_RE,
  findUnownedMilestones,
  getApiPackageById,
} from "../../../../_lib/coachPackages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

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
    if (
      !Array.isArray(body.milestone_ids) ||
      body.milestone_ids.length === 0 ||
      !body.milestone_ids.every((x: any) => typeof x === "string" && UUID_RE.test(x))
    ) {
      return withCorsJson(req, { ok: false, error: "milestone_ids must be a non-empty array of milestone UUIDs" }, 400)
    }
    const milestoneIds = [...new Set(body.milestone_ids as string[])]

    const supabase = getSupabaseAdmin()

    // 1) Package must belong to this coach.
    const { data: pkg, error: pkgErr } = await supabase
      .from("coach_packages")
      .select("id")
      .eq("id", id)
      .eq("coach_profile_id", coachProfileId)
      .maybeSingle()
    if (pkgErr) return withCorsJson(req, { ok: false, error: `Failed to read package: ${pkgErr.message}` }, 500)
    if (!pkg) return withCorsJson(req, { ok: false, error: "Package not found" }, 404)

    // 2) Every milestone must belong to this coach (dual ownership).
    const unowned = await findUnownedMilestones(supabase, coachProfileId, milestoneIds)
    if (unowned.length) {
      return withCorsJson(req, { ok: false, error: `Deliverable(s) not found: ${unowned.join(", ")}` }, 404)
    }

    // 3) Link the not-yet-linked ids, appended after the package's current max
    //    sort_order. Idempotent: already-linked ids are skipped (and the UNIQUE
    //    constraint backstops any race).
    const { data: existing, error: exErr } = await supabase
      .from("coach_package_milestones")
      .select("milestone_id, sort_order")
      .eq("package_id", id)
    if (exErr) return withCorsJson(req, { ok: false, error: `Failed to read existing links: ${exErr.message}` }, 500)
    const existingIds = new Set((existing ?? []).map((r: any) => r.milestone_id))
    const maxSort = (existing ?? []).reduce((m: number, r: any) => Math.max(m, r.sort_order ?? 0), 0)

    const toInsert = milestoneIds
      .filter((mid) => !existingIds.has(mid))
      .map((mid, i) => ({ package_id: id, milestone_id: mid, sort_order: maxSort + 1 + i }))
    if (toInsert.length) {
      const { error: linkErr } = await supabase
        .from("coach_package_milestones")
        .upsert(toInsert, { onConflict: "package_id,milestone_id", ignoreDuplicates: true })
      if (linkErr) return withCorsJson(req, { ok: false, error: `Failed to link deliverables: ${linkErr.message}` }, 500)
    }

    const out = await getApiPackageById(supabase, coachProfileId, id)
    return withCorsJson(req, { ok: true, package: out })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
