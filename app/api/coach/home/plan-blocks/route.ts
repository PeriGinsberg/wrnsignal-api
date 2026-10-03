// app/api/coach/home/plan-blocks/route.ts
//
// GET Coach Home's plan blocks: follow-ups due (client tasks waiting 3 or more
// days) and clients by phase. My active tasks is the To-Do list itself
// (/api/coach/tasks). See lib/plan/home.ts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { errStatus, getSupabaseAdmin, resolveCoach } from "../../../_lib/coachAuth"
import { getHomeBlocks } from "@/lib/plan/home"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { delegation, error } = await resolveCoach(req)
    if (error) return error
    const blocks = await getHomeBlocks(getSupabaseAdmin(), delegation.actingIds)
    return withCorsJson(req, { ok: true, follow_ups: blocks.followUps, clients_by_phase: blocks.clientsByPhase })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
