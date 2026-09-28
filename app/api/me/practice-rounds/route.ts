// GET — the client's own practice rounds, newest first.
//
// Drafts are excluded: a round the coach has not sent does not exist as far as
// the client is concerned, which is the same rule loadRound applies.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { clientPracticeScope } from "@/lib/practice/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { db, actorId } = await clientPracticeScope(req)

    const { data: rounds, error } = await db
      .from("practice_rounds")
      .select("id, title, status, sent_at, submitted_at, feedback_sent_at")
      .eq("client_profile_id", actorId)
      .is("deleted_at", null)
      .neq("status", "draft")
      .order("created_at", { ascending: false })
    if (error) throw new Error(error.message)

    const ids = (rounds ?? []).map((r) => r.id)
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
    console.error("[me/practice-rounds]", e?.message ?? e)
    return withCorsJson(req, { ok: false, error: "Something went wrong" }, 500)
  }
}
