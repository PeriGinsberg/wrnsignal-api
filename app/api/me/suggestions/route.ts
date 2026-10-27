// app/api/me/suggestions/route.ts
//
// The client's waiting suggestions: jobs a supporter added that the client has
// not accepted or passed on yet. Drives the Suggested strip on the tracker.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { routeError } from "../../_lib/routeError"
import { getCallerProfile, getSupabaseAdmin } from "@/lib/collab/identity"
import { SUGGESTION_COLUMNS } from "@/lib/supporters"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const me = await getCallerProfile(req, "id")
    const supabase = getSupabaseAdmin()
    const [{ data, error }, { data: sups, error: sErr }] = await Promise.all([
      supabase
        .from("supporter_job_suggestions")
        .select(SUGGESTION_COLUMNS)
        .eq("client_profile_id", me.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase.from("client_supporters").select("id, display_name").eq("client_profile_id", me.id),
    ])
    if (error || sErr) throw new Error(`Suggestions lookup failed: ${(error ?? sErr)!.message}`)
    const nameOf = new Map(((sups ?? []) as any[]).map((s) => [s.id as string, s.display_name as string]))
    return withCorsJson(req, {
      ok: true,
      suggestions: ((data ?? []) as any[]).map((s) => ({ ...s, added_by_name: nameOf.get(s.supporter_id) ?? null })),
    })
  } catch (err) {
    return routeError(req, err)
  }
}
