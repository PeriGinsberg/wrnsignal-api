// app/api/coach/job-queue/route.ts
//
// GET: the coach's Job Queue. Every active client's match queue in one list,
// one row per job (copies grouped by linker v2's rules), a chip per client.
// Records the visit: lastVisitAt is the coach's previous visit, for "new since
// my last visit". See lib/match/jobQueue.ts.
import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { LOAD_MIN_SCORE, loadJobQueue, MATCH_REASONS, recordVisit } from "@/lib/match/jobQueue"
import { coachCaller, fail } from "./_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { sb, coachProfileId } = await coachCaller(req)
    const [queue, lastVisitAt] = await Promise.all([loadJobQueue(sb, coachProfileId), recordVisit(sb, coachProfileId)])
    // Kept well under the 4.5 MB function response cap (about 2.5 MB for 9
    // clients on prod data): a chip names its client by index into clients[],
    // requirements load when a row is expanded (GET ./posting), and empty
    // fields are left out.
    const index = new Map(queue.clients.map((c, i) => [c.id, i]))
    const jobs = queue.jobs.map(({ req: _req, ...j }) => ({ ...j, m: j.m.map((c) => ({ ...c, c: index.get(c.c) })) }))
    const body = JSON.stringify(
      { ok: true, asOf: new Date().toISOString(), lastVisitAt, minScoreLoaded: LOAD_MIN_SCORE, reasons: MATCH_REASONS, clients: queue.clients, jobs },
      (_k, v) => (v === null || v === false ? undefined : v),
    )
    const res = withCorsJson(req, {})
    return new Response(body, { status: 200, headers: res.headers })
  } catch (err) {
    return fail(req, err)
  }
}
