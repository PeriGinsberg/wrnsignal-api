// app/api/me/proof-project/route.ts
//
// CLIENT-FACING read of the coached client's proof project — the engagement
// flagged is_proof_project, rendered by the hub as a journey rather than a plan.
// Same identity + gate as the other /api/me routes (bearer → profile → active
// coach relationship), scoped explicitly because service-role bypasses RLS.
//
// TWO WAYS THIS DELIBERATELY DIFFERS FROM /api/me/activities:
//
// 1. IT RETURNS COACH-OWNED ACTIVITIES. /api/me/activities filters to owner in
//    ('client','both') because it answers "what do I have to do". This page
//    answers "how far along is the whole project", and the feature is specified
//    on facts that only coach-owned rows carry: the percentage counts every
//    task, the calendar colours BY OWNER, and the unlock is triggered by the
//    coach's own sign-off step. Hiding them would make the percentage lie.
//    Only name/owner/status/due_date cross — never fees, never source_*_id,
//    never notes. Coach-private NOTES still never appear here; this widens which
//    TASKS are visible, not which commentary is.
//
// 2. IT WITHHOLDS LOCKED SPEAKING POINTS. The text is the reward for finishing a
//    deliverable, so sending it before the unlock — even with the UI hiding it —
//    would put the payoff in the network tab. `speaking_point` is null until the
//    deliverable is signed off; `has_speaking_point` says whether one exists so
//    the page can draw a locked card instead of nothing.
//
// Read-only. No writes, no status transitions; completing a task stays with
// /api/me/activities/[activity_id].

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getActiveCoachRelationship } from "../../_lib/coachedClient"
import { getAuthedUser, getProfileId, getSupabaseAdmin } from "../../_lib/meAuth"
import {
  byOrder,
  isSignedOff,
  type Owner,
  type ProofActivity,
} from "../../../../lib/proofProject"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// How far back to read completion events for the streak. A streak longer than
// this is capped, which no real engagement will reach; the bound exists so the
// query cannot grow without limit on a long-running relationship.
const STREAK_WINDOW_DAYS = 400

type DelivRow = {
  id: string
  name: string
  sort_order: number
  created_at: string
  speaking_point: string | null
  why_this_matters: string | null
}

type ActRow = {
  id: string
  name: string
  status: string
  owner: string
  due_date: string | null
  sort_order: number
  created_at: string
  is_signoff: boolean
  engagement_deliverable_id: string
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // No coach, no flagged engagement, no deliverables — all the same answer:
    // a null project, 200. The page renders its empty state; a non-coached user
    // who guesses the URL sees exactly this rather than an error that would
    // confirm anything.
    const empty = () => withCorsJson(req, { ok: true, project: null })

    const rel = await getActiveCoachRelationship(supabase, profileId)
    if (!rel) return empty()

    // The flagged engagement. Ordered + limited rather than .single() because
    // nothing in the schema stops a coach flagging two (see the migration note);
    // taking the oldest is a defined answer instead of a 500.
    const { data: engData, error: engErr } = await supabase
      .from("coach_client_engagements")
      .select("id, name, attached_at")
      .eq("coach_client_id", rel.id)
      .eq("is_proof_project", true)
      .order("attached_at", { ascending: true })
      .limit(1)
    if (engErr) throw new Error(`Proof project lookup failed: ${engErr.message}`)
    const engagement = (engData ?? [])[0] as { id: string; name: string; attached_at: string } | undefined
    if (!engagement) return empty()

    const { data: delivData, error: delivErr } = await supabase
      .from("coach_client_engagement_deliverables")
      .select("id, name, sort_order, created_at, speaking_point, why_this_matters")
      .eq("engagement_id", engagement.id)
    if (delivErr) throw new Error(`Deliverables lookup failed: ${delivErr.message}`)
    const delivs = ((delivData ?? []) as DelivRow[]).sort(byOrder)
    if (delivs.length === 0) return empty()

    // EVERY owner — see note 1 in the header.
    const { data: actData, error: actErr } = await supabase
      .from("coach_client_engagement_activities")
      .select("id, name, status, owner, due_date, sort_order, created_at, is_signoff, engagement_deliverable_id")
      .in("engagement_deliverable_id", delivs.map((d) => d.id))
    if (actErr) throw new Error(`Activities lookup failed: ${actErr.message}`)

    const actsByDeliv = new Map<string, ProofActivity[]>()
    for (const a of (actData ?? []) as ActRow[]) {
      const list = actsByDeliv.get(a.engagement_deliverable_id) ?? []
      list.push({
        id: a.id,
        name: a.name,
        owner: a.owner as Owner,
        status: a.status as ProofActivity["status"],
        due_date: a.due_date,
        sort_order: a.sort_order,
        created_at: a.created_at,
        is_signoff: a.is_signoff,
      })
      actsByDeliv.set(a.engagement_deliverable_id, list)
    }

    const deliverables = delivs.map((d) => {
      const activities = (actsByDeliv.get(d.id) ?? []).sort(byOrder)
      const unlocked = isSignedOff(activities)
      return {
        id: d.id,
        name: d.name,
        sort_order: d.sort_order,
        created_at: d.created_at,
        activities,
        has_speaking_point: !!(d.speaking_point && d.speaking_point.trim()),
        // Withheld until earned — see note 2 in the header. why_this_matters is
        // part of the same reveal and is gated identically; sending the coach's
        // framing early would give away the reward it frames.
        speaking_point: unlocked && d.speaking_point?.trim() ? d.speaking_point : null,
        why_this_matters: unlocked && d.why_this_matters?.trim() ? d.why_this_matters : null,
      }
    })

    // ── Streak source ──
    //
    // activity_completed events on this RELATIONSHIP. Two honest limitations,
    // both preferred to inventing a number:
    //
    //   - Relationship-wide, not proof-project-scoped. The event context carries
    //     the engagement NAME but no id, and matching on a mutable name would be
    //     worse than the over-count. A client with a second engagement can see a
    //     streak day earned outside this project.
    //   - The events are written best-effort (logCoachClientEvent swallows its
    //     failures by design), so a dropped write shortens a streak. It cannot
    //     invent one.
    //
    // Raw timestamps go to the client and the streak is computed there, in the
    // VIEWER'S timezone. Computing it here in UTC would break a streak for
    // anyone whose evening lands on the next UTC day.
    const since = new Date(Date.now() - STREAK_WINDOW_DAYS * 86_400_000).toISOString()
    const { data: evData, error: evErr } = await supabase
      .from("coach_client_events")
      .select("created_at")
      .eq("coach_client_id", rel.id)
      .eq("event_type", "activity_completed")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
    if (evErr) throw new Error(`Completion events lookup failed: ${evErr.message}`)
    const completions = ((evData ?? []) as { created_at: string }[]).map((e) => e.created_at)

    return withCorsJson(req, {
      ok: true,
      project: {
        engagement_id: engagement.id,
        name: engagement.name,
        started_at: engagement.attached_at,
        deliverables,
        completions,
      },
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
