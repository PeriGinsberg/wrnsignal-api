// app/api/supporter/clients/[clientId]/suggestions/route.ts
//
// POST: a supporter suggests a job. It lands in supporter_job_suggestions as
// 'pending', NOT on the tracker: the client accepts it into the tracker or
// passes on it (/api/me/suggestions/[id]). The client is emailed with a link
// to their tracker; a failed email never fails the suggestion.
//
// No JobFit here. A supporter cannot run one; the client can, once the job is
// on their tracker.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { routeError } from "../../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveSupporterRequestScope } from "@/lib/collab/scope"
import { getAppUrl } from "@/lib/urls"
import { SUGGESTION_COLUMNS, firstName, sendSuggestionNotice } from "@/lib/supporters"
import { readSuggestionFields } from "./fields"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Enough for anyone acting in good faith, and a ceiling on a runaway script. */
const MAX_PENDING_PER_SUPPORTER = 50

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params
    const supabase = getSupabaseAdmin()
    const scope = await resolveSupporterRequestScope(req, supabase, clientId)

    const body = await req.json().catch(() => null)
    const fields = readSuggestionFields(body, { requireAll: true })
    if (!fields.ok) return withCorsJson(req, { ok: false, error: fields.error }, 400)

    const { count, error: cErr } = await supabase
      .from("supporter_job_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("supporter_id", scope.supporterId!)
      .eq("status", "pending")
    if (cErr) throw new Error(`Suggestion count failed: ${cErr.message}`)
    if ((count ?? 0) >= MAX_PENDING_PER_SUPPORTER) {
      return withCorsJson(req, { ok: false, error: "You have a lot of jobs waiting. Give them time to go through those first." }, 429)
    }

    const { data: row, error } = await supabase
      .from("supporter_job_suggestions")
      .insert({ client_profile_id: scope.subjectId, supporter_id: scope.supporterId, ...fields.values })
      .select(SUGGESTION_COLUMNS)
      .single()
    if (error || !row) throw new Error(`Suggestion failed: ${error?.message ?? "no row"}`)

    const [{ data: client }, { data: me }] = await Promise.all([
      supabase.from("client_profiles").select("name, email").eq("id", scope.subjectId).maybeSingle(),
      supabase.from("client_supporters").select("display_name").eq("id", scope.supporterId!).maybeSingle(),
    ])
    let emailed = false
    if (client?.email) {
      const sent = await sendSuggestionNotice({
        to: client.email,
        clientFirstName: firstName(client.name, "there"),
        supporterName: me?.display_name ?? "Your supporter",
        jobTitle: (row as any).job_title,
        companyName: (row as any).company_name,
        trackerUrl: `${getAppUrl(req)}/dashboard/tracker`,
      })
      emailed = sent.ok
      if (!sent.ok) console.error("[supporter/suggestions] client email failed:", sent.error)
    }

    return withCorsJson(req, { ok: true, suggestion: { ...row, mine: true, editable: true }, client_emailed: emailed }, 201)
  } catch (err) {
    return routeError(req, err)
  }
}
