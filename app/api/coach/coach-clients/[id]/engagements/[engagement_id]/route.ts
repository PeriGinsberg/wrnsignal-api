// app/api/coach/coach-clients/[id]/engagements/[engagement_id]/route.ts
//
// Client Engagements — read / detach a single engagement.
//
//   GET    — full snapshot (deliverables[] + nested activities[]) + pricing.
//   PATCH  — set the proposal lifecycle status (draft/sent/approved/declined).
//   DELETE — detach (hard delete; CASCADE clears deliverables + activities).
//
// SECURITY (two-step, the one that matters): (1) the coach_clients row [id] must
// belong to the authed coach; (2) the engagement is matched on BOTH engagement_id
// AND coach_client_id = [id]. So a coach can't read/edit/delete another coach's
// engagement by pairing it with one of THEIR OWN coach_clients rows — the
// coach_client_id match fails → 404.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  PROPOSAL_STATUSES,
  isValidProposalStatus,
  isCoachClientOwnedByCoach,
  getApiEngagementById,
} from "../../../../../_lib/coachEngagements"
import { logCoachClientEvent } from "../../../../../_lib/coachClientEvents"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── GET: single engagement (snapshot + pricing) ──
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string }> },
) {
  try {
    const { id, engagement_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }

    // Matches on engagement_id AND coach_client_id = [id]; an engagement on a
    // DIFFERENT relationship (even one this coach owns) → no match → 404.
    const engagement = await getApiEngagementById(supabase, id, engagement_id)
    if (!engagement) {
      return withCorsJson(req, { ok: false, error: "Engagement not found" }, 404)
    }
    return withCorsJson(req, { ok: true, engagement })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

// ── PATCH: set the proposal lifecycle status ──
//
// Body: { proposal_status: 'draft' | 'sent' | 'approved' | 'declined' }.
// CRITICAL: this writes ONLY coach_client_engagements.proposal_status. It NEVER
// touches coach_clients — approving a proposal has zero side effect on the
// prospect/client row. Convert-to-Client is a completely separate action.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string }> },
) {
  try {
    const { id, engagement_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }
    // Two independently-settable fields. proposal_status keeps its original
    // required-if-present validation; is_proof_project is the Proof Project
    // flag, which selects a PRESENTATION and changes no engagement data.
    const hasProposal = Object.prototype.hasOwnProperty.call(body, "proposal_status")
    const hasProofFlag = Object.prototype.hasOwnProperty.call(body, "is_proof_project")
    if (!hasProposal && !hasProofFlag) {
      return withCorsJson(req, { ok: false, error: "Provide proposal_status and/or is_proof_project" }, 400)
    }
    if (hasProposal && !isValidProposalStatus(body.proposal_status)) {
      return withCorsJson(req, { ok: false, error: `proposal_status must be one of: ${PROPOSAL_STATUSES.join(", ")}` }, 400)
    }
    if (hasProofFlag && typeof body.is_proof_project !== "boolean") {
      return withCorsJson(req, { ok: false, error: "is_proof_project must be a boolean" }, 400)
    }

    const supabase = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }

    // ONE PROOF PROJECT PER CLIENT, enforced here rather than in the schema.
    // The client route takes the oldest flagged engagement, so a second flag
    // would silently do nothing — which looks like a broken toggle. Clearing the
    // others first makes the switch mean what it appears to mean. A unique index
    // was rejected for this: it would turn a presentation choice into a failed
    // write, and the coach's intent when flagging a second one is obviously
    // "this one instead".
    if (hasProofFlag && body.is_proof_project === true) {
      const { error: clearErr } = await supabase
        .from("coach_client_engagements")
        .update({ is_proof_project: false })
        .eq("coach_client_id", id)
        .eq("is_proof_project", true)
        .neq("id", engagement_id)
      if (clearErr) {
        return withCorsJson(req, { ok: false, error: `Failed to move the proof project flag: ${clearErr.message}` }, 500)
      }
    }

    // Update ONLY the engagement row, matched on BOTH engagement_id and
    // coach_client_id = [id] (the dual check). No coach_clients write.
    const patch: { proposal_status?: string; is_proof_project?: boolean } = {}
    if (hasProposal) patch.proposal_status = body.proposal_status
    if (hasProofFlag) patch.is_proof_project = body.is_proof_project
    const { data: updated, error: upErr } = await supabase
      .from("coach_client_engagements")
      .update(patch)
      .eq("id", engagement_id)
      .eq("coach_client_id", id)
      .select("id")
      .maybeSingle()
    if (upErr) {
      return withCorsJson(req, { ok: false, error: `Failed to update engagement: ${upErr.message}` }, 500)
    }
    if (!updated) {
      return withCorsJson(req, { ok: false, error: "Engagement not found" }, 404)
    }

    const engagement = await getApiEngagementById(supabase, id, engagement_id)

    // Best-effort event log. Map the new status → event; SKIP draft (we don't
    // log draft transitions).
    const proposalEvent =
      body.proposal_status === "sent" ? "proposal_sent" :
      body.proposal_status === "approved" ? "proposal_approved" :
      body.proposal_status === "declined" ? "proposal_declined" : null
    if (proposalEvent) {
      await logCoachClientEvent({
        coachClientId: id,
        eventType: proposalEvent,
        actorProfileId: coachProfileId,
        context: { name: engagement?.name },
      })
    }

    return withCorsJson(req, { ok: true, engagement })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

// ── DELETE: detach (hard delete; children CASCADE) ──
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string }> },
) {
  try {
    const { id, engagement_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }

    // Match on BOTH engagement_id and coach_client_id = [id] (see header note).
    // RETURNING also gives the deleted row's name (captured before it's gone).
    const { data: deleted, error: delErr } = await supabase
      .from("coach_client_engagements")
      .delete()
      .eq("id", engagement_id)
      .eq("coach_client_id", id)
      .select("id, name")
      .maybeSingle()
    if (delErr) {
      return withCorsJson(req, { ok: false, error: `Failed to detach engagement: ${delErr.message}` }, 500)
    }
    if (!deleted) {
      return withCorsJson(req, { ok: false, error: "Engagement not found" }, 404)
    }
    const removed = deleted as { id: string; name: string }

    // Best-effort event log (after the detach succeeded; name was returned).
    await logCoachClientEvent({
      coachClientId: id,
      eventType: "engagement_detached",
      actorProfileId: coachProfileId,
      context: { name: removed.name, engagement_id },
    })

    return withCorsJson(req, { ok: true, deleted: removed.id })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
