// app/api/coach/coach-clients/[id]/resume-workshop/export/route.ts
//
// GET: the whole workshop as one Markdown file, read fresh from the database
// (lib/resumeWorkshop/exportMarkdown.ts). Coach only, same check as the
// workshop. No AI and no outside service: the file is the coach's own words.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { errStatus, getSupabaseAdmin, isCoachClientOwnedByCoach, resolveCoach } from "../../../../../_lib/coachEngagements"
import { buildExport } from "@/lib/resumeWorkshop/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client not found" }, 404)
    }
    const r = await buildExport(db, id)
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return new Response(r.data.markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${r.data.filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
