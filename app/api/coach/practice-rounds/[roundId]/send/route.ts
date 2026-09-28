// POST — send a draft round to the client.
//
// FLIPS THE STATUS FIRST, THEN EMAILS. A round that is "sent" but whose mail
// failed is recoverable: the coach presses Send again, or the client finds it
// in SIGNAL anyway, because the link is just a page they can reach. A round
// that emailed but stayed "draft" is not recoverable: the client follows the
// link and is told there is nothing there.
//
// Sending twice is allowed and is the retry. It does not reset sent_at.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { getSupabaseAdmin } from "../../../../_lib/coachAuth"
import { resolveActor, ForbiddenError } from "@/lib/collab/scope"
import { coachPracticeScope, loadRound, NotFoundError } from "@/lib/practice/server"
import { ANSWER_SECONDS } from "@/lib/practice/model"
import { sendPracticeRoundEmail } from "@/lib/email/sendPracticeRound"
import { logCoachClientEvent } from "../../../../_lib/coachClientEvents"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await params
    const actor = await resolveActor(req)
    if (!actor.isCoach) throw new ForbiddenError("Forbidden")

    const admin = getSupabaseAdmin()
    const { data: head } = await admin
      .from("practice_rounds")
      .select("client_profile_id")
      .eq("id", roundId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!head) throw new NotFoundError()

    const { db, actorId, coachClientId } = await coachPracticeScope(req, head.client_profile_id)
    const { round } = await loadRound(db, roundId, { id: actorId, as: "coach" })

    if (round.status === "submitted") {
      return withCorsJson(req, { ok: false, error: "This round has already been answered" }, 409)
    }
    if (round.questions.length === 0) {
      return withCorsJson(req, { ok: false, error: "Add a question before sending" }, 400)
    }

    const { data: client } = await db
      .from("client_profiles")
      .select("email, name")
      .eq("id", round.client_profile_id)
      .maybeSingle()
    const { data: coach } = await db
      .from("client_profiles")
      .select("name")
      .eq("id", round.coach_profile_id)
      .maybeSingle()

    if (!client?.email) {
      return withCorsJson(req, { ok: false, error: "This client has no email address" }, 400)
    }

    const first = String(client.name ?? "").trim().split(/\s+/)[0] || "there"
    const coachName = String(coach?.name ?? "").trim().split(/\s+/)[0] || "Your coach"

    if (round.status === "draft") {
      const { error } = await db
        .from("practice_rounds")
        .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", roundId)
        .eq("status", "draft")
      if (error) throw new Error(error.message)

      await logCoachClientEvent({
        coachClientId,
        eventType: "practice_round_sent",
        actorProfileId: actorId,
        context: { round_id: roundId, questions: round.questions.length },
      })
    }

    const mail = await sendPracticeRoundEmail({
      to: client.email,
      firstName: first,
      coachName,
      questionCount: round.questions.length,
      seconds: ANSWER_SECONDS,
      roundId,
    })

    if (!mail.ok) {
      // Sent, but they were not told. Say so plainly rather than reporting
      // success: the coach is the only one who can decide what to do next.
      console.error("[practice] send email failed:", mail.error)
      return withCorsJson(req, {
        ok: true, status: "sent", emailed: false, error: mail.error,
      })
    }

    return withCorsJson(req, {
      ok: true,
      status: "sent",
      emailed: true,
      to: mail.to,
      redirected: mail.redirected,
    })
  } catch (e: any) {
    if (e instanceof NotFoundError) return withCorsJson(req, { ok: false, error: "Not found" }, 404)
    if (e instanceof ForbiddenError) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)
    console.error("[practice-send]", e?.message ?? e)
    return withCorsJson(req, { ok: false, error: "Something went wrong" }, 500)
  }
}
