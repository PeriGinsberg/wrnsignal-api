// app/api/coach/packages/[id]/deliverables/[milestone_id]/route.ts
//
// Coach Packages — unlink one deliverable from a package.
//
//   DELETE — remove the (package_id, milestone_id) join row. 404 if that link
//            doesn't exist.
//
// SECURITY: the package must belong to the authed coach (checked first), so a
// coach can't remove a link from another coach's package by guessing UUIDs.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  getApiPackageById,
} from "../../../../../_lib/coachPackages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; milestone_id: string }> },
) {
  try {
    const { id, milestone_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()

    // Package must belong to this coach before we touch any of its links.
    const { data: pkg, error: pkgErr } = await supabase
      .from("coach_packages")
      .select("id")
      .eq("id", id)
      .eq("coach_profile_id", coachProfileId)
      .maybeSingle()
    if (pkgErr) return withCorsJson(req, { ok: false, error: `Failed to read package: ${pkgErr.message}` }, 500)
    if (!pkg) return withCorsJson(req, { ok: false, error: "Package not found" }, 404)

    const { data: deleted, error: delErr } = await supabase
      .from("coach_package_milestones")
      .delete()
      .eq("package_id", id)
      .eq("milestone_id", milestone_id)
      .select("id")
      .maybeSingle()
    if (delErr) {
      return withCorsJson(req, { ok: false, error: `Failed to unlink deliverable: ${delErr.message}` }, 500)
    }
    if (!deleted) {
      return withCorsJson(req, { ok: false, error: "Deliverable not linked to this package" }, 404)
    }

    const out = await getApiPackageById(supabase, coachProfileId, id)
    return withCorsJson(req, { ok: true, package: out })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
