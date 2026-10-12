// app/api/coach/coach-clients/[id]/emails/route.ts
//
// The Communications tab: every email SIGNAL sent this client or prospect,
// newest first (lib/email/clientEmailLog.ts). The list carries no bodies;
// GET ./[emailId] returns one email in full.
//
// READ-ONLY. Rows are written by sendToClient, never by request. Auth and
// ownership are the History tab's (../events/route.ts): resolve the coach,
// verify the coach_clients row is theirs, 404 otherwise.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { getSupabaseAdmin, resolveCoach, errStatus, isCoachClientOwnedByCoach } from "../../../../_lib/coachEngagements"
import { CLIENT_EMAIL_LIST_SELECT, withSenderNames } from "@/lib/email/clientEmailRead"

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
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }
    const { data, error: qErr } = await db.from("client_emails").select(CLIENT_EMAIL_LIST_SELECT)
      .eq("coach_client_id", id).order("sent_at", { ascending: false })
    if (qErr) throw new Error(qErr.message)
    return withCorsJson(req, { ok: true, emails: await withSenderNames(db, data ?? []) })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
