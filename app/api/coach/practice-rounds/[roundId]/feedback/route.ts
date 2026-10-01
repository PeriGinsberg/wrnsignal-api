// PATCH — autosave the coach's feedback draft.
// POST  — release it: the client sees it, the task closes, the email goes.
//
// TWO VERBS BECAUSE THERE ARE TWO MOMENTS. A coach types over several minutes
// and every keystroke should survive a closed laptop; none of it should reach
// the client until they say so. Same shape as workbook comments, which are
// written and then released.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { getSupabaseAdmin } from "../../../../_lib/coachAuth"
import { logCoachClientEvent } from "../../../../_lib/coachClientEvents"
import { resolveActor, ForbiddenError } from "@/lib/collab/scope"
import { closePracticeRoundTask, coachPracticeScope, loadRound, NotFoundError } from "@/lib/practice/server"
import { cleanFeedback, hasFeedback } from "@/lib/practice/model"
import { sendPracticeFeedbackEmail } from "@/lib/email/sendPracticeRound"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

function fail(req: NextRequest, e: any) {
  if (e instanceof NotFoundError) return withCorsJson(req, { ok: false, error: "Not found" }, 404)
  if (e instanceof ForbiddenError) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)
  console.error("[practice-feedback]", e?.message ?? e)
  return withCorsJson(req, { ok: false, error: "Something went wrong" }, 500)
}

/** The coach on this round, resolved from the round rather than the URL. */
async function coachOn(req: NextRequest, roundId: string) {
  const actor = await resolveActor(req)
  if (!actor.isCoach) throw new ForbiddenError("Forbidden")
  const admin = getSupabaseAdmin()
  const { data: r } = await admin
    .from("practice_rounds")
    .select("client_profile_id")
    .eq("id", roundId)
    .is("deleted_at", null)
    .maybeSingle()
  if (!r) throw new NotFoundError()
  return coachPracticeScope(req, r.client_profile_id)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await params
    const { db, actorId } = await coachOn(req, roundId)
    const { round } = await loadRound(db, roundId, { id: actorId, as: "coach" })

    // Once released, the client has read it. Editing in place would rewrite
    // what they were told without them knowing.
    if (round.feedback_sent_at) {
      return withCorsJson(req, { ok: false, error: "This feedback has already been sent" }, 409)
    }

    const body = await req.json().catch(() => null)
    const answers: unknown = body?.answers

    if (Array.isArray(answers)) {
      const known = new Set(round.questions.map((q) => q.id))
      for (const a of answers as any[]) {
        const id = String(a?.question_id ?? "")
        if (!known.has(id)) continue
        const { error } = await db
          .from("practice_questions")
          .update({ fb_works: cleanFeedback(a?.works), fb_fix: cleanFeedback(a?.fix) })
          .eq("id", id)
          .eq("round_id", roundId)
        if (error) throw new Error(error.message)
      }
    }

    if (body?.overall !== undefined) {
      const { error } = await db
        .from("practice_rounds")
        .update({ fb_overall: cleanFeedback(body.overall), updated_at: new Date().toISOString() })
        .eq("id", roundId)
      if (error) throw new Error(error.message)
    }

    return withCorsJson(req, { ok: true, saved_at: new Date().toISOString() })
  } catch (e: any) {
    return fail(req, e)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await params
    const { db, actorId } = await coachOn(req, roundId)
    const { round } = await loadRound(db, roundId, { id: actorId, as: "coach" })

    if (round.feedback_sent_at) {
      return withCorsJson(req, { ok: false, error: "This feedback has already been sent" }, 409)
    }
    if (round.status !== "submitted") {
      return withCorsJson(req, { ok: false, error: "There are no answers to give feedback on yet" }, 409)
    }
    // An empty send would email the client to tell them nothing.
    if (!hasFeedback(round)) {
      return withCorsJson(req, { ok: false, error: "Write some feedback first" }, 400)
    }

    const now = new Date().toISOString()
    const { error } = await db
      .from("practice_rounds")
      .update({ status: "feedback_sent", feedback_sent_at: now, updated_at: now })
      .eq("id", roundId)
      .is("feedback_sent_at", null)
    if (error) throw new Error(error.message)

    // CLOSE THE TASK THAT ASKED FOR THIS. The Required Action said "watch
    // their practice round"; sending feedback is what finishing it looks like,
    // and leaving it open would have the coach chase work they have done.
    await closePracticeRoundTask(db, { id: roundId, coach_client_id: round.coach_client_id }, actorId)

    await logCoachClientEvent({
      coachClientId: round.coach_client_id,
      eventType: "practice_feedback_sent",
      actorProfileId: actorId,
      context: { round_id: roundId, questions: round.questions.length },
    })

    const { data: client } = await db
      .from("client_profiles").select("email, name").eq("id", round.client_profile_id).maybeSingle()
    const { data: coach } = await db
      .from("client_profiles").select("name").eq("id", round.coach_profile_id).maybeSingle()

    let emailed = false
    let emailError: string | undefined
    if (client?.email) {
      const mail = await sendPracticeFeedbackEmail({
        to: client.email,
        firstName: String(client.name ?? "").trim().split(/\s+/)[0] || "there",
        coachName: String(coach?.name ?? "").trim().split(/\s+/)[0] || "Your coach",
        roundTitle: round.title,
      })
      emailed = mail.ok
      if (!mail.ok) {
        // Released either way: the feedback is in SIGNAL and they will see it
        // next time they look. Only the nudge is missing, and the coach is the
        // one who can decide what to do about that.
        emailError = mail.error
        console.error("[practice-feedback] email failed:", mail.error)
      }
    } else {
      emailError = "This client has no email address"
    }

    return withCorsJson(req, { ok: true, sent_at: now, emailed, error: emailError })
  } catch (e: any) {
    return fail(req, e)
  }
}
