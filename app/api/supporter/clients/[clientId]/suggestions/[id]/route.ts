// app/api/supporter/clients/[clientId]/suggestions/[id]/route.ts
//
// A supporter edits or deletes a job THEY suggested, and only while it is
// pending. Once the client has accepted it (it is the client's tracker row
// now) or passed on it, it is read-only for the supporter.
//
// The pending check is on the UPDATE / DELETE itself, not a read before it, so
// a client accepting at the same moment cannot be overwritten.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { routeError } from "../../../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveSupporterRequestScope } from "@/lib/collab/scope"
import { SUGGESTION_COLUMNS } from "@/lib/supporters"
import { readSuggestionFields } from "../fields"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

const ACTED = "They have already added this job or passed on it, so it can no longer be changed."

async function notEditable(supabase: ReturnType<typeof getSupabaseAdmin>, id: string, subject: string, supporterId: string) {
  const { data } = await supabase
    .from("supporter_job_suggestions")
    .select("status")
    .eq("id", id)
    .eq("client_profile_id", subject)
    .eq("supporter_id", supporterId)
    .maybeSingle()
  return data ? { error: ACTED, status: 409 } : { error: "Suggestion not found", status: 404 }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ clientId: string; id: string }> }) {
  try {
    const { clientId, id } = await params
    const supabase = getSupabaseAdmin()
    const scope = await resolveSupporterRequestScope(req, supabase, clientId)
    const fields = readSuggestionFields(await req.json().catch(() => null), { requireAll: false })
    if (!fields.ok) return withCorsJson(req, { ok: false, error: fields.error }, 400)
    if (!Object.keys(fields.values).length) return withCorsJson(req, { ok: false, error: "Nothing to change" }, 400)

    const { data, error } = await supabase
      .from("supporter_job_suggestions")
      .update(fields.values)
      .eq("id", id)
      .eq("client_profile_id", scope.subjectId)
      .eq("supporter_id", scope.supporterId!)
      .eq("status", "pending")
      .select(SUGGESTION_COLUMNS)
    if (error) throw new Error(`Suggestion update failed: ${error.message}`)
    if (!data?.length) {
      const why = await notEditable(supabase, id, scope.subjectId, scope.supporterId!)
      return withCorsJson(req, { ok: false, error: why.error }, why.status)
    }
    return withCorsJson(req, { ok: true, suggestion: { ...data[0], mine: true, editable: true } })
  } catch (err) {
    return routeError(req, err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ clientId: string; id: string }> }) {
  try {
    const { clientId, id } = await params
    const supabase = getSupabaseAdmin()
    const scope = await resolveSupporterRequestScope(req, supabase, clientId)
    const { data, error } = await supabase
      .from("supporter_job_suggestions")
      .delete()
      .eq("id", id)
      .eq("client_profile_id", scope.subjectId)
      .eq("supporter_id", scope.supporterId!)
      .eq("status", "pending")
      .select("id")
    if (error) throw new Error(`Suggestion delete failed: ${error.message}`)
    if (!data?.length) {
      const why = await notEditable(supabase, id, scope.subjectId, scope.supporterId!)
      return withCorsJson(req, { ok: false, error: why.error }, why.status)
    }
    return withCorsJson(req, { ok: true, deleted: id })
  } catch (err) {
    return routeError(req, err)
  }
}
