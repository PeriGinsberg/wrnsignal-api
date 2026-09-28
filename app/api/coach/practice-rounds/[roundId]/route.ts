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
import { cleanQuestions, latestTakes } from "@/lib/practice/model"

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

    return withCorsJson(req, {
      ok: true,
      round,
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
