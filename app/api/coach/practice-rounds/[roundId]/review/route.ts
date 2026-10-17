// PATCH — autosave the coach's case evaluation: rubric scores and notes, and
//         the overall review (strengths, priorities, drills, summary).
// POST  — { action: "transcribe", take_id } re-runs a transcript that failed.
//
// COACH ONLY, ALWAYS. Unlike fb_works / fb_fix / fb_overall, which the coach
// releases with Send feedback, the rubric and the review are never shown to
// the student by any route. They are the coach's working notes and the
// export's Coach_Feedback.md; what the student gets is still the released
// feedback.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { getSupabaseAdmin } from "../../../../_lib/coachAuth"
import { resolveActor, ForbiddenError } from "@/lib/collab/scope"
import { coachPracticeScope, loadRound, NotFoundError } from "@/lib/practice/server"
import { cleanReview, cleanRubric } from "@/lib/academy/rubric"
import { transcribeTake } from "@/lib/academy/transcribe"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// A retried transcript runs inside the request.
export const maxDuration = 120

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

function fail(req: NextRequest, e: any) {
  if (e instanceof NotFoundError) return withCorsJson(req, { ok: false, error: "Not found" }, 404)
  if (e instanceof ForbiddenError) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)
  console.error("[practice-review]", e?.message ?? e)
  return withCorsJson(req, { ok: false, error: "Something went wrong" }, 500)
}

async function coachOn(req: NextRequest, roundId: string) {
  const actor = await resolveActor(req)
  if (!actor.isCoach) throw new ForbiddenError("Forbidden")
  const { data: r } = await getSupabaseAdmin()
    .from("practice_rounds").select("client_profile_id").eq("id", roundId).is("deleted_at", null).maybeSingle()
  if (!r) throw new NotFoundError()
  return coachPracticeScope(req, r.client_profile_id)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await params
    const { db, actorId } = await coachOn(req, roundId)
    const { round } = await loadRound(db, roundId, { id: actorId, as: "coach" })
    if (round.kind !== "case") return withCorsJson(req, { ok: false, error: "Only a case round has a rubric" }, 400)

    const body = await req.json().catch(() => null)
    const now = new Date().toISOString()
    const update: Record<string, unknown> = { review_updated_at: now, updated_at: now }
    if (body?.rubric !== undefined) update.rubric = cleanRubric(body.rubric)
    if (body?.review !== undefined) update.coach_review = cleanReview(body.review)
    const { error } = await db.from("practice_rounds").update(update).eq("id", roundId)
    if (error) throw new Error(error.message)
    return withCorsJson(req, { ok: true, saved_at: now })
  } catch (e: any) {
    return fail(req, e)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await params
    const { db, actorId } = await coachOn(req, roundId)
    const { takes } = await loadRound(db, roundId, { id: actorId, as: "coach" })
    const body = await req.json().catch(() => null)
    if (body?.action !== "transcribe") return withCorsJson(req, { ok: false, error: "Unknown action" }, 400)
    const take = takes.find((t) => t.id === String(body?.take_id ?? ""))
    if (!take) return withCorsJson(req, { ok: false, error: "That recording is not in this round" }, 400)
    const r = await transcribeTake(db, take.id)
    return withCorsJson(req, { ok: r.ok, status: r.status, error: r.error ?? null }, r.ok ? 200 : 502)
  } catch (e: any) {
    return fail(req, e)
  }
}
