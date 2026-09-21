// app/api/coach/clients/[clientId]/workbooks/[workbookId]/route.ts
// GET one workbook for review: full content (coach_only included), live answers,
// comments (coach drafts plus everything released; RLS hides the client's
// unsent questions), send history and section marks. "See it as <client>"
// strips coach_only from this same content on the page (stripCoachOnly).

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { workbookError } from "../../../../../_lib/workbookError"
import { must } from "../../../../../_lib/must"
import { coachWorkbookScope, loadAnswers, loadComments, loadSends } from "@/lib/workbook/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest, { params }: { params: Promise<{ clientId: string; workbookId: string }> }) {
  try {
    const { clientId, workbookId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)

    const wb = must(
      await supabase
        .from("workbooks")
        .select("id, slug, status, content, signal_interview_id, created_at, updated_at")
        .eq("id", workbookId)
        .eq("client_profile_id", scope.subjectId)
        .maybeSingle(),
      "read workbook",
    ) as any
    if (!wb) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)

    const interview = wb.signal_interview_id
      ? must(
          await supabase
            .from("signal_interviews")
            .select("company_name, job_title, interview_date, interview_at, interviewer_names")
            .eq("id", wb.signal_interview_id)
            .eq("profile_id", scope.subjectId)
            .maybeSingle(),
          "read linked interview",
        )
      : null

    const [answers, comments, sends, marks] = await Promise.all([
      loadAnswers(supabase, workbookId),
      loadComments(supabase, workbookId),
      loadSends(supabase, workbookId),
      supabase.from("workbook_section_marks").select("section_id, marked_at").eq("workbook_id", workbookId)
        .then((r) => must(r, "read section marks") ?? []),
    ])

    return withCorsJson(req, {
      ok: true,
      workbook: wb,
      interview,
      answers,
      comments,
      sends,
      marks,
    }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
