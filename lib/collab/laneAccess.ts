// lib/collab/laneAccess.ts
//
// Who may see and act on a lane.
//
// Lanes were built single-tenant: every route asked "is lane.client_profile_id
// the caller's own profile id", which is true for a client looking at their own
// lanes and false for a coach looking at a client's. Adding the coach case to
// four routes independently is how the four drift apart, so the rule lives here
// once.
//
// Two levels of question, deliberately kept apart:
//
//   laneScopeIds()       — WHOSE lanes may I list? (own + coached roster)
//   canAccessLaneOwner() — may I do THIS to a lane owned by that profile?
//
// The first is for listing, where the answer is a set. The second is for a
// specific lane and a specific act, where the answer depends on access_level.
// Using the scope set as an authorization check for a write would grant a
// view-only coach the right to edit, so the two are not interchangeable.

import { type SupabaseClient } from "@supabase/supabase-js"
import { verifyCoachAccess } from "./access"

/** Coach access level required for each kind of act on someone else's lane. */
export type LaneAct = "read" | "review" | "configure" | "send"

// read      — see the lane, its results, run discovery
// review    — push/dismiss a result. 'annotate' because that is what reviewing
//             a queue is: a per-row judgement on the client's behalf, the same
//             grant that lets a coach annotate their work elsewhere.
// configure — change the lane's titles. 'full' because titles decide what the
//             lane will ever find; a coach who may comment on results should
//             not silently redirect the search that produces them.
// send      — score a result and put it on the client's tracker. 'full' to match
//             /api/coach/recommend-job, which refuses anything less. Checked
//             here as well so the button can be disabled up front: discovering
//             you lack access AFTER pasting a job description is a wasted trip.
const LEVEL_FOR: Record<LaneAct, string> = {
  read: "view",
  review: "annotate",
  configure: "full",
  send: "full",
}

/**
 * Profile ids whose lanes this caller may list: their own, plus every client
 * they actively coach.
 *
 * Own id is always first, so a UI that wants a stable primary has one without
 * asking a second question.
 */
export async function laneScopeIds(profileId: string, supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase
    .from("coach_clients")
    .select("client_profile_id")
    .eq("coach_profile_id", profileId)
    .eq("status", "active")

  const ids = [profileId]
  for (const row of data ?? []) {
    const id = (row as any).client_profile_id
    // A coach who is somehow also their own client would otherwise appear twice
    // and render two identical lane tabs.
    if (id && id !== profileId) ids.push(id)
  }
  return ids
}

/**
 * May the caller perform `act` on a lane owned by `ownerProfileId`?
 *
 * Own lanes are unconditional — there is no coach_clients row for yourself, and
 * requiring one would lock a client out of their own lane.
 */
export async function canAccessLaneOwner(
  ownerProfileId: string,
  profileId: string,
  act: LaneAct,
  supabase: SupabaseClient
): Promise<boolean> {
  if (ownerProfileId === profileId) return true
  const granted = await verifyCoachAccess(profileId, ownerProfileId, LEVEL_FOR[act], supabase)
  return Boolean(granted)
}

/**
 * Load a lane and authorize it in one step, so no route can accidentally do the
 * first without the second.
 *
 * Returns a discriminated result rather than throwing: the routes turn these
 * into 404/403 with their own CORS wrapper.
 */
export async function loadAuthorizedLane(
  laneId: string,
  profileId: string,
  act: LaneAct,
  supabase: SupabaseClient,
  // `filters` MUST be here. It was omitted, so every run that loaded a lane
  // through this helper applied no board filters at all — the lane stored them,
  // the edit screen showed them, and the nightly run ignored them. Nothing about
  // that failure is visible in the results: you get more jobs, which looks like
  // a good night.
  columns = "id, client_profile_id, name, active, titles, keyword, location, years_max, companies, exclusions, filters"
): Promise<{ lane: any; error: null } | { lane: null; error: "Lane not found" | "Forbidden" }> {
  const { data } = await supabase.from("search_lanes").select(columns).eq("id", laneId).maybeSingle()
  if (!data) return { lane: null, error: "Lane not found" }
  const owner = (data as any).client_profile_id
  if (!(await canAccessLaneOwner(owner, profileId, act, supabase))) {
    return { lane: null, error: "Forbidden" }
  }
  return { lane: data, error: null }
}
