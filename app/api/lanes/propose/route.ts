// app/api/lanes/propose/route.ts
// GET ?client_profile_id=<uuid>[&probe=0]
//
// Propose a lane for a client from their profile, checked against the board.
//
// Nothing is written. The result is a draft for a coach to edit and then POST to
// /api/lanes — which is the point: the proposal is derived from free text a
// client typed into an intake form, and the failure mode of a wrong lane is
// silent. A lane with the wrong keyword returns plausible jobs from the wrong
// industry and nobody can tell from the results that the config was wrong.
//
// Requires FULL access, not view: this is the first step of creating a lane, and
// it also spends real requests against a third party. Read-only in our database
// is not the same as free.
//
// SLOW ON PURPOSE. With probe=1 (the default) this makes one board request per
// title for a baseline plus one per title per candidate keyword — up to ~32
// requests. That is why it exists as its own route rather than as part of the
// create call: the coach sees the evidence, then decides.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { canAccessLaneOwner } from "@/lib/collab/laneAccess"
import { proposeLane } from "@/lib/laneProposal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const url = new URL(req.url)
    const clientProfileId = url.searchParams.get("client_profile_id")
    // probe=0 gives the offline derivation only. Useful for a fast preview and
    // for testing the heuristics without hitting the board.
    const probe = url.searchParams.get("probe") !== "0"

    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "client_profile_id required" }, 400)
    if (!(await canAccessLaneOwner(clientProfileId, profileId, "send", getSupabaseAdmin()))) {
      return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)
    }

    const supabase = getSupabaseAdmin()
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("id, name, email, target_roles, target_locations, preferred_locations, profile_text, resume_text, target_industries, excluded_industries")
      .eq("id", clientProfileId)
      .maybeSingle()
    if (!profile) return withCorsJson(req, { ok: false, error: "Client not found" }, 404)

    const { data: targeting } = await supabase
      .from("candidate_targeting")
      .select("career_stage, primary_other_description")
      .eq("profile_id", clientProfileId)
      .maybeSingle()

    const result = await proposeLane(
      {
        clientProfileId,
        targetRoles: (profile as any).target_roles ?? null,
        targetLocations: (profile as any).target_locations ?? null,
        preferredLocations: (profile as any).preferred_locations ?? null,
        profileText: (profile as any).profile_text ?? null,
        resumeText: (profile as any).resume_text ?? null,
        careerStage: (targeting as any)?.career_stage ?? null,
        primaryOtherDescription: (targeting as any)?.primary_other_description ?? null,
        targetIndustries: (profile as any).target_industries ?? [],
        excludedIndustries: (profile as any).excluded_industries ?? [],
      },
      { probe }
    )

    return withCorsJson(
      req,
      {
        ok: true,
        client: { id: (profile as any).id, name: (profile as any).name, email: (profile as any).email },
        ...result,
      },
      200
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
