// lib/collab/delegation.ts
//
// WHICH COACHES MAY THIS CALLER ACT AS.
//
// A delegate coach works inside a principal's practice: she reaches the
// principal's clients at the principal's level, and has no clients of her own.
// Everything that used to ask "is there a coach_clients row where
// coach_profile_id = me" now asks "... = any of my acting ids".
//
// Mirrors coach_acting_ids() in 20260923_coach_delegates.sql. The SQL version
// guards the policies; this one guards the routes. They must agree, so both read
// coach_delegates with the same two conditions: the delegate is the caller, and
// the row is active.
//
// ATTRIBUTION IS NOT AFFECTED. Acting ids answer what she may reach, never who
// did it: every write still stamps the caller's own profile id.

import type { SupabaseClient } from "@supabase/supabase-js"

export type Delegation = {
  /** The caller's own profile id, always first. */
  callerId: string
  /** Principals the caller may act for. Empty for an ordinary coach. */
  principalIds: string[]
  /** callerId plus principalIds: what an access check should match against. */
  actingIds: string[]
  isDelegate: boolean
}

export async function resolveDelegation(
  supabase: SupabaseClient,
  callerId: string,
): Promise<Delegation> {
  const { data, error } = await supabase
    .from("coach_delegates")
    .select("principal_coach_profile_id")
    .eq("delegate_coach_profile_id", callerId)
    .eq("status", "active")
  // A failed read must not quietly downgrade someone to "no delegation": that
  // would 403 a delegate mid-session and look like a permissions bug.
  if (error) throw new Error(`Delegation lookup failed: ${error.message}`)

  const principalIds = Array.from(
    new Set((data ?? []).map((r) => r.principal_coach_profile_id as string).filter((id) => id && id !== callerId)),
  )
  return {
    callerId,
    principalIds,
    actingIds: [callerId, ...principalIds],
    isDelegate: principalIds.length > 0,
  }
}

/**
 * The principal a delegate's new records belong to: their roster, their seat cap.
 * An ordinary coach is their own principal. With several principals (not a case
 * the product creates today) the first is used and the caller is told to pass one
 * explicitly rather than have it guessed.
 */
export function owningCoachId(d: Delegation, explicit?: string | null): string {
  if (explicit) {
    if (!d.actingIds.includes(explicit)) throw new Error("Forbidden")
    return explicit
  }
  if (d.principalIds.length > 1) {
    throw new Error("Several principals: name which practice this belongs to")
  }
  return d.principalIds[0] ?? d.callerId
}

/**
 * Every coach on a client's team: each coach with an active link to the client,
 * plus each of their active delegates. Used where the question is "did someone
 * on this client's team do it" rather than "did I": a principal and her
 * delegate both act on jobs either of them added, in both directions. Acting
 * ids only run delegate to principal, so they cannot answer this.
 */
export async function clientTeamCoachIds(
  supabase: SupabaseClient,
  clientProfileId: string,
): Promise<string[]> {
  const { data: links, error } = await supabase
    .from("coach_clients")
    .select("coach_profile_id")
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
  if (error) throw new Error(`Client team lookup failed: ${error.message}`)
  const coaches = Array.from(new Set((links ?? []).map((l) => l.coach_profile_id as string).filter(Boolean)))
  if (!coaches.length) return []
  const { data: dels, error: dErr } = await supabase
    .from("coach_delegates")
    .select("delegate_coach_profile_id")
    .in("principal_coach_profile_id", coaches)
    .eq("status", "active")
  if (dErr) throw new Error(`Delegation lookup failed: ${dErr.message}`)
  return Array.from(new Set([...coaches, ...(dels ?? []).map((d) => d.delegate_coach_profile_id as string)]))
}

/**
 * Whether a coach on the client's team added this tracker job, and the
 * recommendation rows linked to it. A job is coach-added when a team coach's
 * recommendation links to it, or when the job itself says a team coach added it
 * (added_by_role 'coach', added_by_profile_id). Job Queue Add Job and Source a
 * Job both write the column, so a job never depends on the recommendation link
 * alone to be deletable (2026-11-05).
 */
export async function teamAddedJob(
  supabase: SupabaseClient,
  app: { id: string; profile_id: string; added_by_role?: string | null; added_by_profile_id?: string | null },
): Promise<{ coachAdded: boolean; recIds: string[] }> {
  const team = await clientTeamCoachIds(supabase, app.profile_id)
  const { data: recs, error } = await supabase
    .from("coach_job_recommendations")
    .select("id")
    .eq("application_id", app.id)
    .eq("client_profile_id", app.profile_id)
    .in("coach_profile_id", team)
  if (error) throw new Error(`Recommendation lookup failed: ${error.message}`)
  const recIds = (recs ?? []).map((r) => r.id as string)
  const byColumn = app.added_by_role === "coach" && !!app.added_by_profile_id && team.includes(app.added_by_profile_id)
  return { coachAdded: recIds.length > 0 || byColumn, recIds }
}
