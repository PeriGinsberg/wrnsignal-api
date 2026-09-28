// GET  — the round, as the client sees it.
// POST — register a recording they have just uploaded, or submit the round.
//
// The client never gets playback URLs for their own takes back from here. They
// have just recorded them; replaying is the coach's job, and not minting those
// URLs keeps the number of signed links in circulation down.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { clientPracticeScope, loadRound, raiseCoachTask, NotFoundError } from "@/lib/practice/server"
import { ANSWER_SECONDS, isComplete, latestTakes } from "@/lib/practice/model"
import { logCoachClientEvent } from "../../../_lib/coachClientEvents"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

function fail(req: NextRequest, e: any) {
  if (e instanceof NotFoundError) return withCorsJson(req, { ok: false, error: "Not found" }, 404)
  console.error("[me/practice-round]", e?.message ?? e)
  return withCorsJson(req, { ok: false, error: "Something went wrong" }, 500)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await params
    const { db, actorId } = await clientPracticeScope(req)
    const { round, takes } = await loadRound(db, roundId, { id: actorId, as: "client" })
    const newest = latestTakes(takes)

    const { data: coach } = await db
      .from("client_profiles").select("name").eq("id", round.coach_profile_id).maybeSingle()

    return withCorsJson(req, {
      ok: true,
      round: {
        id: round.id,
        title: round.title,
        status: round.status,
        submitted_at: round.submitted_at,
        coach_name: String(coach?.name ?? "").trim().split(/\s+/)[0] || "Your coach",
        seconds: ANSWER_SECONDS,
        questions: round.questions.map((q) => ({
          id: q.id,
          position: q.position,
          text: q.text,
          answered: newest.has(q.id),
          takes: takes.filter((t) => t.question_id === q.id).length,
        })),
      },
      complete: isComplete(round.questions, takes),
    })
  } catch (e: any) {
    return fail(req, e)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await params
    const { db, actorId } = await clientPracticeScope(req)
    const { round, takes } = await loadRound(db, roundId, { id: actorId, as: "client" })
    const body = await req.json().catch(() => null)
    const action = String(body?.action ?? "")

    if (round.status === "submitted") {
      return withCorsJson(req, { ok: false, error: "You have already submitted this round" }, 409)
    }

    // ── Register a take ───────────────────────────────────────────────
    if (action === "take") {
      const questionId = String(body?.question_id ?? "")
      const path = String(body?.storage_path ?? "")
      if (!round.questions.some((q) => q.id === questionId)) {
        return withCorsJson(req, { ok: false, error: "That question is not in this round" }, 400)
      }
      // The path is minted by upload-url and always starts with the round id,
      // so a client cannot register a file belonging to someone else's round.
      if (!path.startsWith(`${roundId}/`)) {
        return withCorsJson(req, { ok: false, error: "That recording does not belong to this round" }, 400)
      }
      const duration = Number(body?.duration_ms)
      const { error } = await db.from("practice_takes").insert({
        round_id: roundId,
        question_id: questionId,
        storage_path: path,
        mime: String(body?.mime ?? "video/webm"),
        duration_ms: Number.isFinite(duration) ? Math.round(duration) : null,
      })
      if (error) throw new Error(error.message)
      return withCorsJson(req, { ok: true })
    }

    // ── Submit ────────────────────────────────────────────────────────
    if (action === "submit") {
      if (!isComplete(round.questions, takes)) {
        return withCorsJson(req, { ok: false, error: "Record an answer to every question first" }, 400)
      }
      const now = new Date().toISOString()
      const { error } = await db
        .from("practice_rounds")
        .update({ status: "submitted", submitted_at: now, updated_at: now })
        .eq("id", roundId)
        .neq("status", "submitted")
      if (error) throw new Error(error.message)

      const { data: client } = await db
        .from("client_profiles").select("name").eq("id", round.client_profile_id).maybeSingle()
      const first = String(client?.name ?? "").trim().split(/\s+/)[0] || "Your client"

      // The coach's Required Action, with playback one click away.
      await raiseCoachTask(db, {
        coachClientId: round.coach_client_id,
        clientProfileId: round.client_profile_id,
        assigneeProfileId: round.coach_profile_id,
        title: `Watch ${first}'s practice round`,
        description:
          `${first} recorded ${round.questions.length} answer${round.questions.length === 1 ? "" : "s"}. ` +
          `Watch them back: /dashboard/coach/practice/${roundId}`,
      })

      await logCoachClientEvent({
        coachClientId: round.coach_client_id,
        eventType: "practice_round_submitted",
        actorProfileId: actorId,
        context: { round_id: roundId, questions: round.questions.length },
      })

      return withCorsJson(req, { ok: true, submitted_at: now })
    }

    return withCorsJson(req, { ok: false, error: "Unknown action" }, 400)
  } catch (e: any) {
    return fail(req, e)
  }
}
