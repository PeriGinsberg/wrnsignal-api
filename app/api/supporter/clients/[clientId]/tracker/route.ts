// app/api/supporter/clients/[clientId]/tracker/route.ts
//
// The supporter's view of a client's tracker, READ ONLY, plus every suggestion
// made for the client (theirs editable while pending, the other supporter's
// read-only, decided ones labelled).
//
// WHAT IS NOT HERE, ON PURPOSE: the client's own notes, coach annotations,
// coach recommendations and their coaching notes, coach responses, the job
// description. Explicit columns only (lib/supporters.ts); no select("*"), no
// embeds, because an embed is how a coach table would arrive unasked.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { routeError } from "../../../../_lib/routeError"
import { getHistoryBoundary, applyHistoryBoundary } from "../../../../_lib/clientHistoryBoundary"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveSupporterRequestScope } from "@/lib/collab/scope"
import {
  SUGGESTION_COLUMNS, SUPPORTER_APPLICATION_COLUMNS, SUPPORTER_INTERVIEW_COLUMNS, firstName,
} from "@/lib/supporters"

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
    const subject = scope.subjectId

    // The same window the client's own tracker shows.
    const boundaryAt = await getHistoryBoundary(supabase, subject)
    const q = supabase.from("signal_applications").select(SUPPORTER_APPLICATION_COLUMNS).eq("profile_id", subject)
    const { data: apps, error: appsErr } = await applyHistoryBoundary(q, boundaryAt).order("created_at", { ascending: false })
    if (appsErr) throw new Error(`Applications lookup failed: ${appsErr.message}`)
    const applications = (apps ?? []) as any[]

    const appIds = applications.map((a) => a.id as string)
    const runIds = Array.from(new Set(applications.map((a) => a.jobfit_run_id).filter(Boolean))) as string[]
    const [ivRes, clRes, sugRes, supRes, clientRes] = await Promise.all([
      appIds.length
        ? supabase.from("signal_interviews").select(SUPPORTER_INTERVIEW_COLUMNS).eq("profile_id", subject).in("application_id", appIds)
        : Promise.resolve({ data: [], error: null }),
      runIds.length
        ? supabase.from("coverletter_runs").select("jobfit_run_id").eq("client_profile_id", subject).in("jobfit_run_id", runIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("supporter_job_suggestions")
        .select(SUGGESTION_COLUMNS)
        .eq("client_profile_id", subject)
        .order("created_at", { ascending: false }),
      supabase.from("client_supporters").select("id, display_name").eq("client_profile_id", subject),
      supabase.from("client_profiles").select("name").eq("id", subject).maybeSingle(),
    ])
    for (const r of [ivRes, clRes, sugRes, supRes]) {
      if (r.error) throw new Error(`Tracker lookup failed: ${r.error.message}`)
    }

    const supporterName = new Map(((supRes.data ?? []) as any[]).map((s) => [s.id as string, s.display_name as string]))
    const interviewsByApp = new Map<string, { interview_stage: string; interview_date: string | null }[]>()
    for (const iv of (ivRes.data ?? []) as any[]) {
      const list = interviewsByApp.get(iv.application_id) ?? []
      list.push({ interview_stage: iv.interview_stage, interview_date: iv.interview_date })
      interviewsByApp.set(iv.application_id, list)
    }
    const withLetter = new Set(((clRes.data ?? []) as any[]).map((r) => r.jobfit_run_id as string))

    return withCorsJson(req, {
      ok: true,
      client: { first_name: firstName((clientRes.data as any)?.name, "Your contact") },
      me: { supporter_id: scope.supporterId, display_name: supporterName.get(scope.supporterId!) ?? null },
      applications: applications.map((a) => ({
        ...a,
        added_by_name: a.added_by_role === "supporter" ? supporterName.get(a.added_by_supporter_id) ?? null : null,
        interviews: interviewsByApp.get(a.id) ?? [],
        has_jobfit: !!a.jobfit_run_id,
        has_cover_letter: a.jobfit_run_id ? withLetter.has(a.jobfit_run_id) : false,
      })),
      suggestions: ((sugRes.data ?? []) as any[]).map((s) => ({
        ...s,
        added_by_name: supporterName.get(s.supporter_id) ?? null,
        mine: s.supporter_id === scope.supporterId,
        editable: s.supporter_id === scope.supporterId && s.status === "pending",
      })),
    })
  } catch (err) {
    return routeError(req, err)
  }
}
