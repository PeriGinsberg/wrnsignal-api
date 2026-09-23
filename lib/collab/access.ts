// lib/collab/access.ts
//
// Shared coach-access check for coach-collaboration routes.
//
// Lifted EXACTLY from the inline `verifyCoachAccess` duplicated across the
// coach API routes. Rules are unchanged:
//   - the relationship row must exist in coach_clients for
//     (coach_profile_id, client_profile_id) with status = 'active'
//   - the row's access_level must satisfy the requested level, where
//       view     is granted by view | annotate | full
//       annotate is granted by annotate | full
//       full     is granted by full
// Returns the matched { id, access_level, status } row, or null on deny.
//
// A DELEGATE coach acts inside a principal's practice, so the row that grants
// access may belong to the principal rather than the caller. We match any coach
// the caller may act as and keep the strongest row; a delegation can only add
// access, never lower what the caller already held in their own right.

import { type SupabaseClient } from "@supabase/supabase-js"
import { resolveDelegation } from "./delegation"

export async function verifyCoachAccess(
  coachProfileId: string,
  clientProfileId: string,
  requiredLevel: string,
  supabase: SupabaseClient,
) {
  const levels: Record<string, string[]> = { view: ["view", "annotate", "full"], annotate: ["annotate", "full"], full: ["full"] }
  const { actingIds } = await resolveDelegation(supabase, coachProfileId)
  const { data, error } = await supabase
    .from("coach_clients")
    .select("id, access_level, status, coach_profile_id")
    .in("coach_profile_id", actingIds)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
  if (error) throw new Error(`coach_clients lookup failed: ${error.message}`)
  const rank: Record<string, number> = { view: 1, annotate: 2, full: 3 }
  return (data ?? [])
    .filter((r: any) => levels[requiredLevel]?.includes(r.access_level))
    .sort((a: any, b: any) => rank[b.access_level] - rank[a.access_level])[0] ?? null
}
