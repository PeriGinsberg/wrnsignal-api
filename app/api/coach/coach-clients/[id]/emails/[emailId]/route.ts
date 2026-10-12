// app/api/coach/coach-clients/[id]/emails/[emailId]/route.ts
//
// One email from the Communications tab, in full: the text and HTML exactly as
// sent, private links already replaced when it was saved. Same auth as the
// list (../route.ts); an email belonging to another client is a 404.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { getSupabaseAdmin, resolveCoach, errStatus, isCoachClientOwnedByCoach } from "../../../../../_lib/coachEngagements"
import { CLIENT_EMAIL_LIST_SELECT, withSenderNames } from "@/lib/email/clientEmailRead"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; emailId: string }> }) {
  try {
    const { id, emailId } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }
    const { data, error: qErr } = await db.from("client_emails")
      .select(`${CLIENT_EMAIL_LIST_SELECT}, text_body, html_body`)
      .eq("coach_client_id", id).eq("id", emailId).maybeSingle()
    if (qErr) throw new Error(qErr.message)
    if (!data) return withCorsJson(req, { ok: false, error: "Email not found" }, 404)
    const [email] = await withSenderNames(db, [data])
    return withCorsJson(req, { ok: true, email })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
