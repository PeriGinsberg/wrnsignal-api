// app/api/supporter/clients/[clientId]/profile/route.ts
//
// The client's profile and master resume, view only. The column list in
// lib/supporters.ts is the whole of it: no email, no coach fields, no
// purchase history, no structured profile internals.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { routeError } from "../../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveSupporterRequestScope } from "@/lib/collab/scope"
import { SUPPORTER_PROFILE_COLUMNS } from "@/lib/supporters"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params
    const supabase = getSupabaseAdmin()
    const scope = await resolveSupporterRequestScope(req, supabase, clientId)
    const { data, error } = await supabase
      .from("client_profiles")
      .select(SUPPORTER_PROFILE_COLUMNS)
      .eq("id", scope.subjectId)
      .maybeSingle()
    if (error) throw new Error(`Profile lookup failed: ${error.message}`)
    if (!data) return withCorsJson(req, { ok: false, error: "Profile not found" }, 404)
    return withCorsJson(req, { ok: true, profile: data })
  } catch (err) {
    return routeError(req, err)
  }
}
