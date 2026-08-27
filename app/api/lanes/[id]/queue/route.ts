// app/api/lanes/[id]/queue/route.ts
// DELETE — empty this lane's review queue without touching the lane.
//
// A lane left alone for a month greets its coach with a hundred unreviewed
// rows, most of them roles filled by now. Before this, the only ways out were
// judging every row one at a time or deleting the lane, and deleting the lane
// throws away the review history, which is the part worth keeping.
//
// WHAT IT WRITES, and why it is not a delete. Unreviewed rows are marked
// action = 'cleared' rather than removed. The runner upserts on
// (lane_id, job_id), so a deleted row is re-inserted by the next run with a
// fresh first_seen_at and lands straight back in the queue: a clear that
// deletes would appear to work until the next morning. The kept row is
// refreshed in place instead, and stays out of the queue because it has an
// action. See 20260827_lane_result_cleared.sql.
//
// WHAT IT LEAVES ALONE. Everything already actioned. The update filters on
// action IS NULL, so pushes and dismissals keep their reason, note and
// actioned_at exactly as the reviewer left them. That filter is also what makes
// running this twice a no-op rather than a rewrite of the review history.
//
// 'cleared' is deliberately not a dismissal. Dismissal reasons exist to be
// counted, and a bulk clear filed under one of them would put a hundred
// imaginary judgements into a count that is supposed to say whether the lane's
// titles are wrong.
//
// ACCESS. 'configure', the same level as editing titles or deleting the lane,
// not the 'review' level a per-row decision needs. Clearing is a lane-wide act
// that empties the queue for everyone who works it, and it is not a judgement
// about any job in it.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { loadAuthorizedLane } from "@/lib/collab/laneAccess"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await resolveCaller(req)
    const { id } = await params
    const supabase = getSupabaseAdmin()

    const { lane, error } = await loadAuthorizedLane(
      id,
      profileId,
      "configure",
      supabase,
      "id, client_profile_id, name"
    )
    if (error) return withCorsJson(req, { ok: false, error }, error === "Forbidden" ? 403 : 404)

    const { data, error: upErr } = await supabase
      .from("lane_results")
      .update({ action: "cleared", actioned_at: new Date().toISOString() })
      .eq("lane_id", id)
      // The guard on the review history. Without it this rewrites every
      // dismissal on the lane into a clear.
      .is("action", null)
      .select("id")
    if (upErr) throw new Error(`Clear failed: ${upErr.message}`)

    return withCorsJson(
      req,
      { ok: true, lane: { id, name: lane.name }, cleared: data?.length ?? 0 },
      200
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const s = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, s)
  }
}
