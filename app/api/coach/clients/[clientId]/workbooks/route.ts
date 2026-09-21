// app/api/coach/clients/[clientId]/workbooks/route.ts
// GET the client's workbooks for the coach's Workbooks tab. Full-access coaches
// only (coachWorkbookScope). Caller-JWT client: RLS on workbooks applies.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { workbookError } from "../../../../_lib/workbookError"
import { must } from "../../../../_lib/must"
import { coachWorkbookScope } from "@/lib/workbook/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)

    const rows = must(
      await supabase
        .from("workbooks")
        .select("id, slug, status, created_at, updated_at, signal_interview_id, interview:content->interview")
        .eq("client_profile_id", scope.subjectId)
        .order("updated_at", { ascending: false }),
      "list workbooks",
    ) ?? []

    const ids = rows.map((r: any) => r.id)
    const sends = ids.length
      ? must(
          await supabase
            .from("workbook_sends")
            .select("workbook_id, direction, sent_at, item_count")
            .in("workbook_id", ids)
            .order("sent_at", { ascending: false }),
          "list workbook sends",
        ) ?? []
      : []

    const workbooks = rows.map((r: any) => {
      const mine = sends.filter((s: any) => s.workbook_id === r.id)
      return {
        ...r,
        last_to_coach: mine.find((s: any) => s.direction === "to_coach") ?? null,
        last_to_client: mine.find((s: any) => s.direction === "to_client") ?? null,
      }
    })

    return withCorsJson(req, { ok: true, workbooks }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
