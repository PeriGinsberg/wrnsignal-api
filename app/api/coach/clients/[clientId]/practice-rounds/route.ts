// GET  — every practice round for this client, newest first.
// POST — create a draft round with its questions.
//
// Coach side. The client never reaches this path.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { coachPracticeScope } from "@/lib/practice/server"
import { cleanQuestions } from "@/lib/practice/model"
import { ForbiddenError } from "@/lib/collab/scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

function fail(req: NextRequest, e: any) {
  if (e instanceof ForbiddenError) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)
  console.error("[practice-rounds]", e?.message ?? e)
  return withCorsJson(req, { ok: false, error: "Something went wrong" }, 500)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params
    const { db, scope } = await coachPracticeScope(req, clientId)

    const { data: rounds, error } = await db
      .from("practice_rounds")
      .select("id, title, status, created_at, sent_at, submitted_at, feedback_sent_at")
      .eq("client_profile_id", scope.subjectId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
    if (error) throw new Error(error.message)

    const ids = (rounds ?? []).map((r) => r.id)
    // Counts only. The builder loads a single round in full; a list that
    // carried every question and take would grow without bound.
    const counts: Record<string, { questions: number; answered: number }> = {}
    if (ids.length) {
      const { data: qs } = await db.from("practice_questions").select("id, round_id").in("round_id", ids)
      const { data: ts } = await db.from("practice_takes").select("question_id, round_id").in("round_id", ids)
      for (const id of ids) counts[id] = { questions: 0, answered: 0 }
      for (const q of qs ?? []) counts[q.round_id].questions++
      const seen = new Set<string>()
      for (const t of ts ?? []) {
        const k = `${t.round_id}:${t.question_id}`
        if (seen.has(k)) continue
        seen.add(k)
        counts[t.round_id].answered++
      }
    }

    return withCorsJson(req, {
      ok: true,
      rounds: (rounds ?? []).map((r) => ({ ...r, ...counts[r.id] })),
    })
  } catch (e: any) {
    return fail(req, e)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params
    const { db, scope, actorId, coachClientId } = await coachPracticeScope(req, clientId)
    const body = await req.json().catch(() => null)

    const cleaned = cleanQuestions(body?.questions)
    if (!cleaned.ok) return withCorsJson(req, { ok: false, error: cleaned.error }, 400)

    const { data: round, error } = await db
      .from("practice_rounds")
      .insert({
        coach_client_id: coachClientId,
        client_profile_id: scope.subjectId,
        coach_profile_id: actorId,
        title: String(body?.title ?? "").trim() || "Practice round",
      })
      .select("id")
      .maybeSingle()
    if (error || !round) throw new Error(error?.message ?? "insert returned nothing")

    const { error: qErr } = await db
      .from("practice_questions")
      .insert(cleaned.questions.map((q) => ({ ...q, round_id: round.id })))
    if (qErr) {
      // A round with no questions is not usable and should not linger.
      await db.from("practice_rounds").delete().eq("id", round.id)
      throw new Error(qErr.message)
    }

    return withCorsJson(req, { ok: true, round_id: round.id }, 201)
  } catch (e: any) {
    return fail(req, e)
  }
}
