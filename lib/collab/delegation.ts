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
