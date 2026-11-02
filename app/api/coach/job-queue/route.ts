// app/api/coach/job-queue/route.ts
//
// GET: the coach's Job Queue. Every active client's match queue in one list,
// one row per job (copies grouped by linker v2's rules), a chip per client.
// See lib/match/jobQueue.ts.
//
// PAGED: one response is capped at 4.5 MB by Vercel, and the whole list grows
// with every client (about 2.5 MB for 9 clients on prod data). ?page=0 builds
// the list, records the visit and returns the first PAGE_SIZE jobs with the
// clients, the reasons and `pages`; the page then asks for ?page=1.. with the
// `snap` it got back. A page request served by the same instance within
// SNAP_TTL reads the list already built; otherwise it builds it again (the
// order is total, so pages still line up unless a job changed in between; the
// page drops any job it already has).
import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { LOAD_MIN_SCORE, loadJobQueue, MATCH_REASONS, recordVisit } from "@/lib/match/jobQueue"
import { coachCaller, fail } from "./_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const PAGE_SIZE = 800
const SNAP_TTL_MS = 3 * 60e3
type Built = Awaited<ReturnType<typeof loadJobQueue>>
const snaps = new Map<string, { at: number; coach: string; q: Built }>()

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { sb, coachProfileId } = await coachCaller(req)
    const page = Math.max(0, Math.floor(Number(req.nextUrl.searchParams.get("page") ?? 0)) || 0)
    const now = Date.now()
    for (const [k, v] of snaps) if (now - v.at > SNAP_TTL_MS) snaps.delete(k)

    let snap = req.nextUrl.searchParams.get("snap") ?? ""
    let lastVisitAt: string | null = null
    let queue: Built
    const hit = page > 0 ? snaps.get(snap) : undefined
    if (hit && hit.coach === coachProfileId) {
      queue = hit.q
    } else if (page === 0) {
      ;[queue, lastVisitAt] = await Promise.all([loadJobQueue(sb, coachProfileId), recordVisit(sb, coachProfileId)])
      snap = crypto.randomUUID()
      snaps.set(snap, { at: now, coach: coachProfileId, q: queue })
    } else {
      queue = await loadJobQueue(sb, coachProfileId)
    }

    // Kept small: a chip names its client by index into clients[], requirements
    // load when a row is expanded (GET ./posting), and empty fields are left out.
    const index = new Map(queue.clients.map((c, i) => [c.id, i]))
    const jobs = queue.jobs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      .map(({ req: _req, ...j }) => ({ ...j, m: j.m.map((c) => ({ ...c, c: index.get(c.c) })) }))
    const pages = Math.max(1, Math.ceil(queue.jobs.length / PAGE_SIZE))
    const head = page === 0
      ? { asOf: new Date().toISOString(), lastVisitAt, minScoreLoaded: LOAD_MIN_SCORE, reasons: MATCH_REASONS, clients: queue.clients }
      : { clientIds: queue.clients.map((c) => c.id) }
    const body = JSON.stringify(
      { ok: true, snap, page, pages, total: queue.jobs.length, ...head, jobs },
      (_k, v) => (v === null || v === false ? undefined : v),
    )
    const res = withCorsJson(req, {})
    return new Response(body, { status: 200, headers: res.headers })
  } catch (err) {
    return fail(req, err)
  }
}
