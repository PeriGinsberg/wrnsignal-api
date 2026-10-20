// GET    — one round in full, with signed playback URLs once answers exist.
// PATCH  — replace the question list (this is also how reordering saves).
// DELETE — soft delete a draft.
//
// Keyed by round rather than by client, because the builder and the review
// view both already hold a round id and looking the client up again would only
// give another chance to disagree about which one it is.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin } from "../../../_lib/coachAuth"
import { resolveActor, ForbiddenError } from "@/lib/collab/scope"
import { coachPracticeScope, loadRound, signTakes, NotFoundError } from "@/lib/practice/server"
import { answerSecondsFor, cleanQuestions, latestTakes } from "@/lib/practice/model"
import { getCase } from "@/lib/academy/cases"
import { rubricAverage } from "@/lib/academy/rubric"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

function fail(req: NextRequest, e: any) {
  if (e instanceof NotFoundError) return withCorsJson(req, { ok: false, error: "Not found" }, 404)
  if (e instanceof ForbiddenError) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)
  console.error("[practice-round]", e?.message ?? e)
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
  // Re-resolve through the normal path so a delegate is handled the same way
  // here as everywhere else.
  return coachPracticeScope(req, r.client_profile_id)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await params
    const { db, actorId } = await coachOn(req, roundId)
    const { round, takes } = await loadRound(db, roundId, { id: actorId, as: "coach" })
    const newest = latestTakes(takes)
    const urls = await signTakes(db, [...newest.values()])

    // ── Case rounds: the coach-only extras ──────────────────────────────
    // The answer key and guide come from the case library here, on the
    // server, and nowhere else. The rubric and review are read separately
    // from the shared loader so no client route can ever pick them up.
    let academy: Record<string, unknown> | null = null
    if (round.kind === "case") {
      const { data: extra } = await db.from("practice_rounds")
        .select("rubric, coach_review, review_updated_at").eq("id", roundId).maybeSingle()
      const { data: attempts } = await db.from("practice_rounds")
        .select("id, title, case_id, status, sent_at, submitted_at, rubric")
        .eq("client_profile_id", round.client_profile_id).eq("kind", "case").is("deleted_at", null)
        .order("created_at", { ascending: true })
      let workbook: { id: string; title: string | null; status: string } | null = null
      if (round.workbook_id) {
        const { data: wb } = await db.from("workbooks")
          .select("id, status, title:content->>title").eq("id", round.workbook_id).maybeSingle()
        if (wb) workbook = { id: wb.id, title: (wb as any).title ?? null, status: wb.status }
      }
      academy = {
        guide: getCase(round.case_id),
        rubric: extra?.rubric ?? {},
        review: extra?.coach_review ?? {},
        review_updated_at: extra?.review_updated_at ?? null,
        workbook,
        attempts: (attempts ?? []).map((a: any) => {
          const def = getCase(a.case_id)
          return {
            id: a.id, title: a.title, case_id: a.case_id, case_title: def?.title ?? null,
            difficulty: def?.difficulty ?? null, case_type: def?.type ?? null,
            status: a.status, sent_at: a.sent_at, submitted_at: a.submitted_at,
            rubric_average: rubricAverage(a.rubric), current: a.id === roundId,
          }
        }),
      }
    }

    return withCorsJson(req, {
      ok: true,
      round,
      academy,
      answers: round.questions.map((q) => {
        const t = newest.get(q.id)
        return {
          question_id: q.id,
          take_id: t?.id ?? null,
          mime: t?.mime ?? null,
          duration_ms: t?.duration_ms ?? null,
          recorded_at: t?.created_at ?? null,
          // How many times they went again. Worth showing a coach: four takes
          // on one question is a sign about the question, not the client.
          takes: takes.filter((x) => x.question_id === q.id).length,
          url: t ? urls[t.id] ?? null : null,
          seconds: answerSecondsFor(q),
          question_shown_at: t?.question_shown_at ?? null,
          response_started_at: t?.response_started_at ?? null,
          response_ended_at: t?.response_ended_at ?? null,
          first_speech_ms: t?.first_speech_ms ?? null,
          transcript: t?.transcript ?? null,
          transcript_status: t?.transcript_status ?? null,
          transcript_error: t?.transcript_error ?? null,
        }
      }),
    })
  } catch (e: any) {
    return fail(req, e)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await params
    const { db, actorId } = await coachOn(req, roundId)
    const { round } = await loadRound(db, roundId, { id: actorId, as: "coach" })

    // Once it is with the client, the questions are what they were asked. A
    // round that changed under them would make their answers look like answers
    // to something else.
    if (round.status !== "draft") {
      return withCorsJson(req, { ok: false, error: "This round has already been sent" }, 409)
    }
    // A case's questions come from the case library, with timing and exhibits
    // the builder knows nothing about. Rebuilding them here would strip both.
    if (round.kind === "case") {
      return withCorsJson(req, { ok: false, error: "A case round's questions come from the case library and cannot be edited here" }, 409)
    }

    const body = await req.json().catch(() => null)
    const cleaned = cleanQuestions(body?.questions)
    if (!cleaned.ok) return withCorsJson(req, { ok: false, error: cleaned.error }, 400)

    // Replace wholesale. Positions are rewritten from zero, so reorder, add,
    // remove and edit are all the same request.
    const { error: delErr } = await db.from("practice_questions").delete().eq("round_id", roundId)
    if (delErr) throw new Error(delErr.message)
    const { error: insErr } = await db
      .from("practice_questions")
      .insert(cleaned.questions.map((q) => ({ ...q, round_id: roundId })))
    if (insErr) throw new Error(insErr.message)

    const title = String(body?.title ?? "").trim()
    await db
      .from("practice_rounds")
      .update({ updated_at: new Date().toISOString(), ...(title ? { title } : {}) })
      .eq("id", roundId)

    return withCorsJson(req, { ok: true })
  } catch (e: any) {
    return fail(req, e)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await params
    const { db, actorId } = await coachOn(req, roundId)
    const { round } = await loadRound(db, roundId, { id: actorId, as: "coach" })
    if (round.status === "submitted") {
      return withCorsJson(req, { ok: false, error: "This round has answers in it" }, 409)
    }
    await db.from("practice_rounds").update({ deleted_at: new Date().toISOString() }).eq("id", roundId)
    return withCorsJson(req, { ok: true })
  } catch (e: any) {
    return fail(req, e)
  }
}
