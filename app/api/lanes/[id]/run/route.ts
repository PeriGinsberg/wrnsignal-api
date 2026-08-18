// app/api/lanes/[id]/run/route.ts
// POST — run this lane now.
//
// The nightly sweep would get to it eventually; this is for when "eventually" is
// not good enough — a lane whose titles were just edited, or one a coach wants to
// work through while the client is on the phone.
//
// Requires FULL access, matching the rest of the lane edit screen. Running is not
// a config change, but it writes results into the client's queue and spends
// requests against a third party, so it sits with pause rather than with review.
//
// Idempotent in the way that matters: (lane_id, job_id) is unique, so running
// twice refreshes rather than duplicates. `added` is what is genuinely new.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { loadAuthorizedLane } from "@/lib/collab/laneAccess"
import { runLaneLogged, type Lane } from "@/lib/laneRunner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// One board request per title, serially. A wide lane is not quick.
export const maxDuration = 300

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await resolveCaller(req)
    const { id } = await params
    const supabase = getSupabaseAdmin()

    const { lane, error } = await loadAuthorizedLane(id, profileId, "configure", supabase)
    if (error) return withCorsJson(req, { ok: false, error }, error === "Forbidden" ? 403 : 404)

    // A paused lane is skipped by the sweep, not disabled. Running it by hand is
    // an explicit act by someone looking straight at the pause control, so it is
    // allowed — and reported, so the result is not mistaken for the schedule
    // having resumed.
    const wasPaused = !(lane as any).active

    const outcome = await runLaneLogged(lane as Lane, supabase, "manual")
    if (!outcome.ok) {
      // 200, not 500: the run was attempted and the attempt is recorded. The
      // caller needs to show what happened, not retry a server fault.
      return withCorsJson(req, { ok: false, error: outcome.error, logged: true, was_paused: wasPaused }, 200)
    }

    return withCorsJson(
      req,
      {
        ok: true,
        was_paused: wasPaused,
        run: {
          found: outcome.found,
          added: outcome.result.added,
          refreshed: outcome.result.refreshed,
          titles: outcome.result.perTitle.map((t) => ({
            title: t.title,
            query: t.query,
            fetched: t.fetched,
            available: t.available,
            capped: t.capped,
            kept: t.kept,
          })),
        },
      },
      200
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
