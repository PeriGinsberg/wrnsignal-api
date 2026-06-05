// app/api/_lib/coachActivities.ts
//
// Shared building blocks for the Deliverable Activities API — a sub-resource of
// coach_milestones (coach_milestone_activities). Auth / scoping is REUSED from
// ./coachPackages (the same generic coach-route helpers — bearer → authed user
// → coach profile → is_coach — used across the coach API); not reinvented here.
//
// SECURITY: coach_milestone_activities has NO coach_profile_id and NO RLS —
// ownership reaches through milestone_id → coach_milestones.coach_profile_id.
// Every activity write first verifies the PARENT deliverable belongs to the
// authed coach (isMilestoneOwnedByCoach); the [activity_id] routes additionally
// match the activity's milestone_id to the path id, so a coach can't edit
// another coach's activity by pairing it with a deliverable they do own.

import { type SupabaseClient } from "@supabase/supabase-js"

// Reuse the generic coach-route auth/scoping helpers (the recent worked example).
export { getSupabaseAdmin, resolveCoach, errStatus } from "./coachPackages"

export const ACTIVITY_OWNERS = ["coach", "client", "both"] as const
export type ActivityOwner = (typeof ACTIVITY_OWNERS)[number]

// Validate owner at the API edge with a clean 400 (the DB CHECK
// coach_milestone_activities_owner_valid is only the backstop).
export function isValidOwner(v: unknown): v is ActivityOwner {
  return typeof v === "string" && (ACTIVITY_OWNERS as readonly string[]).includes(v)
}

export type ActivityRow = {
  id: string
  milestone_id: string
  name: string
  owner: string
  sort_order: number
  created_at: string
  updated_at: string
}
export const ACTIVITY_SELECT = "id, milestone_id, name, owner, sort_order, created_at, updated_at"

export function toApiActivity(r: ActivityRow) {
  return { id: r.id, name: r.name, owner: r.owner, sort_order: r.sort_order }
}

// Ownership guard. Activities have no coach_profile_id; ownership is reached
// through the parent deliverable. Returns true iff `milestoneId` belongs to the
// coach. Throws on a real query error (mapped to 500 by the caller).
export async function isMilestoneOwnedByCoach(
  supabase: SupabaseClient,
  coachProfileId: string,
  milestoneId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("coach_milestones")
    .select("id")
    .eq("id", milestoneId)
    .eq("coach_profile_id", coachProfileId)
    .maybeSingle()
  if (error) throw new Error(`Ownership check failed: ${error.message}`)
  return !!data
}
