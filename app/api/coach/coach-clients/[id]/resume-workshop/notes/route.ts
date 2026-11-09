// app/api/coach/coach-clients/[id]/resume-workshop/notes/route.ts
//
// Coach Notes on the Resume Workshop tabs.
//   GET   every coach's notes for this client (all of the client's coach
//         relationships, not just the caller's), authors' names, the caller's
//         id, and the realtime filter the page subscribes with.
//   POST  { section_id: <tab or 'general'>, body }  a new note by the caller.
// Access: the relationship's coach or their delegate, on an active
// relationship (the workshop's own check).

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { errStatus } from "../../../../../_lib/coachEngagements"
import { authorizeWorkshop } from "../../../../../_lib/resumeWorkshopAuth"
import { addNote, listNotes } from "@/lib/resumeWorkshop/coachNotes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const a = await authorizeWorkshop(req, id)
    if ("error" in a) return a.error
    return withCorsJson(req, { ok: true, ...(await listNotes(a.db, id, a.me)) })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const a = await authorizeWorkshop(req, id)
    if ("error" in a) return a.error
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const r = await addNote(a.db, id, b.section_id, b.body, a.me)
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, note: r.data }, 201)
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
