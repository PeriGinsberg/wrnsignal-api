// app/api/coach/job-queue/match/route.ts
//
// PATCH { client_profile_id, match_ids[], action, reason?, note? }
//   action 'evaluating'  Add Job opened (never downgrades a decision)
//   action 'dismiss'     Not a fit; reason required, 'other' needs a note
//   action 'push' with already_added: true
//                        Already added: a Fit because the job is already in the
//                        client's tracker; nothing is added, no JobFit runs
//   action null          undo: back to undecided
// Any other 'push' (Fit) is written by /api/coach/recommend-job when the job is
// added to the client's tracker, with the JobFit result; not here.
// match_ids are every copy of the job this client has: all get the decision.
import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { assertFullAccess, HttpError, recordDecision } from "@/lib/match/jobQueue"
import { coachCaller, fail } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PATCH(req: NextRequest) {
  try {
    const { sb, coachProfileId } = await coachCaller(req)
    const b = await req.json().catch(() => null)
    if (!b || typeof b !== "object") throw new HttpError(400, "Invalid JSON body")
    const clientProfileId = String(b.client_profile_id ?? "").trim()
    if (!clientProfileId) throw new HttpError(400, "client_profile_id is required")
    if (!Array.isArray(b.match_ids)) throw new HttpError(400, "match_ids must be an array")
    const alreadyAdded = b.action === "push" && b.already_added === true
    if (!(b.action === null || b.action === "evaluating" || b.action === "dismiss" || alreadyAdded)) {
      throw new HttpError(400, "action must be evaluating, dismiss, push with already_added: true, or null")
    }
    await assertFullAccess(sb, coachProfileId, clientProfileId)
    const r = await recordDecision(sb, {
      clientProfileId, matchIds: b.match_ids.map(String), action: b.action,
      reason: b.reason ?? null, note: typeof b.note === "string" ? b.note : undefined, actorId: coachProfileId, alreadyAdded,
    })
    return withCorsJson(req, { ok: true, ...r })
  } catch (err) {
    return fail(req, err)
  }
}
