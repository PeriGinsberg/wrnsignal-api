// GET — every practice round across every client this coach works with.
//
// The per-client list answers "where is this client up to". This one answers
// the question a coach actually opens the app with: "what is waiting on me?"
// Those are different enough to be different endpoints; folding them together
// would mean the cross-client page fetched one client at a time.
//
// SCOPED THROUGH coach_clients, not through the rounds. A round carries
// coach_profile_id, but reading on that alone would hide a round a delegate
// built on the principal's behalf, and show nothing at all to a delegate who
// has just been given the relationship. The relationship is the authority.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin } from "../../_lib/coachAuth"
import { resolveActor, ForbiddenError } from "@/lib/collab/scope"
import { resolveDelegation } from "@/lib/collab/delegation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveActor(req)
    if (!actor.isCoach) throw new ForbiddenError("Forbidden")
    const db = getSupabaseAdmin()

    // Which coaches this caller may act as: themselves, plus any principal
    // whose practice they are a delegate in. The same resolution the clients
    // list uses, so a delegate's practice page shows the same book as their
    // My Clients page rather than a subset of it.
    const { actingIds } = await resolveDelegation(db, actor.actorId)

    const { data: links, error: linkErr } = await db
      .from("coach_clients")
      .select("id, client_profile_id, coach_profile_id")
      .eq("status", "active")
      .in("coach_profile_id", actingIds)
    if (linkErr) throw new Error(linkErr.message)

    const clientIds = [...new Set((links ?? []).map((l) => l.client_profile_id))]
    if (clientIds.length === 0) return withCorsJson(req, { ok: true, rounds: [] })

    const { data: rounds, error } = await db
      .from("practice_rounds")
      .select("id, title, status, created_at, sent_at, submitted_at, feedback_sent_at, client_profile_id")
      .in("client_profile_id", clientIds)
      .is("deleted_at", null)
      // A draft is a page the coach is still writing, not a round. It belongs
      // on the client's own tab, where they left it, not in a cross-client
      // worklist that is meant to read as "these are real".
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

    const { data: people } = await db
      .from("client_profiles").select("id, name, email").in("id", clientIds)
    const nameOf = new Map((people ?? []).map((p) => [p.id, String(p.name ?? "").trim() || p.email || "Unnamed"]))

    return withCorsJson(req, {
      ok: true,
      rounds: (rounds ?? []).map((r) => ({
        ...r,
        ...counts[r.id],
        client_name: nameOf.get(r.client_profile_id) ?? "Unnamed",
      })),
    })
  } catch (e: any) {
    if (e instanceof ForbiddenError) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)
    console.error("[coach/practice-rounds]", e?.message ?? e)
    return withCorsJson(req, { ok: false, error: "Something went wrong" }, 500)
  }
}
